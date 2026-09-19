import asyncio
import json
import time
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from app import main, auth, voice, dashboard
from app.store import Store

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'store', Store(str(tmp_path/'dashboard.db')))
    monkeypatch.setattr(auth, 'verify', lambda token: auth.Identity(token, int(time.time())+300))
    monkeypatch.setenv('DEEPGRAM_API_KEY', 'test')
    with TestClient(main.app) as client:
        yield client

def headers(user='alice'):
    return {'Authorization':'Bearer '+user}

def test_persistent_private_dashboard(client):
    a = client.post('/world/agent', headers=headers()).json()['session']
    b = client.post('/world/agent', headers=headers()).json()['session']
    assert a['id'] == b['id']
    assert a['mode'] == 'dashboard'
    main.store.add_member('bob', a['organization_id'])
    assert client.get('/sessions/'+a['id'], headers=headers('bob')).status_code == 404
    assert client.post('/world/agent', headers=headers('bob')).json()['session']['id'] != a['id']
    state = main.store.get(a['id'], 'alice')
    state['transcript'] = [{'id':str(i),'role':'user','text':str(i),'sequence':i+1} for i in range(230)]
    main.store.save(state)
    restarted = Store(main.store.path)
    assert len(restarted.dashboard('alice')['transcript']) == 230
    page = client.get('/world/agent/transcript?after=200&limit=10', headers=headers()).json()
    assert page['messages'][0]['text'] == '200'
    assert page['next_after'] == 210 and page['has_more']
    snapshot = client.post('/world/agent', headers=headers()).json()['session']
    assert len(snapshot['transcript']) == 50 and snapshot['transcript_count'] == 230
    assert 'history' not in snapshot

def test_dashboard_prompt_context_and_onboarding_isolation(client):
    state = main.store.dashboard('alice')
    state['history'] = [{'type':'History','role':'user','content':'x'*1000} for _ in range(200)]
    config = voice.settings(state)
    names = {f['name'] for f in config['agent']['think']['functions']}
    assert 'update_context' not in names
    assert {'read_conversation_history','get_agent_activity','query_financials'} <= names
    assert len(json.dumps(config['agent']['context']['messages'])) < 65000
    assert 'NOT onboarding' in config['agent']['think']['prompt']
    assert 'update_context' in {f['name'] for f in voice.settings(main.store.create('alice'))['agent']['think']['functions']}

async def test_dashboard_beyond_onboarding_limit_and_readiness(client):
    state = main.store.dashboard('alice')
    state['transcript'] = [{'id':str(i),'role':'user','text':'old'} for i in range(220)]
    events = []
    async def emit(event):events.append(event)
    bridge = voice.VoiceSession(state, main.store, emit)
    assert await bridge.user_text('new question', 'new')
    assert not await bridge.user_text('new question', 'new')
    assert state['readiness']['status'] == 'not_applicable'
    assert not any(e['type']=='readiness' for e in events)
    await bridge.handle({'type':'Warning','code':'MAXIMUM_SESSION_LENGTH_APPROACHING'})
    assert events[-1]['type'] == 'connection.reconnect_required'
    result = dashboard.execute(main.store,state,'read_conversation_history',{'after':220})
    assert result['messages'][0]['id'] == 'new'
    assert not main.store.workspace('alice')['onboarding_complete']

class Provider:
    def __init__(self):self.queue=asyncio.Queue();self.sent=[]
    async def send(self, raw):
        if isinstance(raw, bytes):self.sent.append(raw);return
        msg=json.loads(raw);self.sent.append(msg)
        if msg['type']=='Settings':await self.queue.put(json.dumps({'type':'SettingsApplied'}))
        if msg['type']=='InjectUserMessage':
            await self.queue.put(json.dumps({'type':'ConversationText','role':'user','content':msg['content']}))
            await self.queue.put(json.dumps({'type':'ConversationText','role':'assistant','content':'Let me check the evidence.'}))
            await self.queue.put(b'\x00\x00')
    async def recv(self):return await self.queue.get()
    def __aiter__(self):return self
    async def __anext__(self):return await self.recv()
    async def close(self):pass

def until(ws, kind):
    for _ in range(25):
        event=ws.receive_json()
        if event['type']==kind:return event
    raise AssertionError(kind)

def test_world_text_voice_reconnect_and_exclusion(client,monkeypatch):
    providers=[]
    async def connect(*args,**kwargs):
        provider=Provider();providers.append(provider);return provider
    monkeypatch.setattr(voice,'connect',connect)
    with client.websocket_connect('/world/agent/stream') as ws:
        ws.send_json({'token':'alice'})
        sid=until(ws,'session')['session']['id']
        with client.websocket_connect('/world/agent/stream') as duplicate:
            duplicate.send_json({'token':'alice'})
            assert duplicate.receive()['code']==1008
        ws.send_json({'type':'text','id':'one','text':'What needs my attention?'})
        assert until(ws,'reply')['text']=='Let me check the evidence.'
        assert until(ws,'audio')['sample_rate']==24000
        ws.send_json({'type':'voice.start'})
        until(ws,'voice.ready')
        ws.send_bytes(b'\x00\x00')
        ws.send_json({'type':'voice.stop'})
        ws.send_json({'type':'auth.refresh','token':'alice'})
        until(ws,'auth.refreshed')
    with client.websocket_connect('/world/agent/stream') as ws:
        ws.send_json({'token':'alice'})
        snapshot=until(ws,'session')['session']
        assert snapshot['id']==sid and snapshot['transcript_count']==2
        ws.send_json({'type':'text','id':'two','text':'And yesterday?'})
        until(ws,'reply')
    history=providers[1].sent[0]['agent']['context']['messages']
    assert any(m.get('content')=='What needs my attention?' for m in history)
    assert b'\x00\x00' in providers[0].sent

async def test_dashboard_tools_cannot_complete_onboarding(client):
    state=main.store.dashboard('alice')
    events=[];sent=[]
    async def emit(event):events.append(event)
    async def send(event):sent.append(event)
    bridge=voice.VoiceSession(state,main.store,emit)
    bridge.send=send
    await bridge.tool({'id':'denied','name':'update_context','arguments':'{}'},0)
    assert json.loads(sent[-1]['content'])['error']=='Tool not available in this session'
    await bridge.tool({'id':'activity','name':'get_agent_activity','arguments':'{}'},0)
    result=events[-1]
    assert result['type']=='tool.result'
    assert result['result']['controller']['status']=='not_started'
    assert not main.store.workspace('alice')['onboarding_complete']

def test_provider_disconnect_closes_dashboard_socket(client,monkeypatch):
    class BrokenProvider(Provider):
        async def send(self,raw):
            await super().send(raw)
            if not isinstance(raw,bytes) and json.loads(raw)['type']=='InjectUserMessage':
                await self.queue.put(json.dumps({'type':'Error','code':'MAXIMUM_SESSION_LENGTH_REACHED'}))
    async def connect(*args,**kwargs):return BrokenProvider()
    monkeypatch.setattr(voice,'connect',connect)
    with client.websocket_connect('/world/agent/stream') as ws:
        ws.send_json({'token':'alice'});until(ws,'session')
        ws.send_json({'type':'text','id':'one','text':'Check status'})
        until(ws,'connection.closed')
        assert ws.receive()['code']==1012
    saved=client.get('/world/agent/transcript',headers=headers()).json()
    assert saved['messages'][0]['text']=='Check status'

def test_investigation_http_auth_isolation_and_pause(client):
    body={'request_key':'cash-drop','title':'Cash drop','objective':'Investigate cash movement'}
    assert client.post('/agents/investigations',json=body).status_code==401
    response=client.post('/agents/investigations',json=body,headers=headers())
    assert response.status_code==200
    task=response.json()
    assert task['status']=='queued'
    assert client.post('/agents/investigations',json=body,headers=headers()).json()['id']==task['id']
    assert client.get('/agents/tasks/'+task['id'],headers=headers('outsider')).status_code==404
    assert client.post('/agents/investigations',json={**body,'objective':'Different'},headers=headers()).status_code==409
    assert client.post('/agents/controller',json={'enabled':False},headers=headers()).status_code==200
    assert client.post('/agents/investigations',json={**body,'request_key':'another'},headers=headers()).status_code==409

async def test_voice_delegation_tracks_persisted_result(client):
    state=main.store.dashboard('alice');events=[]
    async def emit(event):events.append(event)
    async def send(event):pass
    bridge=voice.VoiceSession(state,main.store,emit);bridge.send=send
    call={'id':'delegate','name':'start_investigation','arguments':json.dumps({'request_key':'voice-task','title':'Review','objective':'Review evidence'})}
    await bridge.tool(call,0)
    task=events[-1]['result']
    assert task['status']=='queued'
    assert main.store.get(state['id'],'alice')['investigation_ids']==[task['id']]
    assert 'credential_hash' not in task
