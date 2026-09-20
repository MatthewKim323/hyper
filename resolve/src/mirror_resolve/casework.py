"""Case state, blocking issues, revisions and invalidation.

The engine owns SATISFIED and INVALIDATED. Agents can describe and route issues,
but a factual condition only closes when the trusted records and verified credits
make it close.
"""
from __future__ import annotations

import uuid

from sqlalchemy import and_, select
from sqlalchemy.engine import Connection

from . import events, store
from .ingest import get_record, list_records
from .matching import match_invoice

ENGINE = "engine"
AGENT_SETTABLE_ISSUE_STATUS = {"OPEN", "AWAITING_EVIDENCE", "CONTESTED"}
AGENT_SETTABLE_WORK_STATUS = {"INVESTIGATING", "WAITING_EXTERNAL", "WAITING_INTERNAL", "BLOCKED", "ESCALATED"}
CLOSED = {"SATISFIED", "INVALIDATED"}


class CaseError(Exception):
    pass


def get_case(conn: Connection, case_id: str) -> dict:
    row = conn.execute(select(store.cases).where(store.cases.c.case_id == case_id)).mappings().first()
    if not row:
        raise CaseError(f"unknown case {case_id}")
    return dict(row)


def list_issues(conn: Connection, case_id: str) -> list[dict]:
    i = store.case_issues
    return [dict(r) for r in conn.execute(
        select(i).where(i.c.case_id == case_id).order_by(i.c.opened_at)
    ).mappings().all()]


def verified_credits(conn: Connection, company_id: str, invoice_id: str, states=("VERIFIED",)) -> list[dict]:
    c = store.credits
    return [dict(r) for r in conn.execute(select(c).where(and_(
        c.c.company_id == company_id, c.c.invoice_id == invoice_id, c.c.state.in_(states),
    )).order_by(c.c.credit_id)).mappings().all()]


def open_case(conn: Connection, company_id: str, invoice_id: str, actor: str = "intake") -> dict:
    existing = conn.execute(select(store.cases).where(and_(
        store.cases.c.company_id == company_id, store.cases.c.invoice_id == invoice_id,
    ))).mappings().first()
    if existing:
        return dict(existing)
    if get_record(conn, company_id, invoice_id) is None:
        raise CaseError(f"no trusted invoice record {invoice_id}")
    case_id = "case_" + uuid.uuid4().hex[:10]
    t = store.now()
    conn.execute(store.cases.insert().values(
        case_id=case_id, company_id=company_id, invoice_id=invoice_id, revision=1,
        work_status="NEW", authorization_status="NOT_REQUESTED",
        payment_status="NOT_PREPARED", owner="mirror-resolve", created_at=t, updated_at=t,
    ))
    events.emit(conn, "case.created", actor, case_id=case_id, company_id=company_id,
                payload={"invoice_id": invoice_id})
    evaluate_case(conn, case_id)
    return get_case(conn, case_id)


def _sync_issue(conn: Connection, case: dict, type_: str, present: bool, satisfied: bool, *,
                description: str, detail: dict, requirements: list[dict], refs: list[dict],
                initial_status: str = "OPEN", closed_as: str = "SATISFIED",
                absent_as: str = "SATISFIED",
                responsible: str | None = None, next_action: str | None = None) -> None:
    i = store.case_issues
    row = conn.execute(select(i).where(and_(
        i.c.case_id == case["case_id"], i.c.type == type_, i.c.opened_by == ENGINE,
    ))).mappings().first()
    if row is None:
        if not present:
            return
        issue_id = "iss_" + uuid.uuid4().hex[:10]
        status = closed_as if satisfied else initial_status
        conn.execute(i.insert().values(
            issue_id=issue_id, case_id=case["case_id"], type=type_, description=description,
            status=status, blocking=1, detail=detail, evidence_refs=refs, dependencies=[],
            resolution_requirements=requirements, responsible_party=responsible,
            next_action=next_action, revision=case["revision"], opened_by=ENGINE,
            opened_at=store.now(),
        ))
        events.emit(conn, "issue.opened", ENGINE, case_id=case["case_id"], company_id=case["company_id"],
                    payload={"issue_id": issue_id, "type": type_, "status": status, "detail": detail})
        return
    if not present:
        new_status = absent_as       # the condition no longer exists under current records
    elif satisfied:
        new_status = closed_as
    elif row["status"] in CLOSED:
        new_status = "OPEN"          # reopened by newer evidence
    else:
        new_status = row["status"]
    changed = (new_status != row["status"] or detail != row["detail"]
               or requirements != row["resolution_requirements"])
    if not changed:
        return
    values = dict(status=new_status, detail=detail, resolution_requirements=requirements,
                  evidence_refs=refs, revision=case["revision"], description=description)
    if new_status in CLOSED:
        values.update(next_action=None, due_at=None)
    conn.execute(i.update().where(i.c.issue_id == row["issue_id"]).values(**values))
    events.emit(conn, "issue.updated", ENGINE, case_id=case["case_id"], company_id=case["company_id"],
                payload={"issue_id": row["issue_id"], "type": type_, "from": row["status"],
                         "to": new_status, "detail": detail})


def _req(name: str, met: bool, note: str = "") -> dict:
    return {"requirement": name, "met": bool(met), "note": note}


def evaluate_case(conn: Connection, case_id: str) -> dict:
    """Recompute the match, sync engine-owned issues, and derive readiness for review."""
    case = get_case(conn, case_id)
    company_id = case["company_id"]
    inv = get_record(conn, company_id, case["invoice_id"])
    m = match_invoice(conn, company_id, inv)
    creds = verified_credits(conn, company_id, case["invoice_id"], states=("VERIFIED", "ALLOCATED"))
    price_credit = sum(c["amount_cents"] for c in creds if c["scope"] == "PRICE")
    qty_credit = sum(c["amount_cents"] for c in creds if c["scope"] == "QUANTITY")
    cred_refs = [{"credit_id": c["credit_id"], "doc_id": c["doc_id"]} for c in creds]

    _sync_issue(conn, case, "MISSING_RECORD", bool(m["missing"]), False,
                description="Required records are unavailable: " + ", ".join(m["missing"]),
                detail={"missing": m["missing"]},
                requirements=[_req(f"obtain {x}", False) for x in m["missing"]], refs=m["sources"])

    dupes = [r for r in list_records(conn, company_id, "INVOICE")
             if r["record_id"] != inv["record_id"]
             and r["data"]["vendor_id"] == inv["data"]["vendor_id"]
             and r["data"]["invoice_number"] == inv["data"]["invoice_number"]]
    # The earliest import keeps the identity; later imports are the suspected duplicates.
    is_later_dupe = any(r["id"] < inv["id"] for r in dupes)
    _sync_issue(conn, case, "DUPLICATE_INVOICE", is_later_dupe, False,
                description="Another active invoice has the same supplier and invoice number.",
                detail={"other_invoice_ids": [r["record_id"] for r in dupes]},
                requirements=[_req("authorized disposition of the duplicate", False)],
                refs=[{"record_id": r["record_id"], "doc_id": r["doc_id"]} for r in dupes],
                responsible="CONTROLLER")

    vm = m["vendor_master"]
    remit_mismatch = bool(vm) and vm["remit_account_ref"] != m["invoice_remit_account_ref"]
    _sync_issue(conn, case, "REMIT_MISMATCH", remit_mismatch, False,
                description="Invoice payment destination differs from the approved vendor master.",
                detail={"invoice": m["invoice_remit_account_ref"],
                        "vendor_master": vm["remit_account_ref"] if vm else None},
                requirements=[_req("vendor-master change completed through the authorized process", False)],
                refs=m["sources"], responsible="CONTROLLER")

    pv = m["price_variance_cents"]
    _sync_issue(conn, case, "PRICE_VARIANCE", pv > 0, pv > 0 and price_credit == pv,
                description="Invoice unit price exceeds the supported agreement price.",
                detail={"variance_cents": pv, "verified_price_credits_cents": price_credit,
                        "lines": [{k: l[k] for k in ("item_id", "billed_qty", "invoice_unit_cents",
                                                     "contract_unit_cents", "price_source")}
                                  for l in m["lines"] if l["price_variance_cents"]]},
                requirements=[_req("verified PRICE credits equal the variance, or a trusted amendment supports the invoiced price",
                                   price_credit == pv, f"{price_credit} of {pv} cents credited")],
                refs=m["sources"] + cred_refs, responsible="SUPPLIER",
                absent_as="INVALIDATED")  # a trusted amendment means the premise was wrong

    qv = m["qty_variance_cents"]
    unacc = sum(l["unaccounted_qty"] for l in m["lines"])
    pending = sum(l["canceled_pending_ack_qty"] for l in m["lines"])
    disputed = sum(l["canceled_disputed_qty"] for l in m["lines"])
    backordered = sum(l["backordered_qty"] for l in m["lines"])
    reqs = [
        _req("status of every unreceived unit is established by a trusted record", unacc == 0,
             f"{unacc} units unaccounted"),
        _req("supplier acceptance documented for every canceled unit", pending == 0 and disputed == 0,
             f"{pending} pending acknowledgment, {disputed} disputed"),
        _req("no billed units remain on backorder", backordered == 0, f"{backordered} backordered"),
        _req("verified QUANTITY credits equal the value of unreceived units", qty_credit == qv,
             f"{qty_credit} of {qv} cents credited"),
    ]
    _sync_issue(conn, case, "QUANTITY_VARIANCE", qv > 0, qv > 0 and all(r["met"] for r in reqs),
                description="Billed quantity exceeds received quantity.",
                detail={"variance_cents": qv, "verified_quantity_credits_cents": qty_credit,
                        "unaccounted_qty": unacc, "canceled_pending_ack_qty": pending,
                        "canceled_disputed_qty": disputed, "backordered_qty": backordered,
                        "lines": [{k: l[k] for k in ("item_id", "billed_qty", "received_qty", "unreceived_qty")}
                                  for l in m["lines"] if l["unreceived_qty"]]},
                requirements=reqs, refs=m["sources"] + cred_refs,
                initial_status="UNKNOWN" if unacc else "OPEN")

    net = m["face_cents"] - price_credit - qty_credit
    other_credit = sum(c["amount_cents"] for c in creds if c["scope"] not in ("PRICE", "QUANTITY"))
    issues = list_issues(conn, case_id)
    blocking = [x for x in issues if x["blocking"] and x["status"] not in CLOSED]
    residual = net - other_credit - m["supported_cents"]
    ready_for_review = not blocking and residual == 0 and m["stated_total_cents"] == m["face_cents"]

    if case["work_status"] != "RESOLVED":
        new_ws = None
        if ready_for_review and case["work_status"] != "READY_FOR_REVIEW":
            new_ws = "READY_FOR_REVIEW"
        elif not ready_for_review and case["work_status"] in ("NEW", "READY_FOR_REVIEW"):
            new_ws = "INVESTIGATING"
        if new_ws:
            conn.execute(store.cases.update().where(store.cases.c.case_id == case_id)
                         .values(work_status=new_ws, updated_at=store.now()))
            events.emit(conn, "case.status", ENGINE, case_id=case_id, company_id=company_id,
                        payload={"work_status": new_ws})
    return {
        "case_id": case_id, "revision": case["revision"], "match": m,
        "verified_credits": creds, "net_supported_payable_cents": net - other_credit,
        "residual_cents": residual, "open_blocking_issues": [x["issue_id"] for x in blocking],
        "ready_for_review": ready_for_review,
    }


def bump_revision(conn: Connection, case_id: str, reason: str, actor: str = ENGINE) -> int:
    """New relevant evidence: advance the revision and invalidate work that depended on the old one."""
    case = get_case(conn, case_id)
    rev = case["revision"] + 1
    p, rv, ap = store.proposals, store.reviews, store.approvals
    stale = [r[0] for r in conn.execute(select(p.c.proposal_id).where(and_(
        p.c.case_id == case_id, p.c.status == "DRAFT"))).all()]
    values = dict(revision=rev, updated_at=store.now())
    if stale:
        conn.execute(p.update().where(p.c.proposal_id.in_(stale)).values(status="INVALIDATED"))
        conn.execute(rv.update().where(and_(rv.c.proposal_id.in_(stale), rv.c.status == "CURRENT"))
                     .values(status="INVALIDATED"))
        conn.execute(ap.update().where(and_(ap.c.proposal_id.in_(stale), ap.c.status.in_(("PENDING", "APPROVED"))))
                     .values(status="INVALIDATED"))
        for pid in stale:
            events.emit(conn, "proposal.invalidated", actor, case_id=case_id,
                        company_id=case["company_id"], payload={"proposal_id": pid, "reason": reason})
    if case["work_status"] != "RESOLVED":
        values.update(authorization_status="NOT_REQUESTED", payment_status="NOT_PREPARED")
    conn.execute(store.cases.update().where(store.cases.c.case_id == case_id).values(**values))
    _mark_batches_stale(conn, case)
    events.emit(conn, "case.revised", actor, case_id=case_id, company_id=case["company_id"],
                payload={"revision": rev, "reason": reason})
    if case["work_status"] == "RESOLVED":
        # Never silently edit committed work. Surface it for a human.
        record_issue(conn, case_id, "POST_COMMIT_EVIDENCE",
                     f"Evidence arrived after commitment: {reason}", actor=ENGINE,
                     responsible_party="CONTROLLER", opened_by=ENGINE + ":late")
    return rev


def _mark_batches_stale(conn: Connection, case: dict) -> None:
    b = store.payment_batches
    for row in conn.execute(select(b).where(and_(
            b.c.company_id == case["company_id"], b.c.status == "PROPOSED"))).mappings().all():
        if any(l["case_id"] == case["case_id"] for l in row["lines"]):
            conn.execute(b.update().where(b.c.batch_id == row["batch_id"]).values(status="STALE"))
            events.emit(conn, "payment_batch.stale", ENGINE, case_id=case["case_id"],
                        company_id=case["company_id"], payload={"batch_id": row["batch_id"]})


def affected_cases(conn: Connection, company_id: str, record: dict) -> list[str]:
    """Only cases that actually reference the record. One discovery never touches unrelated work."""
    d, t = record["data"], record["record_type"]
    out = []
    for case in conn.execute(select(store.cases).where(store.cases.c.company_id == company_id)).mappings().all():
        inv = get_record(conn, company_id, case["invoice_id"])
        if inv is None:
            continue
        i = inv["data"]
        hit = (
            d.get("invoice_id") == i["invoice_id"]
            or (d.get("po_id") and d.get("po_id") == i.get("po_id"))
            or (t in ("AGREEMENT", "VENDOR_MASTER") and d.get("vendor_id") == i["vendor_id"])
            or (t == "INVOICE" and d.get("vendor_id") == i["vendor_id"]
                and d.get("invoice_number") == i["invoice_number"])
        )
        if t == "CHANGE_ORDER_ACK" and not hit:
            co = get_record(conn, company_id, d["co_id"])
            hit = bool(co and co["data"]["po_id"] == i.get("po_id"))
        if hit:
            out.append(case["case_id"])
    return out


def on_new_evidence(conn: Connection, company_id: str, record: dict, actor: str = ENGINE) -> list[str]:
    if record.get("duplicate") or record["trust"] != "TRUSTED":
        return []
    touched = affected_cases(conn, company_id, record)
    for case_id in touched:
        if record['record_type'] != 'CREDIT_MEMO':
            case = get_case(conn, case_id)
            # Verification is dependent on invoice/contract/receipt versions, not permanent.
            conn.execute(store.credits.update().where(
                store.credits.c.company_id == company_id,
                store.credits.c.invoice_id == case['invoice_id'],
                store.credits.c.state == 'VERIFIED').values(state='RECEIVED', checks=[], updated_at=store.now()))
        bump_revision(conn, case_id, f"{record['record_type']} {record['record_id']} v{record['version']}", actor)
        evaluate_case(conn, case_id)
    return touched


def record_issue(conn: Connection, case_id: str, type_: str, description: str, *, actor: str,
                 evidence_refs: list | None = None, responsible_party: str | None = None,
                 next_action: str | None = None, blocking: bool = True, opened_by: str | None = None) -> str:
    """Agent- or human-raised issue. It stays open until an authorized actor closes it."""
    case = get_case(conn, case_id)
    i = store.case_issues
    opened_by = opened_by or actor
    row = conn.execute(select(i.c.issue_id).where(and_(
        i.c.case_id == case_id, i.c.type == type_, i.c.opened_by == opened_by))).first()
    if row:
        return row[0]
    issue_id = "iss_" + uuid.uuid4().hex[:10]
    conn.execute(i.insert().values(
        issue_id=issue_id, case_id=case_id, type=type_, description=description, status="OPEN",
        blocking=int(blocking), detail={}, evidence_refs=evidence_refs or [], dependencies=[],
        resolution_requirements=[_req("authorized resolution recorded", False)],
        responsible_party=responsible_party, next_action=next_action, revision=case["revision"],
        opened_by=opened_by, opened_at=store.now(),
    ))
    events.emit(conn, "issue.opened", actor, case_id=case_id, company_id=case["company_id"],
                payload={"issue_id": issue_id, "type": type_, "status": "OPEN"})
    evaluate_case(conn, case_id)
    return issue_id


def update_issue(conn: Connection, issue_id: str, *, actor: str, status: str | None = None,
                 next_action: str | None = None, responsible_party: str | None = None,
                 evidence_refs: list | None = None) -> dict:
    """Routing updates only. Nobody sets SATISFIED through this path."""
    i = store.case_issues
    row = conn.execute(select(i).where(i.c.issue_id == issue_id)).mappings().first()
    if not row:
        raise CaseError(f"unknown issue {issue_id}")
    if row["status"] in CLOSED:
        raise CaseError("issue is closed; new evidence reopens it, not a status edit")
    if status is not None and status not in AGENT_SETTABLE_ISSUE_STATUS:
        raise CaseError(f"status {status} is engine-owned")
    values = {k: v for k, v in dict(status=status, next_action=next_action,
                                    responsible_party=responsible_party).items() if v is not None}
    if evidence_refs:
        values["evidence_refs"] = list(row["evidence_refs"]) + evidence_refs
    conn.execute(i.update().where(i.c.issue_id == issue_id).values(**values))
    case = get_case(conn, row["case_id"])
    events.emit(conn, "issue.updated", actor, case_id=row["case_id"], company_id=case["company_id"],
                payload={"issue_id": issue_id, "type": row["type"], "from": row["status"], **values})
    return {**dict(row), **values}


def set_work_status(conn: Connection, case_id: str, status: str, reason: str, actor: str) -> None:
    if status not in AGENT_SETTABLE_WORK_STATUS:
        raise CaseError(f"work status {status} is derived, not set")
    case = get_case(conn, case_id)
    if case["work_status"] == "RESOLVED":
        raise CaseError("case is resolved")
    conn.execute(store.cases.update().where(store.cases.c.case_id == case_id)
                 .values(work_status=status, updated_at=store.now()))
    kind = {"ESCALATED": "case.escalated", "WAITING_EXTERNAL": "case.waiting",
            "WAITING_INTERNAL": "case.waiting"}.get(status, "case.status")
    events.emit(conn, kind, actor, case_id=case_id, company_id=case["company_id"],
                payload={"work_status": status, "reason": reason})
