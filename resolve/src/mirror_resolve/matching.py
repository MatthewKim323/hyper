"""Deterministic three-way match. Recomputed from current trusted records every time.

The model never supplies these numbers. It decides what to look for and whom to
ask; the arithmetic, joins and dates live here.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy.engine import Connection

from .ingest import get_record, list_records


def applicable_price(agreements: list[dict], vendor_id: str, item_id: str, on: date) -> tuple[int, dict] | None:
    best: tuple[tuple, int, dict] | None = None
    for rec in agreements:
        a = rec["data"]
        if a["vendor_id"] != vendor_id:
            continue
        start = date.fromisoformat(a["effective_from"])
        end = date.fromisoformat(a["effective_to"]) if a.get("effective_to") else None
        if start > on or (end and end < on):
            continue
        for p in a["prices"]:
            if p["item_id"] == item_id:
                rank = (start, a.get("amendment_no", 0))
                if best is None or rank > best[0]:
                    best = (rank, p["unit_price_cents"], rec)
    return (best[1], best[2]) if best else None


def _ref(rec: dict) -> dict:
    return {"record_id": rec["record_id"], "version": rec["version"], "doc_id": rec["doc_id"]}


def match_invoice(conn: Connection, company_id: str, invoice_rec: dict) -> dict:
    inv = invoice_rec["data"]
    missing: list[str] = []
    sources: list[dict] = [_ref(invoice_rec)]
    on = date.fromisoformat(inv["invoice_date"])

    vendor = get_record(conn, company_id, inv["vendor_id"])
    if vendor is None:
        missing.append(f"vendor master for {inv['vendor_id']}")
    else:
        sources.append(_ref(vendor))

    po = get_record(conn, company_id, inv["po_id"]) if inv.get("po_id") else None
    if po is None:
        missing.append("purchase order")
    else:
        sources.append(_ref(po))

    agreements = list_records(conn, company_id, "AGREEMENT")
    receipts = list_records(conn, company_id, "GOODS_RECEIPT", po_id=inv.get("po_id")) if po else []
    change_orders = list_records(conn, company_id, "CHANGE_ORDER", po_id=inv.get("po_id")) if po else []
    acks = {a["data"]["co_id"]: a for a in list_records(conn, company_id, "CHANGE_ORDER_ACK")
            if a["data"]["vendor_id"] == inv["vendor_id"]}
    backorders = list_records(conn, company_id, "BACKORDER_NOTICE", po_id=inv.get("po_id")) if po else []
    sources += [_ref(x) for x in receipts]

    lines = []
    for ln in inv["lines"]:
        item, billed, inv_price = ln["item_id"], ln["qty"], ln["unit_price_cents"]
        price_src = None
        found = applicable_price(agreements, inv["vendor_id"], item, on)
        if found:
            contract_price, arec = found
            price_src = _ref(arec)
            sources.append(price_src)
        elif po:
            po_line = next((x for x in po["data"]["lines"] if x["item_id"] == item), None)
            contract_price = po_line["unit_price_cents"] if po_line else None
            price_src = _ref(po) if po_line else None
        else:
            contract_price = None
        if contract_price is None:
            missing.append(f"supported price for item {item}")
            contract_price = 0

        received = sum(l["qty"] for r in receipts for l in r["data"]["lines"] if l["item_id"] == item)
        canceled_accepted = canceled_pending = canceled_disputed = 0
        for co in change_orders:
            c = co["data"]
            if c["kind"] != "CANCEL_QTY" or c["internal_status"] != "APPROVED":
                continue
            qty = sum(l["qty"] for l in c["lines"] if l["item_id"] == item)
            if not qty:
                continue
            sources.append(_ref(co))
            ack = acks.get(c["co_id"])
            if ack is None:
                canceled_pending += qty
            elif ack["data"]["response"] == "ACCEPTED":
                canceled_accepted += qty
                sources.append(_ref(ack))
            else:
                canceled_disputed += qty
                sources.append(_ref(ack))
        backordered = sum(l["qty"] for b in backorders for l in b["data"]["lines"] if l["item_id"] == item)
        sources += [_ref(b) for b in backorders]

        supported_price = min(inv_price, contract_price)
        supported_qty = min(billed, received)
        unreceived = max(0, billed - received)
        unaccounted = max(0, unreceived - canceled_accepted - canceled_pending - canceled_disputed - backordered)
        lines.append({
            "item_id": item,
            "billed_qty": billed,
            "invoice_unit_cents": inv_price,
            "contract_unit_cents": contract_price,
            "price_source": price_src,
            "received_qty": received,
            "unreceived_qty": unreceived,
            "canceled_accepted_qty": canceled_accepted,
            "canceled_pending_ack_qty": canceled_pending,
            "canceled_disputed_qty": canceled_disputed,
            "backordered_qty": backordered,
            "unaccounted_qty": unaccounted,
            "price_variance_cents": max(0, inv_price - contract_price) * billed,
            "qty_variance_cents": unreceived * supported_price,
            "supported_cents": supported_qty * supported_price,
        })

    face = sum(l["billed_qty"] * l["invoice_unit_cents"] for l in lines)
    seen, uniq = set(), []
    for s in sources:
        k = (s["record_id"], s["version"])
        if k not in seen:
            seen.add(k)
            uniq.append(s)
    return {
        "invoice_id": inv["invoice_id"],
        "vendor_id": inv["vendor_id"],
        "currency": inv["currency"],
        "face_cents": face,
        "stated_total_cents": inv["total_cents"],
        "lines": lines,
        "price_variance_cents": sum(l["price_variance_cents"] for l in lines),
        "qty_variance_cents": sum(l["qty_variance_cents"] for l in lines),
        "supported_cents": sum(l["supported_cents"] for l in lines),
        "missing": missing,
        "sources": uniq,
        "vendor_master": _ref(vendor) | {"remit_account_ref": vendor["data"]["remit_account_ref"]} if vendor else None,
        "invoice_remit_account_ref": inv["remit_account_ref"],
    }
