import asyncio
import contextlib
import os
import time
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / '.env')
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, Query, Depends
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from .store import Store
from . import voice, auth, dashboard

app = FastAPI(title='Hyper Onboarding')
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in os.getenv('ALLOWED_ORIGINS','http://127.0.0.1:8000,http://localhost:8000').split(',')], allow_methods=['GET','POST'], allow_headers=['Authorization','Content-Type'])
store = Store()
active = set()

class CreateSession(BaseModel):
    demo: bool = False

class TextInput(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=16000)

    @field_validator('text')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Text must not be blank')
        return value

@app.get('/health')
def health():
    return {'status': 'ok'}

@app.get('/')
def playground():
    return FileResponse(Path(__file__).resolve().parents[1] / 'static/index.html')

@app.get('/audio-worklet.js')
def audio_worklet():
    return FileResponse(Path(__file__).resolve().parents[1] / 'static/audio-worklet.js', media_type='text/javascript')

@app.get('/auth/config')
def auth_config():
    return {'publishable_key':os.getenv('CLERK_PUBLISHABLE_KEY',''),
            'frontend_api':os.getenv('CLERK_ISSUER','')}

@app.get('/me/workspace')
def workspace(identity=Depends(auth.current_user)):
    try:
        org = store.workspace(identity.user_id)
    except PermissionError:
        raise HTTPException(403, 'Workspace access removed')
    return {'user_id':identity.user_id, 'organization':org,
            'next_step':'workspace' if org['onboarding_complete'] else 'onboarding'}

@app.post('/sessions')
def create(body: CreateSession, identity=Depends(auth.current_user)):
    try:
        return {'session':store.create(identity.user_id, body.demo)}
    except PermissionError:
        raise HTTPException(403, 'Workspace access removed')

@app.get('/sessions/{sid}')
def get(sid: str, request: Request):
    identity = auth.current_user(request)
    state = store.get(sid, identity.user_id)
    if not state:
        raise HTTPException(404)
    return state

@app.get('/sessions/{sid}/transcript', summary='Retrieve ordered voice and typed transcript segments')
def transcript(sid: str, request: Request, after: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
    state = get(sid, request)
    entries = [{**entry, 'sequence':i + 1} for i, entry in enumerate(state['transcript'])]
    page = entries[after:after + limit]
    return {'session_id':sid, 'messages':page,
            'next_after':page[-1]['sequence'] if page else after,
            'has_more':after + len(page) < len(entries)}


def dashboard_snapshot(state):
    return {**{k:v for k,v in state.items() if k not in ('history','evidence','transcript')},
            'transcript':state['transcript'][-50:], 'transcript_count':len(state['transcript']),
            'stream_url':'/world/agent/stream', 'transcript_url':'/world/agent/transcript'}


@app.post('/world/agent', tags=['world'], summary='Create or resume your persistent dashboard agent')
def dashboard_agent(identity=Depends(auth.current_user)):
    try:
        return {'session':dashboard_snapshot(store.dashboard(identity.user_id))}
    except PermissionError:
        raise HTTPException(403, 'Workspace access removed') from None


@app.get('/world/agent/transcript', tags=['world'])
def dashboard_transcript(identity=Depends(auth.current_user), after: int = Query(0, ge=0),
                         limit: int = Query(100, ge=1, le=500)):
    try:
        state = store.dashboard(identity.user_id)
    except PermissionError:
        raise HTTPException(403, 'Workspace access removed') from None
    entries = [{**entry, 'sequence':i+1} for i,entry in enumerate(state['transcript'])]
    page = entries[after:after+limit]
    return {'session_id':state['id'], 'messages':page, 'next_after':after+len(page),
            'has_more':after+len(page)<len(entries)}


@app.websocket('/world/agent/stream')
async def dashboard_stream(ws: WebSocket):
    await stream(ws, None)


@app.websocket('/sessions/{sid}/stream')
async def stream(ws: WebSocket, sid: str):
    origins = os.getenv('ALLOWED_ORIGINS', 'http://127.0.0.1:8000,http://localhost:8000').split(',')
    if ws.headers.get('origin') and ws.headers['origin'] not in origins:
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        handshake = await asyncio.wait_for(ws.receive_json(), 10)
        identity = await asyncio.to_thread(auth.verify, handshake['token'])
    except Exception:
        await ws.close(code=1008)
        return
    try:
        state = store.dashboard(identity.user_id) if sid is None else store.get(sid, identity.user_id)
    except PermissionError:
        await ws.close(code=1008)
        return
    if state:
        sid = state['id']
        if state.get('mode') == 'dashboard':
            state['context'] = store.workspace(identity.user_id)['context']
    if not state or sid in active:
        await ws.close(code=1008)
        return
    active.add(sid)
    send_lock = asyncio.Lock()
    def authorize():
        if time.time() >= identity.expires_at or not store.member(identity.user_id, state['organization_id']):
            raise PermissionError('Login expired or workspace access removed')
    async def emit(event):
        authorize()
        async with send_lock:
            await ws.send_json(event)
            if event['type'] == 'connection.closed' and state.get('mode') == 'dashboard':
                # A dead provider must not leave a seemingly live dashboard socket.
                await ws.close(code=1012, reason='Reconnect to resume saved conversation')
    bridge = voice.VoiceSession(state, store, emit, authorize)
    started = False
    microphone = False
    async def watch_auth():
        while True:
            await asyncio.sleep(1)
            if time.time() >= identity.expires_at or not store.member(identity.user_id, state['organization_id']):
                await ws.close(code=1008)
                return
    watcher = asyncio.create_task(watch_auth())
    async def watch_investigations():
        from .orchestrator import AgentService
        seen = {}
        while True:
            await asyncio.sleep(3)
            if state.get('mode') != 'dashboard':
                return
            for task_id in list(state.get('investigation_ids', [])):
                authorize()
                task = await asyncio.to_thread(AgentService(store, state['organization_id']).get_task, task_id)
                if seen.get(task_id) != task:
                    await emit({'type':'investigation.updated','task':task})
                    seen[task_id] = task
    activity_watcher = asyncio.create_task(watch_investigations())
    try:
        await emit({'type':'session','session':dashboard_snapshot(state) if state.get('mode') == 'dashboard' else state})
        await bridge.set_visual_state('idle', 'session_connected')
        while True:
            packet = await ws.receive()
            if packet['type'] == 'websocket.disconnect':
                break
            if time.time() >= identity.expires_at or not store.member(identity.user_id,state['organization_id']):
                await ws.close(code=1008)
                break
            if packet.get('bytes') is not None:
                data = packet['bytes']
                if started and microphone and len(data) <= 32000 and len(data) % 2 == 0:
                    await bridge.send(data)
                continue
            import json
            try:
                msg = json.loads(packet.get('text', '{}'))
                if not isinstance(msg, dict):
                    raise ValueError('Object required')
                kind = msg.get('type')
                if kind == 'auth.refresh':
                    refreshed = await asyncio.to_thread(auth.verify, msg.get('token',''))
                    if refreshed.user_id != identity.user_id:
                        await ws.close(code=1008)
                        break
                    identity = refreshed
                    await emit({'type':'auth.refreshed','expires_at':identity.expires_at})
                elif kind in ('text','voice.start'):
                    typed = TextInput.model_validate(msg) if kind == 'text' else None
                    if not started:
                        await bridge.start()
                        started = True
                    if kind == 'text':
                        await bridge.inject(typed.text, typed.id)
                    else:
                        microphone = True
                        bridge.microphone_enabled = True
                        await bridge.set_visual_state(bridge.resting_state(), 'microphone_enabled')
                        await emit({'type':'voice.ready'})
                elif kind == 'pointer' and state.get('mode') == 'dashboard':
                    bridge.pointer = dashboard.accept_pointer(msg)
                elif kind == 'voice.stop':
                    microphone = False
                    bridge.microphone_enabled = False
                    if bridge.visual_state == 'listening':
                        await bridge.set_visual_state(bridge.resting_state(), 'microphone_disabled')
                else:
                    raise ValueError('Unknown message type')
            except HTTPException:
                await ws.close(code=1008)
                break
            except (ValueError, KeyError, TypeError):
                await emit({'type':'error','message':'Invalid message or session limit reached.'})
            except Exception:
                await bridge.set_visual_state('error', 'provider_unavailable')
                await emit({'type':'error','message':'Deepgram unavailable. Reconnect to retry; voice and text both use the managed agent.'})
    except WebSocketDisconnect:
        pass
    except Exception:
        with contextlib.suppress(Exception):
            await emit({'type':'error','message':'Connection failed. Reconnect to resume saved history.'})
    finally:
        activity_watcher.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await activity_watcher
        watcher.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await watcher
        await bridge.close()
        active.discard(sid)


from .data_api import router as data_router
app.include_router(data_router)
from .simulator_api import router as simulator_router
app.include_router(simulator_router)
from .connectors.api import router as connector_router
app.include_router(connector_router)

# Connector request bodies can contain provider credentials. Do not echo validation inputs.
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse

@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    if request.url.path.startswith('/connections'):
        return JSONResponse(status_code=422, content={'detail': [
            {'loc': list(e['loc']), 'msg': e['msg'], 'type': e['type']} for e in exc.errors()]})
    return await request_validation_exception_handler(request, exc)

from .concern_api import router as concern_router
app.include_router(concern_router)

from .artifact_api import router as artifact_router
app.include_router(artifact_router)

from .orchestrator_api import router as orchestrator_router
app.include_router(orchestrator_router)

from .elastic_api import router as elastic_router
app.include_router(elastic_router)

from .accounting_api import router as accounting_router
app.include_router(accounting_router)

from .settlement_api import router as settlement_router
app.include_router(settlement_router)

from .accrual_api import router as accrual_router
app.include_router(accrual_router)

from .skills_api import router as skills_router
app.include_router(skills_router)

from .counterparty_api import router as counterparty_router
app.include_router(counterparty_router)

from .graph_api import router as graph_router
app.include_router(graph_router)
