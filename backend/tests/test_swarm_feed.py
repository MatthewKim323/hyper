import asyncio
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app import auth, main
from app.database import agent_events, agent_tasks, memberships
from app.orchestrator import AgentService, CaseState, Delegate, Page, PutCase, execute
from app.store import Store
from app.swarm_feed import (MessageCache, SwarmService, clean_text, decode_cursor,
                            provider_page, stream_events)


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    store = Store(str(tmp_path / 'swarm.db'))
    alice = store.workspace('alice')['id']
    bob = store.workspace('bob')['id']
    monkeypatch.setattr(main, 'store', store)
    monkeypatch.setattr(auth, 'verify', lambda token: auth.Identity(token, int(time.time()) + 300))
    monkeypatch.delenv('DEVIN_API_KEY', raising=False)
    monkeypatch.delenv('DEVIN_ORG_ID', raising=False)
    return store, alice, bob


def task(store, oid, key='review', title='Invoice review'):
    service = AgentService(store, oid)
    case = service.put_case(PutCase(case_key=key, title=title, expected_version=0, state=CaseState()))
    return service.delegate(Delegate(request_key=key, case_id=case['id'], objective='Inspect the supporting invoice'))


def event(store, oid, number, kind='source.indexed', payload=None, timestamp=100):
    with store.engine.begin() as db:
        db.execute(agent_events.insert().values(id=f'evt_{number:05}', organization_id=oid,
            event_key=f'event-{number}', kind=kind, payload=payload or {}, acknowledged=True,
            created_at=timestamp))


class Provider:
    def __init__(self):
        self.calls = []

    def page(self, sid, after=None, limit=100):
        self.calls.append((sid, after, limit))
        return {'items': [
            {'event_id': 'agent-1', 'created_at': 1770000000, 'source': 'devin',
             'message': 'I am reviewing the invoice. agt_abcdefghijklmnopqrst'},
            {'event_id': 'user-1', 'created_at': 1770000001, 'source': 'user',
             'message': 'Secret instructions and the full agent prompt'},
        ], 'end_cursor': 'next-page', 'has_next_page': True}


def test_snapshot_is_scoped_and_exposes_only_display_fields(workspace):
    store, alice, bob = workspace
    mine, other = task(store, alice), task(store, bob)
    event(store, alice, 1, 'task.finished', {'task_id': mine['id'], 'result': {'summary': 'Compared invoice evidence.'}, 'secret': 'hidden'})
    event(store, bob, 2, 'task.finished', {'task_id': other['id'], 'result': {'summary': 'Private Bob findings'}})
    with store.engine.begin() as db:
        db.execute(update(agent_tasks).where(agent_tasks.c.id == mine['id']).values(
            credential_hash='secret-hash', claim_token='claim-secret', launch_key='launch-secret'))
    data = SwarmService(store, alice).snapshot()
    assert data['task_total'] == 1 and data['tasks'][0]['id'] == mine['id']
    assert data['tasks'][0]['section'] == 'cases'
    assert data['events'][0]['text'] == 'Compared invoice evidence.'
    serialized = json.dumps(data)
    for excluded in ['Private Bob', 'secret-hash', 'claim-secret', 'launch-secret', '"payload"']:
        assert excluded not in serialized
    assert data['provider_logs']['status'] == 'not_configured'
    # Reading the UI neither consumes coordinator events nor starts tasks.
    assert AgentService(store, alice).get_task(mine['id'])['status'] == 'queued'


def test_event_cursor_ties_history_and_reconnect_backlog(workspace):
    store, alice, _ = workspace
    for number in range(1, 7):
        event(store, alice, number)
    service = SwarmService(store, alice)
    initial = service.snapshot(limit=2)
    assert [entry['id'] for entry in initial['events']] == ['evt_00005', 'evt_00006']
    assert initial['has_more']
    older = service.snapshot(before=initial['older_cursor'], limit=2)
    assert [entry['id'] for entry in older['events']] == ['evt_00003', 'evt_00004']
    for number in range(7, 10):
        event(store, alice, number)
    reconnect = service.snapshot(after=initial['cursor'], limit=2)
    assert [entry['id'] for entry in reconnect['events']] == ['evt_00007', 'evt_00008']
    assert reconnect['has_more']
    remaining = service.snapshot(after=reconnect['cursor'], limit=2)
    assert [entry['id'] for entry in remaining['events']] == ['evt_00009']
    assert not remaining['has_more']
    assert service.snapshot(after=remaining['cursor'])['cursor'] == remaining['cursor']


def test_task_pagination_and_real_tool_location(workspace):
    store, alice, _ = workspace
    workers = [task(store, alice, key=str(i)) for i in range(3)]
    event(store, alice, 1, 'agent.tool.completed', {'task_id': workers[0]['id'], 'tool': 'search_evidence'})
    service = SwarmService(store, alice)
    first = service.snapshot(task_limit=2)
    second = service.snapshot(task_offset=first['tasks_next_offset'], task_limit=2)
    assert first['task_total'] == 3 and first['tasks_has_more']
    assert not second['tasks_has_more'] and second['tasks_next_offset'] is None
    found = {row['id']: row for row in first['tasks'] + second['tasks']}
    assert found[workers[0]['id']]['section'] == 'evidence'
    assert first['events'][0]['section'] == 'evidence'
    assert 'search evidence' in first['events'][0]['title']


def test_provider_messages_are_sanitized_real_and_deduplicable(workspace):
    provider = Provider()
    first = provider_page(provider, 'devin-one', 'task-one', 'evidence')
    second = provider_page(provider, 'devin-one', 'task-one', 'evidence', 'next-page', 50)
    assert len(first['events']) == 1
    event = first['events'][0]
    assert event['timestamp'] == 1770000000000
    assert event['source'] == 'devin' and event['id'] == second['events'][0]['id']
    assert 'agt_' not in event['text']
    assert first['next_cursor'] == 'next-page' and first['has_more']
    assert provider.calls[-1] == ('devin-one', 'next-page', 50)


def test_provider_proxy_never_accepts_foreign_session_ids(workspace):
    store, alice, bob = workspace
    other = task(store, bob)
    with store.engine.begin() as db:
        db.execute(update(agent_tasks).where(agent_tasks.c.id == other['id']).values(session_id='devin-private'))
    provider = Provider()
    with pytest.raises(LookupError):
        SwarmService(store, alice, provider).session_messages(other['id'])
    assert provider.calls == []


def test_unlaunched_task_has_no_fake_messages(workspace):
    store, alice, _ = workspace
    worker = task(store, alice)
    provider = Provider()
    assert SwarmService(store, alice, provider).session_messages(worker['id']) == {
        'events': [], 'next_cursor': None, 'has_more': False}
    assert provider.calls == []


def test_secrets_and_control_characters_are_removed(monkeypatch):
    monkeypatch.setenv('EXAMPLE_API_KEY', 'configured-secret-value')
    value = clean_text('A\x00B\nAuthorization: Bearer abcdefghijk\npassword=hunter-secret\nconfigured-secret-value\ncog_abcdefghijklmnop')
    assert '\x00' not in value
    for secret in ('abcdefghijk', 'hunter-secret', 'configured-secret-value', 'cog_abcdefghijklmnop'):
        assert secret not in value
    assert len(clean_text('a' * 9000)) == 4000


@pytest.mark.parametrize('cursor', ['bad', 'e30', 'WzEsbnVsbF0', 'Wy0xLCJldnRfYSJd', 'W3RydWUsImV2dF9hIl0'])
def test_cursor_validation(cursor):
    with pytest.raises(ValueError):
        decode_cursor(cursor)


def test_authenticated_routes_and_bounded_queries(workspace):
    store, alice, _ = workspace
    task(store, alice)
    with TestClient(main.app) as client:
        assert client.get('/agents/swarm').status_code == 401
        headers = {'Authorization': 'Bearer alice'}
        assert client.get('/agents/swarm', headers=headers).json()['task_total'] == 1
        assert client.get('/agents/swarm?limit=9999', headers=headers).status_code == 422
        assert client.get('/agents/swarm?before=bad', headers=headers).status_code == 422
        assert client.get('/agents/swarm/stream?after=bad', headers=headers).status_code == 422
        assert client.get('/agents/swarm/tasks/not-mine/messages', headers=headers).status_code == 404


async def test_sse_reconnect_and_membership_revocation(workspace):
    store, alice, _ = workspace
    service = SwarmService(store, alice)
    event(store, alice, 1)
    previous = service.snapshot()['cursor']
    event(store, alice, 2)
    class Request:
        async def is_disconnected(self):
            return False
    identity = auth.Identity('alice', int(time.time()) + 60)
    stream = stream_events(Request(), service, identity, previous)
    first = await anext(stream)
    assert 'event: snapshot' in first and 'evt_00002' in first
    assert 'evt_00001' not in first
    with store.engine.begin() as db:
        db.execute(memberships.delete().where(memberships.c.user_id == 'alice'))
    closed = await anext(stream)
    assert 'event: access_lost' in closed and '"reason":"access_removed"' in closed
    with pytest.raises(StopAsyncIteration):
        await anext(stream)


async def test_sse_expired_auth_stops_without_snapshot(workspace):
    store, alice, _ = workspace
    class Request:
        async def is_disconnected(self):
            return False
    stream = stream_events(Request(), SwarmService(store, alice), auth.Identity('alice', 0))
    closed = await anext(stream)
    assert 'event: access_lost' in closed and '"reason":"token_expired"' in closed
    with pytest.raises(StopAsyncIteration):
        await anext(stream)


def test_worker_telemetry_records_success_without_payload_or_work_queue_loop(workspace):
    store, alice, _ = workspace
    worker = task(store, alice)
    identity = {'organization_id': alice, 'role': 'worker', 'task_id': worker['id'], 'case_id': worker['case_id']}
    execute(store, identity, 'get_case', {'case_id': worker['case_id']})
    with store.engine.connect() as db:
        telemetry = db.execute(select(agent_events).where(agent_events.c.kind == 'agent.tool.completed')).mappings().all()
    assert len(telemetry) == 1
    assert telemetry[0]['acknowledged'] is True
    assert telemetry[0]['payload'] == {'tool': 'get_case', 'task_id': worker['id'], 'case_id': worker['case_id']}
    assert AgentService(store, alice).list_events(Page())['events'] == []
    with pytest.raises(PermissionError):
        execute(store, identity, 'get_case', {'case_id': 'not-mine'})
    with store.engine.connect() as db:
        assert len(db.execute(select(agent_events)).mappings().all()) == 1


def test_cache_does_not_block_application_snapshots(workspace, monkeypatch):
    import threading
    store, alice, _ = workspace
    worker = task(store, alice)
    with store.engine.begin() as db:
        db.execute(update(agent_tasks).where(agent_tasks.c.id == worker['id']).values(session_id='devin-one'))
    monkeypatch.setenv('DEVIN_API_KEY', 'configured')
    monkeypatch.setenv('DEVIN_ORG_ID', 'org-test')
    waiting, release = threading.Event(), threading.Event()
    class SlowProvider(Provider):
        def page(self, *args):
            waiting.set()
            release.wait(2)
            return super().page(*args)
    provider = SlowProvider()
    start = time.monotonic()
    snapshot = SwarmService(store, alice, provider).snapshot()
    assert time.monotonic() - start < 1
    assert snapshot['tasks'][0]['id'] == worker['id']
    assert waiting.wait(1)
    release.set()


def test_devin_proxy_uses_only_documented_get_endpoint(monkeypatch):
    from app.swarm_feed import DevinMessages
    monkeypatch.setenv('DEVIN_API_KEY', 'provider-key')
    monkeypatch.setenv('DEVIN_ORG_ID', 'org-owned')
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={'items': [], 'end_cursor': None, 'has_next_page': False})
    client_type = httpx.Client
    monkeypatch.setattr(httpx, 'Client', lambda **kwargs: client_type(transport=httpx.MockTransport(respond), **kwargs))
    result = DevinMessages().page('devin-owned', 'opaque-token', 20)
    assert result['items'] == []
    assert len(requests) == 1 and requests[0].method == 'GET'
    assert requests[0].url.host == 'api.devin.ai'
    assert requests[0].url.path == '/v3/organizations/org-owned/sessions/devin-owned/messages'
    assert requests[0].url.params['after'] == 'opaque-token'
    assert requests[0].url.params['first'] == '20'
    assert requests[0].headers['Authorization'] == 'Bearer provider-key'


def test_provider_pagination_cannot_loop_without_cursor():
    class BrokenProvider:
        def page(self, *args):
            return {'items': [], 'has_next_page': True}
    with pytest.raises(ValueError, match='pagination cursor'):
        provider_page(BrokenProvider(), 'devin-one', 'task-one', None)


def test_manual_provider_history_uses_actual_latest_tool_section(workspace):
    store, alice, _ = workspace
    worker = task(store, alice)
    with store.engine.begin() as db:
        db.execute(update(agent_tasks).where(agent_tasks.c.id == worker['id']).values(session_id='devin-evidence'))
    event(store, alice, 1, 'agent.tool.completed', {'task_id': worker['id'], 'tool': 'search_evidence'})
    event(store, alice, 2, 'agent.tool.completed', {'task_id': worker['id'], 'tool': 'get_task'})
    data = SwarmService(store, alice, Provider()).session_messages(worker['id'])
    assert data['events'][0]['section'] == 'evidence'


def test_feed_payload_budget_preserves_every_application_cursor_event(workspace, monkeypatch):
    import app.swarm_feed as feed
    store, alice, _ = workspace
    worker = task(store, alice)
    monkeypatch.setenv('DEVIN_API_KEY', 'configured')
    monkeypatch.setenv('DEVIN_ORG_ID', 'org-test')
    with store.engine.begin() as db:
        db.execute(agent_tasks.delete())
        db.execute(agent_tasks.insert(), [dict(
            id=f'task_large_{i}', organization_id=alice, case_id=worker['case_id'], request_key=f'large-{i}',
            objective='"' * 8000, result={'summary': '"' * 8000}, error='"' * 8000,
            session_id=f'devin-{i}', status='running', created_at=i, credential_expires=0, lease_until=0, next_poll_at=0
        ) for i in range(200)])
        db.execute(agent_events.insert(), [dict(
            id=f'evt_large_{i}', organization_id=alice, event_key=f'large-event-{i}', kind='task.finished',
            payload={'result': {'summary': '"' * 8000}}, acknowledged=True, created_at=i
        ) for i in range(200)])
    def cached(namespace, oid, sid, tid, section, provider):
        return {'status': 'available', 'has_more': True, 'next_cursor': '"' * 4096, 'message': None,
                'events': [dict(id=f'devin_{sid}_{i}', kind='devin.message', source='devin',
                    timestamp=i, title='Devin update', text='"' * 4000, task_id=tid, session_id=sid, section=section)
                    for i in range(200)]}
    monkeypatch.setattr(feed.message_cache, 'poll', cached)
    snapshot = SwarmService(store, alice).snapshot(limit=200, task_limit=200)
    assert len(snapshot['events']) <= 500
    assert sum(event['source'] == 'application' for event in snapshot['events']) == 200
    assert len(snapshot['provider_logs']['sessions']) <= 50
    assert len(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')).encode()) <= 1_750_000
    assert snapshot['events_truncated']
    assert '50 of 200' in snapshot['provider_logs']['message']


def test_stream_settles_to_the_slow_cadence(monkeypatch):
    """`after` was reassigned to the cursor each pass, so the "draining a reconnect backlog"
    guard was always true: any workspace reporting has_more polled at 10 Hz forever, one DB
    scan and one threadpool slot per tick, per connected client."""
    import asyncio, time, types
    from app import swarm_feed

    class Store:
        def member(self, user_id, oid): return True

    class Svc:
        def __init__(self): self.calls = 0; self.store = Store(); self.oid = 'o1'
        def snapshot(self, _a, cursor):
            self.calls += 1
            return {'cursor': 'c%d' % self.calls, 'has_more': True, 'tasks': [], 'generated_at': 0}

    class Request:
        async def is_disconnected(self): return False

    async def drive(after, seconds):
        svc = Svc()
        identity = types.SimpleNamespace(expires_at=time.time() + 9999, user_id='u1')
        stream = swarm_feed.stream_events(Request(), svc, identity, after=after)
        started = time.time()
        try:
            while time.time() - started < seconds:
                await asyncio.wait_for(stream.__anext__(), timeout=seconds)
        except (asyncio.TimeoutError, StopAsyncIteration):
            pass
        return svc.calls

    # A fresh connection has no backlog: roughly one snapshot per 2 s, never the 10 Hz path.
    assert asyncio.run(drive(None, 2.2)) <= 4
    # A reconnect may drain fast, but not forever.
    monkeypatch.setattr(swarm_feed, 'DRAIN_SECONDS', 0.4)
    assert asyncio.run(drive('seed', 2.2)) <= 12
