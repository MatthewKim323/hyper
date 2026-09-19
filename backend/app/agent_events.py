"""Transactional event outbox shared by ingestion, concerns, artifacts and agents."""
import time
import uuid
from .database import agent_events, insert_ignore


def emit(db, oid, key, kind, payload):
    insert_ignore(db, agent_events, dict(id='evt_'+uuid.uuid4().hex, organization_id=oid,
        event_key=key, kind=kind, payload=payload, acknowledged=False, created_at=int(time.time()*1000)))
