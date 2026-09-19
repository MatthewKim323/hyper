"""Honest inventory of what exists in the repo today, and the claims the demo wants to make.

Rules: a row points at real files. Engine unit tests are not agent evaluations, so they never
fill passed/failed. passed/failed stay null until a subject-agent run exists. A claim with no
agent-level evidence is not demo_allowed.
"""
from __future__ import annotations

from .schema import Capability, Claim

ENGINE_TESTS = "resolve/tests/test_backbone.py"
ENGINE_NOTE = "deterministic engine only, no model-driven agent yet, unit tests are not agent evaluations"
NO_AGENT = "no model-driven agent exists in the repo yet"

# All 18 ap_workflow families, ungrouped on purpose: grouping them by expected outcome in a
# public export would leak grader truth. A test keeps this list equal to the register.
AP_FAMILIES = ["allocation_conflict", "alternative_order", "backorder", "changed_recipient", "clean",
               "credit_claim_without_memo", "disputed_cancellation", "duplicate_credit_delivery",
               "duplicate_invoice_import", "embedded_instruction", "missing_agreement",
               "new_receipt_during_review", "partial_correction", "price_only", "quantity_only",
               "supplier_silent", "unrelated_credit", "valid_amendment"]


def capabilities() -> list[Capability]:
    return [
        Capability(
            id="cap-01-documents", area="Document reading and evidence retrieval",
            name="Ingest records with source trust, retrieve evidence for a case", status="partial",
            entry_point="resolve/src/mirror_resolve/ingest.py",
            human_authority="none needed to read, trust rules are code-owned",
            test_families=["embedded_instruction", "duplicate_invoice_import"], task_count=2,
            evidence_refs=[ENGINE_TESTS, "resolve/src/mirror_resolve/ingest.py"],
            note="Structured record intake with trusted-source rules exists. No reading of unstructured "
                 "documents (PDF, email prose) and no retrieval by an agent. " + ENGINE_NOTE),
        Capability(
            id="cap-02-economic", area="Economic interpretation",
            name="Interpret the economics of a transaction, including crypto-native activity",
            status="unsupported", entry_point=None, human_authority=None,
            test_families=[f"C{i:02d}" for i in range(1, 13)], task_count=0, evidence_refs=[],
            note="Nothing implements this. The crypto_native suite is registered but has no tasks. "
                 "The engine computes AP arithmetic only."),
        Capability(
            id="cap-03-cash-application", area="Cash application and reconciliation",
            name="Apply receipts and reconcile settlements to the ledger", status="unsupported",
            entry_point=None, human_authority=None, test_families=[], task_count=0,
            evidence_refs=["data/engine/validate.py"],
            note="The dataset generator validates its own reconciliations. No system under test performs "
                 "cash application, and no suite covers it."),
        Capability(
            id="cap-04-ap-backbone", area="AP investigation and payment preparation",
            name="Deterministic AP backbone: three-way match, credit lifecycle, hash-bound proposal, "
                 "approval, idempotent commit",
            status="partial", entry_point="resolve/src/mirror_resolve/proposals.py",
            human_authority="human controller approves the exact proposal hash",
            test_families=AP_FAMILIES, task_count=len(AP_FAMILIES),
            evidence_refs=[ENGINE_TESTS, "resolve/src/mirror_resolve/matching.py",
                           "resolve/src/mirror_resolve/creditmemo.py", "resolve/src/mirror_resolve/proposals.py"],
            note=ENGINE_NOTE),
        Capability(
            id="cap-04b-ap-investigation", area="AP investigation and payment preparation",
            name="Agentic investigation: decide what is missing, ask for it, judge what comes back",
            status="unsupported", entry_point=None, human_authority=None,
            test_families=AP_FAMILIES, task_count=len(AP_FAMILIES), evidence_refs=[],
            note=NO_AGENT + ". The ap_workflow suite and its grader are ready, SUBJECT_AGENTS is empty."),
        Capability(
            id="cap-05-ledger", area="Ledger consistency",
            name="Balanced single recognition per invoice, no cash entries at payment-ready",
            status="partial", entry_point="resolve/src/mirror_resolve/proposals.py",
            human_authority=None, test_families=AP_FAMILIES, task_count=len(AP_FAMILIES),
            evidence_refs=[ENGINE_TESTS],
            note="Covers AP recognition entries inside the engine only, not a general ledger. " + ENGINE_NOTE),
        Capability(
            id="cap-06-reporting", area="Reporting and variance",
            name="Management reporting, variance explanation, close support", status="unsupported",
            entry_point=None, human_authority=None, test_families=[], task_count=0, evidence_refs=[],
            note="Nothing implements this. The planned substitute is the MIRROR longitudinal close suite, "
                 "inspired by AccountingBench, which does not exist yet."),
        Capability(
            id="cap-07-handoffs", area="Multi-agent handoffs and follow-through",
            name="Supplier follow-up, handoffs between roles, chasing silence", status="unsupported",
            entry_point=None, human_authority=None, test_families=["supplier_silent", "credit_claim_without_memo"],
            task_count=2, evidence_refs=[],
            note=NO_AGENT + ". The grader checks for duplicate outbound messages and justified holds once one does."),
        Capability(
            id="cap-08-memory", area="Memory",
            name="Carry knowledge across cases and sessions", status="unsupported", entry_point=None,
            human_authority=None, test_families=[], task_count=0, evidence_refs=[],
            note="Nothing implements this and no suite measures it."),
        Capability(
            id="cap-09-controls", area="Controls, uncertainty, reviewer independence and human authorization",
            name="Preparer cannot review, only a human controller approves, approval binds to the proposal hash",
            status="partial", entry_point="resolve/src/mirror_resolve/proposals.py",
            human_authority="human controller, identified by the human: prefix and CONTROLLER role",
            test_families=AP_FAMILIES, task_count=len(AP_FAMILIES),
            evidence_refs=[ENGINE_TESTS, "resolve/src/mirror_resolve/casework.py"],
            note="Controls are enforced by the engine. Whether an agent respects them, and how it handles "
                 "uncertainty, is untested. " + ENGINE_NOTE),
        Capability(
            id="cap-10-recovery", area="Recovery, concurrency, duplicates and stale data",
            name="Idempotent commit, duplicate delivery handling, revision invalidation of stale approvals",
            status="partial", entry_point="resolve/src/mirror_resolve/casework.py", human_authority=None,
            test_families=["duplicate_credit_delivery", "duplicate_invoice_import", "new_receipt_during_review"],
            task_count=3, evidence_refs=[ENGINE_TESTS],
            note="No concurrency or crash-recovery tests exist. The reliability suite is registered but not "
                 "implemented. " + ENGINE_NOTE),
        Capability(
            id="cap-11-checkpoints", area="Learned checkpoints",
            name="Trained adapters or checkpoints that improve the system", status="unsupported",
            entry_point=None, human_authority=None, test_families=[], task_count=0, evidence_refs=[],
            note="No trained weights, training code or checkpoints exist. No version-over-version comparison "
                 "is possible until at least two subject systems have runs."),
    ]


ENGINE_LEVEL = " (engine-level only, not agent-level)"


def claims() -> list[Claim]:
    return [
        Claim(id="claim-01-end-to-end", claim="Completes AP exceptions end to end",
              status="unsupported", evidence_refs=[], demo_allowed=False),
        Claim(id="claim-02-partial-correction", claim="Notices a partial supplier correction instead of "
              "treating the first credit as the whole answer" + ENGINE_LEVEL,
              status="untested", evidence_refs=[ENGINE_TESTS], demo_allowed=False),
        Claim(id="claim-03-approval", claim="Never releases without current human approval" + ENGINE_LEVEL,
              status="untested", evidence_refs=[ENGINE_TESTS], demo_allowed=False),
        Claim(id="claim-04-no-duplicates", claim="No duplicate financial effects under retries and "
              "duplicate deliveries" + ENGINE_LEVEL,
              status="untested", evidence_refs=[ENGINE_TESTS], demo_allowed=False),
        Claim(id="claim-05-ready-not-paid", claim="Payment-ready is not paid: no cash moves" + ENGINE_LEVEL,
              status="untested", evidence_refs=[ENGINE_TESTS], demo_allowed=False),
        Claim(id="claim-06-improves", claim="Improves across versions",
              status="unsupported", evidence_refs=[], demo_allowed=False),
        Claim(id="claim-07-external", claim="Performs on external benchmarks",
              status="unsupported", evidence_refs=[], demo_allowed=False),
        Claim(id="claim-08-crypto", claim="Interprets crypto-economic activity correctly",
              status="unsupported", evidence_refs=[], demo_allowed=False),
    ]


CLAIM_NOTES = {
    "claim-01-end-to-end": "No subject agent exists, so no run exists. Needs an ap_workflow subject run.",
    "claim-02-partial-correction": "The engine test shows the first credit cannot release the case. "
                                   "That is engine-level, not agent-level. Needs the partial_correction family in a subject run.",
    "claim-03-approval": "The engine refuses agent and preparer approvals in unit tests. That is engine-level, "
                         "not agent-level. Needs zero approval_current control failures across a subject run.",
    "claim-04-no-duplicates": "The engine commits once under retries in unit tests. That is engine-level, not "
                              "agent-level. Needs the duplicate families plus the reliability suite.",
    "claim-05-ready-not-paid": "The engine writes no cash entries in unit tests. That is engine-level, not "
                               "agent-level. Needs cash_unchanged to hold across a subject run.",
    "claim-06-improves": "Needs two subject systems and a matched comparison. Neither exists.",
    "claim-07-external": "No external suite has been run. All external suites are pending source verification.",
    "claim-08-crypto": "The crypto_native suite is registered but not implemented.",
}
