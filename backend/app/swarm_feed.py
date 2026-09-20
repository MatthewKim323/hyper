"""Read-only CFO activity view. Provider messages are data, never executable markup."""
import asyncio
import base64
import hashlib
import json
import os
import re
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, or_, select
from starlette.concurrency import run_in_threadpool

from . import auth
from .database import agent_cases, agent_controllers, agent_events, agent_tasks

router = APIRouter(prefix='/agents/swarm', tags=['agents'])
# How long a reconnect may poll at the fast cadence before settling to the normal one.
DRAIN_SECONDS = 10
SECTIONS = {'cases', 'evidence', 'review', 'timeline', 'benchmarks', 'identity'}
# Only tool semantics determine location. Task prose and provider prose do not.
TOOL_SECTIONS = {
    'list_accounting_records': 'cases', 'open_payable_case': 'cases',
    'analyze_payable': 'cases', 'inspect_payable_credit': 'cases',
    'prepare_payable_proposal': 'review', 'list_open_exceptions': 'cases',
    'request_supplier_document': 'cases', 'request_internal_confirmation': 'review',
    'get_counterparty_thread': 'cases', 'reconcile_settlement': 'cases',
    'get_settlement_reconciliation': 'cases', 'prepare_expense_accrual': 'cases',
    'get_expense_accrual': 'cases', 'track_expense_accrual': 'cases',
    'list_datasets': 'evidence', 'query_financials': 'evidence',
    'search_evidence': 'evidence', 'get_source': 'evidence',
    'resolve_entity': 'evidence', 'explore_entity_graph': 'evidence',
    'find_entity_path': 'evidence', 'get_entity_evidence': 'evidence',
    'create_financial_artifact': 'evidence', 'get_financial_artifact': 'evidence',
    'raise_concern': 'review', 'get_case': 'cases', 'update_case': 'cases',
    'search_learned_skills': 'timeline', 'get_learned_skill': 'timeline',
    'get_skill_resource': 'timeline', 'save_learned_skill': 'timeline',
    'record_skill_run': 'timeline', 'save_skill_execution_evidence': 'timeline',
}


def clean_text(value, limit=4000):
    """Return bounded plain text with credential patterns and configured secrets removed."""
    text = value if isinstance(value, str) else ''
    text = re.sub(r'-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----', '[redacted]', text, flags=re.S)
    text = re.sub(r'(?im)^.*(?:authorization\s*:|session_secrets|APP_AGENT_TOKEN\s*[=:]).*$', '[credential redacted]', text)
    text = re.sub(r'\b(?:agt_|cog_|apk_user_|apk_|sk-|Bearer\s+)[A-Za-z0-9._~+/=-]{8,}', '[redacted]', text, flags=re.I)
    text = re.sub(r'(?i)(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[=:]\s*[\'\"]?[^\s\'\",;]+', '[credential redacted]', text)
    for key, secret in os.environ.items():
        if len(secret) >= 8 and re.search(r'(?:KEY|SECRET|TOKEN|PASSWORD)$', key):
            text = text.replace(secret, '[redacted]')
    text = re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', text)
    return text.encode('utf-8')[:limit].decode('utf-8', errors='ignore')


def encode_cursor(row):
    if row is None:
        return None
    return base64.urlsafe_b64encode(json.dumps([row['created_at'], row['id']], separators=(',', ':')).encode()).decode().rstrip('=')


def decode_cursor(cursor):
    if not cursor:
        return None
    try:
        value = json.loads(base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)))
        if (not isinstance(value, list) or len(value) != 2 or type(value[0]) is not int
                or value[0] < 0 or not isinstance(value[1], str) or not re.fullmatch(r'evt_[a-zA-Z0-9_-]{1,128}', value[1])):
            raise ValueError()
        return value
    except (ValueError, TypeError, UnicodeError):
        raise ValueError('Invalid activity cursor') from None


def event_location(kind, payload):
    if kind == 'agent.tool.completed':
        return TOOL_SECTIONS.get(payload.get('tool'))
    if kind.startswith(('source.', 'artifact.', 'elastic.')):
        return 'evidence'
    if kind.startswith('concern.'):
        return 'review'
    if kind.startswith(('task.', 'exception.', 'counterparty.')):
        return 'cases'
    return None


def application_event(row, task_by_id):
    payload = row['payload'] if isinstance(row['payload'], dict) else {}
    task_id = payload.get('task_id')
    task = task_by_id.get(task_id)
    # Never forward arbitrary payloads or identifiers referring to another workspace.
    task_id = task_id if task else None
    titles = {'task.queued': 'Investigation queued', 'task.finished': 'Investigation reported',
              'task.blocked': 'Investigation needs attention', 'controller.started': 'Agent dispatch enabled',
              'source.created': 'Evidence received', 'source.indexed': 'Evidence indexed',
              'artifact.ready': 'Financial artifact ready', 'concern.responded': 'Review decision received',
              'exception.received': 'Exception received', 'exception.scored': 'Exception evaluated',
              'counterparty.replied': 'Counterparty reply received',
              'elastic.investigation.completed': 'Evidence investigation completed'}
    kind = row['kind']
    title = titles.get(kind, 'Workspace activity')
    text = ''
    if kind == 'agent.tool.completed':
        name = payload.get('tool', '')
        title = 'Agent completed ' + clean_text(name.replace('_', ' '), 100)
    elif kind == 'task.finished':
        result = payload.get('result')
        text = clean_text(result.get('summary', '')) if isinstance(result, dict) else ''
    elif kind == 'task.blocked':
        text = 'The provider session stopped or needs input. No completed result has been verified.'
    return {'id': row['id'], 'kind': clean_text(kind, 100), 'source': 'application',
            'timestamp': row['created_at'], 'title': title, 'text': text,
            'task_id': task_id, 'session_id': task.get('session_id') if task else None,
            'section': event_location(kind, payload)}


class DevinMessages:
    """Bounded read-only proxy for the documented v3 session message endpoint.

    https://docs.devin.ai/api-reference/v3/sessions/get-organizations-session-messages
    Public Devin replies only. User messages can contain full prompts and secrets.
    This endpoint does not provide the underlying terminal/tool execution trace.
    """
    def page(self, session_id, after=None, limit=100):
        key, org = os.getenv('DEVIN_API_KEY'), os.getenv('DEVIN_ORG_ID')
        if not key or not org:
            raise ValueError('Devin message access is not configured')
        params = {'first': limit}
        if after:
            params['after'] = after
        with httpx.Client(timeout=httpx.Timeout(8, connect=3)) as client:
            response = client.get('https://api.devin.ai/v3/organizations/' + quote(org, safe='')
                                  + '/sessions/' + quote(session_id, safe='') + '/messages',
                                  params=params, headers={'Authorization': 'Bearer ' + key})
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, dict) or not isinstance(data.get('items'), list):
            raise ValueError('Invalid provider message response')
        return data


def provider_page(provider, session_id, task_id, section, after=None, limit=100):
    result = provider.page(session_id, after, limit)
    messages = []
    for item in result['items'][:limit]:
        if not isinstance(item, dict) or item.get('source') != 'devin' or not isinstance(item.get('message'), str):
            continue
        timestamp = item.get('created_at')
        if not isinstance(timestamp, (int, float)) or isinstance(timestamp, bool) or not 0 <= timestamp < 10**15:
            continue
        # Devin timestamps are epoch seconds; tolerate already-normalized milliseconds.
        timestamp = int(timestamp * 1000 if timestamp < 10**11 else timestamp)
        event_id = item.get('event_id')
        if not isinstance(event_id, str) or not event_id:
            continue
        uid = 'devin_' + hashlib.sha256((session_id + ':' + event_id).encode()).hexdigest()[:32]
        messages.append({'id': uid, 'kind': 'devin.message', 'source': 'devin', 'timestamp': timestamp,
                         'title': 'Devin update', 'text': clean_text(item['message']),
                         'task_id': task_id, 'session_id': session_id, 'section': section})
    next_cursor = result.get('end_cursor')
    if not isinstance(next_cursor, str) or len(next_cursor) > 4096:
        next_cursor = None
    if result.get('has_next_page') is True and not next_cursor:
        raise ValueError('Provider pagination cursor missing')
    return {'events': messages, 'next_cursor': next_cursor, 'has_more': result.get('has_next_page') is True,
            'session_id': session_id}


_provider_reads = ThreadPoolExecutor(max_workers=4, thread_name_prefix="swarm-messages")


class MessageCache:
    """Share provider polls across open panels, bounded by workspace and session."""
    def __init__(self):
        self.lock = threading.Lock()
        self.entries = OrderedDict()

    def poll(self, namespace, oid, session_id, task_id, section, provider):
        key = (namespace, oid, session_id)
        with self.lock:
            entry = self.entries.setdefault(key, {'events': [], 'next_cursor': None, 'has_more': False,
                                                  'status': 'unavailable', 'message': None, 'next_poll': 0, 'pending': False})
            self.entries.move_to_end(key)
            while len(self.entries) > 256:
                self.entries.popitem(last=False)
            if entry['pending'] or time.monotonic() < entry['next_poll']:
                return dict(entry)
            # Set before the request to avoid duplicate calls from concurrent clients.
            entry['next_poll'] = time.monotonic() + 10
            entry['pending'] = True
            after = entry['next_cursor']
            entry['message'] = 'Loading Devin session messages.' if not entry['events'] else entry['message']
            _provider_reads.submit(self._read, entry, provider, session_id, task_id, section, after)
            return dict(entry)

    def _read(self, entry, provider, session_id, task_id, section, after):
        try:
            page = provider_page(provider, session_id, task_id, section, after)
            with self.lock:
                merged = {event['id']: event for event in entry['events'] + page['events']}
                entry.update(page, events=sorted(merged.values(), key=lambda e: (e['timestamp'], e['id']))[-200:],
                             status='available', message=None)
                # The documented final page can omit end_cursor. Preserve the last useful
                # cursor; re-reading that last page is harmless because event IDs dedupe.
                entry['next_cursor'] = page['next_cursor'] or after
                entry['next_poll'] = time.monotonic() + (1 if page['has_more'] else 10)
                entry['pending'] = False
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            with self.lock:
                entry.update(status='unavailable', message='Devin messages are unavailable. Check provider access or retry shortly.')
                entry['next_poll'] = time.monotonic() + 15
                entry['pending'] = False


message_cache = MessageCache()


class SwarmService:
    def __init__(self, store, oid, provider=None):
        self.store, self.oid = store, oid
        self.provider = provider or DevinMessages()

    def snapshot(self, before=None, after=None, limit=50, task_offset=0, task_limit=100, include_provider=True):
        older, newer = decode_cursor(before), decode_cursor(after)
        with self.store.engine.connect() as db:
            controller = db.execute(select(agent_controllers).where(agent_controllers.c.organization_id == self.oid)).mappings().first()
            # Cases are joined with both ID and organization to keep all display fields scoped.
            task_rows = db.execute(select(agent_tasks, agent_cases.c.title).outerjoin(agent_cases, and_(
                agent_cases.c.id == agent_tasks.c.case_id, agent_cases.c.organization_id == self.oid))
                .where(agent_tasks.c.organization_id == self.oid)
                .order_by(agent_tasks.c.created_at.desc(), agent_tasks.c.id.desc())).mappings().all()
            task_by_id = {row['id']: dict(row) for row in task_rows}
            query = select(agent_events).where(agent_events.c.organization_id == self.oid)
            latest = db.execute(query.order_by(agent_events.c.created_at.desc(), agent_events.c.id.desc()).limit(1)).mappings().first()
            if older:
                query = query.where(or_(agent_events.c.created_at < older[0], and_(agent_events.c.created_at == older[0], agent_events.c.id < older[1])))
            if newer:
                query = query.where(or_(agent_events.c.created_at > newer[0], and_(agent_events.c.created_at == newer[0], agent_events.c.id > newer[1])))
            order = (agent_events.c.created_at.asc(), agent_events.c.id.asc()) if newer else (agent_events.c.created_at.desc(), agent_events.c.id.desc())
            rows = db.execute(query.order_by(*order).limit(limit + 1)).mappings().all()
            # Last successful actual tool is a stronger location than general case membership.
            activity_rows = db.execute(select(agent_events.c.payload).where(agent_events.c.organization_id == self.oid,
                agent_events.c.kind == 'agent.tool.completed').order_by(agent_events.c.created_at.desc(), agent_events.c.id.desc()).limit(1000)).scalars().all()
        locations = {}
        for payload in activity_rows:
            if isinstance(payload, dict) and payload.get('task_id') in task_by_id:
                section = TOOL_SECTIONS.get(payload.get('tool'))
                if section:
                    locations.setdefault(payload['task_id'], section)
        for task in task_by_id.values():
            task['section'] = locations.get(task['id']) or ('cases' if task.get('title') else None)
        page = rows[:limit]
        app_events = [application_event(row, task_by_id) for row in page]
        app_events.sort(key=lambda event: (event['timestamp'], event['id']))
        tasks = []
        for row in task_rows[task_offset:task_offset + task_limit]:
            result = row['result'] if isinstance(row['result'], dict) else {}
            sid = row['session_id']
            tasks.append({'id': row['id'], 'title': clean_text(row['title'] or 'Investigation', 200),
                          'objective': clean_text(row['objective']), 'status': clean_text(row['status'], 60),
                          'section': task_by_id[row['id']]['section'], 'case_id': row['case_id'],
                          'session_id': sid, 'session_url': 'https://app.devin.ai/sessions/' + quote(sid, safe='') if sid else None,
                          'error': clean_text(row['error']) or None, 'result_summary': clean_text(result.get('summary')) or None,
                          'created_at': row['created_at']})
        configured = bool(os.getenv('DEVIN_API_KEY') and os.getenv('DEVIN_ORG_ID'))
        sessions = [(row['session_id'], row['id'], task_by_id[row['id']]['section']) for row in task_rows if row['session_id']]
        if controller and controller['session_id']:
            sessions.insert(0, (controller['session_id'], None, None))
        session_total = len(sessions)
        sessions = sessions[:50]
        states, provider_events = [], []
        if configured and include_provider:
            for sid, tid, section in sessions:
                cached = message_cache.poll(str(self.store.engine.url), self.oid, sid, tid, section, self.provider)
                provider_events.extend(dict(event) for event in cached['events'])
                states.append({'task_id': tid, 'session_id': sid, **{key: cached[key] for key in ('status', 'has_more', 'next_cursor', 'message')}})
        if not configured:
            provider_status = 'not_configured'
            provider_message = 'Devin message access is not configured. Application activity is live.'
        elif not sessions:
            provider_status = 'no_sessions'
            provider_message = 'No Devin sessions have been started for this workspace.'
        elif states and all(state['status'] == 'available' for state in states):
            provider_status = 'available'
            provider_message = 'Live Devin session messages and application activity. Raw terminal traces are not exposed by this feed.'
        else:
            provider_status = 'partial' if any(state['status'] == 'available' for state in states) else 'unavailable'
            provider_message = 'Some Devin messages are unavailable. Application activity remains live.'
        provider_events.sort(key=lambda event: (event['timestamp'], event['id']))
        provider_limit = max(0, 500 - len(app_events))
        events_truncated = len(provider_events) > provider_limit
        provider_events = provider_events[-provider_limit:] if provider_limit else []
        if session_total > len(sessions):
            provider_message += f' Showing messages from {len(sessions)} of {session_total} sessions; each task has its own message history.'
        all_events = sorted(app_events + provider_events, key=lambda event: (event['timestamp'], event['id']))
        result = {'controller': {'enabled': bool(controller and controller['enabled']),
                              'status': clean_text(controller['status'], 60) if controller else 'not_started',
                              'session_id': controller['session_id'] if controller else None,
                              'error': clean_text(controller['error']) or None if controller else None},
                'tasks': tasks, 'task_total': len(task_rows), 'tasks_has_more': task_offset + len(tasks) < len(task_rows),
                'tasks_next_offset': task_offset + len(tasks) if task_offset + len(tasks) < len(task_rows) else None,
                'events': all_events,
                'cursor': encode_cursor(page[-1]) if newer and page else (after if newer else encode_cursor(latest)),
                'older_cursor': encode_cursor(min(page, key=lambda row: (row['created_at'], row['id']))) if page else before,
                'has_more': len(rows) > limit,
                'provider_logs': {'status': provider_status, 'message': provider_message, 'sessions': states},
                'generated_at': int(time.time() * 1000), 'events_truncated': events_truncated}
        # Preserve every application event in the cursor page. Provider histories can
        # be read separately, so shed their oldest cached messages before reducing excerpts.
        budget = 1_750_000
        def size():
            return len(json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        while provider_events and size() > budget:
            provider_events = provider_events[len(provider_events) // 2 + 1:]
            result['events'] = sorted(app_events + provider_events, key=lambda event: (event['timestamp'], event['id']))
            result['events_truncated'] = True
        for excerpt_limit in (1000, 500, 250):
            if size() <= budget:
                break
            for item in result['events']:
                item['text'] = clean_text(item['text'], excerpt_limit)
            for item in result['tasks']:
                for field in ('objective', 'error', 'result_summary'):
                    item[field] = clean_text(item[field], excerpt_limit) or ('' if field == 'objective' else None)
            result['events_truncated'] = True
        return result

    def session_messages(self, task_id=None, after=None, limit=100):
        with self.store.engine.connect() as db:
            if task_id:
                row = db.execute(select(agent_tasks).where(agent_tasks.c.id == task_id,
                    agent_tasks.c.organization_id == self.oid)).mappings().first()
            else:
                row = db.execute(select(agent_controllers).where(agent_controllers.c.organization_id == self.oid)).mappings().first()
            section = None
            if task_id and row:
                activity = db.execute(select(agent_events.c.payload).where(
                    agent_events.c.organization_id == self.oid, agent_events.c.kind == 'agent.tool.completed',
                    agent_events.c.payload['task_id'].as_string() == task_id,
                    agent_events.c.payload['tool'].as_string().in_(TOOL_SECTIONS))
                    .order_by(agent_events.c.created_at.desc(), agent_events.c.id.desc()).limit(1)).scalar()
                section = TOOL_SECTIONS.get(activity.get('tool')) if activity else 'cases'
        if not row:
            raise LookupError('Agent not found')
        if not row['session_id']:
            return {'events': [], 'next_cursor': None, 'has_more': False}
        return provider_page(self.provider, row['session_id'], task_id, section, after, limit)


def service(identity=Depends(auth.current_user)):
    from .main import store
    try:
        org = store.workspace(identity.user_id)
    except PermissionError:
        raise HTTPException(403, 'Workspace access removed') from None
    return SwarmService(store, org['id'])


@router.get('')
def snapshot(before: str | None = Query(None, max_length=256), limit: int = Query(50, ge=1, le=200),
             task_offset: int = Query(0, ge=0, le=100000), task_limit: int = Query(100, ge=1, le=200),
             svc=Depends(service)):
    try:
        return svc.snapshot(before=before, limit=limit, task_offset=task_offset, task_limit=task_limit)
    except ValueError:
        raise HTTPException(422, 'Invalid activity cursor') from None


def messages(svc, task_id, after, limit):
    try:
        return svc.session_messages(task_id, after, limit)
    except LookupError:
        raise HTTPException(404, 'Agent not found') from None
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        raise HTTPException(503, 'Devin messages are unavailable. Application activity remains live.') from None


@router.get('/tasks/{task_id}/messages')
def task_messages(task_id: str, after: str | None = Query(None, max_length=4096),
                  limit: int = Query(100, ge=1, le=200), svc=Depends(service)):
    return messages(svc, task_id, after, limit)


@router.get('/controller/messages')
def controller_messages(after: str | None = Query(None, max_length=4096),
                        limit: int = Query(100, ge=1, le=200), svc=Depends(service)):
    return messages(svc, None, after, limit)


def sse(event, payload, cursor=None):
    return (('id: ' + cursor + '\n') if cursor else '') + 'event: ' + event + '\ndata: ' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n\n'


async def stream_events(request, svc, identity, after=None):
    cursor, previous, first = after, None, True
    # Only a reconnect (a caller-supplied cursor) has a backlog worth draining fast.
    draining, opened = after is not None, time.time()
    while not await request.is_disconnected():
        expired = time.time() >= identity.expires_at
        if expired or not await run_in_threadpool(svc.store.member, identity.user_id, svc.oid):
            yield sse('access_lost', {'reason': 'token_expired' if expired else 'access_removed',
                                    'message': 'Sign in again to resume agent activity.' if expired else 'Workspace access was removed.'})
            return
        snapshot = await run_in_threadpool(svc.snapshot, None, cursor)
        cursor = snapshot['cursor']
        signature = json.dumps({key: value for key, value in snapshot.items() if key != 'generated_at'}, sort_keys=True)
        if first or signature != previous:
            yield sse('snapshot' if first else 'update', snapshot, cursor)
            first, previous = False, signature
        else:
            yield ': heartbeat\n\n'
        # Drain a reconnect backlog quickly, then settle to the normal cadence. `after` used
        # to stand in for "still draining", but it was reassigned to the cursor below on every
        # pass, so it was always truthy: any workspace reporting has_more polled at 10 Hz
        # forever, one DB scan and one threadpool slot per tick, per connected client.
        # Bounded: a workspace that always reports has_more (more events than one page)
        # would otherwise hold the fast cadence open indefinitely.
        draining = draining and snapshot['has_more'] and time.time() - opened < DRAIN_SECONDS
        await asyncio.sleep(.1 if draining else 2)


@router.get('/stream')
async def stream(request: Request, after: str | None = Query(None, max_length=256),
                 identity=Depends(auth.current_user), svc=Depends(service)):
    after = after or request.headers.get('last-event-id')
    try:
        decode_cursor(after)
    except ValueError:
        raise HTTPException(422, 'Invalid activity cursor') from None
    return StreamingResponse(stream_events(request, svc, identity, after), media_type='text/event-stream',
                             headers={'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no'})
