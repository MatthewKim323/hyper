import asyncio
import json
import pytest
from fastapi.testclient import TestClient
from app import main, agent, voice, auth
import time
import uuid
from fastapi import HTTPException
from app.store import Store

async def test_evaluator_fails_closed(monkeypatch):
    monkeypatch.setenv('EVALUATOR_URL','http://127.0.0.1:1')
    result=await agent.evaluate({'transcript':[],'context':{},'revision':1})
    assert result['status']=='unavailable'

async def test_jev_cannot_override_missing_scope(monkeypatch):
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,*args,**kwargs):
            import httpx
            return httpx.Response(200,json={'ready':True},request=httpx.Request('POST','http://local'))
    monkeypatch.setattr(agent.httpx,'AsyncClient',Client)
    result=await agent.evaluate({'transcript':[],'context':{},'revision':1})
    assert result['status']=='collecting'

async def test_full_transcript_sent_to_jev(monkeypatch):
    captured={}
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,*args,**kwargs):
            captured.update(kwargs['json'])
            import httpx
            return httpx.Response(200,json={'ready':False},request=httpx.Request('POST','http://local'))
    monkeypatch.setattr(agent.httpx,'AsyncClient',Client)
    history=[{'id':str(i),'role':'user','text':f'fact {i}'} for i in range(100)]
    await agent.evaluate({'transcript':history,'context':{},'revision':100})
    assert captured['transcript']==history

BRIEF = {'company':'Meridian','objective':'Review invoices','scope':'Friday batch','success_criteria':'Supported payables','next_action':'Inspect records'}

class FakeDeepgram:
    def __init__(self):
        self.queue = asyncio.Queue()
        self.sent = []
        self.closed = False
    async def send(self, raw):
        if isinstance(raw, bytes):
            self.sent.append(raw)
            return
        msg = json.loads(raw)
        self.sent.append(msg)
        if msg['type'] == 'Settings':
            await self.queue.put(json.dumps({'type':'Welcome'}))
            await self.queue.put(json.dumps({'type':'SettingsApplied'}))
        elif msg['type'] == 'InjectUserMessage':
            await self.queue.put(json.dumps({'type':'ConversationText','role':'user','content':msg['content']}))
            await self.queue.put(json.dumps({'type':'FunctionCallRequest','functions':[{'id':'call-'+str(len(self.sent)), 'name':'update_context','client_side':True,'arguments':json.dumps(BRIEF)}]}))
        elif msg['type'] == 'FunctionCallResponse':
            await self.queue.put(json.dumps({'type':'ConversationText','role':'assistant','content':'I have the scoped brief.'}))
            await self.queue.put(b'\x00\x00')
    async def recv(self):
        return await self.queue.get()
    def __aiter__(self):return self
    async def __anext__(self):return await self.recv()
    async def close(self):self.closed=True

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main,'store',Store(str(tmp_path/'state.db')))
    monkeypatch.setenv('DEEPGRAM_API_KEY','test-key')
    def verify(token):
        if not token.startswith('test-'): raise HTTPException(401)
        return auth.Identity(token, int(time.time())+300)
    monkeypatch.setattr(auth,'verify',verify)
    async def connect(*args,**kwargs):return FakeDeepgram()
    monkeypatch.setattr(voice,'connect',connect)
    async def evaluate(state):return {'status':'ready','revision':state['revision'],'authority':'read_only_investigation'}
    monkeypatch.setattr(agent,'evaluate',evaluate)
    with TestClient(main.app) as c:yield c

def create(client):
    token='test-'+uuid.uuid4().hex
    result=client.post('/sessions',json={'demo':True},headers={'Authorization':'Bearer '+token}).json()
    return {**result,'token':token}

def receive_until(ws,kind):
    for _ in range(30):
        event=ws.receive_json()
        if event['type']==kind:return event
    raise AssertionError(kind)

def test_auth_and_isolation(client):
    a,b=create(client),create(client)
    url=f"/sessions/{a['session']['id']}"
    assert client.get(url,headers={'Authorization':'Bearer '+b['token']}).status_code==404
    assert client.get(url,headers={'Authorization':'Bearer '+a['token']}).status_code==200
    with client.websocket_connect(url+'/stream') as ws:
        ws.send_json({'token':'bad'})
        assert ws.receive()['code']==1008

def test_managed_turn_resume_and_dedup(client):
    a=create(client);url=f"/sessions/{a['session']['id']}"
    with client.websocket_connect(url+'/stream') as ws:
        ws.send_json({'token':a['token']});receive_until(ws,'session')
        ws.send_json({'type':'text','text':'Review Friday invoices','id':'one'})
        assert receive_until(ws,'reply')['text']=='I have the scoped brief.'
        assert receive_until(ws,'audio')['sample_rate']==24000
        ws.send_json({'type':'text','text':'Review Friday invoices','id':'one'})
        ws.send_json({'type':'text','text':'Actually Monday','id':'two'})
        assert receive_until(ws,'transcript')['id']=='two'
        receive_until(ws,'reply')
    state=client.get(url,headers={'Authorization':'Bearer '+a['token']}).json()
    assert state['revision']==2
    assert len([t for t in state['transcript'] if t['role']=='user'])==2
    assert state['context']['company']=='Meridian'
    assert state['readiness']['status']=='ready'
    assert any('function_calls' in h for h in state['history'])
    with client.websocket_connect(url+'/stream') as ws:
        ws.send_json({'token':a['token']})
        assert receive_until(ws,'session')['session']['transcript']==state['transcript']

def test_origin_rejected(client):
    from starlette.websockets import WebSocketDisconnect
    a=create(client)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/sessions/{a['session']['id']}/stream",headers={'origin':'https://evil.example'}):pass

def test_static_console(client):
    assert client.get('/').status_code==200
    assert 'registerProcessor' in client.get('/audio-worklet.js').text

def test_second_socket_cannot_take_session(client):
    a=create(client);url=f"/sessions/{a['session']['id']}/stream"
    with client.websocket_connect(url) as first:
        first.send_json({'token':a['token']});receive_until(first,'session')
        with client.websocket_connect(url) as second:
            second.send_json({'token':a['token']});assert second.receive()['code']==1008

def test_missing_key_is_visible(client,monkeypatch):
    monkeypatch.delenv('DEEPGRAM_API_KEY')
    a=create(client)
    with client.websocket_connect(f"/sessions/{a['session']['id']}/stream") as ws:
        ws.send_json({'token':a['token']});receive_until(ws,'session')
        ws.send_json({'type':'voice.start'})
        assert 'Deepgram unavailable' in receive_until(ws,'error')['message']

def bridge(tmp_path):
    store=Store(str(tmp_path/'unit.db'));state=store.create('unit-user',True);events=[]
    async def emit(event):events.append(event)
    session=voice.VoiceSession(state,store,emit)
    session.socket=FakeDeepgram()
    return session,events

async def test_settings_restores_history_and_managed_default(tmp_path,monkeypatch):
    monkeypatch.delenv('DEEPGRAM_THINK_MODEL',raising=False)
    s,_=bridge(tmp_path)
    await s.user_text('Review payables','one')
    cfg=voice.settings(s.state)
    assert cfg['agent']['think']['provider']=={'type':'open_ai','model':'gpt-4o-mini'}
    assert cfg['agent']['context']['messages'][0]['content']=='Review payables'
    assert all(f['defer_until_eot'] for f in cfg['agent']['think']['functions'])
    assert cfg['audio']['input']['sample_rate']==16000
    assert cfg['mip_opt_out'] is True

def test_settings_preserves_explicit_managed_provider_override(tmp_path,monkeypatch):
    monkeypatch.setenv('DEEPGRAM_THINK_PROVIDER','anthropic')
    monkeypatch.setenv('DEEPGRAM_THINK_MODEL','claude-haiku-4-5')
    s,_=bridge(tmp_path)
    think=voice.settings(s.state)['agent']['think']
    assert think['provider']=={'type':'anthropic','model':'claude-haiku-4-5'}
    assert 'endpoint' not in think

def test_new_conversation_has_provider_greeting_without_injected_history(tmp_path):
    s,_=bridge(tmp_path)
    before=json.dumps(s.state,sort_keys=True)
    cfg=voice.settings(s.state)
    assert cfg['agent']['greeting']=='Hi, I’m Hyper. Let’s get to know you. What would you like help with?'
    assert cfg['agent']['context']['messages']==[]
    assert json.dumps(s.state,sort_keys=True)==before
    assert s.socket.sent==[]

@pytest.mark.parametrize('saved_field',['transcript','history'])
def test_resumed_conversation_does_not_repeat_greeting(tmp_path,saved_field):
    s,_=bridge(tmp_path)
    s.state[saved_field]=[{'role':'assistant','text':'Saved introduction','content':'Saved introduction'}]
    assert 'greeting' not in voice.settings(s.state)['agent']

async def test_interrupt_cancels_readiness_before_commit(tmp_path,monkeypatch):
    s,events=bridge(tmp_path);entered=asyncio.Event()
    async def slow(state):
        entered.set();await asyncio.sleep(10)
        return {'status':'ready'}
    monkeypatch.setattr(agent,'evaluate',slow)
    await s.handle({'type':'FunctionCallRequest','functions':[{'id':'c1','name':'update_context','arguments':json.dumps(BRIEF),'client_side':True}]})
    await asyncio.wait_for(entered.wait(),1)
    task=s.tasks['c1']
    await s.handle({'type':'UserStartedSpeaking'})
    with pytest.raises(asyncio.CancelledError):await task
    assert s.state['context']=={}
    assert s.state['readiness']['status']=='collecting'
    assert not s.socket.sent
    assert any(e['type']=='interrupt' for e in events)

async def test_provider_cancels_tool_without_response(tmp_path,monkeypatch):
    s,_=bridge(tmp_path);entered=asyncio.Event()
    async def slow(state):entered.set();await asyncio.sleep(10)
    monkeypatch.setattr(agent,'evaluate',slow)
    await s.handle({'type':'FunctionCallRequest','functions':[{'id':'c1','name':'update_context','arguments':json.dumps(BRIEF)}]})
    await asyncio.wait_for(entered.wait(),1);task=s.tasks['c1']
    await s.handle({'type':'FunctionCallCancelled','functions':[{'id':'c1','name':'update_context'}]})
    with pytest.raises(asyncio.CancelledError):await task
    assert not s.socket.sent

async def test_legacy_file_search_not_available(tmp_path):
    s,_=bridge(tmp_path);s.state['demo']=False
    await s.tool({'id':'c1','name':'search_records','arguments':'{"query":"invoice"}'},s.generation)
    assert 'not available' in s.socket.sent[0]['content']

async def test_malformed_tool_returns_error(tmp_path):
    s,_=bridge(tmp_path)
    await s.tool({'id':'bad','name':'update_context','arguments':'not json'},s.generation)
    assert s.socket.sent[0]['type']=='FunctionCallResponse'
    assert 'Invalid tool arguments' in s.socket.sent[0]['content']

async def test_streamed_transcript_includes_both_roles_and_segments(tmp_path):
    s,events=bridge(tmp_path)
    await s.inject('Review payables','typed-1')
    await s.handle({'type':'ConversationText','role':'user','content':'Review payables'})
    await s.handle({'type':'ConversationText','role':'assistant','content':'I will inspect the invoices.'})
    await s.handle({'type':'ConversationText','role':'assistant','content':'Which deadline applies?'})
    await s.handle({'type':'ConversationText','role':'user','content':'Friday.'})
    transcripts=[e for e in events if e['type']=='transcript']
    assert [e['role'] for e in transcripts]==['user','assistant','assistant','user']
    assert [e['sequence'] for e in transcripts]==[1,2,3,4]
    assert [e['source'] for e in transcripts]==['text','agent','agent','voice']
    assert all(e['created_at'] and e['final'] for e in transcripts)
    assert len({e['id'] for e in transcripts})==4
    assert s.socket.sent[0]=={'type':'InjectUserMessage','content':'Review payables'}
    assert [e['id'] for e in events if e['type']=='reply']==[transcripts[1]['id'],transcripts[2]['id']]


def test_transcript_api_pagination_and_auth(client):
    a=create(client);sid=a['session']['id'];headers={'Authorization':'Bearer '+a['token']}
    with client.websocket_connect(f'/sessions/{sid}/stream') as ws:
        ws.send_json({'token':a['token']});receive_until(ws,'session')
        ws.send_json({'type':'text','id':'first','text':'Review Friday invoices'})
        user=receive_until(ws,'transcript');assistant=receive_until(ws,'transcript')
        assert user['role']=='user' and assistant['role']=='assistant'
    first=client.get(f'/sessions/{sid}/transcript?limit=1',headers=headers).json()
    assert first['messages'][0]['id']=='first' and first['has_more']
    second=client.get(f'/sessions/{sid}/transcript?after=1',headers=headers).json()
    assert second['messages'][0]['id']==assistant['id'] and not second['has_more']
    assert client.get(f'/sessions/{sid}/transcript').status_code==401
    assert client.get(f'/sessions/{sid}/transcript?after=-1',headers=headers).status_code==422


def test_invalid_text_does_not_start_provider(client,monkeypatch):
    async def forbidden(*args,**kwargs):raise AssertionError('Must validate before connecting')
    monkeypatch.setattr(voice,'connect',forbidden)
    a=create(client)
    with client.websocket_connect(f"/sessions/{a['session']['id']}/stream") as ws:
        ws.send_json({'token':a['token']});receive_until(ws,'session')
        for text,mid in [('   ','a'),('valid',''),('x'*16001,'b')]:
            ws.send_json({'type':'text','id':mid,'text':text})
            assert 'Invalid message' in receive_until(ws,'error')['message']

async def test_orb_state_tracks_runtime_not_model_claims(tmp_path):
    s,events=bridge(tmp_path)
    await s.handle({'type':'UserStartedSpeaking'})
    await s.handle({'type':'ConversationText','role':'user','content':'Review invoices'})
    await s.handle({'type':'AgentThinking'})
    await s.handle({'type':'ConversationText','role':'assistant','content':'We are ready!'})
    states=[e['state'] for e in events if e['type']=='agent.state']
    assert states==['listening','thinking']
    assert 'ready' not in states

async def test_audio_done_preserves_playback_boundary(tmp_path):
    s,events=bridge(tmp_path)
    s.microphone_enabled=True
    await s.set_visual_state('speaking','provider_audio')
    await s.handle({'type':'AgentAudioDone'})
    done=next(e for e in events if e['type']=='audio.done')
    assert done['next_state']=='listening'
    assert events[-1]['state']=='listening'
    assert done['generation']==s.generation

async def test_search_drives_researching_state(tmp_path,monkeypatch):
    s,events=bridge(tmp_path)
    monkeypatch.setattr(voice.data_tools,'execute',lambda *args:{'hits':[]})
    await s.tool({'id':'research','name':'search_evidence','arguments':'{"query":"invoice"}'},s.generation)
    assert any(e.get('state')=='researching' for e in events)

def test_workspace_api_resume_and_refresh(client):
    a=create(client);headers={'Authorization':'Bearer '+a['token']}
    workspace=client.get('/me/workspace',headers=headers).json()
    assert workspace['organization']['latest_session_id']==a['session']['id']
    assert workspace['next_step']=='onboarding'
    assert client.post('/sessions',json={}).status_code==401
    with client.websocket_connect(f"/sessions/{a['session']['id']}/stream") as ws:
        ws.send_json({'token':a['token']});receive_until(ws,'session')
        ws.send_json({'type':'auth.refresh','token':a['token']})
        assert receive_until(ws,'auth.refreshed')['expires_at']>time.time()
        ws.send_json({'type':'auth.refresh','token':'test-other-user'})
        assert ws.receive()['code']==1008

async def test_revoked_access_blocks_context_commit(tmp_path,monkeypatch):
    s,_=bridge(tmp_path)
    async def evaluate(state):return {'status':'ready'}
    monkeypatch.setattr(agent,'evaluate',evaluate)
    def denied():raise PermissionError()
    s.authorize=denied
    with pytest.raises(PermissionError):
        await s.tool({'id':'revoked','name':'update_context','arguments':json.dumps(BRIEF)},s.generation)
    assert not s.store.workspace('unit-user')['onboarding_complete']


def test_prompt_collects_the_context_that_survives_to_the_workspace_agent():
    """Onboarding hands off to the workspace agent; it does not do financial work. Only
    `company` and `facts` are copied into a later session (store.py), so the interview has to
    spend itself on those. The prompt used to interview toward scoping a first task, which is
    the workspace agent's job and does not persist."""
    import inspect
    from app import store
    from app.voice import PROMPT
    from app.agent import Brief
    from app import dashboard

    prompt = PROMPT.lower()
    # The durable payload, asserted against the code that copies it rather than a literal.
    carried = inspect.getsource(store.Store)
    assert "('company','facts')" in carried.replace(' ', ''), 'store no longer carries company+facts'
    for field in ('company', 'facts'):
        assert field in prompt, field
        assert field in Brief.model_fields

    # The handoff has to be stated up front, or the agent has no reason to record for a
    # reader other than itself. Check the opening paragraph, not merely a mention anywhere.
    opening = prompt.split('what you are collecting')[0]
    assert 'takes over' in opening and 'workspace' in opening, opening[:200]
    # It must not interview toward a first task: that is the workspace agent's job, and
    # objective/scope/success_criteria/next_action are dropped when the session ends.
    assert 'do not interview toward one' in prompt
    # And the division of labour must match what the workspace agent believes.
    assert 'not onboarding' in dashboard.PROMPT.lower()

    # Authority is unchanged by any of this.
    assert 'read-only' in prompt
    assert 'never permission to send messages, post entries' in prompt
