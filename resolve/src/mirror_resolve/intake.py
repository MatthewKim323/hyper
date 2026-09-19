"""Single entry point for anything arriving from outside: store, register, re-evaluate."""
from __future__ import annotations

from sqlalchemy.engine import Connection

from . import casework, creditmemo
from .ingest import put_record
from .policy import DEFAULT_POLICY, Policy


def receive_record(conn: Connection, company_id: str, record_type: str, data: dict, *,
                   source_system: str, channel: str = "API", sender: str | None = None,
                   source_msg_id: str | None = None, actor: str = "intake",
                   policy: Policy = DEFAULT_POLICY) -> dict:
    rec = put_record(conn, company_id, record_type, data, source_system=source_system,
                     channel=channel, sender=sender, source_msg_id=source_msg_id,
                     actor=actor, policy=policy)
    if rec.get("duplicate"):
        return {**rec, "affected_cases": []}
    if record_type == "CREDIT_MEMO":
        creditmemo.register_credit_memo(conn, company_id, rec)
    touched = casework.on_new_evidence(conn, company_id, rec, actor=actor)
    return {**rec, "affected_cases": touched}
