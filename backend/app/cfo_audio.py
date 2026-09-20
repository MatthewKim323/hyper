"""Exact-text Deepgram speech with private claims, bounded streaming and receipts."""
import asyncio
import contextlib
import hashlib
import os
import time
import uuid
from email.message import Message
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict
from typing import Literal
from sqlalchemy import select, update, func, text as sql_text
from . import auth
from .database import insert_ignore
from .cfo_audio_tables import cfo_audio_leases as leases, cfo_audio_deliveries as deliveries

router = APIRouter(prefix='/world/cfo', tags=['CFO commentary'])
SAMPLE_RATE = 24000
MAX_SAMPLES = SAMPLE_RATE * 15
LEASE_MS = 30000
VOICE = 'aura-2-thalia-en'
GREETING = "I'm your CFO. I'll keep you up to date as your financial workflows move forward. If something needs your judgment, I'll bring you three options. You can choose one or tell me what to do."


def valid_pcm_type(content_type):
    mime = Message()
    mime['content-type'] = content_type
    if mime.get_content_type() not in ('audio/l16', 'audio/raw', 'application/octet-stream'):
        return False
    # The browser decodes only the mono 24 kHz PCM requested from the provider.
    for name, expected in (('rate', SAMPLE_RATE), ('sample_rate', SAMPLE_RATE), ('channels', 1)):
        for key, value in mime.get_params()[1:]:
            if key.lower() == name:
                try:
                    if int(value) != expected:
                        return False
                except (TypeError, ValueError):
                    return False
    return True


def now():
    return int(time.time() * 1000)


def context(identity):
    from .main import store
    try:
        org = store.workspace(identity.user_id)
    except PermissionError:
        raise HTTPException(403, 'Workspace access removed') from None
    if time.time() >= identity.expires_at:
        raise HTTPException(401, 'Login expired')
    return store, org['id']


def authorize(store, oid, identity):
    if time.time() >= identity.expires_at or not store.member(identity.user_id, oid):
        raise HTTPException(403, 'Workspace access removed')


def owns_lease(store, oid, identity, uid, token):
    authorize(store, oid, identity)
    with store.engine.connect() as db:
        valid = db.execute(select(leases.c.token).where(leases.c.organization_id == oid,
            leases.c.user_id == identity.user_id, leases.c.utterance_id == uid,
            leases.c.token == token, leases.c.expires_at > now())).scalar()
    if not valid:
        raise HTTPException(409, 'Speech playback was interrupted')


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    event_id: str = Field(min_length=1, max_length=180)
    request_id: str = Field(min_length=1, max_length=180)
    client_id: str = Field(min_length=1, max_length=180)
    replay: bool = False


class PlaybackReceipt(BaseModel):
    model_config = ConfigDict(extra='forbid')
    client_id: str = Field(min_length=1, max_length=180)
    lease_token: str = Field(min_length=1, max_length=180)
    state: Literal['completed', 'interrupted', 'failed', 'blocked']
    played_samples: int = Field(ge=0, le=MAX_SAMPLES)


def narration(store, oid, event_id):
    if event_id == 'cfo:greeting':
        return {'text': GREETING, 'textHash': hashlib.sha256(GREETING.encode()).hexdigest()}
    if event_id.startswith('concern:'):
        from .concerns import ConcernService
        from .data_service import DataService
        pieces = event_id.split(':')
        if len(pieces) != 4:
            raise HTTPException(404, 'Decision speech not found')
        try:
            svc = ConcernService(DataService(store, oid))
            concern = svc.get(pieces[1])
            cue = next((c for c in concern.get('decision_cues', []) if c['event_id'] == event_id), None)
            snapshot = svc.snapshot([ref['id'] for ref in concern.get('evidence_snapshot', [])] or concern['request']['source_ids'])
        except (LookupError, ValueError):
            raise HTTPException(404, 'Decision speech not found') from None
        if not cue or concern.get('evidence_snapshot') and snapshot != concern['evidence_snapshot']:
            raise HTTPException(409, 'These decision options changed')
        return cue
    from .workflow import get_event, relevance
    try:
        event = get_event(store.engine, oid, event_id)
    except LookupError:
        raise HTTPException(404, 'Commentary event not found') from None
    if not event or not event.get('narration'):
        raise HTTPException(404, 'Commentary event not found')
    if not relevance(store.engine, oid, event_id)['relevant']:
        raise HTTPException(409, 'This update has been superseded')
    return event['narration']


def claim(engine, oid, user_id, body, text_hash, characters):
    stamp = now()
    token, uid = uuid.uuid4().hex, 'utterance_' + uuid.uuid4().hex
    scope = (leases.c.organization_id == oid) & (leases.c.user_id == user_id)
    with engine.begin() as db:
        insert_ignore(db, leases, dict(organization_id=oid, user_id=user_id, token='', client_id='', utterance_id='', expires_at=0))
        # The user-scoped row serializes admission and remains locked until both records commit.
        lease = db.execute(select(leases).where(scope).with_for_update()).mappings().one()
        prior = db.execute(select(deliveries).where(deliveries.c.organization_id == oid,
            deliveries.c.user_id == user_id, deliveries.c.request_id == body.request_id)).mappings().first()
        if prior:
            raise HTTPException(409, 'This speech request was already admitted')
        if lease['expires_at'] > stamp:
            raise HTTPException(409, 'Another CFO utterance owns playback')
        if not body.replay and db.execute(select(deliveries.c.id).where(deliveries.c.organization_id == oid,
            deliveries.c.user_id == user_id, deliveries.c.event_id == body.event_id).limit(1)).first():
            raise HTTPException(409, 'This update was already delivered; replay must be explicit')
        if db.dialect.name == 'postgresql':
            # All users share the character budget. Keep this lock order after the user lease.
            budget_key = int.from_bytes(hashlib.sha256(('cfo-budget:' + oid).encode()).digest()[:8], 'big', signed=True)
            db.execute(sql_text('SELECT pg_advisory_xact_lock(:key)'), {'key': budget_key})
        used = db.execute(select(func.coalesce(func.sum(deliveries.c.characters), 0)).where(
            deliveries.c.organization_id == oid, deliveries.c.created_at >= stamp-60000)).scalar_one()
        if used + characters > int(os.getenv('CFO_TTS_CHARACTERS_PER_MINUTE', '6000')):
            raise HTTPException(429, 'CFO speech budget reached; captions remain available')
        expires = stamp + LEASE_MS
        db.execute(update(leases).where(scope).values(token=token, client_id=body.client_id, utterance_id=uid, expires_at=expires))
        db.execute(deliveries.insert().values(id=uid, organization_id=oid, user_id=user_id, event_id=body.event_id,
            request_id=body.request_id, client_id=body.client_id, lease_token=token, text_hash=text_hash,
            characters=characters, created_at=stamp, state='admitted', sample_count=0, played_samples=0))
    return uid, token, expires


def produced(engine, uid, sample_count, state):
    with engine.begin() as db:
        db.execute(update(deliveries).where(deliveries.c.id == uid,
            deliveries.c.state.in_(['admitted', 'streaming', 'produced'])).values(sample_count=sample_count, state=state))


def release_failed(engine, uid, token):
    with engine.begin() as db:
        db.execute(update(leases).where(leases.c.utterance_id == uid, leases.c.token == token).values(expires_at=0))
        db.execute(update(deliveries).where(deliveries.c.id == uid).values(state='failed'))


@router.get('/config')
def config(identity=Depends(auth.current_user)):
    context(identity)
    return {'audio_enabled': bool(os.getenv('DEEPGRAM_API_KEY')) and os.getenv('CFO_COMMENTARY_AUDIO_ENABLED', 'true').lower() == 'true',
            'voice': VOICE, 'sample_rate': SAMPLE_RATE,
            'greeting': {'event_id': 'cfo:greeting', 'text': GREETING, 'textHash': hashlib.sha256(GREETING.encode()).hexdigest()}}


@router.get('/decisions/{concern_id}/speech')
def decision_speech(concern_id: str, card_revision: int = Query(ge=0), identity=Depends(auth.current_user)):
    from .concerns import ConcernService
    from .data_service import DataService
    store, oid = context(identity)
    try:
        concern = ConcernService(DataService(store, oid)).get(concern_id)
    except LookupError:
        raise HTTPException(404, 'Concern not found') from None
    if concern.get('card_revision') != card_revision or not concern.get('decision_cues'):
        raise HTTPException(409, 'These decision options changed')
    for cue in concern['decision_cues']:
        narration(store, oid, cue['event_id'])
    return {'cues': concern['decision_cues'], 'cardRevision': card_revision, 'cardHash': concern['card_hash']}


@router.post('/speech')
async def speak(body: SpeechRequest, request: Request, identity=Depends(auth.current_user)):
    store, oid = await asyncio.to_thread(context, identity)
    exact = await asyncio.to_thread(narration, store, oid, body.event_id)
    text = exact['text']
    if not text or len(text) > 600:
        raise HTTPException(422, 'Speech cue exceeds the supported length')
    key = os.getenv('DEEPGRAM_API_KEY')
    if not key or os.getenv('CFO_COMMENTARY_AUDIO_ENABLED', 'true').lower() != 'true':
        raise HTTPException(503, 'CFO speech is unavailable; captions remain available')
    uid, token, expiry = await asyncio.to_thread(claim, store.engine, oid, identity.user_id, body, exact['textHash'], len(text))
    client = httpx.AsyncClient(timeout=httpx.Timeout(10, connect=5, read=5, write=5, pool=5))
    provider = None
    try:
        provider = await client.send(client.build_request('POST', 'https://api.deepgram.com/v1/speak',
            params={'model': VOICE, 'encoding': 'linear16', 'sample_rate': SAMPLE_RATE, 'container': 'none', 'mip_opt_out': 'true'},
            headers={'Authorization': 'Token ' + key}, json={'text': text}), stream=True)
        if provider.status_code != 200 or not valid_pcm_type(provider.headers.get('content-type', '')):
            raise ValueError('Speech provider unavailable')
        await asyncio.to_thread(owns_lease, store, oid, identity, uid, token)
        refreshed = await asyncio.to_thread(narration, store, oid, body.event_id)
        if refreshed['textHash'] != exact['textHash']:
            raise HTTPException(409, 'The commentary changed before playback')
    except BaseException as exc:
        if provider is not None:
            await provider.aclose()
        await client.aclose()
        await asyncio.to_thread(release_failed, store.engine, uid, token)
        if isinstance(exc, asyncio.CancelledError):
            raise
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(503, 'CFO speech is unavailable; captions remain available') from None

    async def audio():
        carry, count, finished = b'', 0, False
        try:
            async with asyncio.timeout(18):
                async for data in provider.aiter_bytes(chunk_size=4096):
                    if await request.is_disconnected():
                        return
                    await asyncio.to_thread(owns_lease, store, oid, identity, uid, token)
                    if now() >= expiry-2000:
                        raise RuntimeError('Playback lease expired')
                    merged = carry + data
                    valid = len(merged) - len(merged) % 2
                    carry = merged[valid:]
                    if not valid:
                        continue
                    count += valid // 2
                    if count > MAX_SAMPLES:
                        raise RuntimeError('Speech exceeded bounded playback')
                    await asyncio.to_thread(produced, store.engine, uid, count, 'streaming')
                    yield merged[:valid]
                if carry or count == 0:
                    raise RuntimeError('Incomplete PCM audio')
                finished = True
        finally:
            await provider.aclose()
            await client.aclose()
            # Production completion is not playback completion. Only a browser receipt or expiry releases ownership.
            with contextlib.suppress(Exception):
                await asyncio.shield(asyncio.to_thread(produced, store.engine, uid, count, 'produced' if finished else 'failed'))

    return StreamingResponse(audio(), media_type='audio/l16', headers={
        'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Utterance-Id': uid,
        'X-Text-Hash': exact['textHash'], 'X-Sample-Rate': str(SAMPLE_RATE),
        'X-Lease-Token': token, 'X-Lease-Expires-At': str(expiry), 'X-Lease-Duration-Ms': str(LEASE_MS)})


@router.post('/speech/{utterance_id}/receipt')
def receipt(utterance_id: str, body: PlaybackReceipt, identity=Depends(auth.current_user)):
    store, oid = context(identity)
    with store.engine.begin() as db:
        row = db.execute(select(deliveries).where(deliveries.c.id == utterance_id,
            deliveries.c.organization_id == oid, deliveries.c.user_id == identity.user_id).with_for_update()).mappings().first()
        if not row or row['client_id'] != body.client_id or row['lease_token'] != body.lease_token:
            raise HTTPException(404, 'Speech delivery not found')
        if body.played_samples > row['sample_count'] or (body.state == 'completed' and (row['state'] not in ('produced', 'completed') or body.played_samples != row['sample_count'])):
            raise HTTPException(409, 'Playback has not drained the produced audio')
        if row['state'] in ('completed', 'interrupted', 'blocked'):
            return {'state': row['state']}
        db.execute(update(deliveries).where(deliveries.c.id == utterance_id).values(state=body.state, played_samples=body.played_samples))
        db.execute(update(leases).where(leases.c.organization_id == oid, leases.c.user_id == identity.user_id,
            leases.c.token == body.lease_token, leases.c.utterance_id == utterance_id).values(expires_at=0))
    return {'state': body.state}
