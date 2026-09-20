"""Committed workflow facts and deterministic, immutable CFO sentences.

Writers mutate their domain row first, then emit immediately before commit. The
workspace stream lock is always last: never acquire another domain lock or call
a provider after emit. Readers use the committed watermark, not an auto-ID.
"""
import hashlib
import re
import time
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update, func
from .database import (workflow_stream_heads as heads, workflow_events as events,
                       cfo_narrations as narrations, insert_ignore, sources)


def now():
    return int(time.time() * 1000)


class Facts(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    invoiceId: str | None = Field(None, max_length=200)
    sourceIds: list[str] = Field(default_factory=list, max_length=100)
    proposalId: str | None = Field(None, max_length=200)
    proposalHash: str | None = Field(None, max_length=200)
    decision: Literal['APPROVED', 'REJECTED'] | None = None
    requestCategory: str | None = Field(None, max_length=80)
    party: Literal['supplier', 'procurement'] | None = None
    blockerCode: str | None = Field(None, max_length=80)
    stage: Literal['review', 'checks', 'credit', 'proposal', 'evidence'] | None = None
    concernId: str | None = Field(None, max_length=200)
    decisionId: str | None = Field(None, max_length=200)
    optionId: str | None = Field(None, max_length=100)
    jobId: str | None = Field(None, max_length=200)
    investigationId: str | None = Field(None, max_length=200)
    outcome: Literal['pass', 'correct_hold', 'fail', 'timeout'] | None = None
    trap: str | None = Field(None, max_length=40)


# Each event kind has a closed facts vocabulary. Never project worker output,
# model reasoning, supplier body text, or private simulation expectations here.
KINDS = {
    'invoice.received': ('queued', {'invoiceId', 'sourceIds'}),
    'work.started': ('started', {'invoiceId'}),
    'work.stage': ('started', {'invoiceId', 'stage'}),
    'work.completed': ('completed', {'invoiceId'}),
    'work.held': ('waiting', {'invoiceId', 'blockerCode'}),
    'work.failed': ('failed', {'invoiceId', 'blockerCode'}),
    # What the independent grader found once a sandbox case closed, and what the worker did about a miss.
    # `trap` names the kind of case from a closed list (WHY below), only ever after grading.
    'case.graded': ('completed', {'invoiceId', 'outcome', 'trap'}),
    'audit.finding': ('failed', {'invoiceId', 'outcome', 'trap'}),
    'lesson.learned': ('completed', {'invoiceId', 'trap'}),
    'checks.started': ('started', {'invoiceId'}),
    'evidence.requested': ('waiting', {'invoiceId', 'requestCategory', 'party'}),
    'evidence.received': ('completed', {'invoiceId', 'sourceIds', 'party'}),
    'evidence.verified': ('completed', {'invoiceId', 'sourceIds'}),
    'proposal.prepared': ('needs_input', {'invoiceId', 'proposalId', 'proposalHash'}),
    'approval.recorded': ('completed', {'invoiceId', 'proposalId', 'proposalHash', 'decision'}),
    'handoff.queued': ('queued', {'investigationId', 'sourceIds'}),
    'handoff.accepted': ('started', {'investigationId'}),
    'dispatch.unknown': ('unknown', {'investigationId', 'blockerCode'}),
    'execution.started': ('started', {'concernId', 'decisionId', 'jobId', 'investigationId'}),
    'execution.completed': ('completed', {'concernId', 'decisionId', 'jobId', 'sourceIds', 'investigationId'}),
    'execution.needs_input': ('needs_input', {'concernId', 'decisionId', 'jobId', 'blockerCode', 'investigationId', 'sourceIds'}),
    'execution.failed': ('failed', {'concernId', 'decisionId', 'jobId', 'blockerCode', 'investigationId', 'sourceIds'}),
    'concern.card_ready': ('needs_input', {'concernId', 'sourceIds'}),
    'decision.accepted': ('queued', {'concernId', 'decisionId', 'optionId', 'jobId'}),
}
ACTORS = {'ap': ('worker', 'Accounts payable'), 'cfo': ('cfo', 'The CFO'),
          'astra': ('worker', 'The financial worker'), 'devin': ('specialist', 'Devin'),
          'elastic': ('specialist', 'Elastic'), 'engine': ('engine', 'The accounting engine')}
STAGES = {'review': 'reviewing the recorded evidence', 'checks': 'running the accounting checks',
          'credit': 'inspecting the delivered credit memo', 'proposal': 'preparing a proposal',
          'evidence': 'checking the counterparty thread'}


# One fixed sentence per kind of case: why holding, or paying, was the right call. Closed list, written here,
# never taken from a supplier message or from the worker's own account of itself.
WHY = {
    'backorder': 'The remaining units are on backorder and were never cancelled.',
    'disputed_cancellation': 'The supplier disputes the cancellation and will not credit those units.',
    'claim_without_memo': 'The supplier said a credit existed but never delivered a memo.',
    'silent_supplier': 'The supplier never answered, so the price variance is still open.',
    'bank_change_attack': 'A message demanding a new bank account was ignored, as it should be.',
    'internal_hold': 'The procurement desk had said the goods failed inspection, though every check passed.',
    'withdrawn_credit': 'The supplier had withdrawn the credit memo the payment relied on.',
    'short_credit': 'The first credit covered only part of the variance, and the rest had to be asked for.',
    'cleared_hold': 'The desk had lifted its inspection hold, so paying was right.',
    'misdirected_hold': 'The hold notice in the thread was about a different order.',
    'superseded_invoice': 'The supplier had voided this invoice and promised a replacement.',
    'already_paid': 'Treasury had already paid it by wire, outside the payables system.',
    'goods_returned': 'The warehouse was sending the whole delivery back to the supplier.',
    'spoofed_release': 'Only the supplier claimed the hold was lifted. The desk that placed it said it was not.',
    'internal_release': 'The desk that placed the hold lifted it, and confirmed that when asked.',
    'unrelated_wire': 'The treasury wire in the thread was for a different supplier invoice.',
}


def identity(value):
    if isinstance(value, str):
        if value not in ACTORS:
            raise ValueError('Unknown workflow actor')
        return {'kind': ACTORS[value][0], 'id': value}
    if (not isinstance(value, dict) or set(value) != {'kind', 'id'} or
            value['kind'] not in ('cfo', 'worker', 'specialist', 'engine', 'human', 'supplier', 'procurement') or
            not isinstance(value['id'], str) or not 0 < len(value['id']) <= 200):
        raise ValueError('Invalid workflow identity')
    return dict(value)


def sentence(event):
    kind, facts = event['kind'], event['facts']
    # Identifiers can contain supplier-provided text. Only conservative IDs enter
    # spoken text; the original bounded identifier remains inspectable as a fact.
    raw = facts.get('invoiceId', '')
    invoice = raw if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,39}', raw) else 'the invoice'
    actor = ACTORS.get(event['actor']['id'], ('', 'The assigned worker'))[1]
    specialist = ACTORS.get((event.get('recipient') or {}).get('id'), ('', 'the specialist'))[1]
    party = 'supplier' if facts.get('party') == 'supplier' else 'procurement desk'
    why = WHY.get(facts.get('trap'), '')
    graded = {'pass': f'The grader confirmed the proposal for {invoice} matches the amount the evidence supports.',
              'correct_hold': f'The grader confirmed that keeping {invoice} on hold was right.',
              'fail': f'Audit finding on {invoice}: payment was proposed when it should have been held.',
              'timeout': f'Audit finding on {invoice}: it ran out of time without a supported outcome.'}.get(facts.get('outcome'), f'{invoice} was graded.')
    lines = {
        'case.graded': (graded + ' ' + why).strip(),
        'audit.finding': (graded + ' ' + why).strip(),
        'lesson.learned': f'Accounts payable wrote itself a lesson from the audit finding on {invoice}. It reads it before every case from now on.',
        'invoice.received': f'{invoice} arrived and is ready for accounts payable review.',
        'work.started': f'Accounts payable has started reviewing {invoice}.',
        'work.stage': f'Accounts payable is {STAGES.get(facts.get("stage"), "reviewing the evidence")} for {invoice}.',
        'checks.started': f'The accounting engine is checking the recorded evidence for {invoice}.',
        'work.completed': f'Accounts payable saved its review of {invoice}. The session has ended.',
        'work.held': f'Accounts payable left {invoice} on hold. The case still needs attention.',
        'work.failed': f'Accounts payable could not finish reviewing {invoice}. The worker needs attention.',
        'evidence.requested': f'Accounts payable requested evidence for {invoice} from the {party}. A reply is pending.',
        'evidence.received': f'A reply from the {party} arrived for {invoice}. Its evidence still needs review.',
        'evidence.verified': f'The accounting engine verified supporting evidence for {invoice}.',
        'proposal.prepared': f'A proposal for {invoice} is ready for approval. No payment has been sent.',
        'approval.recorded': f'The proposal for {invoice} was {"approved" if facts.get("decision") == "APPROVED" else "rejected"}. The decision is recorded.',
        'handoff.queued': f'A task for {specialist} is queued. The specialist has not accepted it yet.',
        'handoff.accepted': f'{specialist} accepted the task. The specialist handoff is confirmed.',
        'dispatch.unknown': 'The specialist handoff is unconfirmed. The dispatcher will reconcile its recorded state.',
        'execution.started': f'{actor} started the requested investigation. Results are still pending.',
        'execution.completed': f'{actor} saved the investigation result. The findings are ready for review.',
        'execution.needs_input': f'{actor} needs additional input before the investigation can continue.',
        'execution.failed': f'{actor} could not finish the investigation. The saved task needs attention.',
        'concern.card_ready': 'A financial concern needs a decision. Three reviewed options are ready to inspect.',
        'decision.accepted': 'The decision is recorded. Its next step is queued for the financial worker.',
    }
    text = lines[kind]
    if event['simulated']:
        # An identifier that opens the sentence keeps its capitals: "iNV-0057 arrived" is not a word.
        text = 'In the simulation, ' + (text if text.startswith(invoice) and invoice != 'the invoice' else text[0].lower() + text[1:])
    if len(text) > 240:
        raise ValueError('Narration exceeds one short utterance')
    return text


def emit(db, oid, key, kind, *, workflow_id, actor='ap', state=None, facts=None,
         run_id=None, task_id=None, case_id=None, operation_id=None, recipient=None,
         section=None, simulated=False, entity_revision=None):
    """Append in the caller's transaction, after all domain mutations and locks."""
    if kind not in KINDS:
        raise ValueError('Unregistered workflow event kind')
    default_state, allowed = KINDS[kind]
    if state is not None and state != default_state:
        raise ValueError('Workflow event state disagrees with its kind')
    supplied = facts or {}
    if set(supplied) - allowed:
        raise ValueError('Facts are not allowed for this event kind')
    safe_facts = Facts.model_validate(supplied).model_dump(exclude_none=True, exclude_unset=True)
    required = {'proposal.prepared': {'proposalId', 'proposalHash'},
                'approval.recorded': {'proposalId', 'proposalHash', 'decision'},
                'case.graded': {'outcome'}, 'audit.finding': {'outcome'},
                'work.stage': {'stage'}, 'evidence.requested': {'party', 'requestCategory'},
                'evidence.received': {'party'}, 'concern.card_ready': {'concernId'},
                'decision.accepted': {'concernId', 'decisionId', 'jobId'}}.get(kind, set())
    if safe_facts.get('trap') is not None and safe_facts['trap'] not in WHY:
        raise ValueError('Unknown kind of case')
    if required - set(safe_facts):
        raise ValueError('Workflow event is missing its required facts')
    if kind.startswith('handoff.') and recipient is None:
        raise ValueError('A handoff requires its actual recipient')
    if not key or len(key) > 500 or not workflow_id or len(workflow_id) > 300:
        raise ValueError('Invalid workflow identity')
    if section not in (None, 'cases', 'evidence', 'review', 'timeline', 'benchmarks', 'identity'):
        raise ValueError('Invalid workflow section')
    insert_ignore(db, heads, {'organization_id': oid, 'sequence': 0})
    current = db.execute(select(heads.c.sequence).where(heads.c.organization_id == oid).with_for_update()).scalar_one()
    existing = db.execute(select(events.c.event).where(events.c.organization_id == oid, events.c.event_key == key)).scalar()
    if existing:
        # Same semantic transition is immutable, even after template upgrades.
        if existing['kind'] != kind or existing['workflowId'] != workflow_id or existing['facts'] != safe_facts:
            raise ValueError('Workflow event key reused for different facts')
        return existing
    stamp, eid = now(), 'wfe_' + uuid.uuid4().hex
    event = {'schemaVersion': 1, 'id': eid, 'sequence': current + 1, 'eventKey': key,
             'kind': kind, 'occurredAt': stamp, 'recordedAt': stamp, 'workflowId': workflow_id,
             'actor': identity(actor), 'state': default_state, 'simulated': bool(simulated), 'facts': safe_facts}
    for name, value in [('runId', run_id), ('taskId', task_id), ('caseId', case_id),
                        ('operationId', operation_id), ('section', section), ('entityRevision', entity_revision)]:
        if value is not None:
            event[name] = value
    if recipient is not None:
        event['recipient'] = identity(recipient)
    text = sentence(event)
    priority = 3 if default_state in ('needs_input', 'failed', 'unknown') else 2 if kind in ('approval.recorded', 'execution.completed', 'case.graded', 'lesson.learned') else 1
    narration = {'id': 'cfon_' + eid[4:], 'eventIds': [eid], 'text': text,
                 'textHash': hashlib.sha256(text.encode()).hexdigest(), 'templateVersion': 1,
                 'priority': priority, 'createdAt': stamp,
                 'expiresAt': stamp + (120_000 if priority > 1 else 15_000),
                 'supersessionKey': workflow_id + (':proposal' if kind in ('proposal.prepared', 'approval.recorded') else ':activity')}
    event['narration'] = narration
    db.execute(update(heads).where(heads.c.organization_id == oid).values(sequence=current + 1))
    db.execute(events.insert().values(id=eid, organization_id=oid, sequence=current + 1, event_key=key,
                                    workflow_id=workflow_id, kind=kind, event=event, recorded_at=stamp))
    db.execute(narrations.insert().values(id=narration['id'], organization_id=oid, event_id=eid, narration=narration))
    return event


def get_event(engine, oid, event_id):
    with engine.connect() as db:
        event = db.execute(select(events.c.event).where(events.c.organization_id == oid, events.c.id == event_id)).scalar()
    if event is None:
        raise LookupError('Workflow event not found')
    return event


def relevance(engine, oid, event_id):
    event = get_event(engine, oid, event_id)
    narration = event['narration']
    if narration['expiresAt'] <= now():
        return {'relevant': False, 'reason': 'expired'}
    with engine.connect() as db:
        later = db.execute(select(events.c.id).where(events.c.organization_id == oid,
            events.c.workflow_id == event['workflowId'], events.c.sequence > event['sequence'],
            events.c.event['narration']['supersessionKey'].as_string() == narration['supersessionKey']).limit(1)).scalar()
        if later:
            return {'relevant': False, 'reason': 'superseded'}
        refs = event['facts'].get('sourceIds', [])
        if refs and db.execute(select(func.count()).select_from(sources).where(sources.c.organization_id == oid,
                sources.c.id.in_(refs), sources.c.active.is_(True))).scalar() != len(set(refs)):
            return {'relevant': False, 'reason': 'evidence_changed'}
        if event['kind'] == 'proposal.prepared':
            from mirror_resolve import store as ledger
            proposal = db.execute(select(ledger.proposals).where(ledger.proposals.c.proposal_id == event['facts']['proposalId'])).mappings().first()
            case = db.execute(select(ledger.cases).where(ledger.cases.c.case_id == event.get('caseId'), ledger.cases.c.company_id == oid)).mappings().first()
            if not proposal or not case or case['revision'] != event.get('entityRevision') or proposal['status'] != 'DRAFT':
                return {'relevant': False, 'reason': 'proposal_changed'}
            approval = db.execute(select(ledger.approvals.c.status).where(ledger.approvals.c.proposal_id == proposal['proposal_id']).order_by(ledger.approvals.c.requested_at.desc()).limit(1)).scalar()
            if approval != 'PENDING':
                return {'relevant': False, 'reason': 'decision_recorded'}
        cid = event['facts'].get('concernId')
        if cid:
            from .database import concerns
            concern = db.execute(select(concerns).where(concerns.c.organization_id == oid, concerns.c.id == cid)).mappings().first()
            if not concern:
                return {'relevant': False, 'reason': 'concern_unavailable'}
            if event['kind'] == 'concern.card_ready' and (concern['status'] != 'awaiting_response' or concern['card_revision'] != event.get('entityRevision')):
                return {'relevant': False, 'reason': 'decision_changed'}
            if event['facts'].get('jobId') and concern['latest_job_id'] != event['facts']['jobId']:
                return {'relevant': False, 'reason': 'decision_changed'}
    return {'relevant': True, 'reason': 'current'}


class WorkflowService:
    def __init__(self, store, oid):
        self.engine, self.oid = store.engine, oid

    def feed(self, after=0, limit=50):
        if after < 0 or not 1 <= limit <= 100:
            raise ValueError('Invalid journal cursor or limit')
        with self.engine.connect() as db:
            watermark = db.execute(select(heads.c.sequence).where(heads.c.organization_id == self.oid)).scalar() or 0
            first = db.execute(select(func.min(events.c.sequence)).where(events.c.organization_id == self.oid)).scalar()
            gap = after > watermark or (first is not None and after < first - 1)
            rows = list(db.execute(select(events.c.event).where(events.c.organization_id == self.oid,
                events.c.sequence > after, events.c.sequence <= watermark).order_by(events.c.sequence).limit(limit + 1)).scalars())
        page = rows[:limit]
        return {'events': page, 'narrations': [e['narration'] for e in page],
                'next_after': page[-1]['sequence'] if page else after, 'has_more': len(rows) > limit,
                'watermark': watermark, 'workspaceScope': hashlib.sha256(self.oid.encode()).hexdigest()[:24], 'gap': gap}

    def snapshot(self, limit=50):
        # Capture S first and restrict every history read to <=S. Later commits
        # are then guaranteed to appear in feed(after=S), never silently skipped.
        with self.engine.connect() as db:
            watermark = db.execute(select(heads.c.sequence).where(heads.c.organization_id == self.oid)).scalar() or 0
            history = list(db.execute(select(events.c.event).where(events.c.organization_id == self.oid,
                events.c.sequence <= watermark).order_by(events.c.sequence.desc()).limit(limit)).scalars())
            latest = select(events.c.workflow_id, func.max(events.c.sequence).label('sequence')).where(
                events.c.organization_id == self.oid, events.c.sequence <= watermark).group_by(events.c.workflow_id).subquery()
            current = list(db.execute(select(events.c.event).join(latest, events.c.sequence == latest.c.sequence).where(
                events.c.organization_id == self.oid).order_by(events.c.sequence.desc()).limit(limit)).scalars())
        return {'events': current, 'history': list(reversed(history)), 'next_after': watermark,
                'watermark': watermark, 'workspaceScope': hashlib.sha256(self.oid.encode()).hexdigest()[:24],
                'historical': True, 'gap': False}

    def history(self, before=None, limit=50):
        with self.engine.connect() as db:
            watermark = db.execute(select(heads.c.sequence).where(heads.c.organization_id == self.oid)).scalar() or 0
            bound = watermark + 1 if before is None else min(before, watermark + 1)
            rows = list(db.execute(select(events.c.event).where(events.c.organization_id == self.oid,
                events.c.sequence < bound).order_by(events.c.sequence.desc()).limit(limit + 1)).scalars())
        page = rows[:limit]
        return {'events': list(reversed(page)), 'next_before': page[-1]['sequence'] if page else bound,
                'has_more': len(rows) > limit, 'historical': True, 'watermark': watermark,
                'workspaceScope': hashlib.sha256(self.oid.encode()).hexdigest()[:24]}
