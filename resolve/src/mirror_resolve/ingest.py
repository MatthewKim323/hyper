"""Document and record intake. Documents are immutable, records are versioned.

Trust follows the fixture's explicit source rules. This is provenance bookkeeping
inside a simulator, not forensic authentication of real-world documents.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.engine import Connection

from . import events, store
from .policy import DEFAULT_POLICY, Policy
from .schemas import RECORD_TYPES

INTERNAL_SOURCES = {"ERP", "PROCUREMENT_SYSTEM", "RECEIVING_SYSTEM"}
SUPPLIER_TYPES = {"CREDIT_MEMO", "CHANGE_ORDER_ACK", "BACKORDER_NOTICE", "INVOICE"}
# Vendor master only changes through the ERP's own controlled process.
SOURCE_RULES = {"VENDOR_MASTER": {"ERP"}}


def store_document(
    conn: Connection,
    company_id: str,
    filename: str,
    content: bytes,
    *,
    source_system: str,
    channel: str,
    sender: str | None = None,
    source_msg_id: str | None = None,
    media_type: str = "application/json",
    supersedes_doc_id: str | None = None,
    extraction_status: str = "STRUCTURED",
) -> tuple[str, bool]:
    """Returns (doc_id, is_duplicate). A redelivery never creates a second document."""
    d = store.documents
    sha = hashlib.sha256(content).hexdigest()
    if source_msg_id is not None:
        hit = conn.execute(
            select(d.c.doc_id).where(and_(
                d.c.company_id == company_id,
                d.c.source_system == source_system,
                d.c.source_msg_id == source_msg_id,
            ))
        ).first()
        if hit:
            return hit[0], True
    hit = conn.execute(
        select(d.c.doc_id).where(and_(
            d.c.company_id == company_id, d.c.sha256 == sha,
            d.c.source_system == source_system,
            d.c.sender.is_(None) if sender is None else d.c.sender == sender,
        ))
    ).first()
    if hit:
        return hit[0], True
    doc_id = "doc_" + uuid.uuid4().hex[:12]
    conn.execute(d.insert().values(
        doc_id=doc_id, company_id=company_id, sha256=sha, filename=filename,
        media_type=media_type, source_system=source_system, channel=channel,
        sender=sender, source_msg_id=source_msg_id, received_at=store.now(),
        content=content, extraction_status=extraction_status,
        supersedes_doc_id=supersedes_doc_id,
    ))
    return doc_id, False


def decide_trust(
    conn: Connection, company_id: str, record_type: str, data: dict,
    source_system: str, sender: str | None, policy: Policy,
) -> str:
    if source_system not in policy.trusted_sources:
        return "UNVERIFIED"
    allowed = SOURCE_RULES.get(record_type)
    if allowed is not None:
        return "TRUSTED" if source_system in allowed else "UNVERIFIED"
    if source_system in INTERNAL_SOURCES:
        return "TRUSTED"
    # Supplier portal: the authenticated sender must be the approved vendor the record names.
    if record_type in SUPPLIER_TYPES and sender and sender == data.get("vendor_id"):
        return "TRUSTED" if get_record(conn, company_id, sender) else "UNVERIFIED"
    return "UNVERIFIED"


def put_record(
    conn: Connection,
    company_id: str,
    record_type: str,
    data: dict[str, Any],
    *,
    source_system: str,
    channel: str = "API",
    sender: str | None = None,
    source_msg_id: str | None = None,
    actor: str = "intake",
    policy: Policy = DEFAULT_POLICY,
) -> dict:
    """Validate, store the source document, and append a new record version."""
    model, key = RECORD_TYPES[record_type]
    parsed = model.model_validate(data)
    clean = json.loads(parsed.model_dump_json())
    record_id = clean[key]
    content = json.dumps(clean, sort_keys=True).encode()
    doc_id, dup = store_document(
        conn, company_id, f"{record_id}.json", content,
        source_system=source_system, channel=channel, sender=sender,
        source_msg_id=source_msg_id,
    )
    r = store.records
    if dup:
        existing = conn.execute(
            select(r).where(and_(r.c.company_id == company_id, r.c.doc_id == doc_id))
        ).mappings().first()
        if existing:
            events.emit(conn, "evidence.duplicate_ignored", actor, company_id=company_id,
                        payload={"record_id": record_id, "doc_id": doc_id})
            return {**dict(existing), "duplicate": True}
    trust = decide_trust(conn, company_id, record_type, clean, source_system, sender, policy)
    prev = conn.execute(
        select(r.c.version).where(and_(r.c.company_id == company_id, r.c.record_id == record_id))
        .order_by(r.c.version.desc())
    ).first()
    version = (prev[0] + 1) if prev else 1
    if prev and trust == "TRUSTED":
        conn.execute(r.update().where(and_(
            r.c.company_id == company_id, r.c.record_id == record_id, r.c.status == "ACTIVE",
            r.c.trust == "TRUSTED",
        )).values(status="SUPERSEDED"))
    conn.execute(r.insert().values(
        record_id=record_id, record_type=record_type, version=version,
        company_id=company_id, doc_id=doc_id, data=clean, trust=trust,
        status="ACTIVE", created_at=store.now(),
    ))
    events.emit(conn, "evidence.received", actor, company_id=company_id, payload={
        "record_id": record_id, "record_type": record_type, "version": version,
        "doc_id": doc_id, "trust": trust, "source_system": source_system,
    })
    return {"record_id": record_id, "record_type": record_type, "version": version,
            "doc_id": doc_id, "data": clean, "trust": trust, "status": "ACTIVE",
            "duplicate": False}


def get_record(conn: Connection, company_id: str, record_id: str, trusted_only: bool = True) -> dict | None:
    r = store.records
    q = select(r).where(and_(
        r.c.company_id == company_id, r.c.record_id == record_id, r.c.status == "ACTIVE",
    ))
    if trusted_only:
        q = q.where(r.c.trust == "TRUSTED")
    row = conn.execute(q.order_by(r.c.version.desc())).mappings().first()
    return dict(row) if row else None


def list_records(
    conn: Connection, company_id: str, record_type: str, trusted_only: bool = True, **where: Any,
) -> list[dict]:
    r = store.records
    q = select(r).where(and_(
        r.c.company_id == company_id, r.c.record_type == record_type, r.c.status == "ACTIVE",
    ))
    if trusted_only:
        q = q.where(r.c.trust == "TRUSTED")
    rows = [dict(x) for x in conn.execute(q.order_by(r.c.id)).mappings().all()]
    return [x for x in rows if all(x["data"].get(k) == v for k, v in where.items())]
