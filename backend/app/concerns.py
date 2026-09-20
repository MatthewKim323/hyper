"""Persistent anomaly concerns, evaluated cards, and leased agent resolution tasks."""
import os
import hashlib
import json
import time
import uuid
from typing import Literal
import httpx
from pydantic import Field, model_validator
from sqlalchemy import select, update, and_, or_, text
from .database import concerns, sources, memberships, concern_decisions, concern_jobs, insert_ignore
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


class DecisionChoice(StrictModel):
    optionId: Literal['option_1', 'option_2', 'option_3', 'custom']
    instruction: str | None = Field(default=None, min_length=1, max_length=6000)

    @model_validator(mode='after')
    def valid(self):
        if self.optionId == 'custom':
            if not self.instruction or not self.instruction.strip():
                raise ValueError('Custom instruction required')
        elif self.instruction is not None:
            raise ValueError('Option text is loaded from the reviewed card')
        return self


class DecisionCommand(StrictModel):
    commandId: str = Field(min_length=1, max_length=160)
    concernId: str = Field(min_length=1, max_length=160)
    expectedDecisionRevision: int = Field(ge=0)
    cardRevision: int = Field(ge=0)
    cardHash: str = Field(max_length=64)
    input: Literal['click', 'text', 'voice']
    choice: DecisionChoice
    userTurnId: str | None = Field(default=None, min_length=1, max_length=160)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def workflow_event(db, oid, key, kind, cid, *, revision=None, **facts):
    from .workflow import emit
    return emit(db, oid, key, kind, workflow_id='concern:' + cid, actor='astra' if kind.startswith('execution.') else 'cfo',
                section='review', entity_revision=revision, facts={'concernId': cid, **facts})


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
    value = {k: v for k, v in dict(row).items() if k not in ('organization_id', 'claim_token', 'lease_until')}
    value['decision_cues'] = []
    if row['status'] in ('awaiting_response', 'needs_input') and row.get('card'):
        words = {'option_1': 'one', 'option_2': 'two', 'option_3': 'three'}
        for option in sorted(row['card']['options'], key=lambda item: item['id']):
            text = f"Option {words[option['id']]}. {option['title']}"
            value['decision_cues'].append({'event_id': f"concern:{row['id']}:{row['card_revision']}:{option['id']}",
                                          'text': text, 'textHash': hashlib.sha256(text.encode()).hexdigest()})
    return value


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
                status='draft', card_revision=0, decision_revision=0, evidence_snapshot=[],
                created_at=now(), updated_at=now(), lease_until=0))
            row = db.execute(select(concerns).where(concerns.c.organization_id == self.oid,
                concerns.c.request_key == args.request_key)).mappings().one()
        if row['request'] != payload:
            raise Conflict('Request key already used for a different concern')
        if row['status'] in ('draft', 'card_failed'):
            return self.generate(row['id'])
        return public(row)

    def snapshot(self, ids, db=None):
        def read(connection):
            rows = connection.execute(select(sources.c.id, sources.c.sha256, sources.c.active).where(
                sources.c.organization_id == self.oid, sources.c.id.in_(ids))).mappings().all()
            if len(rows) != len(set(ids)) or any(not r['active'] for r in rows):
                raise Conflict('Evidence changed or is unavailable; refresh this decision')
            return sorted([{'id': r['id'], 'sha256': r['sha256']} for r in rows], key=lambda r: r['id'])
        if db is not None:
            return read(db)
        with self.engine.connect() as connection:
            return read(connection)

    def generate(self, cid):
        row = self.get(cid)
        token = uuid.uuid4().hex
        with self.engine.begin() as db:
            won = db.execute(update(concerns).where(concerns.c.id == cid,
                concerns.c.organization_id == self.oid,
                or_(concerns.c.status.in_(['draft', 'card_failed', 'needs_input', 'awaiting_response']),
                    and_(concerns.c.status == 'generating', concerns.c.lease_until < now())))
                .values(status='generating', claim_token=token, lease_until=now()+120000, updated_at=now())).rowcount
        if not won:
            raise Conflict('Card cannot be regenerated in its current state')
        owned = and_(concerns.c.id == cid, concerns.c.organization_id == self.oid, concerns.c.claim_token == token)
        try:
            evidence_ids = list(dict.fromkeys(row['request']['source_ids'] + (row.get('resolution') or {}).get('source_ids', [])))
            evidence_snapshot = self.snapshot(evidence_ids)
            with httpx.Client(timeout=90) as client:
                response = client.post(os.getenv('EVALUATOR_URL', 'http://127.0.0.1:8001') + '/concern-card',
                    headers={'Authorization': 'Bearer ' + os.getenv('EVALUATOR_SECRET', '')},
                    json={'concern': row['request'], 'evidence': self.evidence(evidence_ids),
                          'previous_resolution': row.get('resolution'), 'previous_decision': row.get('decision')})
                response.raise_for_status()
                body = response.json()
            card = Card.model_validate(body['card']).model_dump()
            if body.get('approved') is not True:
                raise ValueError('Jev rejected proposed card')
            card['custom_option'] = {'id': 'custom', 'title': 'Something else', 'input_required': True}
            card['evaluation'] = body.get('evaluation')
            revision = (row.get('card_revision') or 0) + 1
            card_hash = digest({'card': card, 'evidence': evidence_snapshot, 'revision': revision})
            card.update(revision=revision, hash=card_hash)
            with self.engine.begin() as db:
                if self.snapshot(evidence_ids, db) != evidence_snapshot:
                    raise Conflict('Evidence changed during review')
                won = db.execute(update(concerns).where(owned).values(card=card, status='awaiting_response',
                    card_revision=revision, card_hash=card_hash, evidence_snapshot=evidence_snapshot,
                    claim_token=None, lease_until=0, updated_at=now())).rowcount
                if won:
                    workflow_event(db, self.oid, f'concern:{cid}:card:{revision}', 'concern.card_ready',
                                   cid, revision=revision, sourceIds=evidence_ids)
        except Exception:
            with self.engine.begin() as db:
                db.execute(update(concerns).where(owned).values(status='card_failed',
                    claim_token=None, lease_until=0, updated_at=now()))
        return self.get(cid)

    def accept(self, command, user_id):
        """Commit one authenticated decision and one durable execution, with replay-safe identity."""
        args = command if isinstance(command, DecisionCommand) else DecisionCommand.model_validate(command)
        payload = args.model_dump()
        cid = args.concernId
        with self.engine.begin() as db:
            if db.dialect.name == 'sqlite':
                db.exec_driver_sql('BEGIN IMMEDIATE')
            if db.dialect.name == 'postgresql':
                db.execute(text('SELECT pg_advisory_xact_lock(hashtext(:key))'),
                           {'key': 'decision-command:' + self.oid + ':' + args.commandId})
            role = db.execute(select(memberships.c.role).where(memberships.c.organization_id == self.oid,
                              memberships.c.user_id == user_id)).scalar()
            if role not in ('owner', 'member'):
                raise PermissionError('Workspace access removed or response capability missing')
            row = db.execute(select(concerns).where(concerns.c.id == cid,
                             concerns.c.organization_id == self.oid).with_for_update()).mappings().first()
            if not row:
                raise LookupError('Concern not found')
            existing = db.execute(select(concern_decisions).where(
                concern_decisions.c.organization_id == self.oid,
                concern_decisions.c.command_id == args.commandId)).mappings().first()
            if existing:
                if existing['request'] != payload or existing['created_by'] != user_id:
                    raise Conflict('Command ID reused with a different decision')
                job = db.execute(select(concern_jobs).where(concern_jobs.c.decision_id == existing['id'])).mappings().one()
                return {'decision_id': existing['id'], 'job_id': job['id'], 'status': job['status'], 'concern': public(row)}
            if row['status'] not in ('awaiting_response', 'needs_input', 'card_failed'):
                raise Conflict('This concern is not awaiting a decision')
            if (args.cardRevision != (row['card_revision'] or 0) or args.cardHash != (row['card_hash'] or '')
                    or args.expectedDecisionRevision != (row['decision_revision'] or 0)):
                raise Conflict('The decision changed; refresh the current choices')
            evidence_ids = [ref['id'] for ref in row['evidence_snapshot']] or row['request']['source_ids']
            snapshot = self.snapshot(evidence_ids, db)
            if row['evidence_snapshot'] and snapshot != row['evidence_snapshot']:
                raise Conflict('Evidence changed; refresh this decision before choosing')
            option = None
            if args.choice.optionId != 'custom':
                if row['status'] == 'card_failed' or not row['card']:
                    raise Conflict('Reviewed choices are unavailable; retry or send a custom instruction')
                option = next(o for o in row['card']['options'] if o['id'] == args.choice.optionId)
            instruction = args.choice.instruction.strip() if option is None else option['action']
            stamp, did, jid = now(), 'decision_' + uuid.uuid4().hex, 'resolution_' + uuid.uuid4().hex
            revision = (row['decision_revision'] or 0) + 1
            decision = {'id': did, 'job_id': jid, 'command_id': args.commandId, 'option_id': args.choice.optionId,
                        'instruction': instruction, 'original_input': args.choice.instruction if option is None else None,
                        'input': args.input, 'user_turn_id': args.userTurnId, 'user_id': user_id,
                        'selected_at': stamp, 'revision': revision, 'card_revision': args.cardRevision,
                        'card_hash': args.cardHash, 'requires_approval': bool(option and option['requires_approval']),
                        'authority': 'Investigate and prepare only; domain approvals remain required.'}
            db.execute(concern_decisions.insert().values(id=did, organization_id=self.oid, concern_id=cid,
                command_id=args.commandId, request=payload, card_revision=args.cardRevision,
                decision_revision=revision, input=args.input, instruction=instruction, created_by=user_id, created_at=stamp))
            db.execute(concern_jobs.insert().values(id=jid, organization_id=self.oid, concern_id=cid, decision_id=did,
                status='queued', objective=instruction, created_by=user_id, operations=[],
                lease_until=0, next_attempt_at=0, attempts=0, created_at=stamp, updated_at=stamp))
            db.execute(update(concerns).where(concerns.c.id == cid).values(status='queued', decision=decision,
                decision_revision=revision, latest_job_id=jid, evidence_snapshot=snapshot, resolution=None, updated_at=stamp))
            from .agent_events import emit
            emit(db, self.oid, 'concern-decision:' + did, 'concern.responded', {'concern_id': cid, 'decision': decision})
            workflow_event(db, self.oid, 'decision:' + did, 'decision.accepted', cid,
                           revision=revision, decisionId=did, jobId=jid, optionId=args.choice.optionId)
        return {'decision_id': did, 'job_id': jid, 'status': 'queued', 'concern': self.get(cid)}

    def respond(self, cid, args, user_id):
        """Legacy HTTP compatibility. New clients carry explicit revision/command identity."""
        row = self.get(cid)
        receipt = self.accept(DecisionCommand(commandId='legacy_' + uuid.uuid4().hex, concernId=cid,
            expectedDecisionRevision=row.get('decision_revision') or 0, cardRevision=row.get('card_revision') or 0,
            cardHash=row.get('card_hash') or '', input='text' if args.option_id == 'custom' else 'click',
            choice=DecisionChoice(optionId=args.option_id, instruction=args.custom_response)), user_id)
        return receipt['concern']

    def job(self, cid, jid):
        self.get(cid)
        with self.engine.connect() as db:
            row = db.execute(select(concern_jobs).where(concern_jobs.c.id == jid,
                concern_jobs.c.concern_id == cid, concern_jobs.c.organization_id == self.oid)).mappings().first()
        if not row:
            raise LookupError('Resolution job not found')
        return {k: v for k, v in dict(row).items() if k not in ('organization_id', 'claim_token', 'lease_until')}

    def claim(self, cid):
        if self.get(cid).get('latest_job_id'):
            raise PermissionError('Resolution is assigned to the scoped decision executor')
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
        if self.get(args.concern_id).get('latest_job_id'):
            raise PermissionError('Resolution is assigned to the scoped decision executor')
        with self.engine.begin() as db:
            if not db.execute(update(concerns).where(concerns.c.id == args.concern_id,
                concerns.c.organization_id == self.oid, concerns.c.status == 'resolving',
                concerns.c.claim_token == args.claim_token, concerns.c.lease_until > now())
                .values(lease_until=now()+900000)).rowcount:
                raise Conflict('Claim expired or no longer owned')
        return {'renewed': True, 'lease_seconds': 900}

    def finish(self, args):
        if self.get(args.concern_id).get('latest_job_id'):
            raise PermissionError('Only the assigned decision executor may record this result')
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
