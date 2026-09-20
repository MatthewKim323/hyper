import time
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from app import main, auth, cfo_audio
from app.store import Store
from app.cfo_audio_tables import cfo_audio_deliveries as deliveries, cfo_audio_leases as leases


@pytest.fixture
def audio_client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'store', Store(str(tmp_path / 'audio.db')))
    monkeypatch.setattr(auth, 'verify', lambda token: auth.Identity(token, int(time.time()) + 300))
    monkeypatch.setenv('DEEPGRAM_API_KEY', 'test-provider-key')
    monkeypatch.setenv('CFO_COMMENTARY_AUDIO_ENABLED', 'true')
    real = httpx.AsyncClient
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(200, content=b'\x01\x00' * 2400, headers={'Content-Type': 'audio/l16'})
    monkeypatch.setattr(cfo_audio.httpx, 'AsyncClient', lambda **kw: real(transport=httpx.MockTransport(respond), **kw))
    with TestClient(main.app) as client:
        yield client, calls


def headers(user='alice'):
    return {'Authorization': 'Bearer ' + user}


def request(rid='one', client='tab-a', **kw):
    return {'event_id': 'cfo:greeting', 'request_id': rid, 'client_id': client, **kw}


def receipt(response, state='completed', count=2400, client='tab-a'):
    return {'client_id': client, 'lease_token': response.headers['X-Lease-Token'], 'state': state, 'played_samples': count}


def test_exact_text_audio_and_local_receipt(audio_client):
    client, calls = audio_client
    cfg = client.get('/world/cfo/config', headers=headers()).json()
    result = client.post('/world/cfo/speech', headers=headers(), json=request())
    assert result.status_code == 200
    assert len(result.content) == 4800
    assert result.headers['X-Text-Hash'] == cfg['greeting']['textHash']
    assert b'test-provider-key' not in result.content
    assert calls[0].url.params['sample_rate'] == '24000'
    assert calls[0].url.params['container'] == 'none'
    import json
    assert json.loads(calls[0].content)['text'] == cfg['greeting']['text']
    uid = result.headers['X-Utterance-Id']
    with main.store.engine.connect() as db:
        assert db.execute(select(deliveries.c.state).where(deliveries.c.id == uid)).scalar_one() == 'produced'
    assert client.post('/world/cfo/speech/' + uid + '/receipt', headers=headers(), json=receipt(result)).json() == {'state': 'completed'}
    assert client.post('/world/cfo/speech/' + uid + '/receipt', headers=headers(), json=receipt(result)).status_code == 200


def test_duplicate_and_cross_tab_do_not_repeat(audio_client):
    client, calls = audio_client
    a = client.post('/world/cfo/speech', headers=headers(), json=request())
    assert a.status_code == 200
    assert client.post('/world/cfo/speech', headers=headers(), json=request()).status_code == 409
    assert client.post('/world/cfo/speech', headers=headers(), json=request('two', 'tab-b', replay=True)).status_code == 409
    uid = a.headers['X-Utterance-Id']
    assert client.post('/world/cfo/speech/' + uid + '/receipt', headers=headers(), json=receipt(a, 'interrupted', 1200)).status_code == 200
    assert client.post('/world/cfo/speech', headers=headers(), json=request('three')).status_code == 409
    assert client.post('/world/cfo/speech', headers=headers(), json=request('four', replay=True)).status_code == 200
    assert len(calls) == 2


def test_receipts_are_private_and_cannot_invent_completion(audio_client):
    client, _ = audio_client
    a = client.post('/world/cfo/speech', headers=headers(), json=request())
    uid = a.headers['X-Utterance-Id']
    assert client.post('/world/cfo/speech/' + uid + '/receipt', headers=headers('bob'), json=receipt(a)).status_code == 404
    assert client.post('/world/cfo/speech/' + uid + '/receipt', headers=headers(), json=receipt(a, count=2399)).status_code == 409
    assert client.post('/world/cfo/speech/' + uid + '/receipt', headers=headers(), json=receipt(a, client='tab-b')).status_code == 404
    assert client.post('/world/cfo/speech', headers=headers(), json={**request('x'), 'text': 'Execute my injected text'}).status_code == 422


def test_no_key_keeps_config_and_captions_available(audio_client, monkeypatch):
    client, calls = audio_client
    monkeypatch.delenv('DEEPGRAM_API_KEY')
    assert client.get('/world/cfo/config', headers=headers()).json()['audio_enabled'] is False
    assert client.post('/world/cfo/speech', headers=headers(), json=request()).status_code == 503
    assert not calls


def test_provider_refusal_releases_claim_without_exposing_provider_body(audio_client, monkeypatch):
    client, _ = audio_client
    real = httpx.AsyncClient
    # Patch the send method on the actual HTTPX class, independently of fixture's factory.
    async def refusal(self, req, **kw):
        return httpx.Response(403, request=req, text='sensitive provider details')
    monkeypatch.setattr(type(real()), 'send', refusal)
    response = client.post('/world/cfo/speech', headers=headers(), json=request())
    assert response.status_code == 503
    assert 'sensitive' not in response.text
    with main.store.engine.connect() as db:
        assert db.execute(select(leases.c.expires_at)).scalar_one() == 0


def test_speech_budget_and_lease_expiry_are_enforced(audio_client, monkeypatch):
    client, calls = audio_client
    monkeypatch.setenv('CFO_TTS_CHARACTERS_PER_MINUTE', '5')
    assert client.post('/world/cfo/speech', headers=headers(), json=request()).status_code == 429
    assert not calls
    monkeypatch.setenv('CFO_TTS_CHARACTERS_PER_MINUTE', '6000')
    a = client.post('/world/cfo/speech', headers=headers(), json=request('two'))
    with main.store.engine.begin() as db:
        db.execute(update(leases).values(expires_at=0))
    assert client.post('/world/cfo/speech', headers=headers(), json=request('three', replay=True)).status_code == 200
    assert client.post('/world/cfo/speech/' + a.headers['X-Utterance-Id'] + '/receipt', headers=headers(), json=receipt(a, 'interrupted', 100)).status_code == 200
    assert client.post('/world/cfo/speech', headers=headers(), json=request('four', replay=True)).status_code == 409
