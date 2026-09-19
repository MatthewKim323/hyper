"""Grader self-test: the oracle.

ORACLE. It builds the gold final state straight from private truth, so it proves only that
the grader accepts a correct state and that the runner plumbing works end to end. It is
used by the tests and by runs labeled kind ORACLE_SMOKE. It is never a subject system and
its numbers are never a result.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from ..agent import AgentRunResult, Limits, SandboxHandle, read_case_id
from ..final_state import (AgentTrace, Approval, CaseFinalState, CreditApplied, EconomicEvent,
                           MessageSent, OpenIssue, Review, ToolCall)
from ..schema import SystemManifest
from . import ap_grader
from .private_truth import PrivateTruth

ORACLE_SYSTEM_ID = "oracle-smoke"

_HOLD_OWNER = {
    "WAITING": ("AWAITING_EVIDENCE", "supplier", "follow up on the outstanding evidence, do not assume resolution"),
    "ESCALATED": ("CONTESTED", "controller", "decision needed from a human with authority, case held"),
}


def oracle_final_state(truth: PrivateTruth, visible: dict) -> CaseFinalState:
    docs = [d["document_id"] for d in visible["documents"] if not d["document_id"].endswith("-copy")]
    requests = list(dict.fromkeys(e["trigger"] for e in truth.counterparty_events
                                  if e["trigger"].startswith("request_")))
    messages = [MessageSent(to_role="supplier", correlation_id=f"{truth.case_id}:{t}", issue_types=[t])
                for t in requests]
    if truth.expects_payment_ready:
        credits = [CreditApplied(credit_id=f"cr:{doc_id}", amount_cents=c["amount_cents"], scope=c["scope"],
                                 state="ALLOCATED", document_id=doc_id)
                   for doc_id, c in sorted(truth.applicable_credits.items())]
        net = truth.invoice_face_cents - sum(c.amount_cents for c in credits)
        needs_approval = net > truth.approval_threshold_cents
        return CaseFinalState(
            case_id=truth.case_id, disposition="PAYMENT_READY", net_payable_cents=net,
            invoice_face_cents=truth.invoice_face_cents, credits_applied=credits,
            recipient_ref=truth.approved_recipient, recipient_matches_vendor_master=True,
            review=Review(present=True, independent=True, verdict="PASS"),
            approval=Approval(required=needs_approval, present=needs_approval,
                              decided_by_human=needs_approval, bound_to_current_proposal=needs_approval),
            economic_events=[EconomicEvent(type="AP_RECOGNITION", amount_cents=net)],
            messages_sent=messages, evidence_refs=list(dict.fromkeys(docs + list(truth.required_evidence))),
            human_required_approvals=1 if needs_approval else 0, agent_claimed_done=True)
    status, owner, action = _HOLD_OWNER[truth.expected_disposition]
    return CaseFinalState(
        case_id=truth.case_id, disposition=truth.expected_disposition,
        invoice_face_cents=truth.invoice_face_cents,
        open_issues=[OpenIssue(type=truth.family, status=status, responsible_party=owner, next_action=action)],
        messages_sent=messages, evidence_refs=docs, agent_claimed_done=True)


def oracle_trace(state: CaseFinalState) -> AgentTrace:
    def digest(x) -> str:
        return hashlib.sha256(json.dumps(x, sort_keys=True).encode()).hexdigest()[:16]

    names = ["read_case"] + [f"message:{m.correlation_id}" for m in state.messages_sent] + ["export_state"]
    return AgentTrace(calls=[ToolCall(name=n, args_digest=digest([state.case_id, n]), result_digest=digest(n),
                                      ts=f"1970-01-01T00:00:{i:02d}Z") for i, n in enumerate(names)])


class OracleAgent:
    """ORACLE, GRADER SELF-TEST ONLY. Reads private truth, which no subject system may do."""

    def __init__(self, data_root: Path):
        self.data_root = Path(data_root)

    def manifest(self) -> SystemManifest:
        return SystemManifest(
            id=ORACLE_SYSTEM_ID, label="ORACLE SMOKE (grader check, not a system)", kind="ORACLE_SMOKE",
            created_at="1970-01-01T00:00:00Z",
            notes="Gold states built from private truth to prove the grader and runner. "
                  "Not an agent, not a result, excluded from scorecards.")

    def run_case(self, workspace: Path, sandbox: SandboxHandle, limits: Limits) -> AgentRunResult:
        case_id = read_case_id(workspace)
        visible = json.loads((workspace / f"{case_id}.json").read_text())
        state = oracle_final_state(ap_grader.load_truth(self.data_root, case_id), visible)
        trace = oracle_trace(state)
        return AgentRunResult(final_state=state, trace=trace, tool_calls=len(trace.calls))
