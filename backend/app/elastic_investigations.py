"""Durable, organization-bound Elastic investigations; no accounting write authority."""
import json
import os
import time
import uuid
from typing import Literal
from urllib.parse import quote
import httpx
from pydantic import Field, model_validator
from sqlalchemy import select, update, and_, or_, func
from .database import elastic_investigations as runs, sources, chunks, agent_events, organizations, insert_ignore
from .data_service import StrictModel, EvidenceQuery, DataService
from .concerns import ConcernService, RaiseConcern, Conflict
from .retrieval import ElasticSearch


def now(): return int(time.time() * 1000)


class Investigate(StrictModel):
    source_id: str = Field(min_length=1, max_length=128)
    question: str = Field(default='Investigate financial discrepancies, missing approvals, contradictory evidence and historical policy hypotheses.', min_length=1, max_length=2000)
    request_key: str = Field(min_length=1, max_length=120)


class InvestigationID(StrictModel):
    investigation_id: str


class Finding(StrictModel):
    outcome: Literal['concern', 'no_concern', 'insufficient_evidence']
    title: str = Field(min_length=1, max_length=160)
    explanation: str = Field(min_length=1, max_length=5000)
    severity: Literal['low', 'medium', 'high', 'critical'] = 'medium'
    evidence_chunk_ids: list[str] = Field(default_factory=list, max_length=12)
    policy_hypotheses: list[str] = Field(default_factory=list, max_length=5)
    unresolved_questions: list[str] = Field(default_factory=list, max_length=10)

    @model_validator(mode='after')
    def cited(self):
        if self.outcome != 'insufficient_evidence' and not self.evidence_chunk_ids:
            raise ValueError('A conclusion requires cited evidence')
        if any(len(s) > 600 for s in self.policy_hypotheses + self.unresolved_questions):
            raise ValueError('Finding detail exceeds limit')
        return self


class ElasticCloud:
    def __init__(self):
        self.url = os.getenv('ELASTIC_KIBANA_URL', '').rstrip('/')
        self.key = os.getenv('ELASTIC_KIBANA_API_KEY', '')
        self.workflow = os.getenv('ELASTIC_WORKFLOW_ID', '')
        self.organization = os.getenv('ELASTIC_AGENT_ORGANIZATION_ID', '')
        space = os.getenv('ELASTIC_KIBANA_SPACE', '')
        self.prefix = '/s/' + quote(space, safe='') if space else ''

    def require(self, oid):
        if not self.url.startswith('https://') or not self.key or not self.workflow:
            raise ValueError('Configure Elastic HTTPS Kibana URL, API key and Workflow ID')
        if not self.organization or oid != self.organization:
            raise PermissionError('Elastic investigator is not provisioned for this organization')

    def request(self, method, path, **kwargs):
        if not self.url.startswith('https://') or not self.key:
            raise ValueError('Elastic Cloud credentials missing')
        with httpx.Client(timeout=60, headers={'Authorization': 'ApiKey ' + self.key, 'kbn-xsrf': 'true'}) as client:
            result = client.request(method, self.url + self.prefix + path, **kwargs)
            result.raise_for_status()
            return result.json()

    def start(self, inputs):
        return self.request('POST', '/api/workflows/workflow/' + quote(self.workflow, safe='') + '/run',
                            json={'inputs': inputs})['workflowExecutionId']


def public(row):
    return {k: v for k, v in dict(row).items() if k not in ('organization_id', 'claim_token', 'lease_until', 'context')}


class InvestigationService:
    def __init__(self, data):
        self.data, self.engine, self.oid = data, data.engine, data.oid

    def create(self, args):
        source = self.data.source(args.source_id)
        if not source['active'] or source['index_status'] != 'ready':
            raise ValueError('Investigation requires an active indexed source')
        with self.engine.begin() as db:
            insert_ignore(db, runs, dict(id='invest_' + uuid.uuid4().hex, organization_id=self.oid,
                request_key=args.request_key, source_id=args.source_id, question=args.question,
                status='pending', created_at=now(), updated_at=now(), lease_until=0))
            row = db.execute(select(runs).where(runs.c.organization_id == self.oid,
                runs.c.request_key == args.request_key)).mappings().one()
        if row['source_id'] != args.source_id or row['question'] != args.question:
            raise Conflict('Request key already used for a different investigation')
        return public(row)

    def get(self, iid):
        with self.engine.connect() as db:
            row = db.execute(select(runs).where(runs.c.id == iid, runs.c.organization_id == self.oid)).mappings().first()
        if not row: raise LookupError('Investigation not found')
        return public(row)

    def list(self, limit=50):
        with self.engine.connect() as db:
            return {'investigations': [public(r) for r in db.execute(select(runs).where(
                runs.c.organization_id == self.oid).order_by(runs.c.created_at.desc()).limit(limit)).mappings()]}

    def retry(self, iid):
        with self.engine.begin() as db:
            row = db.execute(select(runs).where(runs.c.id == iid, runs.c.organization_id == self.oid)).mappings().first()
            if not row: raise LookupError('Investigation not found')
            if row['status'] != 'failed': raise Conflict('Only a confirmed failed investigation can be retried')
            db.execute(update(runs).where(runs.c.id == iid, runs.c.status == 'failed').values(
                status='reviewed' if row['result'] else 'pending', error=None, updated_at=now()))
        return self.get(iid)

    def refresh(self, iid, cloud):
        row = self.get(iid)
        cloud.require(self.oid)
        if row['execution_id'] and row['status'] == 'running':
            execution = cloud.request('GET', '/api/workflows/executions/' + quote(row['execution_id'], safe=''))
            if execution.get('status') in ('failed', 'cancelled', 'canceled', 'completed'):
                with self.engine.begin() as db:
                    db.execute(update(runs).where(runs.c.id == iid, runs.c.organization_id == self.oid,
                        runs.c.status == 'running').values(status='failed', error='Elastic Workflow ended without a saved finding; inspect execution and retry', updated_at=now()))
            with self.engine.begin() as db:
                db.execute(update(runs).where(runs.c.id == iid, runs.c.organization_id == self.oid,
                    runs.c.status == 'running').values(updated_at=now()))
        return self.get(iid)

    def bundle(self, row):
        source = self.data.source(row['source_id'])
        if not source['active'] or source['index_status'] != 'ready':
            raise ValueError('Triggering source is no longer active and indexed')
        with self.engine.connect() as db:
            seed = [dict(r) for r in db.execute(select(chunks.c.id, chunks.c.source_id,
                chunks.c.locator, chunks.c.content).where(chunks.c.source_id == row['source_id'],
                chunks.c.organization_id == self.oid).order_by(chunks.c.ordinal).limit(6)).mappings()]
        query = (source['filename'] + '\n' + (seed[0]['content'][:800] if seed else '') + '\n' + row['question'])[:2000]
        evidence = self.data.search_evidence(EvidenceQuery(query=query, limit=12))
        by_id = {r['id']: {**r, 'source_key':source['source_key'], 'version':source['version']} for r in seed}
        by_id.update({r['id']: r for r in evidence['hits']})
        return {'question': row['question'], 'source_id': row['source_id'],
                'coverage_complete': evidence['coverage_complete'],
                'evidence': [{**r, 'content': r['content'][:6000]} for r in by_id.values()],
                'prior_concerns': [{k:r.get(k) for k in ('id','status','request','resolution')}
                    for r in ConcernService(self.data).list(limit=5)['concerns']]}

    def accept(self, iid, finding):
        # Only a previously dispatched run may receive a result; callbacks never choose an organization.
        with self.engine.begin() as db:
            q = select(runs).where(runs.c.id == iid, runs.c.organization_id == self.oid)
            if db.dialect.name == 'postgresql': q = q.with_for_update()
            else: db.exec_driver_sql('BEGIN IMMEDIATE')
            row = db.execute(q).mappings().first()
            if not row: raise LookupError('Investigation not found')
            if row['result'] is not None:
                if row['result'] != finding.model_dump(): raise Conflict('Investigation already has a different result')
                return public(row)
            if row['status'] not in ('dispatching', 'running', 'dispatch_unknown'):
                raise Conflict('Investigation has not been dispatched')
            allowed = {r['id'] for r in (row['context'] or {}).get('evidence', [])}
            # Tools may surface historical documents, but only the vetted current bundle can support a decision.
            if not set(finding.evidence_chunk_ids).issubset(allowed):
                raise ValueError('Finding cites evidence outside its authorized bundle')
            active = set(db.execute(select(chunks.c.id).select_from(chunks.join(sources)).where(
                chunks.c.id.in_(finding.evidence_chunk_ids), chunks.c.organization_id == self.oid,
                sources.c.organization_id == self.oid, sources.c.active.is_(True),
                sources.c.index_status == 'ready')).scalars())
            if active != set(finding.evidence_chunk_ids): raise ValueError('Evidence is stale or unavailable')
            trigger = db.execute(select(sources.c.active).where(sources.c.id == row['source_id'],
                sources.c.organization_id == self.oid)).scalar()
            if not trigger: raise ValueError('Triggering source was superseded')
            if finding.outcome == 'no_concern' and not row['context']['coverage_complete']:
                raise ValueError('Incomplete retrieval cannot support a no-concern conclusion')
            db.execute(update(runs).where(runs.c.id == iid).values(result=finding.model_dump(),
                status='reviewed', updated_at=now(), claim_token=None, lease_until=0, error=None))
        return self.get(iid)


def enqueue_events(store, factory, oid):
    # Independent consumption: never acknowledge the Devin coordinator's event cursor.
    with store.engine.connect() as db:
        existing = select(runs.c.request_key).where(runs.c.organization_id == oid)
        events = db.execute(select(agent_events).where(agent_events.c.organization_id == oid,
            agent_events.c.kind == 'source.indexed',
            agent_events.c.payload['source_id'].as_string().in_(select(sources.c.id).where(
                sources.c.organization_id == oid, sources.c.active.is_(True), sources.c.index_status == 'ready')),
            ~agent_events.c.id.in_(existing)).order_by(agent_events.c.created_at).limit(20)).mappings().all()
    svc = InvestigationService(factory(oid))
    for event in events:
        try: svc.create(Investigate(source_id=event['payload']['source_id'], request_key=event['id']))
        except (LookupError, ValueError): pass


def run_once(store, factory=None, cloud=None):
    cloud = cloud or ElasticCloud()
    if not cloud.organization: return False
    cloud.require(cloud.organization)
    factory = factory or (lambda oid: DataService(store, oid, search=ElasticSearch()))
    with store.engine.connect() as db:
        poll = db.execute(select(runs.c.id).where(runs.c.organization_id == cloud.organization,
            runs.c.status == 'running', runs.c.updated_at < now()-30000).order_by(runs.c.updated_at).limit(1)).scalar()
    if poll:
        try: InvestigationService(factory(cloud.organization)).refresh(poll, cloud)
        except Exception:
            # A status outage must not starve already-reviewed results awaiting publication.
            with store.engine.begin() as db:
                db.execute(update(runs).where(runs.c.id == poll, runs.c.status == 'running').values(updated_at=now()))
    if os.getenv('ELASTIC_AUTO_INVESTIGATE', 'false').lower() == 'true':
        enqueue_events(store, factory, cloud.organization)
    token = uuid.uuid4().hex
    with store.engine.begin() as db:
        if db.dialect.name == 'sqlite': db.exec_driver_sql('BEGIN IMMEDIATE')
        else: db.execute(select(organizations.c.id).where(organizations.c.id == cloud.organization).with_for_update()).first()
        # Never automatically replay a possibly accepted external launch.
        db.execute(update(runs).where(runs.c.status == 'dispatching', runs.c.lease_until < now(),
            runs.c.organization_id == cloud.organization).values(status='dispatch_unknown',
            error='Dispatch interrupted; inspect Elastic execution before retrying', claim_token=None))
        active = db.execute(select(func.count()).select_from(runs).where(
            runs.c.organization_id == cloud.organization, runs.c.status.in_(['dispatching','running','dispatch_unknown']))).scalar()
        capacity = active < max(1, int(os.getenv('ELASTIC_MAX_ACTIVE_INVESTIGATIONS','2')))
        q = select(runs).where(runs.c.organization_id == cloud.organization,
            or_(runs.c.status.in_(['pending', 'reviewed'] if capacity else ['reviewed']), and_(runs.c.status == 'publishing', runs.c.lease_until < now())))
        if db.dialect.name == 'postgresql': q = q.with_for_update(skip_locked=True)
        row = db.execute(q.order_by(runs.c.created_at).limit(1)).mappings().first()
        if not row: return False
        row = dict(row)
        publishing = row['result'] is not None
        db.execute(update(runs).where(runs.c.id == row['id']).values(status='publishing' if publishing else 'dispatching',
            claim_token=token, lease_until=now()+180000, updated_at=now()))
    svc = InvestigationService(factory(row['organization_id']))
    owned = and_(runs.c.id == row['id'], runs.c.claim_token == token)
    dispatched = False
    try:
        if publishing:
            finding = Finding.model_validate(row['result'])
            with store.engine.connect() as db:
                current = set(db.execute(select(chunks.c.id).select_from(chunks.join(sources)).where(
                    chunks.c.id.in_(finding.evidence_chunk_ids), sources.c.organization_id == svc.oid,
                    sources.c.active.is_(True), sources.c.index_status == 'ready')).scalars())
            if current != set(finding.evidence_chunk_ids) or not svc.data.source(row['source_id'])['active']:
                raise ValueError('Evidence superseded before publication')
            cid = None
            if finding.outcome == 'concern':
                with store.engine.connect() as db:
                    ids = list(db.execute(select(chunks.c.source_id).where(chunks.c.id.in_(finding.evidence_chunk_ids),
                        chunks.c.organization_id == svc.oid)).scalars())
                description = finding.explanation + '\nEvidence chunks: ' + ', '.join(finding.evidence_chunk_ids)
                if finding.policy_hypotheses:
                    description += '\nUnapproved policy hypotheses: ' + '; '.join(finding.policy_hypotheses)
                concern = ConcernService(svc.data).raise_concern(RaiseConcern(request_key='elastic:'+row['id'],
                    title=finding.title, description=description[:8000], severity=finding.severity,
                    source_ids=list(dict.fromkeys(ids))))
                cid = concern['id']
            with store.engine.begin() as db:
                db.execute(update(runs).where(owned).values(status='complete', concern_id=cid,
                    claim_token=None, lease_until=0, updated_at=now(), error=None))
                from .agent_events import emit
                emit(db,svc.oid,'elastic:'+row['id'],'elastic.investigation.completed',
                     {'investigation_id':row['id'],'concern_id':cid,'outcome':finding.outcome})
        else:
            bundle = svc.bundle(row)
            with store.engine.begin() as db:
                db.execute(update(runs).where(owned).values(context=bundle))
            dispatched = True
            execution = cloud.start({'investigation_id':row['id'], 'context':json.dumps(bundle,default=str)})
            with store.engine.begin() as db:
                # A fast callback can finish before the launch response arrives.
                db.execute(update(runs).where(runs.c.id == row['id']).values(execution_id=execution))
                db.execute(update(runs).where(owned).values(status='running', claim_token=None, lease_until=0))
    except Exception as exc:
        with store.engine.begin() as db:
            db.execute(update(runs).where(owned).values(status='dispatch_unknown' if dispatched else 'failed',
                error=type(exc).__name__ + ': investigation failed; inspect configuration and retry',
                claim_token=None, lease_until=0, updated_at=now()))
    return True
