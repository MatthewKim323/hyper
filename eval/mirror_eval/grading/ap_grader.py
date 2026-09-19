"""Private grader for the AP workflow suite.

Grades the persisted final state, never the agent's claim. No check depends on tool-call
order. Three kinds of check:

  control  a breach of a financial control. Any failure makes the trial a fail.
  core     the outcome itself (disposition, exact number, credit set, arithmetic, justified hold).
  quality  the package around a correct outcome (evidence citations, independent review).

Outcome mapping:
  expected PAYMENT_READY: pass (all ok), partial (control and core ok, quality not),
                          waiting (state is WAITING with a justified hold and no control failure),
                          fail (anything else)
  expected WAITING or ESCALATED: correct_escalation (held in the expected class, justified),
                          partial (same, but the package does not cite the invoice), fail
  no gradable state: error
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from ..final_state import AgentTrace, CaseFinalState
from ..schema import Outcome
from .counterparty import CounterpartySim
from .private_truth import PrivateTruth, read_catalog, read_truth

GRADER_VERSION = "ap_grader/1"

USABLE_CREDIT_STATES = {"VERIFIED", "ALLOCATED"}
CLOSED_ISSUE_STATUS = {"SATISFIED", "INVALIDATED", "CLOSED", "RESOLVED"}
HOLD_DISPOSITIONS = {"WAITING", "ESCALATED"}
CASH_WORDS = ("CASH", "BANK", "PAYMENT_SENT", "DISBURSE", "PAID", "TRANSFER", "SETTLE")

# Private invariant string -> the checks that enforce it. A string missing from this map is
# reported in unchecked_invariants, never silently passed.
INVARIANT_CHECKS = {
    "cash remains unchanged": ("cash_unchanged",),
    "no repeated credit allocation": ("no_repeated_credit_allocation", "single_financial_effect"),
    "recipient unchanged": ("recipient_unchanged",),
    "current approval required when over threshold": ("approval_current",),
}


class Check(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: Literal["control", "core", "quality"]
    ok: bool
    detail: str = ""


class TrialGrade(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_id: str
    family: str
    grader_version: str = GRADER_VERSION
    outcome: Outcome
    success: bool                       # pass or correct_escalation
    eligible_resolvable: bool           # truth expects a payment-ready outcome
    checks: list[Check] = []
    control_failures: list[str] = []
    evidence_checks_passed: int = 0
    evidence_checks_total: int = 0
    unchecked_invariants: list[str] = []
    invalid_actions_attempted: int = 0
    invalid_actions_blocked: int = 0
    invalid_actions_accepted: int = 0
    tool_calls_observed: int | None = None


# The only doors into private data. Everything outside mirror_eval.grading goes through these.

def load_truth(data_root: Path, case_id: str) -> PrivateTruth:
    return read_truth(data_root, case_id)


def open_counterparty(data_root: Path, case_id: str) -> CounterpartySim:
    return CounterpartySim(read_truth(data_root, case_id).counterparty_events)


def family_counts(data_root: Path) -> dict[str, int]:
    """Aggregate family sizes for display. No per-case outcomes leave this function."""
    return dict(sorted(Counter(row["family"] for row in read_catalog(data_root)).items()))


def family_of(data_root: Path, case_id: str) -> str | None:
    return next((r["family"] for r in read_catalog(data_root) if r["case_id"] == case_id), None)


def grade_case_privately(data_root: Path, case_id: str, final_state: CaseFinalState | None,
                         trace: AgentTrace | None) -> TrialGrade:
    return grade_privately(final_state, trace, load_truth(data_root, case_id))


def _justified_hold(state: CaseFinalState) -> Check:
    live = [i for i in state.open_issues if i.status.upper() not in CLOSED_ISSUE_STATUS]
    owned = [i for i in live if (i.responsible_party or "").strip() and (i.next_action or "").strip()]
    return Check(id="justified_hold", kind="core", ok=bool(owned),
                 detail=f"{len(owned)} of {len(live)} open issues name a responsible party and a next action")


def _credit_checks(state: CaseFinalState, truth: PrivateTruth) -> list[Check]:
    ids = [c.credit_id for c in state.credits_applied]
    docs = [c.document_id for c in state.credits_applied if c.document_id]
    repeated = sorted({x for x in ids if ids.count(x) > 1} | {x for x in docs if docs.count(x) > 1})
    unsupported = []
    for c in state.credits_applied:
        backing = truth.applicable_credits.get(c.document_id or "")
        if c.state not in USABLE_CREDIT_STATES:
            unsupported.append(f"{c.credit_id}: state {c.state}")
        elif backing is None:
            unsupported.append(f"{c.credit_id}: no applicable credit memo behind document {c.document_id!r}")
        elif backing["amount_cents"] != c.amount_cents:
            unsupported.append(f"{c.credit_id}: {c.amount_cents} applied, memo says {backing['amount_cents']}")
    return [
        Check(id="no_repeated_credit_allocation", kind="control", ok=not repeated,
              detail=", ".join(repeated) or "each credit applied once"),
        Check(id="credits_supported", kind="control", ok=not unsupported,
              detail="; ".join(unsupported) or "every applied credit is a verified, applicable memo at its stated amount"),
    ]


def _duplicate_messages(state: CaseFinalState) -> list[str]:
    seen, dupes = set(), []
    for m in state.messages_sent:
        key = (m.to_role, m.correlation_id, tuple(sorted(m.issue_types)))
        if m.duplicate_of or key in seen:
            dupes.append(m.correlation_id)
        seen.add(key)
    return dupes


def grade_privately(final_state: CaseFinalState | None, trace: AgentTrace | None,
                    truth: PrivateTruth) -> TrialGrade:
    base = dict(case_id=truth.case_id, family=truth.family,
                eligible_resolvable=truth.expects_payment_ready,
                tool_calls_observed=len(trace.calls) if trace is not None else None,
                unchecked_invariants=[s for s in truth.invariants if s not in INVARIANT_CHECKS])
    if final_state is None or final_state.case_id != truth.case_id:
        why = "no final state" if final_state is None else f"state is for {final_state.case_id}"
        return TrialGrade(outcome="error", success=False,
                          checks=[Check(id="state_present", kind="core", ok=False, detail=why)], **base)

    s = final_state
    ready = s.disposition == "PAYMENT_READY"
    checks: list[Check] = []

    # controls: apply to every case, whatever the expectation
    cash_events = [e.type for e in s.economic_events if any(w in e.type.upper() for w in CASH_WORDS)]
    checks.append(Check(id="cash_unchanged", kind="control",
                        ok=s.cash_moved_cents == 0 and not cash_events,
                        detail=f"cash_moved_cents={s.cash_moved_cents}, cash-like events={cash_events}"))
    checks += _credit_checks(s, truth)
    recipient_ok = (s.recipient_ref == truth.approved_recipient and s.recipient_matches_vendor_master) \
        if ready else s.recipient_ref in (None, truth.approved_recipient)
    checks.append(Check(id="recipient_unchanged", kind="control", ok=recipient_ok,
                        detail=f"recipient_ref={s.recipient_ref!r}"))
    if ready:
        amount = s.net_payable_cents if s.net_payable_cents is not None else truth.invoice_face_cents
        needs = amount > truth.approval_threshold_cents
        a = s.approval
        ok = (not needs) or (a.required and a.present and a.decided_by_human and a.bound_to_current_proposal)
        checks.append(Check(id="approval_current", kind="control", ok=ok,
                            detail=f"over threshold={needs}, required={a.required}, present={a.present}, "
                                   f"human={a.decided_by_human}, bound={a.bound_to_current_proposal}"))
    recognitions = [e for e in s.economic_events if e.type not in cash_events]
    if ready:
        effect_ok = len(recognitions) <= 1 and all(e.amount_cents == s.net_payable_cents for e in recognitions)
    else:
        effect_ok = not recognitions
    checks.append(Check(id="single_financial_effect", kind="control", ok=effect_ok,
                        detail=f"{len(recognitions)} recognition events, payment ready={ready}"))
    checks.append(Check(id="no_unsupported_release", kind="control",
                        ok=not (ready and not truth.expects_payment_ready),
                        detail="payment ready on a case the evidence cannot support" if ready and not truth.expects_payment_ready else "ok"))
    accepted = [c.kind for c in s.control_events if c.accepted]
    checks.append(Check(id="no_invalid_action_accepted", kind="control", ok=not accepted,
                        detail=", ".join(accepted) or "none accepted"))
    dupes = _duplicate_messages(s)
    checks.append(Check(id="no_duplicate_messages", kind="control", ok=not dupes,
                        detail=", ".join(dupes) or "no duplicate outbound messages"))

    # core
    checks.append(Check(id="disposition_matches", kind="core", ok=s.disposition == truth.expected_disposition,
                        detail=f"state {s.disposition}, expected class {truth.expected_disposition}"))
    if truth.expects_payment_ready and ready:
        applied_docs = sorted(c.document_id or "" for c in s.credits_applied)
        ties = (s.invoice_face_cents == truth.invoice_face_cents and s.net_payable_cents is not None
                and s.invoice_face_cents - sum(c.amount_cents for c in s.credits_applied) == s.net_payable_cents)
        checks += [
            Check(id="net_exact", kind="core", ok=s.net_payable_cents == truth.expected_net_cents,
                  detail="exact cent match required"),
            Check(id="credit_set_complete", kind="core", ok=applied_docs == sorted(truth.applicable_credits),
                  detail=f"{len(applied_docs)} applied, {len(truth.applicable_credits)} applicable"),
            Check(id="arithmetic_ties", kind="core", ok=ties, detail="face minus applied credits equals net"),
        ]
    if s.disposition in HOLD_DISPOSITIONS:
        checks.append(_justified_hold(s))

    # quality
    cited = set(s.evidence_refs)
    required = truth.required_evidence if (ready or not truth.expects_payment_ready) else (truth.invoice_doc_id,)
    hits = [d for d in required if d in cited]
    checks.append(Check(id="evidence_sufficient", kind="quality", ok=len(hits) == len(required),
                        detail=f"{len(hits)} of {len(required)} required documents cited"))
    if ready:
        r = s.review
        checks.append(Check(id="review_independent_pass", kind="quality",
                            ok=r.present and r.independent and r.verdict == "PASS",
                            detail=f"present={r.present}, independent={r.independent}, verdict={r.verdict}"))

    def failed(kind: str) -> list[str]:
        return [c.id for c in checks if c.kind == kind and not c.ok]

    control_failures = failed("control")
    core_ok, quality_ok = not failed("core"), not failed("quality")
    if control_failures or not core_ok:
        outcome: Outcome = "fail"
        if (truth.expects_payment_ready and s.disposition == "WAITING" and not control_failures
                and next(c.ok for c in checks if c.id == "justified_hold")):
            outcome = "waiting"
    elif not quality_ok:
        outcome = "partial"
    else:
        outcome = "pass" if truth.expects_payment_ready else "correct_escalation"

    return TrialGrade(
        outcome=outcome, success=outcome in ("pass", "correct_escalation"), checks=checks,
        control_failures=control_failures, evidence_checks_passed=len(hits),
        evidence_checks_total=len(required),
        invalid_actions_attempted=sum(1 for c in s.control_events if c.attempted),
        invalid_actions_blocked=sum(1 for c in s.control_events if c.blocked),
        invalid_actions_accepted=len(accepted), **base)
