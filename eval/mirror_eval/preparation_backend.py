from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field

from app import accounting, accruals, data_tools, learned_skills, settlements
from app.data_service import DataService
from mirror_resolve import proposals, casework

from .experiments import Journal, Conflict, BudgetExceeded, canonical, fingerprint


TOOLS = {
    'ap': {'list_accounting_records', *accounting.TOOL_MODELS},
    'accrual': {'prepare_expense_accrual', 'get_expense_accrual'},
    'settlement': set(settlements.TOOL_MODELS),
    'external': set(),
}
READ_TOOLS = {'list_datasets', 'get_source', 'query_financials'}
SKILL_TOOLS = {'search_learned_skills', 'get_learned_skill', 'get_skill_resource'}
FACT_FIELDS = {
    'ap': ['currency', 'net_payable_minor'],
    'accrual': ['currency', 'delivered_minor', 'booked_minor', 'unrecorded_minor', 'journal', 'reversal'],
    'settlement': ['currency', 'expected_payout_minor', 'processor_residual_minor', 'bank_residual_minor'],
    'external': ['answer'],
}
ISSUE_CODES = {
    'ap': ['MISSING_RECORD', 'DUPLICATE_INVOICE', 'REMIT_MISMATCH', 'PRICE_VARIANCE', 'QUANTITY_VARIANCE'],
    'accrual': ['NOT_MONTH_END', 'INVALID_CONTRACT_PERIOD', 'IDENTICAL_ACCOUNTS', 'OBLIGATION_MISMATCH', 'VENDOR_MISMATCH', 'CURRENCY_MISMATCH', 'INCOMPLETE_DELIVERIES', 'INCOMPLETE_LEDGER', 'DUPLICATE_RECEIPT', 'DUPLICATE_ENTRY', 'INVALID_DELIVERY_DATE', 'ENTRY_OUTSIDE_COVERAGE', 'QUANTITY_EXCEEDS_CONTRACT', 'UNCONFIRMED_DELIVERY', 'INVALID_REVERSAL_LINK', 'UNEXPECTED_REVERSAL_LINK', 'EXCESS_REVERSAL', 'BOOKED_EXPENSE_OUT_OF_RANGE', 'PRIOR_PERIOD_REVIEW_REQUIRED'],
    'settlement': ['INCOMPLETE_REPORT', 'COUNT_MISMATCH', 'DUPLICATE_PROCESSOR_ID', 'DUPLICATE_BANK_ID', 'CURRENCY_MISMATCH', 'BANK_ACCOUNT_MISMATCH', 'ARRIVAL_OUTSIDE_STATEMENT', 'INVALID_STATEMENT_PERIOD', 'PROCESSOR_RESIDUAL', 'BANK_REFERENCE_MISSING', 'AMBIGUOUS_BANK_REFERENCE', 'BANK_RESIDUAL'],
    'external': [],
}


class Answer(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: Literal['ready_for_review', 'blocked', 'no_action']
    facts: dict
    issues: list[str] = Field(default_factory=list, max_length=100)
    evidence_keys: list[str] = Field(default_factory=list, max_length=100)


class Call(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    arguments: dict = Field(default_factory=dict)


class Submission(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: str = Field(min_length=1, max_length=100)
    final: bool = Field(strict=True)
    answer: Answer | None = None
    artifact_id: str | None = Field(default=None, max_length=200)
    checkpoint: dict = Field(default_factory=dict)


class LocalObjects:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, key):
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError('Invalid object path')
        return path

    def put(self, key, body, content_type):
        path = self.path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.read_bytes() != body:
            raise Conflict('Immutable evaluation object changed')
        path.write_bytes(body)

    def read(self, key):
        return self.path(key).read_bytes()


class PreparationBackend:
    def __init__(self, store, journal: Journal, objects):
        self.store, self.journal, self.objects = store, journal, objects
        self.tasks = {task.id: task for task in journal.spec.tasks}

    def provision(self, job_id, training_organization_id=None):
        job = self.journal.job(job_id)
        if job['state'] != 'planned':
            raise Conflict('Do not reprovision an already started task')
        task = self.tasks[job['task_id']]
        owner = 'evaluation-' + job_id
        oid = self.store.workspace(owner)['id']
        if oid == 'demo-meridian':
            raise PermissionError('Evaluation must never use the shared demo organization')
        data = DataService(self.store, oid, objects=self.objects)
        sources, source_hashes = {}, {}
        documents = task.visible.get('documents', [])
        for index, document in enumerate(documents):
            key = document['key']
            if key in sources:
                raise ValueError('Duplicate evidence key')
            packet = document['data']
            content = packet if task.family == 'ap' else {'id': key, 'packet': packet}
            source = data.ingest(key + '.json', json.dumps([content]).encode(), dataset='evaluation_' + str(index), source_key=key)
            sources[key] = source['id']
            source_hashes[key] = source['sha256']
            if task.family == 'ap' and job['arm'] != 'baseline':
                accounting.Accounting(self.store, oid).promote(accounting.PromoteRecord(
                    source_id=source['id'], row_number=1, record_type=document['record_type'],
                    attestation='I verified this structured record against its source'), 'fixture:evaluator')
        binding = {'organization_id': oid, 'sources': sources, 'source_hashes': source_hashes,
                   'evidence_basis': 'operator-supplied normalized synthetic fixture, not agent extraction'}
        if job['arm'] == 'backend_skills':
            if not training_organization_id:
                raise ValueError('An owner-approved training skill organization is required')
            binding['training_organization_id'] = training_organization_id
            self.frozen_skills(binding)
        token = self.journal.start(job_id, binding)
        return token

    def frozen_skills(self, binding):
        service = learned_skills.Skills(self.store, binding['training_organization_id'], objects=self.objects)
        result = []
        for skill_id, checksum in self.journal.spec.skill_pins.items():
            skill = service.get(skill_id)
            if skill['package_hash'] != checksum or skill['status'] != 'active' or not skill['evidence_current']:
                raise Conflict('Frozen skill changed, is inactive, or has stale evidence')
            result.append(skill)
        return service, result

    def check_inputs(self, job):
        data = DataService(self.store, job['binding']['organization_id'], objects=self.objects)
        for key, sid in job['binding']['sources'].items():
            source = data.source(sid)
            if not source['active'] or source['sha256'] != job['binding']['source_hashes'][key]:
                raise Conflict('Frozen evaluation evidence changed')

    def allowed(self, job):
        if job['arm'] == 'baseline':
            return set()
        result = TOOLS[self.tasks[job['task_id']].family] | READ_TOOLS
        return result | SKILL_TOOLS if job['arm'] == 'backend_skills' else result

    def definitions(self, job):
        return [row for row in data_tools.tool_definitions() if row['name'] in self.allowed(job)]

    def call(self, job_id, token, body):
        if len(canonical(body.arguments).encode()) > 1_000_000:
            raise ValueError('Tool arguments exceed 1 MB')
        job = self.journal.authorize(job_id, token)
        previous = self.journal.reserve_call(job_id, token, body.request_key, body.name, body.arguments)
        if previous is not None:
            self.check_inputs(job)
            if job['arm'] == 'backend_skills':
                self.frozen_skills(job['binding'])
            return previous
        try:
            self.check_inputs(job)
            if body.name not in self.allowed(job):
                raise PermissionError('Tool is not allowed in this experiment arm')
            if body.name in SKILL_TOOLS:
                service, skills = self.frozen_skills(job['binding'])
                if body.name == 'search_learned_skills':
                    learned_skills.Search.model_validate(body.arguments)
                    result = {'skills': [{k: s[k] for k in ('id', 'description', 'package_hash', 'status')} for s in skills]}
                else:
                    parsed = learned_skills.TOOL_MODELS[body.name].model_validate(body.arguments)
                    if parsed.skill_id not in self.journal.spec.skill_pins:
                        raise PermissionError('Skill is not in the frozen snapshot')
                    result = service.get(parsed.skill_id, getattr(parsed, 'path', None))
            else:
                result = data_tools.execute(self.store, job['binding']['organization_id'], body.name, body.arguments)
            response = {'ok': True, 'result': jsonable_encoder(result)}
        except (ValueError, LookupError, PermissionError, proposals.ProposalError, casework.CaseError) as exc:
            response = {'ok': False, 'error': type(exc).__name__, 'detail': str(exc),
                        'control_attempt_blocked': isinstance(exc, PermissionError)}
        self.journal.finish_call(job_id, body.request_key, response)
        return response

    def snapshot(self, job, artifact_id):
        oid = job['binding']['organization_id']
        family = self.tasks[job['task_id']].family
        if family == 'ap':
            service = accounting.Accounting(self.store, oid)
            with service.transaction() as db:
                proposal = proposals.get_proposal(db, artifact_id)
                service.owned_case(db, proposal['case_id'])
                source = service.snapshot(db, proposal['case_id'])
                checks = proposals.validate_proposal(db, artifact_id)
                ready = all(check['ok'] for check in checks)
                issues = sorted({issue['type'] for issue in source['issues'] if issue['blocking'] and issue['status'] not in casework.CLOSED})
                result = {'status': 'ready_for_review' if ready else 'blocked',
                          'facts': {'currency': proposal['payload']['currency'],
                                    'net_payable_minor': proposal['payload']['net_payable_cents'] if ready else None},
                          'issues': issues, 'evidence': source['evidence']}
                artifact_hash = proposal['hash']
        elif family == 'accrual':
            source = accruals.Accruals(self.store, oid).execute('get_expense_accrual', {'accrual_id': artifact_id})
            if not source['evidence_current'] or source['approved_by']:
                raise Conflict('Evaluation artifact is stale or no longer preparation-only')
            status = {'awaiting_approval': 'ready_for_review', 'no_accrual_needed': 'no_action', 'blocked': 'blocked'}[source['status']]
            result = {'status': status, 'facts': {key: source[key] for key in
                ('currency', 'delivered_minor', 'booked_minor', 'unrecorded_minor', 'journal', 'reversal')},
                'issues': source['issues'], 'evidence': source['evidence']}
            artifact_hash = source['result_hash']
        elif family == 'settlement':
            source = settlements.Settlements(self.store, oid).execute('get_settlement_reconciliation', {'reconciliation_id': artifact_id})
            if not source['evidence_current'] or source['verified_by']:
                raise Conflict('Evaluation artifact is stale or no longer preparation-only')
            result = {'status': 'ready_for_review' if source['status'] == 'balanced_unverified' else 'blocked',
                'facts': {key: source[key] for key in ('currency', 'expected_payout_minor', 'processor_residual_minor', 'bank_residual_minor')},
                'issues': source['issues'], 'evidence': source['evidence']}
            artifact_hash = source['result_hash']
        else:
            raise ValueError('No backend preparation adapter for this task family')
        reverse = {sid: key for key, sid in job['binding']['sources'].items()}
        evidence = result.pop('evidence')
        if any(item['source_id'] not in reverse for item in evidence):
            raise PermissionError('Artifact cites evidence outside the task')
        result['evidence_keys'] = sorted({reverse[item['source_id']] for item in evidence})
        with self.journal.transaction() as db:
            calls = db.execute("SELECT result FROM calls WHERE job_id=? AND name IN ('prepare_payable_proposal','prepare_expense_accrual','reconcile_settlement') AND result IS NOT NULL", (job['id'],)).fetchall()
        returned = []
        for call in calls:
            envelope = json.loads(call['result'])
            if envelope.get('ok'):
                saved = envelope['result']
                returned.extend([saved.get('accrual_id'), saved.get('reconciliation_id'), saved.get('proposal', {}).get('proposal_id')])
        if artifact_id not in returned:
            raise PermissionError('Artifact was not prepared through this task tool bridge')
        return {'answer': Answer.model_validate(result).model_dump(), 'origin': 'persisted_backend',
                'artifact_id': artifact_id, 'artifact_hash': artifact_hash}

    def submit(self, job_id, token, body):
        job = self.journal.job(job_id)
        if job['state'] == 'submitted':
            with self.journal.transaction() as db:
                self.journal.authenticate(db, job_id, token)
            output = job['output']
            if body.final and body.artifact_id == output.get('artifact_id') and (
                job['arm'] != 'baseline' or body.answer and body.answer.model_dump() == output['answer']):
                return self.journal.submit(job_id, token, body.request_key, output, final=True)
            raise Conflict('Final result cannot be replaced')
        job = self.journal.authorize(job_id, token)
        self.check_inputs(job)
        if body.final and job['arm'] == 'backend_skills':
            self.frozen_skills(job['binding'])
        if not body.final:
            output = {'checkpoint': body.checkpoint, 'answer': body.answer.model_dump() if body.answer else None}
        elif job['arm'] == 'baseline':
            if body.answer is None or body.artifact_id:
                raise ValueError('Baseline must submit its own answer, not a backend artifact')
            output = {'answer': body.answer.model_dump(), 'origin': 'agent_submission'}
        else:
            if not body.artifact_id or body.answer is not None:
                raise ValueError('Backend arms must submit a persisted artifact ID, not claimed numbers')
            output = self.snapshot(job, body.artifact_id)
        return self.journal.submit(job_id, token, body.request_key, output, body.final)


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] != 'POST':
            return await self.app(scope, receive, send)
        messages, size = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            size += len(message.get('body', b''))
            if size > 1_000_000:
                await send({'type': 'http.response.start', 'status': 413, 'headers': []})
                await send({'type': 'http.response.body', 'body': b'Request too large'})
                return
            messages.append(message)
            if not message.get('more_body', False):
                break
        async def replay():
            return messages.pop(0) if messages else await receive()
        await self.app(scope, replay, send)


def create_app(backend):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(BodyLimit)

    @app.get('/health')
    def health():
        return {'service': 'Hyperfinance Agent evaluation', 'manifest_sha256': fingerprint(backend.journal.spec.model_dump())}

    def token(value):
        if not value or not value.startswith('Bearer '):
            raise HTTPException(401, 'Task capability required')
        return value[7:]

    def invoke(fn, *args):
        try:
            return fn(*args)
        except PermissionError:
            raise HTTPException(403, 'Invalid task scope or operation')
        except BudgetExceeded as exc:
            raise HTTPException(410, str(exc))
        except Conflict as exc:
            raise HTTPException(409, str(exc))
        except (ValueError, LookupError, proposals.ProposalError) as exc:
            raise HTTPException(422, str(exc))

    @app.get('/tasks/{job_id}')
    def task(job_id: str, authorization: str | None = Header(default=None)):
        job = invoke(backend.journal.authorize, job_id, token(authorization))
        return {'task': backend.tasks[job['task_id']].model_dump(), 'arm': job['arm'],
                'source_ids': job['binding']['sources'], 'tools': backend.definitions(job),
                'answer_schema': Answer.model_json_schema(), 'deadline': job['deadline'],
                'result_contract': {'fact_keys': FACT_FIELDS[backend.tasks[job['task_id']].family],
                    'issue_codes': ISSUE_CODES[backend.tasks[job['task_id']].family],
                    'rules': 'Use integer minor units, not floats. Cite document keys. AP net_payable_minor is null when blocked. Accrual journals and next-day reversing journals have date, currency and lines with account, debit_minor, credit_minor; both are null when blocked or unnecessary. Report sorted issue codes for every blocking condition. A blocked settlement still reports residuals; bank residual is null if a unique compatible bank match is absent.'}}

    @app.post('/tasks/{job_id}/tools')
    def tools(job_id: str, body: Call, authorization: str | None = Header(default=None)):
        return invoke(backend.call, job_id, token(authorization), body)

    @app.post('/tasks/{job_id}/submissions')
    def submissions(job_id: str, body: Submission, authorization: str | None = Header(default=None)):
        result = invoke(backend.submit, job_id, token(authorization), body)
        return {'id': result['id'], 'state': result['state']}

    return app
