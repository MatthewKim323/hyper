"""Payment batch projection. Totals come from the same committed events the cases do."""
from __future__ import annotations

import uuid

from sqlalchemy import and_, select
from sqlalchemy.engine import Connection

from . import casework, events, store
from .ingest import get_record
from .proposals import canonical_hash


def project_batch(conn: Connection, company_id: str) -> dict:
    ee = store.economic_events
    committed = {r["case_id"]: dict(r) for r in conn.execute(
        select(ee).where(and_(ee.c.company_id == company_id, ee.c.type == "AP_RECOGNITION"))).mappings().all()}
    lines = []
    for case in conn.execute(select(store.cases).where(store.cases.c.company_id == company_id)
                             .order_by(store.cases.c.created_at)).mappings().all():
        inv = get_record(conn, company_id, case["invoice_id"])
        face = sum(l["qty"] * l["unit_price_cents"] for l in inv["data"]["lines"])
        creds = casework.verified_credits(conn, company_id, case["invoice_id"], states=("VERIFIED", "ALLOCATED"))
        issues = casework.list_issues(conn, case["case_id"])
        open_issues = [i for i in issues if i["blocking"] and i["status"] not in casework.CLOSED]
        econ = committed.get(case["case_id"])
        ready = case["payment_status"] == "PAYMENT_READY" and econ is not None
        lines.append({
            "case_id": case["case_id"], "invoice_id": case["invoice_id"],
            "vendor_id": inv["data"]["vendor_id"],
            "work_status": case["work_status"], "authorization_status": case["authorization_status"],
            "payment_status": case["payment_status"], "revision": case["revision"],
            "invoice_face_cents": face,
            "verified_credits_cents": sum(c["amount_cents"] for c in creds),
            "net_supported_payable_cents": face - sum(c["amount_cents"] for c in creds),
            # Planned payment only exists once the recognition event is committed.
            "planned_payment_cents": econ["amount_cents"] if ready else 0,
            "open_issues": [{"issue_id": i["issue_id"], "type": i["type"], "status": i["status"],
                             "responsible_party": i["responsible_party"], "next_action": i["next_action"]}
                            for i in open_issues],
            "age_seconds": int((store.now() - case["created_at"].replace(tzinfo=store.now().tzinfo)).total_seconds()),
        })
    return {
        "company_id": company_id,
        "lines": lines,
        "payment_ready_total_cents": sum(l["planned_payment_cents"] for l in lines),
        "ap_obligation_cents": sum(e["amount_cents"] for e in committed.values()),
        "cash_moved_cents": 0,  # no payment events exist in the MVP
        "counts": {s: sum(1 for l in lines if l["work_status"] == s) for s in sorted({l["work_status"] for l in lines})},
    }


def propose_payment_batch(conn: Connection, company_id: str, actor: str) -> dict:
    proj = project_batch(conn, company_id)
    ready = [{"case_id": l["case_id"], "invoice_id": l["invoice_id"], "vendor_id": l["vendor_id"],
              "amount_cents": l["planned_payment_cents"], "revision": l["revision"]}
             for l in proj["lines"] if l["planned_payment_cents"] > 0]
    batch_id = "batch_" + uuid.uuid4().hex[:10]
    total = sum(l["amount_cents"] for l in ready)
    conn.execute(store.payment_batches.insert().values(
        batch_id=batch_id, company_id=company_id, status="PROPOSED", lines=ready,
        total_cents=total, hash=canonical_hash({"lines": ready, "total": total}), created_at=store.now()))
    events.emit(conn, "payment_batch.proposed", actor, company_id=company_id,
                payload={"batch_id": batch_id, "total_cents": total, "cases": [l["case_id"] for l in ready]})
    return {"batch_id": batch_id, "status": "PROPOSED", "lines": ready, "total_cents": total,
            "excluded": [l for l in proj["lines"] if l["planned_payment_cents"] == 0]}
