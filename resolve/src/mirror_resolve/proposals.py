"""Payable proposals, independent validation, review, approval and atomic commitment.

PAYMENT_READY is only ever written by commit_proposal, after every check passes
inside one transaction. There is no setter for it anywhere else.
"""
from __future__ import annotations

import hashlib
import json
import uuid

from sqlalchemy import and_, select
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from . import casework, events, store
from .ingest import get_record
from .policy import DEFAULT_POLICY, Policy

HUMAN_PREFIX = "human:"


class ProposalError(Exception):
    pass


def canonical_hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def get_proposal(conn: Connection, proposal_id: str) -> dict:
    row = conn.execute(select(store.proposals).where(
        store.proposals.c.proposal_id == proposal_id)).mappings().first()
    if not row:
        raise ProposalError(f"unknown proposal {proposal_id}")
    return dict(row)


def calculate_supported_payable(conn: Connection, case_id: str) -> dict:
    """Code-owned arithmetic. Two independent routes to the number must tie:
    face minus verified credits, and received quantity at the supported price."""
    ev = casework.evaluate_case(conn, case_id)
    m = ev["match"]
    credits = [{"credit_id": c["credit_id"], "scope": c["scope"], "amount_cents": c["amount_cents"],
                "doc_id": c["doc_id"], "state": c["state"]} for c in ev["verified_credits"]]
    return {
        "case_id": case_id,
        "revision": ev["revision"],
        "currency": m["currency"],
        "invoice_face_cents": m["face_cents"],
        "verified_credits": credits,
        "verified_credits_total_cents": sum(c["amount_cents"] for c in credits),
        "net_after_credits_cents": ev["net_supported_payable_cents"],
        "independently_supported_cents": m["supported_cents"],
        "residual_cents": ev["residual_cents"],
        "ties": ev["residual_cents"] == 0,
        "open_blocking_issues": ev["open_blocking_issues"],
        "lines": m["lines"],
    }


def propose_payable_update(conn: Connection, case_id: str, based_on_revision: int, *, actor: str,
                           evidence_refs: list | None = None, idempotency_key: str | None = None,
                           policy: Policy = DEFAULT_POLICY) -> dict:
    case = casework.get_case(conn, case_id)
    if case["work_status"] == "RESOLVED":
        raise ProposalError("case already resolved")
    if based_on_revision != case["revision"]:
        raise ProposalError(f"stale revision {based_on_revision}, case is at {case['revision']}")
    calc = calculate_supported_payable(conn, case_id)
    inv = get_record(conn, case["company_id"], case["invoice_id"])
    vendor = get_record(conn, case["company_id"], inv["data"]["vendor_id"])
    if vendor is None:
        raise ProposalError("no approved vendor master record")
    net = calc["net_after_credits_cents"]
    payload = {
        "kind": "PAYABLE_UPDATE",
        "case_id": case_id,
        "invoice_id": case["invoice_id"],
        "invoice_record_version": inv["version"],
        "currency": calc["currency"],
        "invoice_face_cents": calc["invoice_face_cents"],
        "credits": [{k: c[k] for k in ("credit_id", "scope", "amount_cents")} for c in calc["verified_credits"]],
        "net_payable_cents": net,
        "recipient": {"vendor_id": vendor["record_id"], "vendor_master_version": vendor["version"],
                      "remit_account_ref": vendor["data"]["remit_account_ref"]},
        "accounting": [
            {"account": policy.inventory_clearing_account, "debit_cents": net, "credit_cents": 0},
            {"account": policy.ap_account, "debit_cents": 0, "credit_cents": net},
        ],
        "policy_version": policy.version,
        "evidence_refs": evidence_refs or [],
        "approval_required": policy.approval_required(net, len(calc["verified_credits"])),
    }
    h = canonical_hash(payload)
    p = store.proposals
    same = conn.execute(select(p).where(and_(
        p.c.case_id == case_id, p.c.hash == h, p.c.based_on_revision == based_on_revision,
        p.c.status == "DRAFT"))).mappings().first()
    if same:
        return dict(same)
    proposal_id = "prop_" + uuid.uuid4().hex[:10]
    conn.execute(p.insert().values(
        proposal_id=proposal_id, case_id=case_id, based_on_revision=based_on_revision,
        kind="PAYABLE_UPDATE", payload=payload, hash=h, status="DRAFT", created_by=actor,
        created_at=store.now(),
    ))
    conn.execute(store.cases.update().where(store.cases.c.case_id == case_id)
                 .values(payment_status="DRAFT_PREPARED", updated_at=store.now()))
    events.emit(conn, "proposal.created", actor, case_id=case_id, company_id=case["company_id"],
                payload={"proposal_id": proposal_id, "hash": h, "net_payable_cents": net,
                         "based_on_revision": based_on_revision})
    return get_proposal(conn, proposal_id)


def validate_proposal(conn: Connection, proposal_id: str) -> list[dict]:
    """Independent reconstruction from current records. Does not trust the proposal's own numbers."""
    prop = get_proposal(conn, proposal_id)
    pl = prop["payload"]
    case = casework.get_case(conn, prop["case_id"])
    calc = calculate_supported_payable(conn, prop["case_id"])
    vendor = get_record(conn, case["company_id"], pl["recipient"]["vendor_id"])
    issues = [i for i in casework.list_issues(conn, prop["case_id"])
              if i["blocking"] and i["status"] not in casework.CLOSED]
    c = store.credits
    cred_rows = {r["credit_id"]: dict(r) for r in conn.execute(
        select(c).where(c.c.credit_id.in_([x["credit_id"] for x in pl["credits"]] or [""]))).mappings().all()}
    credits_ok = all(
        cred_rows.get(x["credit_id"], {}).get("state") == "VERIFIED"
        and cred_rows[x["credit_id"]]["remaining_cents"] == x["amount_cents"] == cred_rows[x["credit_id"]]["amount_cents"]
        and cred_rows[x["credit_id"]]["invoice_id"] == pl["invoice_id"]
        for x in pl["credits"])
    already = conn.execute(select(store.economic_events.c.econ_id).where(and_(
        store.economic_events.c.company_id == case["company_id"],
        store.economic_events.c.invoice_id == pl["invoice_id"]))).first()
    recomputed_credits = sorted((x["credit_id"], x["amount_cents"]) for x in calc["verified_credits"])
    proposed_credits = sorted((x["credit_id"], x["amount_cents"]) for x in pl["credits"])
    debit = sum(e["debit_cents"] for e in pl["accounting"])
    credit = sum(e["credit_cents"] for e in pl["accounting"])
    return [
        {"check":"invoice_total_ties", "ok":casework.evaluate_case(conn,prop['case_id'])['match']['stated_total_cents']==calc['invoice_face_cents'], "detail":"stated invoice total must equal line arithmetic; unsupported taxes/fees need explicit modeling"},
        {"check": "proposal_is_current_draft", "ok": prop["status"] == "DRAFT", "detail": prop["status"]},
        {"check": "hash_intact", "ok": canonical_hash(pl) == prop["hash"], "detail": prop["hash"][:12]},
        {"check": "revision_current", "ok": prop["based_on_revision"] == case["revision"],
         "detail": f"proposal r{prop['based_on_revision']} vs case r{case['revision']}"},
        {"check": "no_open_blocking_issues", "ok": not issues,
         "detail": ", ".join(f"{i['type']}={i['status']}" for i in issues) or "none"},
        {"check": "amount_reconstructed", "ok": calc["net_after_credits_cents"] == pl["net_payable_cents"]
         and calc["invoice_face_cents"] == pl["invoice_face_cents"],
         "detail": f"recomputed {calc['net_after_credits_cents']} vs proposed {pl['net_payable_cents']}"},
        {"check": "two_routes_tie", "ok": calc["ties"],
         "detail": f"residual {calc['residual_cents']} cents between net-of-credits and received-at-supported-price"},
        {"check": "credit_set_matches_verified", "ok": recomputed_credits == proposed_credits,
         "detail": f"{len(proposed_credits)} proposed, {len(recomputed_credits)} verified"},
        {"check": "credits_verified_and_unallocated", "ok": credits_ok, "detail": "each credit VERIFIED with full remaining balance"},
        {"check": "recipient_is_current_vendor_master", "ok": bool(vendor)
         and vendor["version"] == pl["recipient"]["vendor_master_version"]
         and vendor["data"]["remit_account_ref"] == pl["recipient"]["remit_account_ref"],
         "detail": pl["recipient"]["remit_account_ref"]},
        {"check": "entries_balance_to_net", "ok": debit == credit == pl["net_payable_cents"], "detail": f"{debit}/{credit}"},
        {"check": "not_already_recognized", "ok": already is None, "detail": "one recognition per invoice"},
        {"check": "no_cash_entries", "ok": all("CASH" not in e["account"].upper() and "BANK" not in e["account"].upper()
                                                for e in pl["accounting"]), "detail": "payment-ready is not paid"},
    ]


def record_review(conn: Connection, proposal_id: str, *, reviewer: str, verdict: str,
                  deficiencies: list | None = None) -> dict:
    """A reviewer verdict never overrides a failed deterministic check."""
    prop = get_proposal(conn, proposal_id)
    if reviewer == prop["created_by"]:
        raise ProposalError("the preparer cannot review their own proposal")
    if verdict not in ("PASS", "FAIL"):
        raise ProposalError("verdict must be PASS or FAIL")
    checks = validate_proposal(conn, proposal_id)
    failed = [c for c in checks if not c["ok"]]
    deficiencies = list(deficiencies or [])
    effective = verdict
    if failed and verdict == "PASS":
        effective = "FAIL"
        deficiencies += [f"deterministic check failed: {c['check']} ({c['detail']})" for c in failed]
    case = casework.get_case(conn, prop["case_id"])
    review_id = "rev_" + uuid.uuid4().hex[:10]
    conn.execute(store.reviews.update().where(and_(
        store.reviews.c.proposal_id == proposal_id, store.reviews.c.status == "CURRENT"))
        .values(status="INVALIDATED"))
    conn.execute(store.reviews.insert().values(
        review_id=review_id, proposal_id=proposal_id, proposal_hash=prop["hash"], reviewer=reviewer,
        verdict=effective, deficiencies=deficiencies, deterministic_checks=checks, status="CURRENT",
        created_at=store.now(),
    ))
    events.emit(conn, "review.completed", reviewer, case_id=prop["case_id"], company_id=case["company_id"],
                payload={"review_id": review_id, "proposal_id": proposal_id, "verdict": effective,
                         "reviewer_verdict": verdict, "deficiencies": deficiencies})
    return {"review_id": review_id, "verdict": effective, "reviewer_verdict": verdict,
            "deficiencies": deficiencies, "checks": checks}


def _current_review(conn: Connection, prop: dict) -> dict | None:
    rv = store.reviews
    row = conn.execute(select(rv).where(and_(
        rv.c.proposal_id == prop["proposal_id"], rv.c.proposal_hash == prop["hash"],
        rv.c.status == "CURRENT"))).mappings().first()
    return dict(row) if row else None


def request_controller_approval(conn: Connection, proposal_id: str, *, actor: str) -> dict:
    prop = get_proposal(conn, proposal_id)
    if prop["status"] != "DRAFT":
        raise ProposalError(f"proposal is {prop['status']}")
    review = _current_review(conn, prop)
    if not review or review["verdict"] != "PASS":
        raise ProposalError("approval can only be requested after an independent review passes")
    ap = store.approvals
    existing = conn.execute(select(ap).where(and_(
        ap.c.proposal_id == proposal_id, ap.c.proposal_hash == prop["hash"],
        ap.c.status.in_(("PENDING", "APPROVED"))))).mappings().first()
    if existing:
        return dict(existing)
    case = casework.get_case(conn, prop["case_id"])
    pl = prop["payload"]
    packet = {
        "decision": "Approve the net payable for this invoice under " + pl["policy_version"],
        "invoice_id": pl["invoice_id"], "invoice_face_cents": pl["invoice_face_cents"],
        "credits": pl["credits"], "net_payable_cents": pl["net_payable_cents"],
        "recipient": pl["recipient"], "proposal_hash": prop["hash"],
        "review": {"review_id": review["review_id"], "reviewer": review["reviewer"], "verdict": review["verdict"]},
        "evidence_refs": pl["evidence_refs"],
    }
    approval_id = "apr_" + uuid.uuid4().hex[:10]
    conn.execute(ap.insert().values(
        approval_id=approval_id, proposal_id=proposal_id, proposal_hash=prop["hash"], status="PENDING",
        requested_by=actor, decision_packet=packet, requested_at=store.now(),
    ))
    conn.execute(store.cases.update().where(store.cases.c.case_id == prop["case_id"])
                 .values(authorization_status="PENDING", updated_at=store.now()))
    events.emit(conn, "approval.requested", actor, case_id=prop["case_id"], company_id=case["company_id"],
                payload={"approval_id": approval_id, "proposal_id": proposal_id, "packet": packet})
    return dict(conn.execute(select(ap).where(ap.c.approval_id == approval_id)).mappings().first())


def decide_approval(conn: Connection, approval_id: str, *, decided_by: str, role: str,
                    decision: str, proposal_hash: str) -> dict:
    """Human authority only, bound to the exact proposal hash the human looked at."""
    if role != "CONTROLLER" or not decided_by.startswith(HUMAN_PREFIX):
        raise ProposalError("only a human controller can decide an approval")
    if decision not in ("APPROVED", "REJECTED"):
        raise ProposalError("decision must be APPROVED or REJECTED")
    ap = store.approvals
    row = conn.execute(select(ap).where(ap.c.approval_id == approval_id)).mappings().first()
    if not row:
        raise ProposalError(f"unknown approval {approval_id}")
    if row["status"] != "PENDING":
        raise ProposalError(f"approval is {row['status']}, request a new one for the current proposal")
    prop = get_proposal(conn, row["proposal_id"])
    if proposal_hash != prop["hash"] or proposal_hash != row["proposal_hash"] or prop["status"] != "DRAFT":
        raise ProposalError("approval does not match the current proposal")
    conn.execute(ap.update().where(ap.c.approval_id == approval_id)
                 .values(status=decision, decided_by=decided_by, decided_at=store.now()))
    case = casework.get_case(conn, prop["case_id"])
    conn.execute(store.cases.update().where(store.cases.c.case_id == prop["case_id"])
                 .values(authorization_status=decision, updated_at=store.now()))
    if decision == "REJECTED":
        conn.execute(store.proposals.update().where(store.proposals.c.proposal_id == prop["proposal_id"])
                     .values(status="REJECTED"))
    events.emit(conn, "approval.decided", decided_by, case_id=prop["case_id"], company_id=case["company_id"],
                payload={"approval_id": approval_id, "decision": decision, "proposal_hash": proposal_hash})
    return {"approval_id": approval_id, "status": decision}


def commit_proposal(conn: Connection, proposal_id: str, *, actor: str, idempotency_key: str) -> dict:
    """One atomic commitment. Safe to retry with the same key, impossible to double-apply."""
    ee = store.economic_events
    done = conn.execute(select(ee).where(ee.c.idempotency_key == idempotency_key)).mappings().first()
    if done:
        return {"committed": True, "replayed": True, "econ_id": done["econ_id"], "amount_cents": done["amount_cents"]}
    prop = get_proposal(conn, proposal_id)
    pl = prop["payload"]
    case = casework.get_case(conn, prop["case_id"])
    failed = [c for c in validate_proposal(conn, proposal_id) if not c["ok"]]
    if failed:
        raise ProposalError("validation failed: " + "; ".join(f"{c['check']} ({c['detail']})" for c in failed))
    review = _current_review(conn, prop)
    if not review or review["verdict"] != "PASS":
        raise ProposalError("no passing independent review for this exact proposal")
    if pl["approval_required"]:
        ap = store.approvals
        ok = conn.execute(select(ap.c.approval_id).where(and_(
            ap.c.proposal_id == proposal_id, ap.c.proposal_hash == prop["hash"],
            ap.c.status == "APPROVED"))).first()
        if not ok:
            raise ProposalError("required controller approval is missing for this exact proposal")
    c = store.credits
    try:
        for cr in pl["credits"]:
            res = conn.execute(c.update().where(and_(
                c.c.credit_id == cr["credit_id"], c.c.state == "VERIFIED",
                c.c.remaining_cents >= cr["amount_cents"],
            )).values(remaining_cents=c.c.remaining_cents - cr["amount_cents"], state="ALLOCATED",
                      updated_at=store.now()))
            if res.rowcount != 1:
                raise ProposalError(f"credit {cr['credit_id']} was already consumed")
            conn.execute(store.credit_allocations.insert().values(
                alloc_id="alc_" + uuid.uuid4().hex[:10], credit_id=cr["credit_id"],
                invoice_id=pl["invoice_id"], proposal_id=proposal_id,
                amount_cents=cr["amount_cents"], created_at=store.now()))
        econ_id = "econ_" + uuid.uuid4().hex[:10]
        conn.execute(ee.insert().values(
            econ_id=econ_id, company_id=case["company_id"], case_id=prop["case_id"],
            invoice_id=pl["invoice_id"], proposal_id=proposal_id, type="AP_RECOGNITION",
            entries=pl["accounting"], amount_cents=pl["net_payable_cents"],
            idempotency_key=idempotency_key, committed_at=store.now()))
    except IntegrityError as e:
        raise ProposalError(f"conflicting commitment: {e.orig}") from e
    conn.execute(store.proposals.update().where(store.proposals.c.proposal_id == proposal_id)
                 .values(status="COMMITTED"))
    conn.execute(store.cases.update().where(store.cases.c.case_id == prop["case_id"]).values(
        work_status="RESOLVED", payment_status="PAYMENT_READY",
        authorization_status="APPROVED" if pl["approval_required"] else "NOT_REQUIRED",
        updated_at=store.now()))
    events.emit(conn, "financial_event.committed", actor, case_id=prop["case_id"], company_id=case["company_id"],
                payload={"econ_id": econ_id, "type": "AP_RECOGNITION", "amount_cents": pl["net_payable_cents"],
                         "entries": pl["accounting"], "proposal_id": proposal_id})
    events.emit(conn, "case.payment_ready", actor, case_id=prop["case_id"], company_id=case["company_id"],
                payload={"net_payable_cents": pl["net_payable_cents"], "recipient": pl["recipient"],
                         "note": "payment-ready is not paid; no cash has moved"})
    return {"committed": True, "replayed": False, "econ_id": econ_id, "amount_cents": pl["net_payable_cents"]}
