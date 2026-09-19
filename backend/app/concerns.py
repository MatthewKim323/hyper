"""Persistent anomaly concerns, evaluated cards, and leased agent resolution tasks."""
import os
import time
import uuid
from typing import Literal
import httpx
from pydantic import Field, model_validator
from sqlalchemy import select, update, and_, or_
from .database import concerns, sources, insert_ignore
from .data_service import StrictModel, SourceQuery


def now():
    return int(time.time() * 1000)


class RaiseConcern(StrictModel):
    request_key: str = Field(min_length=1, max_length=160)
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=8000)
    severity: Literal['low', 'medium', 'high', 'critical'] = 'medium'
    source_ids: list[str] = Field(min_length=1, max_length=12)


class ListConcerns(StrictModel):
    status: str | None = None
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class ConcernID(StrictModel):
    concern_id: str


class Option(StrictModel):
    id: Literal['option_1', 'option_2', 'option_3']
    title: str = Field(min_length=1, max_length=160)
    action: str = Field(min_length=1, max_length=3000)
    tradeoff: str = Field(min_length=1, max_length=1000)
    requires_approval: bool


class Card(StrictModel):
    summary: str = Field(min_length=1, max_length=3000)
    options: list[Option] = Field(min_length=3, max_length=3)

    @model_validator(mode='after')
    def unique(self):
        if {o.id for o in self.options} != {'option_1', 'option_2', 'option_3'}:
            raise ValueError('Three distinct option IDs required')
        return self


class Respond(StrictModel):
    option_id: Literal['option_1', 'option_2', 'option_3', 'custom']
    custom_response: str | None = Field(default=None, min_length=1, max_length=6000)

    @model_validator(mode='after')
    def custom(self):
        if self.option_id == 'custom':
            if not self.custom_response or not self.custom_response.strip():
                raise ValueError('Custom response required')
        elif self.custom_response is not None:
            raise ValueError('Custom text only permitted for custom choice')
        return self


class Renew(ConcernID):
    claim_token: str


class Finish(ConcernID):
    claim_token: str
    outcome: Literal['resolved', 'needs_input', 'failed']
    summary: str = Field(min_length=1, max_length=6000)
    source_ids: list[str] = Field(min_length=1, max_length=12)


class Conflict(ValueError):
    pass


def public(row):
    return {k: v for k, v in dict(row).items() if k not in ('organization_id', 'claim_token', 'lease_until')}


class ConcernService:
    def __init__(self, data):
        self.data, self.engine, self.oid = data, data.engine, data.oid

    def evidence(self, ids):
        return [self.data.get_source(SourceQuery(source_id=sid, limit=3)) for sid in ids]

    def get(self, concern_id):
        with self.engine.connect() as db:
            row = db.execute(select(concerns).where(concerns.c.id == concern_id,
                concerns.c.organization_id == self.oid)).mappings().first()
        if not row:
            raise LookupError('Concern not found')
        return public(row)

    def list(self, status=None, limit=50, offset=0):
        query = select(concerns).where(concerns.c.organization_id == self.oid)
        if status:
            query = query.where(concerns.c.status == status)
        with self.engine.connect() as db:
            rows = db.execute(query.order_by(concerns.c.created_at, concerns.c.id)
                .offset(offset).limit(limit + 1)).mappings().all()
        return {'concerns': [public(r) for r in rows[:limit]], 'has_more': len(rows) > limit}

    def raise_concern(self, args):
        self.evidence(args.source_ids)
        payload = args.model_dump()
        with self.engine.begin() as db:
            insert_ignore(db, concerns, dict(id='concern_' + uuid.uuid4().hex,
                organization_id=self.oid, request_key=args.request_key, request=payload,
                status='draft', created_at=now(), updated_at=now(), lease_until=0))
            row = db.execute(select(concerns).where(concerns.c.organization_id == self.oid,
                concerns.c.request_key == args.request_key)).mappings().one()
        if row['request'] != payload:
            raise Conflict('Request key already used for a different concern')
        if row['status'] in ('draft', 'card_failed'):
            return self.generate(row['id'])
        return public(row)

    def generate(self, cid):
        row = self.get(cid)
        token = uuid.uuid4().hex
        with self.engine.begin() as db:
            won = db.execute(update(concerns).where(concerns.c.id == cid,
                concerns.c.organization_id == self.oid,
                or_(concerns.c.status.in_(['draft', 'card_failed']),
                    and_(concerns.c.status == 'generating', concerns.c.lease_until < now())))
                .values(status='generating', claim_token=token, lease_until=now()+120000, updated_at=now())).rowcount
        if not won:
            raise Conflict('Card cannot be regenerated in its current state')
        owned = and_(concerns.c.id == cid, concerns.c.organization_id == self.oid, concerns.c.claim_token == token)
        try:
            with httpx.Client(timeout=90) as client:
                response = client.post(os.getenv('EVALUATOR_URL', 'http://127.0.0.1:8001') + '/concern-card',
                    headers={'Authorization': 'Bearer ' + os.getenv('EVALUATOR_SECRET', '')},
                    json={'concern': row['request'], 'evidence': self.evidence(row['request']['source_ids'])})
                response.raise_for_status()
                body = response.json()
            card = Card.model_validate(body['card']).model_dump()
            if body.get('approved') is not True:
                raise ValueError('Jev rejected proposed card')
            card['custom_option'] = {'id': 'custom', 'title': 'Something else', 'input_required': True}
            card['evaluation'] = body.get('evaluation')
            with self.engine.begin() as db:
                db.execute(update(concerns).where(owned).values(card=card, status='awaiting_response',
                    claim_token=None, lease_until=0, updated_at=now()))
        except Exception:
            with self.engine.begin() as db:
                db.execute(update(concerns).where(owned).values(status='card_failed',
                    claim_token=None, lease_until=0, updated_at=now()))
        return self.get(cid)

    def respond(self, cid, args, user_id):
        row = self.get(cid)
        if row['status'] not in ('awaiting_response', 'needs_input'):
            raise Conflict('Concern is not awaiting a response')
        choice = args.custom_response if args.option_id == 'custom' else next(
            o['action'] for o in row['card']['options'] if o['id'] == args.option_id)
        decision = dict(option_id=args.option_id, instruction=choice, user_id=user_id,
                        selected_at=now(), previous=row.get('decision'), authority='Investigate and prepare resolution; external actions require their own authorization.')
        with self.engine.begin() as db:
            if not db.execute(update(concerns).where(concerns.c.id == cid,
                concerns.c.organization_id == self.oid, concerns.c.status.in_(['awaiting_response', 'needs_input']))
                .values(status='queued', decision=decision, updated_at=now())).rowcount:
                raise Conflict('A response has already been recorded')
            from .agent_events import emit
            emit(db,self.oid,f'concern:{cid}:{decision["selected_at"]}','concern.responded',{'concern_id':cid,'decision':decision})
        return self.get(cid)

    def claim(self, cid):
        token = uuid.uuid4().hex
        with self.engine.begin() as db:
            won = db.execute(update(concerns).where(concerns.c.id == cid,
                concerns.c.organization_id == self.oid,
                or_(concerns.c.status == 'queued', and_(concerns.c.status == 'resolving', concerns.c.lease_until < now())))
                .values(status='resolving', claim_token=token, lease_until=now()+900000, updated_at=now())).rowcount
        if not won:
            self.get(cid)
            raise Conflict('Task not available to claim')
        return dict(self.get(cid), claim_token=token, lease_seconds=900)

    def renew(self, args):
        with self.engine.begin() as db:
            if not db.execute(update(concerns).where(concerns.c.id == args.concern_id,
                concerns.c.organization_id == self.oid, concerns.c.status == 'resolving',
                concerns.c.claim_token == args.claim_token, concerns.c.lease_until > now())
                .values(lease_until=now()+900000)).rowcount:
                raise Conflict('Claim expired or no longer owned')
        return {'renewed': True, 'lease_seconds': 900}

    def finish(self, args):
        self.evidence(args.source_ids)
        with self.engine.begin() as db:
            won = db.execute(update(concerns).where(concerns.c.id == args.concern_id,
                concerns.c.organization_id == self.oid, concerns.c.status == 'resolving',
                concerns.c.claim_token == args.claim_token, concerns.c.lease_until > now())
                .values(status=args.outcome, resolution={'summary': args.summary, 'source_ids': args.source_ids},
                        claim_token=None, lease_until=0, updated_at=now())).rowcount
        if not won:
            self.get(args.concern_id)
            raise Conflict('Resolution claim expired or no longer owned')
        return self.get(args.concern_id)
