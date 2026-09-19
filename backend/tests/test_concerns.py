import time
from concurrent.futures import ThreadPoolExecutor
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from app.concerns import ConcernService, RaiseConcern, Respond, Finish, Conflict
from app.database import concerns
from app import main, auth, data_api
from test_simulator import setup


@pytest.fixture
def flow(setup, monkeypatch):
    store, a, b, factory, _ = setup
    source = a.data.ingest('invoice.txt', b'Invoice amount is 120 dollars.')['id']
    calls = []
    real = httpx.Client
    def respond(request):
        calls.append(request)
        return httpx.Response(200, json={'approved': True, 'evaluation': {'model': 'typesafe-ai/jev'},
            'card': {'summary': 'Invoice needs investigation.', 'options': [
                {'id': f'option_{i}', 'title': f'Choice {i}', 'action': f'Investigate step {i}',
                 'tradeoff': 'Requires review.', 'requires_approval': False} for i in range(1,4)]}})
    monkeypatch.setattr(httpx, 'Client', lambda **kw: real(transport=httpx.MockTransport(respond), **kw))
    svc = ConcernService(a.data)
    args = RaiseConcern(request_key='invoice-1', title='Amount mismatch', description='Compare contract and invoice.', source_ids=[source])
    return store, svc, ConcernService(b.data), args, calls, factory


def test_card_decision_claim_and_resolution(flow):
    store, svc, other, args, calls, _ = flow
    row = svc.raise_concern(args)
    assert row['status'] == 'awaiting_response'
    assert len(row['card']['options']) == 3
    assert row['card']['custom_option']['input_required']
    assert svc.raise_concern(args)['id'] == row['id']
    assert len(calls) == 1
    with pytest.raises(Conflict):
        svc.raise_concern(args.model_copy(update={'description': 'Changed request'}))
    with pytest.raises(LookupError):
        other.get(row['id'])
    with pytest.raises(LookupError):
        other.raise_concern(args)
    result = svc.respond(row['id'], Respond(option_id='custom', custom_response='Check the receiving log first.'), 'alice')
    assert result['decision']['instruction'] == 'Check the receiving log first.'
    assert result['status'] == 'queued'
    with pytest.raises(Conflict):
        svc.respond(row['id'], Respond(option_id='option_1'), 'alice')
    with ThreadPoolExecutor(2) as pool:
        def claim(_):
            try:return svc.claim(row['id'])
            except Conflict:return None
        results = list(pool.map(claim, range(2)))
    winner = next(r for r in results if r)
    assert sum(r is not None for r in results) == 1
    assert 'claim_token' not in svc.get(row['id'])
    with pytest.raises(Conflict):
        svc.finish(Finish(concern_id=row['id'], claim_token='wrong', outcome='resolved', summary='Done', source_ids=args.source_ids))
    finished = svc.finish(Finish(concern_id=row['id'], claim_token=winner['claim_token'], outcome='needs_input',
                                summary='Need receiving confirmation.', source_ids=args.source_ids))
    assert finished['status'] == 'needs_input'
    assert svc.respond(row['id'], Respond(option_id='option_2'), 'alice')['status'] == 'queued'


def test_jev_failure_saved_and_retry(flow, monkeypatch):
    _, svc, _, args, _, _ = flow
    original = httpx.Client
    class Reject:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,*args,**kw):raise httpx.ConnectError('secret-details')
    monkeypatch.setattr(httpx, 'Client', lambda **kw: Reject())
    row = svc.raise_concern(args)
    assert row['status'] == 'card_failed'
    assert row['card'] is None
    with pytest.raises(Conflict):svc.respond(row['id'],Respond(option_id='option_1'),'alice')
    monkeypatch.setattr(httpx, 'Client', original)
    assert svc.generate(row['id'])['status'] == 'awaiting_response'


def test_expired_lease_cannot_complete(flow):
    store, svc, _, args, _, _ = flow
    row = svc.raise_concern(args)
    svc.respond(row['id'], Respond(option_id='option_1'), 'alice')
    claim = svc.claim(row['id'])
    with store.engine.begin() as db:
        db.execute(update(concerns).where(concerns.c.id == row['id']).values(lease_until=0))
    with pytest.raises(Conflict):
        svc.finish(Finish(concern_id=row['id'],claim_token=claim['claim_token'],outcome='resolved',summary='Done',source_ids=args.source_ids))
    assert svc.claim(row['id'])['claim_token'] != claim['claim_token']


def test_routes_scope_and_response(flow, monkeypatch):
    store, svc, other, args, _, factory = flow
    row = svc.raise_concern(args)
    monkeypatch.setattr(main,'store',store)
    main.app.dependency_overrides[auth.current_user] = lambda: auth.Identity('alice',int(time.time())+300)
    main.app.dependency_overrides[data_api.service] = lambda: svc.data
    try:
        with TestClient(main.app) as client:
            assert client.get('/concerns').status_code == 200
            assert client.get('/concerns/'+row['id']).json()['card']['custom_option']['id'] == 'custom'
            assert client.post('/concerns/'+row['id']+'/respond',json={'option_id':'custom'}).status_code == 422
            assert client.post('/concerns/'+row['id']+'/respond',json={'option_id':'option_1'}).json()['status'] == 'queued'
            main.app.dependency_overrides[data_api.service] = lambda: other.data
            assert client.get('/concerns/'+row['id']).status_code == 404
    finally:
        main.app.dependency_overrides.clear()
