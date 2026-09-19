"""Append-only event log. Written in the same transaction as the state change it describes."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.engine import Connection

from . import store

DISPLAY_MODES = {"LIVE", "RECORDED_REPLAY", "DEV_FIXTURE"}


def emit(
    conn: Connection,
    event_type: str,
    actor: str,
    *,
    case_id: str | None = None,
    company_id: str | None = None,
    payload: dict[str, Any] | None = None,
    run_id: str | None = None,
    simulated_time: str | None = None,
    config_version: str | None = None,
    display_mode: str = "LIVE",
) -> int:
    assert display_mode in DISPLAY_MODES, display_mode
    res = conn.execute(
        store.events.insert().values(
            event_id=uuid.uuid4().hex,
            run_id=run_id,
            case_id=case_id,
            company_id=company_id,
            occurred_at=store.now(),
            simulated_time=simulated_time,
            event_type=event_type,
            actor=actor,
            config_version=config_version,
            display_mode=display_mode,
            payload=payload or {},
        )
    )
    return int(res.inserted_primary_key[0])


def after(conn: Connection, sequence: int = 0, case_id: str | None = None, limit: int = 500) -> list[dict]:
    q = select(store.events).where(store.events.c.sequence > sequence)
    if case_id:
        q = q.where(store.events.c.case_id == case_id)
    rows = conn.execute(q.order_by(store.events.c.sequence).limit(limit)).mappings().all()
    return [dict(r) for r in rows]
