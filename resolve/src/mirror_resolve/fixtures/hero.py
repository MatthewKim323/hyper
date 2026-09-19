"""DEV_FIXTURE: the incomplete-supplier-correction scenario. Everything here is synthetic.

Only the initial ERP state is seeded. The cancellation record, acknowledgment and
credit memos are separate builders because in a real run they arrive later, from
counterparties, and only if those counterparties actually produce them.
"""
from __future__ import annotations

from sqlalchemy.engine import Connection

from ..casework import open_case
from ..intake import receive_record

COMPANY = "DEMO_CO_001"
VENDOR = "DEMO_VENDOR_001"
ITEM = "ITEM-7300"


def seed_initial(conn: Connection, company_id: str = COMPANY) -> dict:
    erp = dict(source_system="ERP", actor="seed")
    receive_record(conn, company_id, "VENDOR_MASTER", {
        "vendor_id": VENDOR, "name": "Demo Vendor 001 (simulated)",
        "approved_contact": "portal:DEMO_VENDOR_001", "remit_account_ref": "REMIT-DV001-A"}, **erp)
    receive_record(conn, company_id, "AGREEMENT", {
        "agreement_id": "AGR-220", "vendor_id": VENDOR, "effective_from": "2026-01-01",
        "currency": "USD", "prices": [{"item_id": ITEM, "unit_price_cents": 10_000}]},
        source_system="PROCUREMENT_SYSTEM", actor="seed")
    receive_record(conn, company_id, "PURCHASE_ORDER", {
        "po_id": "PO-481", "vendor_id": VENDOR, "agreement_id": "AGR-220", "currency": "USD",
        "lines": [{"item_id": ITEM, "description": "Widget housing", "qty": 1000, "unit_price_cents": 10_000}]},
        source_system="PROCUREMENT_SYSTEM", actor="seed")
    receive_record(conn, company_id, "GOODS_RECEIPT", {
        "gr_id": "GR-771", "po_id": "PO-481", "received_on": "2026-09-08",
        "lines": [{"item_id": ITEM, "qty": 800}]}, source_system="RECEIVING_SYSTEM", actor="seed")
    receive_record(conn, company_id, "INVOICE", {
        "invoice_id": "INV-1042", "invoice_number": "DV-1042", "vendor_id": VENDOR, "po_id": "PO-481",
        "currency": "USD", "invoice_date": "2026-09-10",
        "lines": [{"item_id": ITEM, "description": "Widget housing", "qty": 1000, "unit_price_cents": 12_000}],
        "total_cents": 12_000_000, "remit_account_ref": "REMIT-DV001-A"}, **erp)
    return open_case(conn, company_id, "INV-1042")


def cancellation_record() -> tuple[str, dict, dict]:
    return ("CHANGE_ORDER", {
        "co_id": "CO-55", "po_id": "PO-481", "kind": "CANCEL_QTY",
        "lines": [{"item_id": ITEM, "qty": 200}], "internal_status": "APPROVED",
        "approved_by": "procurement.lead"}, dict(source_system="PROCUREMENT_SYSTEM"))


def supplier_ack(response: str = "ACCEPTED") -> tuple[str, dict, dict]:
    return ("CHANGE_ORDER_ACK", {
        "ack_id": "ACK-55", "co_id": "CO-55", "vendor_id": VENDOR, "response": response},
        dict(source_system="SUPPLIER_PORTAL", sender=VENDOR))


def price_credit() -> tuple[str, dict, dict]:
    return ("CREDIT_MEMO", {
        "cm_id": "CM-201", "memo_number": "DV-CM-201", "vendor_id": VENDOR, "invoice_id": "INV-1042",
        "currency": "USD", "amount_cents": 2_000_000, "scope": "PRICE",
        "basis": [{"item_id": ITEM, "qty": 1000, "unit_cents": 2_000}], "issued_on": "2026-09-12"},
        dict(source_system="SUPPLIER_PORTAL", sender=VENDOR))


def quantity_credit() -> tuple[str, dict, dict]:
    return ("CREDIT_MEMO", {
        "cm_id": "CM-202", "memo_number": "DV-CM-202", "vendor_id": VENDOR, "invoice_id": "INV-1042",
        "currency": "USD", "amount_cents": 2_000_000, "scope": "QUANTITY",
        "basis": [{"item_id": ITEM, "qty": 200, "unit_cents": 10_000}], "issued_on": "2026-09-13"},
        dict(source_system="SUPPLIER_PORTAL", sender=VENDOR))
