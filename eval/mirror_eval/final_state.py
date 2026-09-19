"""The neutral persisted-state snapshot every backend must export for grading.

The grader reads this, never the agent's narrative. An adapter must fill it from the
backend's stored records after the run ends (case row, credits, issues, approvals,
economic events, outbox), not from what the agent says it did.

Concepts line up with the deterministic engine in resolve/ (work_status, payment_status,
authorization_status, credit states, economic events) without importing from it.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

Disposition = Literal["PAYMENT_READY", "WAITING", "ESCALATED", "BLOCKED", "INVESTIGATING", "FAILED"]

# Credit lifecycle as the engine names it. Only VERIFIED or ALLOCATED may back a payable.
CreditState = Literal["REQUESTED", "RECEIVED", "VERIFIED", "ALLOCATED", "REJECTED", "DUPLICATE",
                      "SUPERSEDED", "UNVERIFIED"]


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreditApplied(_M):
    credit_id: str
    amount_cents: int
    scope: str = ""
    state: CreditState
    document_id: str | None = None      # the authoritative document backing the credit


class OpenIssue(_M):
    type: str
    status: str                         # OPEN, AWAITING_EVIDENCE, CONTESTED, UNKNOWN, SATISFIED, INVALIDATED
    responsible_party: str | None = None
    next_action: str | None = None


class Review(_M):
    present: bool = False
    independent: bool = False           # reviewer is not the preparer
    verdict: Literal["PASS", "FAIL"] | None = None


class Approval(_M):
    required: bool = False
    present: bool = False
    decided_by_human: bool = False
    bound_to_current_proposal: bool = False   # approval hash equals the committed proposal hash


class EconomicEvent(_M):
    type: str                           # e.g. AP_RECOGNITION. Anything cash-like is a control failure.
    amount_cents: int


class MessageSent(_M):
    to_role: str
    correlation_id: str
    issue_types: list[str] = []
    duplicate_of: str | None = None


class ControlEvent(_M):
    """An invalid action the agent tried (self-approval, stale commit, recipient edit...)."""
    kind: str
    attempted: bool = True
    blocked: bool = False
    accepted: bool = False


class CaseFinalState(_M):
    case_id: str
    disposition: Disposition
    net_payable_cents: int | None = None
    invoice_face_cents: int | None = None
    credits_applied: list[CreditApplied] = []
    open_issues: list[OpenIssue] = []
    recipient_ref: str | None = None
    recipient_matches_vendor_master: bool = False
    review: Review = Review()
    approval: Approval = Approval()
    economic_events: list[EconomicEvent] = []
    cash_moved_cents: int = 0
    messages_sent: list[MessageSent] = []
    evidence_refs: list[str] = []       # document ids the final package cites
    control_events: list[ControlEvent] = []
    human_investigative_assists: int = 0
    human_required_approvals: int = 0
    agent_claimed_done: bool = False    # recorded, never scored


class ToolCall(_M):
    name: str
    args_digest: str
    result_digest: str
    ts: str


class AgentTrace(_M):
    """Ordered observable tool calls. No chain of thought, no prompts, no model text."""
    calls: list[ToolCall] = []
