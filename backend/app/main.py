import asyncio
import contextlib
import os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / '.env')
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from .store import Store
from . import voice

app = FastAPI(title='Hyper Onboarding')
store = Store(os.getenv('DATABASE_PATH', 'var/onboarding.sqlite'))
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

@app.post('/sessions')
def create(body: CreateSession):
    state, token = store.create(body.demo)
    return {'session': state, 'token': token}

@app.get('/sessions/{sid}')
def get(sid: str, request: Request):
    state = store.get(sid, request.headers.get('authorization', '').removeprefix('Bearer '))
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


@app.websocket('/sessions/{sid}/stream')
async def stream(ws: WebSocket, sid: str):
    origins = os.getenv('ALLOWED_ORIGINS', 'http://127.0.0.1:8000,http://localhost:8000').split(',')
    if ws.headers.get('origin') and ws.headers['origin'] not in origins:
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        auth = await asyncio.wait_for(ws.receive_json(), 10)
    except Exception:
        await ws.close(code=1008)
        return
    state = store.get(sid, str(auth.get('token', ''))) if isinstance(auth, dict) else None
    if not state or sid in active:
        await ws.close(code=1008)
        return
    active.add(sid)
    send_lock = asyncio.Lock()
    async def emit(event):
        async with send_lock:
            await ws.send_json(event)
    bridge = voice.VoiceSession(state, store, emit)
    started = False
    microphone = False
    try:
        await emit({'type':'session','session':state})
        await bridge.set_visual_state('idle', 'session_connected')
        while True:
            packet = await ws.receive()
            if packet['type'] == 'websocket.disconnect':
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
                if kind in ('text','voice.start'):
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
                elif kind == 'voice.stop':
                    microphone = False
                    bridge.microphone_enabled = False
                    if bridge.visual_state == 'listening':
                        await bridge.set_visual_state(bridge.resting_state(), 'microphone_disabled')
                else:
                    raise ValueError('Unknown message type')
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
        await bridge.close()
        active.discard(sid)
