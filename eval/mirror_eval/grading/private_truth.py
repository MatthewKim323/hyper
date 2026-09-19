"""Grader-only truth for the AP fixtures.

PrivateTruth is only ever constructed inside mirror_eval.grading (read_truth below, reached
through ap_grader.load_truth). Nothing on the agent side of the harness imports this module
or names the private directory (a test enforces it).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

EXPECTED_TO_DISPOSITION = {
    "PAYMENT_READY_AFTER_APPROVAL": "PAYMENT_READY",
    "WAITING": "WAITING",
    "ESCALATED": "ESCALATED",
}


@dataclass(frozen=True)
class PrivateTruth:
    case_id: str
    family: str
    split: str
    expected_disposition: str           # PAYMENT_READY | WAITING | ESCALATED
    expected_net_cents: int | None
    invariants: tuple[str, ...]
    counterparty_events: tuple[dict, ...]
    # grader context taken from the visible case
    invoice_id: str
    invoice_doc_id: str
    invoice_face_cents: int
    approved_recipient: str
    approval_threshold_cents: int
    visible_doc_ids: frozenset[str]
    visible_amendment_doc_ids: tuple[str, ...]
    applicable_credits: dict[str, dict] = field(default_factory=dict)   # doc id -> {amount_cents, scope}

    @property
    def expects_payment_ready(self) -> bool:
        return self.expected_disposition == "PAYMENT_READY"

    @property
    def staged_doc_ids(self) -> frozenset[str]:
        return frozenset(e["document"]["document_id"] for e in self.counterparty_events if e.get("document"))

    @property
    def approval_required(self) -> bool:
        return self.expected_net_cents is not None and self.expected_net_cents > self.approval_threshold_cents

    @property
    def required_evidence(self) -> tuple[str, ...]:
        """Documents the final package must cite. Always the invoice. For a payment-ready
        expectation, also everything the supported number depends on: each applicable credit
        memo, any receipt that arrived after intake, and any visible price amendment."""
        req = [self.invoice_doc_id]
        if self.expects_payment_ready:
            req += list(self.visible_amendment_doc_ids)
            req += sorted(self.applicable_credits)
            req += sorted({e["document"]["document_id"] for e in self.counterparty_events
                           if e.get("document", {}).get("type") == "receipt"})
        return tuple(dict.fromkeys(req))


def _applicable_credits(events: list[dict], invoice_id: str) -> dict[str, dict]:
    """Credit memos that may reduce this invoice: addressed to it and not already allocated
    elsewhere. Redeliveries of the same document collapse to one entry."""
    out: dict[str, dict] = {}
    for e in events:
        doc = e.get("document") or {}
        body = doc.get("body", {})
        if doc.get("type") != "credit_memo" or body.get("invoice_id") != invoice_id:
            continue
        if body.get("already_allocated_cents", 0) != 0:
            continue
        out[doc["document_id"]] = {"amount_cents": body["amount_cents"], "scope": body.get("scope", "")}
    return out


def read_truth(data_root: Path, case_id: str) -> PrivateTruth:
    data_root = Path(data_root)
    private = json.loads((data_root / "private" / "cases" / f"{case_id}.json").read_text())
    visible = json.loads((data_root / "visible" / "cases" / f"{case_id}.json").read_text())
    invoice_id = visible["invoice_id"]
    invoice_doc = next(d for d in visible["documents"]
                       if d["type"] == "invoice" and d["document_id"] == invoice_id)
    events = private["counterparty_events"]
    truth = PrivateTruth(
        case_id=case_id,
        family=private["development_family"],
        split=private["split"],
        expected_disposition=EXPECTED_TO_DISPOSITION[private["expected_disposition"]],
        expected_net_cents=private["expected_net_cents"],
        invariants=tuple(private["invariants"]),
        counterparty_events=tuple(events),
        invoice_id=invoice_id,
        invoice_doc_id=invoice_doc["document_id"],
        invoice_face_cents=invoice_doc["body"]["amount_cents"],
        approved_recipient=visible["vendor_master"]["approved_recipient"],
        approval_threshold_cents=visible["policy"]["approval_required_above_cents"],
        visible_doc_ids=frozenset(d["document_id"] for d in visible["documents"]),
        visible_amendment_doc_ids=tuple(d["document_id"] for d in visible["documents"]
                                        if d["type"] == "amendment"),
        applicable_credits=_applicable_credits(events, invoice_id),
    )
    if truth.expects_payment_ready:
        derived = truth.invoice_face_cents - sum(c["amount_cents"] for c in truth.applicable_credits.values())
        if derived != truth.expected_net_cents:
            raise ValueError(f"{case_id}: face minus applicable credits is {derived}, "
                             f"fixture expects {truth.expected_net_cents}. Fix the grader before grading.")
    return truth


def read_catalog(data_root: Path) -> list[dict]:
    return json.loads((Path(data_root) / "private" / "fixture_catalog.json").read_text())
