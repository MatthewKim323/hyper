"""Credit memo lifecycle: REQUESTED -> RECEIVED -> VERIFIED -> ALLOCATED.

A message saying a credit exists is not a credit. Only a trusted memo record that
passes these checks becomes usable, and it can be consumed exactly once.
"""
from __future__ import annotations

from sqlalchemy import and_, select
from sqlalchemy.engine import Connection

from . import casework, events, store
from .ingest import get_record
from .matching import match_invoice


def register_credit_memo(conn: Connection, company_id: str, record: dict) -> dict:
    """Called when a CREDIT_MEMO record lands. Untrusted memos are tracked but never usable."""
    c = store.credits
    d = record["data"]
    existing = conn.execute(select(c).where(c.c.credit_id == d["cm_id"])).mappings().first()
    untrusted_stub = bool(existing) and existing["state"] == "REJECTED" and any(
        x["check"] == "trusted_source" for x in existing["checks"])
    if existing and not (untrusted_stub and record["trust"] == "TRUSTED"):
        return dict(existing)
    if existing:
        # A spoofed copy must not be able to pre-poison the id of the real memo.
        conn.execute(c.delete().where(c.c.credit_id == d["cm_id"]))
    twin = conn.execute(select(c.c.credit_id).where(and_(
        c.c.company_id == company_id, c.c.vendor_id == d["vendor_id"],
        c.c.memo_number == d["memo_number"], c.c.state != "REJECTED",
    ))).first()
    if record["trust"] != "TRUSTED":
        state, checks = "REJECTED", [{"check": "trusted_source", "ok": False,
                                      "detail": "not delivered through an approved authenticated channel"}]
    elif twin:
        state, checks = "DUPLICATE", [{"check": "unique_memo_number", "ok": False,
                                       "detail": f"same memo number as {twin[0]}"}]
    else:
        state, checks = "RECEIVED", []
    conn.execute(c.insert().values(
        credit_id=d["cm_id"], company_id=company_id, vendor_id=d["vendor_id"],
        invoice_id=d.get("invoice_id"), memo_number=d["memo_number"], currency=d["currency"],
        scope=d["scope"], amount_cents=d["amount_cents"], remaining_cents=d["amount_cents"],
        state=state, doc_id=record["doc_id"], checks=checks, updated_at=store.now(),
    ))
    events.emit(conn, "credit.received", "engine", company_id=company_id,
                payload={"credit_id": d["cm_id"], "state": state, "amount_cents": d["amount_cents"]})
    return dict(conn.execute(select(c).where(c.c.credit_id == d["cm_id"])).mappings().first())


def inspect_credit_memo(conn: Connection, case_id: str, credit_id: str, actor: str) -> dict:
    """Deterministic verification against this case. The caller cannot choose the outcome."""
    case = casework.get_case(conn, case_id)
    c = store.credits
    cred = conn.execute(select(c).where(c.c.credit_id == credit_id)).mappings().first()
    if not cred:
        return {"credit_id": credit_id, "found": False, "usable": False,
                "detail": "no credit memo record with this id has been received"}
    cred = dict(cred)
    if cred["state"] in ("VERIFIED", "ALLOCATED", "REJECTED", "DUPLICATE", "SUPERSEDED"):
        return {"credit_id": credit_id, "found": True, "state": cred["state"],
                "usable": cred["state"] == "VERIFIED" and cred["invoice_id"] == case["invoice_id"],
                "checks": cred["checks"], "amount_cents": cred["amount_cents"], "scope": cred["scope"]}
    rec = get_record(conn, case["company_id"], credit_id)
    inv = get_record(conn, case["company_id"], case["invoice_id"])
    memo, i = rec["data"], inv["data"]
    m = match_invoice(conn, case["company_id"], inv)
    lines = {l["item_id"]: l for l in m["lines"]}

    applies = memo.get("invoice_id") == i["invoice_id"]
    checks = [
        {"check": "references_this_invoice", "ok": applies, "detail": f"memo references {memo.get('invoice_id')}"},
        {"check": "vendor_matches", "ok": memo["vendor_id"] == i["vendor_id"], "detail": memo["vendor_id"]},
        {"check": "currency_matches", "ok": memo["currency"] == i["currency"], "detail": memo["currency"]},
        {"check": "positive_amount", "ok": memo["amount_cents"] > 0, "detail": str(memo["amount_cents"])},
        {"check": "scope_supported", "ok": memo["scope"] in ("PRICE", "QUANTITY"), "detail": memo["scope"]},
    ]
    basis_total = sum(b["qty"] * b["unit_cents"] for b in memo["basis"])
    checks.append({"check": "basis_ties_to_amount", "ok": bool(memo["basis"]) and basis_total == memo["amount_cents"],
                   "detail": f"basis {basis_total} vs amount {memo['amount_cents']}"})
    within = True
    for b in memo["basis"]:
        l = lines.get(b["item_id"])
        if l is None:
            within = False
        elif memo["scope"] == "PRICE":
            within &= b["qty"] <= l["billed_qty"] and b["unit_cents"] <= max(0, l["invoice_unit_cents"] - l["contract_unit_cents"])
        elif memo["scope"] == "QUANTITY":
            within &= b["qty"] <= l["unreceived_qty"] and b["unit_cents"] == min(l["invoice_unit_cents"], l["contract_unit_cents"])
    checks.append({"check": "basis_within_invoice_discrepancy", "ok": within,
                   "detail": "credited units and rates must not exceed the discrepancy on this invoice"})
    used = {}
    for other in casework.verified_credits(conn, case['company_id'], case['invoice_id'], states=('VERIFIED','ALLOCATED')):
        if other['scope'] != memo['scope']:continue
        prior = get_record(conn, case['company_id'], other['credit_id'])
        for basis in prior['data']['basis']:
            used[basis['item_id']] = used.get(basis['item_id'],0) + basis['qty'] * basis['unit_cents']
    for basis in memo['basis']:
        used[basis['item_id']] = used.get(basis['item_id'],0) + basis['qty'] * basis['unit_cents']
    cap_key = 'price_variance_cents' if memo['scope']=='PRICE' else 'qty_variance_cents'
    checks.append({'check':'cumulative_credit_within_discrepancy', 'ok':all(item in lines and amount <= lines[item][cap_key] for item,amount in used.items()), 'detail':'all verified credits must fit each item discrepancy'})

    if not applies:
        # An unrelated memo is not defective, it just is not evidence for this case.
        return {"credit_id": credit_id, "found": True, "state": cred["state"], "usable": False,
                "checks": checks, "detail": "memo does not reference this invoice"}
    ok = all(x["ok"] for x in checks)
    state = "VERIFIED" if ok else "REJECTED"
    conn.execute(c.update().where(and_(c.c.credit_id == credit_id, c.c.state == "RECEIVED"))
                 .values(state=state, checks=checks, updated_at=store.now()))
    events.emit(conn, "credit.verified" if ok else "credit.rejected", actor, case_id=case_id,
                company_id=case["company_id"],
                payload={"credit_id": credit_id, "scope": memo["scope"],
                         "amount_cents": memo["amount_cents"], "checks": checks})
    if ok:
        casework.bump_revision(conn, case_id, f"credit {credit_id} verified", actor)
    casework.evaluate_case(conn, case_id)
    return {"credit_id": credit_id, "found": True, "state": state, "usable": ok, "checks": checks,
            "amount_cents": memo["amount_cents"], "scope": memo["scope"]}
