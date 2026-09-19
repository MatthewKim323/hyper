"""Tables and engine. Append-only where it matters: documents, records, events.

Amounts are integer minor units (cents). Nothing here moves money.
SQLite by default, DATABASE_URL can point at Postgres (same schema).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Integer,
    LargeBinary,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.engine import Engine

md = MetaData()


def now() -> datetime:
    return datetime.now(timezone.utc)


# Immutable source documents. A replacement is a new row that points at the old one.
documents = Table(
    "documents", md,
    Column("doc_id", String, primary_key=True),
    Column("company_id", String, nullable=False),
    Column("sha256", String, nullable=False),
    Column("filename", String, nullable=False),
    Column("media_type", String, nullable=False),
    Column("source_system", String, nullable=False),
    Column("channel", String, nullable=False),
    Column("sender", String),
    Column("source_msg_id", String),
    Column("received_at", DateTime(timezone=True), nullable=False),
    Column("content", LargeBinary, nullable=False),
    Column("extraction_status", String, nullable=False),
    Column("supersedes_doc_id", String),
    UniqueConstraint("company_id", "source_system", "source_msg_id", name="uq_doc_source_msg"),
)

# Versioned structured business records (PO, invoice, receipt, agreement, ...).
records = Table(
    "records", md,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("record_id", String, nullable=False),
    Column("record_type", String, nullable=False),
    Column("version", Integer, nullable=False),
    Column("company_id", String, nullable=False),
    Column("doc_id", String),
    Column("data", JSON, nullable=False),
    Column("trust", String, nullable=False),    # TRUSTED | UNVERIFIED
    Column("status", String, nullable=False),   # ACTIVE | SUPERSEDED | DUPLICATE | REJECTED
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("company_id", "record_id", "version", name="uq_record_version"),
)

cases = Table(
    "cases", md,
    Column("case_id", String, primary_key=True),
    Column("company_id", String, nullable=False),
    Column("invoice_id", String, nullable=False),
    Column("revision", Integer, nullable=False),
    Column("work_status", String, nullable=False),
    Column("authorization_status", String, nullable=False),
    Column("payment_status", String, nullable=False),
    Column("owner", String, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("company_id", "invoice_id", name="uq_case_invoice"),
)

case_issues = Table(
    "case_issues", md,
    Column("issue_id", String, primary_key=True),
    Column("case_id", String, nullable=False),
    Column("type", String, nullable=False),
    Column("description", Text, nullable=False),
    Column("status", String, nullable=False),
    Column("blocking", Integer, nullable=False),
    Column("detail", JSON, nullable=False),
    Column("evidence_refs", JSON, nullable=False),
    Column("dependencies", JSON, nullable=False),
    Column("resolution_requirements", JSON, nullable=False),
    Column("responsible_party", String),
    Column("next_action", Text),
    Column("due_at", DateTime(timezone=True)),
    Column("revision", Integer, nullable=False),
    Column("opened_by", String, nullable=False),
    Column("opened_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("case_id", "type", "opened_by", name="uq_issue_type"),
)

assertions = Table(
    "assertions", md,
    Column("assertion_id", String, primary_key=True),
    Column("case_id", String, nullable=False),
    Column("issue_id", String),
    Column("doc_id", String, nullable=False),
    Column("locator", JSON, nullable=False),
    Column("claim", Text, nullable=False),
    Column("interpretation", Text, nullable=False),
    Column("scope", String),
    Column("status", String, nullable=False),   # CLAIMED | VERIFIED | INVALIDATED
    Column("actor", String, nullable=False),
    Column("case_revision", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

# REQUESTED -> RECEIVED -> VERIFIED -> ALLOCATED, plus REJECTED / SUPERSEDED / DUPLICATE.
credits = Table(
    "credits", md,
    Column("credit_id", String, primary_key=True),
    Column("company_id", String, nullable=False),
    Column("vendor_id", String, nullable=False),
    Column("invoice_id", String),
    Column("memo_number", String),
    Column("currency", String, nullable=False),
    Column("scope", String, nullable=False),
    Column("amount_cents", Integer, nullable=False),
    Column("remaining_cents", Integer, nullable=False),
    Column("state", String, nullable=False),
    Column("doc_id", String),
    Column("checks", JSON, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

credit_allocations = Table(
    "credit_allocations", md,
    Column("alloc_id", String, primary_key=True),
    Column("credit_id", String, nullable=False),
    Column("invoice_id", String, nullable=False),
    Column("proposal_id", String, nullable=False),
    Column("amount_cents", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("credit_id", "invoice_id", name="uq_alloc_credit_invoice"),
)

communications = Table(
    "communications", md,
    Column("comm_id", String, primary_key=True),
    Column("case_id", String, nullable=False),
    Column("issue_ids", JSON, nullable=False),
    Column("direction", String, nullable=False),        # OUTBOUND | INBOUND
    Column("counterparty_role", String, nullable=False),  # SUPPLIER | PROCUREMENT | RECEIVING
    Column("counterparty_id", String, nullable=False),
    Column("channel", String, nullable=False),
    Column("correlation_id", String, nullable=False),
    Column("body", Text, nullable=False),
    Column("requested_evidence", JSON, nullable=False),
    Column("doc_ids", JSON, nullable=False),
    Column("send_state", String, nullable=False),       # QUEUED | SENT | UNKNOWN | FAILED | RECEIVED
    Column("idempotency_key", String, unique=True),
    Column("source_msg_id", String, unique=True),
    Column("attempt", Integer, nullable=False),
    Column("next_followup_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("sent_at", DateTime(timezone=True)),
)

proposals = Table(
    "proposals", md,
    Column("proposal_id", String, primary_key=True),
    Column("case_id", String, nullable=False),
    Column("based_on_revision", Integer, nullable=False),
    Column("kind", String, nullable=False),
    Column("payload", JSON, nullable=False),
    Column("hash", String, nullable=False),
    Column("status", String, nullable=False),   # DRAFT | INVALIDATED | COMMITTED | REJECTED
    Column("created_by", String, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

reviews = Table(
    "reviews", md,
    Column("review_id", String, primary_key=True),
    Column("proposal_id", String, nullable=False),
    Column("proposal_hash", String, nullable=False),
    Column("reviewer", String, nullable=False),
    Column("verdict", String, nullable=False),  # PASS | FAIL
    Column("deficiencies", JSON, nullable=False),
    Column("deterministic_checks", JSON, nullable=False),
    Column("status", String, nullable=False),   # CURRENT | INVALIDATED
    Column("created_at", DateTime(timezone=True), nullable=False),
)

approvals = Table(
    "approvals", md,
    Column("approval_id", String, primary_key=True),
    Column("proposal_id", String, nullable=False),
    Column("proposal_hash", String, nullable=False),
    Column("status", String, nullable=False),   # PENDING | APPROVED | REJECTED | INVALIDATED
    Column("requested_by", String, nullable=False),
    Column("decided_by", String),
    Column("decision_packet", JSON, nullable=False),
    Column("requested_at", DateTime(timezone=True), nullable=False),
    Column("decided_at", DateTime(timezone=True)),
)

economic_events = Table(
    "economic_events", md,
    Column("econ_id", String, primary_key=True),
    Column("company_id", String, nullable=False),
    Column("case_id", String, nullable=False),
    Column("invoice_id", String, nullable=False),
    Column("proposal_id", String, nullable=False),
    Column("type", String, nullable=False),     # AP_RECOGNITION (no cash types exist in the MVP)
    Column("entries", JSON, nullable=False),
    Column("amount_cents", Integer, nullable=False),
    Column("idempotency_key", String, nullable=False, unique=True),
    Column("committed_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("company_id", "invoice_id", "type", name="uq_econ_invoice_type"),
)

payment_batches = Table(
    "payment_batches", md,
    Column("batch_id", String, primary_key=True),
    Column("company_id", String, nullable=False),
    Column("status", String, nullable=False),   # PROPOSED | STALE
    Column("lines", JSON, nullable=False),
    Column("total_cents", Integer, nullable=False),
    Column("hash", String, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

events = Table(
    "events", md,
    Column("sequence", Integer, primary_key=True, autoincrement=True),
    Column("event_id", String, nullable=False, unique=True),
    Column("run_id", String),
    Column("case_id", String),
    Column("company_id", String),
    Column("occurred_at", DateTime(timezone=True), nullable=False),
    Column("simulated_time", String),
    Column("event_type", String, nullable=False),
    Column("actor", String, nullable=False),
    Column("config_version", String),
    Column("display_mode", String, nullable=False),
    Column("payload", JSON, nullable=False),
)


def make_engine(url: str | None = None) -> Engine:
    url = url or os.environ.get("DATABASE_URL") or "sqlite:///var/resolve.db"
    if url.startswith("sqlite:///") and not url.endswith(":memory:"):
        os.makedirs(os.path.dirname(url.removeprefix("sqlite:///")) or ".", exist_ok=True)
    kwargs = {}
    if url.startswith("sqlite"):
        from sqlalchemy.pool import StaticPool
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
    eng = create_engine(url, future=True, **kwargs)
    if url.startswith("sqlite"):
        @event.listens_for(eng, "connect")
        def _pragmas(dbapi_conn, _):  # noqa: ANN001
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA busy_timeout=5000")
            cur.close()
    md.create_all(eng)
    return eng
