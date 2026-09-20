"""Provider failures and concurrent playback must preserve scope and ownership."""
import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from httpx import AsyncClient as RealAsyncClient
from sqlalchemy import delete, event, func, select
from app import auth, cfo_audio, main, workflow
from app.cfo_audio_tables import cfo_audio_deliveries as deliveries, cfo_audio_leases as leases
from app.database import memberships
from test_cfo_audio import audio_client, headers, request
from test_workflow import postgres_journal


def transport(monkeypatch, handler):
    monkeypatch.setattr(cfo_audio.httpx, 'AsyncClient', lambda **kw:
                        RealAsyncClient(transport=httpx.MockTransport(handler), **kw))


def test_interrupted_lease_rejects_late_pcm_and_preserves_new_owner(audio_client, monkeypatch):
    class Chunks(httpx.AsyncByteStream):
        closed = False
        async def __aiter__(self):
            yield b'\x01\x00' * 2048
            yield b'\x02\x00' * 2048
        async def aclose(self):
            self.closed = True
    chunks = Chunks()
    transport(monkeypatch, lambda req: httpx.Response(200, stream=chunks, headers={'Content-Type': 'audio/l16'}))
    identity = auth.Identity('alice', int(time.time()) + 300)
    async def disconnected():
        return False
    async def exercise():
        response = await cfo_audio.speak(cfo_audio.SpeechRequest(**request()),
                                         SimpleNamespace(is_disconnected=disconnected), identity)
        first = await anext(response.body_iterator)
        assert len(first) == 4096
        uid, token = response.headers['X-Utterance-Id'], response.headers['X-Lease-Token']
        cfo_audio.receipt(uid, cfo_audio.PlaybackReceipt(client_id='tab-a', lease_token=token,
                          state='interrupted', played_samples=2048), identity)
        oid = main.store.workspace('alice')['id']
        next_uid, next_token, _ = cfo_audio.claim(main.store.engine, oid, 'alice',
            cfo_audio.SpeechRequest(**request('second', 'tab-b', replay=True)), 'hash', 10)
        with pytest.raises(HTTPException) as stopped:
            await anext(response.body_iterator)
        assert stopped.value.status_code == 409
        with main.store.engine.connect() as db:
            owner = db.execute(select(leases).where(leases.c.organization_id == oid)).mappings().one()
            assert owner['utterance_id'] == next_uid and owner['token'] == next_token
            assert owner['expires_at'] > cfo_audio.now()
            old = db.execute(select(deliveries).where(deliveries.c.id == uid)).mappings().one()
            assert old['state'] == 'interrupted' and old['sample_count'] == 2048
        assert chunks.closed
    asyncio.run(exercise())


def test_changed_workflow_while_waiting_for_headers_returns_no_pcm(audio_client, monkeypatch):
    client, _ = audio_client
    oid = main.store.workspace('alice')['id']
    with main.store.engine.begin() as db:
        prior = workflow.emit(db, oid, 'before', 'work.started', workflow_id='invoice:1', facts={'invoiceId': 'INV-1'})
    def superseded(req):
        with main.store.engine.begin() as db:
            workflow.emit(db, oid, 'after', 'work.completed', workflow_id='invoice:1', facts={'invoiceId': 'INV-1'})
        return httpx.Response(200, content=b'\x01\x00' * 50, headers={'Content-Type': 'audio/l16'})
    transport(monkeypatch, superseded)
    response = client.post('/world/cfo/speech', headers=headers(), json={**request(), 'event_id': prior['id']})
    assert response.status_code == 409
    assert response.headers['content-type'].startswith('application/json')
    with main.store.engine.connect() as db:
        assert db.execute(select(deliveries.c.sample_count)).scalar_one() == 0
        assert db.execute(select(leases.c.expires_at)).scalar_one() == 0


def test_membership_revoked_during_headers_returns_no_pcm(audio_client, monkeypatch):
    client, _ = audio_client
    def revoked(req):
        with main.store.engine.begin() as db:
            db.execute(delete(memberships).where(memberships.c.user_id == 'alice'))
        return httpx.Response(200, content=b'\x01\x00' * 50, headers={'Content-Type': 'audio/l16'})
    transport(monkeypatch, revoked)
    response = client.post('/world/cfo/speech', headers=headers(), json=request())
    assert response.status_code == 403
    with main.store.engine.connect() as db:
        assert db.execute(select(deliveries.c.sample_count)).scalar_one() == 0


@pytest.mark.parametrize('mime', ['audio/l16;rate=16000', 'audio/l16;channels=2',
                                   'audio/l16;rate=invalid', 'audio/l16;channels=0'])
def test_contradictory_pcm_parameters_are_rejected(audio_client, monkeypatch, mime):
    client, _ = audio_client
    transport(monkeypatch, lambda req: httpx.Response(200, content=b'\x01\x00' * 50,
                                                   headers={'Content-Type': mime}))
    response = client.post('/world/cfo/speech', headers=headers(), json=request())
    assert response.status_code == 503
    with main.store.engine.connect() as db:
        assert db.execute(select(deliveries.c.state)).scalar_one() == 'failed'
        assert db.execute(select(leases.c.expires_at)).scalar_one() == 0


def test_matching_pcm_parameters_are_accepted(audio_client, monkeypatch):
    client, _ = audio_client
    transport(monkeypatch, lambda req: httpx.Response(200, content=b'\x01\x00' * 50,
                        headers={'Content-Type': 'audio/l16; rate=24000; channels=1'}))
    response = client.post('/world/cfo/speech', headers=headers(), json=request())
    assert response.status_code == 200 and len(response.content) == 100
    assert response.headers['X-Sample-Rate'] == '24000'


def test_postgres_workspace_budget_serializes_different_users(postgres_journal, monkeypatch):
    engine, _ = postgres_journal
    monkeypatch.setenv('CFO_TTS_CHARACTERS_PER_MINUTE', '100')
    leases.create(engine)
    deliveries.create(engine)
    inserting, contender, release = threading.Event(), threading.Event(), threading.Event()
    counter_lock = threading.Lock()
    budget_checks = 0
    def pause_first_insert(conn, cursor, statement, parameters, context, executemany):
        nonlocal budget_checks
        if 'pg_advisory_xact_lock' in statement:
            with counter_lock:
                budget_checks += 1
                if budget_checks == 2:
                    contender.set()
        if statement.startswith('INSERT INTO') and 'cfo_audio_deliveries' in statement and not inserting.is_set():
            inserting.set()
            assert release.wait(5)
    event.listen(engine, 'before_cursor_execute', pause_first_insert)
    def admit(user):
        try:
            return cfo_audio.claim(engine, 'test-org', user,
                cfo_audio.SpeechRequest(**request(user, user)), 'hash', 60)
        except HTTPException as exc:
            return exc.status_code
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(admit, 'alice')
            try:
                assert inserting.wait(5)
                second = pool.submit(admit, 'bob')
                assert contender.wait(5)
                assert not second.done(), 'the second user must wait for the workspace budget transaction'
            finally:
                release.set()
            assert isinstance(first.result(timeout=5), tuple)
            assert second.result(timeout=5) == 429
        with engine.connect() as db:
            assert db.execute(select(func.sum(deliveries.c.characters))).scalar_one() == 60
    finally:
        event.remove(engine, 'before_cursor_execute', pause_first_insert)
        deliveries.drop(engine)
        leases.drop(engine)
