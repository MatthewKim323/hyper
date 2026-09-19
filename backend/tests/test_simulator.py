import json
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi import Depends, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from app import main, auth, data_api
from app.store import Store
from app.data_service import DataService, FinancialQuery
from app.database import simulations, simulation_events
from app.simulator import (SimulatorService, CreateSimulation, Conflict, run_once,
                           claim, now_ms, make_event, render_document)


class Objects:
    def __init__(self):
        self.values = {}
        self.fail_document = False

    def put(self, key, body, content_type):
        if self.fail_document and body.startswith(b'SIMULATED'):
            raise RuntimeError('S3 down')
        self.values[key] = body


@pytest.fixture
def setup(tmp_path):
    store = Store(str(tmp_path / 'sim.db'))
    objects = Objects()
    def data(oid):
        return DataService(store, oid, objects=objects)
    a = SimulatorService(data(store.workspace('alice')['id']))
    b = SimulatorService(data(store.workspace('bob')['id']))
    return store, a, b, data, objects


def create(svc, **kwargs):
    return svc.create(CreateSimulation(mode='template', **kwargs))['id']


def tick(store, svc, factory, sid, **kwargs):
    svc.control(sid, 'tick')
    assert run_once(store, factory, **kwargs)


def test_manual_publish_retrieval_and_bounds(setup):
    store, a, b, factory, objects = setup
    sid = create(a, max_ticks=2)
    assert not run_once(store, factory)
    tick(store, a, factory, sid)
    assert a.get(sid)['status'] == 'paused'
    page = a.events(sid)
    event = page['events'][0]
    assert page['next_after'] == 1
    assert event['status'] == 'published'
    assert len(event['source_ids']) == 2
    assert all(s['index_status'] == 'pending' for s in event['sources'])
    result = a.data.query_financials(FinancialQuery(dataset='sim_contract'))
    assert result['total_matching'] == 1
    assert event['payload']['record']['id'] == result['rows'][0]['record_id']
    assert len(objects.values) == 2
    with pytest.raises(LookupError):
        b.events(sid)
    with pytest.raises(LookupError):
        b.control(sid, 'start')
    tick(store, a, factory, sid)
    assert a.get(sid)['status'] == 'completed'
    with pytest.raises(Conflict):
        a.control(sid, 'start')
    assert a.events(sid, after=1)['events'][0]['sequence'] == 2
    assert not run_once(store, factory)


def test_schedule_and_pause(setup):
    store, a, _, factory, _ = setup
    sid = create(a)
    a.control(sid, 'start')
    assert run_once(store, factory)
    assert a.get(sid)['status'] == 'running'
    assert not run_once(store, factory)  # next interval isn't due
    with pytest.raises(Conflict):
        a.control(sid, 'tick')
    a.control(sid, 'pause')
    with store.engine.begin() as db:
        db.execute(update(simulations).where(simulations.c.id == sid).values(next_run_at=0))
    assert not run_once(store, factory)


def test_two_workers_and_abandoned_claim(setup):
    store, a, _, factory, _ = setup
    sid = create(a)
    a.control(sid, 'start')
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: claim(store, now_ms()), range(2)))
    assert sum(r is not None for r in results) == 1
    assert not run_once(store, factory)
    with pytest.raises(Conflict):
        a.control(sid, 'start')
    with store.engine.begin() as db:
        db.execute(update(simulations).where(simulations.c.id == sid).values(lease_until=0))
    assert run_once(store, factory)
    assert len(a.events(sid)['events']) == 1
    assert a.events(sid)['events'][0]['attempts'] == 2


def test_partial_ingest_retry_reuses_staged_text(setup):
    store, a, _, factory, objects = setup
    sid = create(a)
    objects.fail_document = True
    tick(store, a, factory, sid)
    assert a.get(sid)['status'] == 'failed'
    assert len(a.data.list_sources()['sources']) == 1
    page = a.events(sid)
    assert page['next_after'] == 0  # client must observe the eventual published retry
    objects.fail_document = False
    def must_not_generate(*args):
        raise AssertionError('Staged document was regenerated')
    tick(store, a, factory, sid, writer=must_not_generate)
    assert len(a.data.list_sources()['sources']) == 2
    assert a.events(sid)['next_after'] == 1
    assert a.events(sid)['events'][0]['attempts'] == 2


def test_generation_failure_and_pause_during_work(setup):
    store, a, _, factory, _ = setup
    sid = create(a)
    def fail(*args):
        raise RuntimeError('secret-provider-body')
    tick(store, a, factory, sid, writer=fail)
    assert a.get(sid)['status'] == 'failed'
    assert 'secret-provider-body' not in json.dumps(a.events(sid))
    assert a.get(sid)['sequence'] == 0
    def pause_and_render(event, config):
        a.control(sid, 'pause')
        return render_document(event, config)
    a.control(sid, 'start')
    run_once(store, factory, writer=pause_and_render)
    assert a.get(sid)['status'] == 'paused'
    assert a.get(sid)['sequence'] == 1


def test_scenarios_are_consistent_and_unresolved_not_paid():
    scenarios = set()
    for seed in range(40):
        run = {'id': 'sim_test', 'config': CreateSimulation(seed=seed).model_dump(mode='json')}
        events = [make_event(run, i) for i in range(1, 8)]
        assert events == [make_event(run, i) for i in range(1, 8)]
        contract, po, bill, receipt, _, credit, bank = [e['record'] for e in events]
        assert po['amount_cents'] == contract['unit_price_cents'] * po['quantity']
        assert bill['purchase_order_id'] == po['id']
        assert receipt['quantity'] <= po['quantity']
        if receipt['quantity'] < po['quantity']:
            assert events[-1]['event_type'] == 'message.created'
            assert 'amount_cents' not in bank
            scenarios.add('partial')
        else:
            credit_amount = credit.get('amount_cents', 0)
            assert bill['amount_cents'] - credit_amount == bank['amount_cents']
            scenarios.add('price' if credit_amount else 'clean')
    assert scenarios == {'clean', 'price', 'partial'}


def test_llm_config_fail_closed_and_http_payload(setup, monkeypatch):
    _, a, *_ = setup
    monkeypatch.delenv('AI_GATEWAY_API_KEY', raising=False)
    monkeypatch.delenv('SIMULATOR_MODEL', raising=False)
    with pytest.raises(Conflict):
        a.create(CreateSimulation())
    monkeypatch.setenv('AI_GATEWAY_API_KEY', 'test-secret')
    monkeypatch.setenv('SIMULATOR_MODEL', 'provider/model')
    sid = a.create(CreateSimulation())['id']
    run = a.get(sid)
    real_client = httpx.Client
    def respond(request):
        body = json.loads(request.content)
        assert body['model'] == 'provider/model'
        assert body['max_tokens'] == 600
        assert request.headers['Authorization'] == 'Bearer test-secret'
        assert 'future' in body['messages'][0]['content']
        return httpx.Response(200, json={'choices': [{'message': {'content': 'Synthetic contract.'}}]})
    monkeypatch.setattr(httpx, 'Client', lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw))
    legacy = dict(run, config=dict(run['config'], generator_version=2))
    assert 'Synthetic contract.' in render_document(make_event(legacy, 1), run['config'])
    assert 'test-secret' not in json.dumps(run)


def test_api_auth_scope_validation_and_openapi(setup, monkeypatch):
    store, a, b, factory, _ = setup
    monkeypatch.setattr(main, 'store', store)
    def verify(token):
        if token not in ('alice', 'bob'):
            raise HTTPException(401)
        return auth.Identity(token, int(time.time()) + 300)
    monkeypatch.setattr(auth, 'verify', verify)
    def data(identity=Depends(auth.current_user)):
        return factory(store.workspace(identity.user_id)['id'])
    main.app.dependency_overrides[data_api.service] = data
    try:
        with TestClient(main.app) as client:
            headers = {'Authorization': 'Bearer alice'}
            assert client.get('/simulations').status_code == 401
            for bad in ({'organization_id': b.oid}, {'interval_seconds': 0}, {'max_ticks': 1001},
                        {'start_time': '2026-09-01T00:00:00'}):
                assert client.post('/simulations', headers=headers, json={'mode': 'template', **bad}).status_code == 422
            response = client.post('/simulations', headers=headers, json={'mode': 'template'})
            assert response.status_code == 201
            sid = response.json()['id']
            for suffix in ('', '/events'):
                assert client.get('/simulations/' + sid + suffix,
                    headers={'Authorization': 'Bearer bob'}).status_code == 404
            assert client.post(f'/simulations/{sid}/tick', headers=headers).status_code == 202
            assert client.post(f'/simulations/{sid}/tick', headers=headers).status_code == 409
            assert run_once(store, factory)
            assert client.get(f'/simulations/{sid}/events', headers=headers).json()['next_after'] == 1
            assert '/simulations/{sid}/start' in client.get('/openapi.json').json()['paths']
    finally:
        main.app.dependency_overrides.clear()


def v2_run(scenario=None):
    config = CreateSimulation(mode='template', scenarios=[scenario] if scenario else None).model_dump(mode='json')
    config['generator_version'] = 2
    return {'id': 'sim_cases', 'config': config}


def test_v2_all_cases_reproducible_linked_and_no_answer_labels():
    from app.simulation_cases import SCENARIOS, case_events
    for scenario in SCENARIOS:
        run = v2_run(scenario)
        count = len(case_events(run, 0, scenario))
        events = [make_event(run, i) for i in range(1, count + 1)]
        assert events == [make_event(run, i) for i in range(1, count + 1)]
        ids = {e['record']['id'] for e in events}
        assert len(ids) == count
        for e in events:
            row = e['record']
            assert not {'scenario', 'expected_outcome', 'anomaly', 'answer'} & row.keys()
            for key in ('invoice_id', 'contract_id', 'purchase_order_id', 'replaces_invoice_id',
                        'reverses_transaction_id', 'applied_credit_id', 'parent_contract_id'):
                if key in row:
                    assert row[key] in ids, (scenario, key)
            if e['dataset'] == 'sim_journal_entry':
                assert sum(x['debit_cents'] for x in row['lines']) == sum(x['credit_cents'] for x in row['lines'])
        assert make_event(run, count + 1)['record']['id'] == 'sim_cases-2-contract'


def test_v2_financial_consequences():
    from app.simulation_cases import case_events
    def rows(scenario, kind):
        return [row for k, row in case_events(v2_run(scenario), 0, scenario) if k == kind]
    bills = rows('duplicate_invoice', 'bill')
    assert bills[0]['id'] != bills[1]['id']
    assert bills[0]['amount_cents'] == bills[1]['amount_cents']
    assert bills[0]['purchase_order_id'] == bills[1]['purchase_order_id']
    price_bill = rows('price_and_quantity', 'bill')[0]
    credit = rows('price_and_quantity', 'vendor_credit')[0]
    po = rows('price_and_quantity', 'purchase_order')[0]
    assert price_bill['amount_cents'] - credit['amount_cents'] == po['amount_cents']
    assert rows('price_and_quantity', 'goods_receipt')[0]['quantity'] < po['quantity']
    assert not rows('price_and_quantity', 'bank_transaction')
    assert not rows('bank_change', 'bank_transaction')
    split = rows('split_approval', 'bill')
    threshold = rows('split_approval', 'policy')[0]['threshold_cents']
    assert all(b['amount_cents'] < threshold for b in split)
    assert sum(b['amount_cents'] for b in split) > threshold
    partial = rows('partial_payment', 'bank_transaction')[0]['amount_cents']
    remaining = rows('partial_payment', 'statement')[0]['balance_cents']
    assert partial + remaining == rows('partial_payment', 'bill')[0]['amount_cents']
    reversal = rows('payment_reversal', 'bank_transaction')
    assert sum(r['amount_cents'] * (1 if r['direction'] == 'outflow' else -1) for r in reversal) == 0
    assert rows('misapplied_credit', 'vendor_credit')[0]['invoice_id'] != rows('misapplied_credit', 'payment_proposal')[0]['invoice_id']
    fx = rows('fx_settlement', 'remittance')[0]
    payment = rows('fx_settlement', 'bank_transaction')[0]
    assert payment['amount_cents'] == fx['settlement_principal_cents'] + fx['fee_cents']
    assert fx['currency'] != payment['currency']
    events = [make_event(v2_run('late_receipt'), i) for i in range(1, 7)]
    receipt = next(e['record'] for e in events if e['dataset'] == 'sim_goods_receipt')
    assert receipt['occurred_at'] < receipt['observed_at']


def test_v2_default_deck_covers_every_case():
    import random
    from app.simulation_cases import SCENARIOS, case_events
    run = v2_run()
    deck = list(SCENARIOS)
    random.Random('42:0:v2').shuffle(deck)
    sequence = 1
    for cycle, scenario in enumerate(deck):
        rows = case_events(run, cycle, scenario)
        events = [make_event(run, i) for i in range(sequence, sequence + len(rows))]
        assert [e['event_type'] for e in events] == [kind + '.created' for kind, _ in rows]
        sequence += len(rows)
    assert sequence < 150


def test_v2_publish_all_cases(setup):
    from app.simulation_cases import SCENARIOS, case_events
    store, a, _, factory, _ = setup
    for scenario in SCENARIOS:
        count = len(case_events(v2_run(scenario), 0, scenario))
        sid = create(a, scenarios=[scenario], max_ticks=count)
        assert a.get(sid)['config']['generator_version'] == 2
        for _ in range(count):
            tick(store, a, factory, sid)
        assert a.get(sid)['status'] == 'completed'
        events = a.events(sid)['events']
        assert len(events) == count
        assert all(e['status'] == 'published' for e in events)
    assert a.data.query_financials(FinancialQuery(dataset='sim_bill'))['total_matching'] > len(SCENARIOS)


def test_scenario_validation():
    from pydantic import ValidationError
    for scenarios in ([], ['invented_scenario']):
        with pytest.raises(ValidationError):
            CreateSimulation(scenarios=scenarios)


def test_llm_authors_events_with_history_and_reuses_staged_output(setup, monkeypatch):
    store, a, _, factory, objects = setup
    monkeypatch.setenv('AI_GATEWAY_API_KEY', 'test-secret')
    monkeypatch.setenv('SIMULATOR_MODEL', 'provider/model')
    sid = a.create(CreateSimulation(mode='llm', max_ticks=2, brief='Invent unusual supplier disputes.'))['id']
    calls = []
    real_client = httpx.Client
    def respond(request):
        body = json.loads(request.content)
        context = json.loads(body['messages'][1]['content'])
        calls.append(context)
        assert 'seed' not in body and 'seed' not in context
        assert context['creative_brief'] == 'Invent unusual supplier disputes.'
        facts = {'amount_cents': 12345, 'vendor_id': 'fictional-vendor'}
        if len(calls) == 2:
            assert context['recent_records'][0]['amount_cents'] == 12345
            facts['invoice_id'] = context['recent_records'][0]['id']
        else:
            assert context['recent_records'] == []
        generated = dict(source='ramp', kind='bill' if len(calls) == 1 else 'vendor_credit',
                         currency='EUR', occurred_at=context['observed_at'], facts=facts,
                         document='A model-authored source document.')
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(generated)}}]})
    monkeypatch.setattr(httpx, 'Client', lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw))
    tick(store, a, factory, sid)
    assert a.get(sid)['config']['generator_version'] == 3
    objects.fail_document = True
    tick(store, a, factory, sid)
    assert a.get(sid)['status'] == 'failed'
    objects.fail_document = False
    tick(store, a, factory, sid)
    assert len(calls) == 2
    assert a.get(sid)['status'] == 'completed'
    events = a.events(sid)['events']
    assert events[0]['payload']['event_type'] == 'bill.created'
    assert events[1]['payload']['record']['invoice_id'] == events[0]['payload']['record']['id']
    assert events[0]['payload']['record']['currency'] == 'EUR'


@pytest.mark.parametrize('change', [
    {'facts': {'invoice_id': 'nonexistent'}},
    {'facts': {'amount_cents': 1.23}},
    {'facts': {'synthetic': False}},
    {'occurred_at': '2099-01-01T00:00:00Z'},
    {'occurred_at': '2026-09-01T00:00:00'},
    {'kind': '../escape'},
])
def test_invalid_llm_event_never_publishes(setup, monkeypatch, change):
    store, a, _, factory, objects = setup
    monkeypatch.setenv('AI_GATEWAY_API_KEY', 'test-secret')
    monkeypatch.setenv('SIMULATOR_MODEL', 'provider/model')
    sid = a.create(CreateSimulation(mode='llm'))['id']
    real_client = httpx.Client
    def respond(request):
        generated = dict(source='ramp', kind='bill', currency='USD',
            occurred_at='2026-09-01T00:00:00Z', facts={'amount_cents': 100}, document='Invoice.')
        generated.update(change)
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(generated)}}]})
    monkeypatch.setattr(httpx, 'Client', lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw))
    tick(store, a, factory, sid)
    assert a.get(sid)['status'] == 'failed'
    assert a.get(sid)['sequence'] == 0
    assert objects.values == {}
