"""Typed shapes for structured business records. Amounts are integer cents."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Rec(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PriceLine(_Rec):
    item_id: str
    unit_price_cents: int = Field(ge=0)


class QtyLine(_Rec):
    item_id: str
    qty: int = Field(gt=0)


class OrderLine(_Rec):
    item_id: str
    description: str = ""
    qty: int = Field(gt=0)
    unit_price_cents: int = Field(ge=0)


class VendorMaster(_Rec):
    vendor_id: str
    name: str
    approved_contact: str
    remit_account_ref: str


class PurchaseOrder(_Rec):
    po_id: str
    vendor_id: str
    agreement_id: str | None = None
    currency: str
    lines: list[OrderLine]


class Agreement(_Rec):
    agreement_id: str
    vendor_id: str
    amends: str | None = None
    amendment_no: int = 0
    effective_from: date
    effective_to: date | None = None
    currency: str
    prices: list[PriceLine]


class GoodsReceipt(_Rec):
    gr_id: str
    po_id: str
    received_on: date
    lines: list[QtyLine]


class Invoice(_Rec):
    invoice_id: str
    invoice_number: str
    vendor_id: str
    po_id: str | None
    currency: str
    invoice_date: date
    lines: list[OrderLine]
    total_cents: int
    remit_account_ref: str


class ChangeOrder(_Rec):
    co_id: str
    po_id: str
    kind: Literal["CANCEL_QTY"]
    lines: list[QtyLine]
    internal_status: Literal["REQUESTED", "APPROVED", "REJECTED"]
    approved_by: str | None = None


class ChangeOrderAck(_Rec):
    ack_id: str
    co_id: str
    vendor_id: str
    response: Literal["ACCEPTED", "DISPUTED"]
    note: str = ""


class BackorderNotice(_Rec):
    notice_id: str
    po_id: str
    vendor_id: str
    lines: list[QtyLine]
    expected_on: date | None = None


class CreditBasis(_Rec):
    item_id: str
    qty: int = Field(gt=0)
    unit_cents: int = Field(gt=0)


class CreditMemo(_Rec):
    cm_id: str
    memo_number: str
    vendor_id: str
    invoice_id: str | None
    currency: str
    amount_cents: int
    scope: Literal["PRICE", "QUANTITY", "OTHER"]
    basis: list[CreditBasis] = []
    issued_on: date


RECORD_TYPES: dict[str, tuple[type[_Rec], str]] = {
    "VENDOR_MASTER": (VendorMaster, "vendor_id"),
    "PURCHASE_ORDER": (PurchaseOrder, "po_id"),
    "AGREEMENT": (Agreement, "agreement_id"),
    "GOODS_RECEIPT": (GoodsReceipt, "gr_id"),
    "INVOICE": (Invoice, "invoice_id"),
    "CHANGE_ORDER": (ChangeOrder, "co_id"),
    "CHANGE_ORDER_ACK": (ChangeOrderAck, "ack_id"),
    "BACKORDER_NOTICE": (BackorderNotice, "notice_id"),
    "CREDIT_MEMO": (CreditMemo, "cm_id"),
}
