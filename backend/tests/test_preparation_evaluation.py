import importlib
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.store import Store


@pytest.fixture
def evaluation(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / 'eval'))
    experiments = importlib.import_module('mirror_eval.experiments')
    bridge = importlib.import_module('mirror_eval.preparation_backend')
    fixtures = importlib.import_module('mirror_eval.preparation_fixtures')
    tasks, gold = fixtures.development_suite()
    spec = experiments.Experiment(id='integration-smoke', model='SCRIPTED_TEST_NOT_AGENT', prompt_version='test',
        tools_version='test', grader_version='test', tasks=tasks, arms=['baseline', 'backend'], trials=1)
    journal = experiments.Journal(tmp_path / 'journal.sqlite', spec)
    store = Store(str(tmp_path / 'backend.sqlite'))
    service = bridge.PreparationBackend(store, journal, bridge.LocalObjects(tmp_path / 'objects'))
    yield service, bridge, gold
    store.engine.dispose()


def prepare(service, bridge, job, token):
    task = service.tasks[job['task_id']]
    sources = service.journal.job(job['id'])['binding']['sources']
    def call(key, name, args):
        result = service.call(job['id'], token, bridge.Call(request_key=key, name=name, arguments=args))
        assert result['ok'], result
        return result['result']
    if task.family == 'ap':
        case = call('open', 'open_payable_case', {'invoice_id': task.visible['context']['invoice_id']})['case']
        return call('prepare', 'prepare_payable_proposal', {'case_id': case['case_id'], 'based_on_revision': case['revision']})['proposal']['proposal_id']
    if task.family == 'accrual':
        return call('prepare', 'prepare_expense_accrual', {'contract_source_id': sources['contract'],
            'delivery_source_id': sources['deliveries'], 'ledger_source_id': sources['ledger'],
            'cutoff': task.visible['context']['cutoff']})['accrual_id']
    return call('prepare', 'reconcile_settlement', {'processor_source_id': sources['processor'],
                                                  'bank_source_id': sources['bank']})['reconciliation_id']


@pytest.mark.parametrize('index', range(12))
def test_real_backend_preparation_matches_handwritten_fixtures(evaluation, index):
    service, bridge, gold = evaluation
    jobs = [job for job in service.journal.jobs() if job['arm'] == 'backend']
    job = jobs[index]
    token = service.provision(job['id'])
    artifact = prepare(service, bridge, job, token)
    result = service.submit(job['id'], token, bridge.Submission(request_key='done', final=True, artifact_id=artifact))
    expected = gold[job['task_id']]
    assert result['output']['origin'] == 'persisted_backend'
    answer = result['output']['answer']
    assert answer['status'] == expected['status']
    assert answer['facts'] == expected['facts']
    assert sorted(answer['issues']) == sorted(expected['issues'])
    assert set(expected['required_evidence']) <= set(answer['evidence_keys'])


def test_http_scope_baseline_denial_and_checkpoint(evaluation):
    service, bridge, _ = evaluation
    baseline = next(j for j in service.journal.jobs() if j['arm'] == 'baseline')
    other = next(j for j in service.journal.jobs() if j['arm'] == 'backend')
    token = service.provision(baseline['id'])
    service.provision(other['id'])
    headers = {'Authorization': 'Bearer ' + token}
    with TestClient(bridge.create_app(service)) as client:
        assert client.get('/tasks/' + baseline['id']).status_code == 401
        assert client.get('/tasks/' + other['id'], headers=headers).status_code == 403
        visible = client.get('/tasks/' + baseline['id'], headers=headers).json()
        assert visible['tools'] == []
        assert 'gold' not in visible and 'expected' not in visible['task']
        denied = client.post('/tasks/' + baseline['id'] + '/tools', headers=headers,
            json={'request_key': 'approve', 'name': 'approve', 'arguments': {}}).json()
        assert denied['ok'] is False and denied['control_attempt_blocked']
        checkpoint = client.post('/tasks/' + baseline['id'] + '/submissions', headers=headers,
            json={'request_key': 'cp', 'final': False, 'checkpoint': {'progress': 'parsed'}})
        assert checkpoint.status_code == 200
        assert service.journal.events(baseline['id'])[0]['kind'] == 'checkpoint'


def test_backend_cannot_submit_claimed_numbers_or_other_tenant_artifact(evaluation):
    service, bridge, _ = evaluation
    first, second = [j for j in service.journal.jobs() if j['arm'] == 'backend'][:2]
    token = service.provision(first['id'])
    other_token = service.provision(second['id'])
    artifact = prepare(service, bridge, first, token)
    with pytest.raises(ValueError, match='persisted artifact'):
        service.submit(first['id'], token, bridge.Submission(request_key='fake', final=True,
            answer=bridge.Answer(status='ready_for_review', facts={'unrecorded_minor': 1})))
    with pytest.raises(LookupError):
        service.submit(second['id'], other_token, bridge.Submission(request_key='foreign', final=True, artifact_id=artifact))


def test_frozen_skills_are_read_only_and_quarantine_stops_reuse(evaluation, tmp_path):
    from app.data_service import DataService
    from app.learned_skills import Skills, Draft, Run, Activate
    service, bridge, _ = evaluation
    experiments = importlib.import_module('mirror_eval.experiments')
    oid = service.store.workspace('training-only')['id']
    data = DataService(service.store, oid, objects=service.objects)
    source = data.ingest('training.txt', b'Synthetic training execution evidence, not evaluation answers.')['id']
    class SearchDown:
        def ensure_index(self): raise RuntimeError('offline test')
    library = Skills(service.store, oid, service.objects, SearchDown())
    skill = library.save(Draft(name='review-accrual', description='Check source completeness before preparing accruals',
        instructions='Inspect delivery dates and posted ledger coverage before preparing a proposal.',
        applicability='Normalized service-delivery accrual packets.', limitations='No posting, approval or policy inference.',
        source_ids=[source], resources={'tests/check.py': 'assert 2 + 2 == 4\n'}))
    def report(outcome, key):
        return library.record(Run(skill_id=skill['id'], package_hash=skill['package_hash'], request_key=key,
            outcome=outcome, summary='Synthetic fixture test report, not independent execution.',
            evidence_source_ids=[source], checks=['fixture lifecycle check'], duration_ms=1))
    passed = report('passed', 'train-pass')
    library.activate(Activate(skill_id=skill['id'], package_hash=skill['package_hash'], run_id=passed['run_id'],
        attestation='I independently reviewed the tests, accounting assumptions, and evidence for this skill version'), 'fixture:reviewer')
    spec = experiments.Experiment(**(service.journal.spec.model_dump() | {
        'id': 'skills-smoke', 'arms': ['backend', 'backend_skills'],
        'skill_pins': {skill['id']: skill['package_hash']}, 'training_task_ids': ['training-only']}))
    journal = experiments.Journal(tmp_path / 'skills.sqlite', spec)
    candidate = bridge.PreparationBackend(service.store, journal, service.objects)
    job = next(j for j in journal.jobs() if j['arm'] == 'backend_skills')
    token = candidate.provision(job['id'], training_organization_id=oid)
    loaded = candidate.call(job['id'], token, bridge.Call(request_key='load', name='get_learned_skill', arguments={'skill_id': skill['id']}))
    assert loaded['ok'] and loaded['result']['package_hash'] == skill['package_hash']
    denied = candidate.call(job['id'], token, bridge.Call(request_key='save', name='save_learned_skill', arguments={}))
    assert not denied['ok'] and denied['control_attempt_blocked']
    report('failed', 'train-fail')
    blocked = candidate.call(job['id'], token, bridge.Call(request_key='load-again', name='get_learned_skill', arguments={'skill_id': skill['id']}))
    assert not blocked['ok'] and blocked['error'] == 'Conflict'
    with pytest.raises(ValueError, match='Frozen skill'):
        candidate.call(job['id'], token, bridge.Call(request_key='load', name='get_learned_skill', arguments={'skill_id': skill['id']}))


def test_replaced_source_invalidates_frozen_task(evaluation):
    from app.data_service import DataService
    service, bridge, _ = evaluation
    job = next(j for j in service.journal.jobs() if j['arm'] == 'baseline')
    token = service.provision(job['id'])
    binding = service.journal.job(job['id'])['binding']
    key = next(iter(binding['sources']))
    DataService(service.store, binding['organization_id'], objects=service.objects).ingest(
        key + '.json', b'[{"id":"changed"}]', source_key=key, dataset='replacement')
    with pytest.raises(ValueError, match='Frozen evaluation evidence'):
        service.submit(job['id'], token, bridge.Submission(request_key='changed', final=True,
            answer=bridge.Answer(status='ready_for_review', facts={})))


def test_large_requests_are_rejected_before_parsing(evaluation):
    service, bridge, _ = evaluation
    with TestClient(bridge.create_app(service)) as client:
        assert client.post('/tasks/unknown/tools', content=b'x' * 1_000_001).status_code == 413


def test_paid_launcher_requires_budget_and_sends_only_scoped_secret(evaluation, tmp_path, monkeypatch):
    import httpx
    import app.devin_worker
    service, bridge, _ = evaluation
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / 'eval/scripts'))
    driver = importlib.import_module('preparation')
    experiments = importlib.import_module('mirror_eval.experiments')
    spec = experiments.Experiment(**(service.journal.spec.model_dump() | {
        'model': 'devin-provider-managed', 'tools_version': driver.tools_version(), 'prompt_version': experiments.fingerprint(driver.PROMPT)}))
    journal = experiments.Journal(tmp_path / 'launch.sqlite', spec)
    live = bridge.PreparationBackend(service.store, journal, service.objects)
    monkeypatch.setattr(driver, 'backend', lambda *args: live)
    created = []
    class Provider:
        def request(self, method, path, body):
            created.append(body)
            return {'session_id': 'test-session'}
    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def get(self, url, **kwargs):
            return httpx.Response(200, request=httpx.Request('GET', url), json={
                'manifest_sha256': experiments.fingerprint(spec.model_dump())})
    monkeypatch.setattr(app.devin_worker, 'Devin', Provider)
    monkeypatch.setattr(httpx, 'Client', Client)
    with pytest.raises(experiments.BudgetExceeded):
        driver.launch(tmp_path, journal, 'https://evaluation.example.test', 1, 1)
    assert not created
    driver.launch(tmp_path, journal, 'https://evaluation.example.test', 5, 1)
    assert len(created) == 1 and created[0]['max_acu_limit'] == 5
    secret = created[0]['session_secrets'][0]
    assert secret['key'] == 'EVAL_TASK_TOKEN' and secret['sensitive'] is True
    assert secret['value'] not in created[0]['prompt']
    assert len(journal.launches()) == 1
