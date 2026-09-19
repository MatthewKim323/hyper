import os
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response
from .. import auth
from ..data_api import service
from .common import ConnectorError, key
from .service import (ConnectionService, GoogleConnect, RampConnect, PlaidConnect,
                      PlaidExchange, google_callback)

router = APIRouter(prefix='/connections', tags=['connections'])


def connection_service(data=Depends(service), identity=Depends(auth.current_user)):
    return ConnectionService(data, identity.user_id)


def invoke(fn, *args):
    from fastapi import HTTPException
    try:
        return fn(*args)
    except ConnectorError as exc:
        raise HTTPException(exc.status, exc.message) from None
    except Exception:
        raise HTTPException(503, 'Connection operation failed; check server configuration and retry') from None


@router.get('/providers')
def providers(svc=Depends(connection_service)):
    encrypted = bool(os.getenv('CONNECTOR_ENCRYPTION_KEY'))
    try:
        key()
    except ConnectorError:
        encrypted = False
    google = encrypted and all(os.getenv(k) for k in ('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CONNECTOR_CALLBACK_BASE_URL'))
    plaid_ready = encrypted and all(os.getenv(k) for k in ('PLAID_CLIENT_ID', 'PLAID_SECRET'))
    return {'providers': [
        {'id': 'gmail', 'configured': google, 'auth': 'oauth', 'imports': ['messages', 'attachments']},
        {'id': 'drive', 'configured': google, 'auth': 'oauth', 'imports': ['files', 'native_exports']},
        {'id': 'ramp', 'configured': encrypted, 'auth': 'business_client_credentials', 'imports': ['bills', 'card_transactions']},
        {'id': 'plaid', 'configured': plaid_ready, 'auth': 'link', 'imports': ['bank_transactions'], 'environment': os.getenv('PLAID_ENV', 'sandbox')},
    ], 'read_only': True, 'sync_method': 'polling'}


@router.post('/google/{provider}/authorize', status_code=201)
def google_start(provider: Literal['gmail', 'drive'], body: GoogleConnect, svc=Depends(connection_service)):
    return invoke(svc.google_start, provider, body)


@router.get('/oauth/{provider}/callback')
def callback(provider: Literal['gmail', 'drive'], state: str = Query(min_length=20, max_length=200),
             code: str | None = Query(None, max_length=8192), error: str | None = Query(None, max_length=200)):
    # Provider redirects have no Clerk header. One-use state binds the initiating member and organization.
    from ..main import store
    result = invoke(google_callback, store, provider, state, code, error)
    return {'connected': True, 'connection': result}


@router.post('/ramp', status_code=201)
def ramp(body: RampConnect, svc=Depends(connection_service)):
    return invoke(svc.ramp_connect, body)


@router.post('/plaid/link-token', status_code=201)
def link(body: PlaidConnect, svc=Depends(connection_service)):
    return invoke(svc.plaid_start, body)


@router.post('/plaid/exchange', status_code=201)
def exchange(body: PlaidExchange, svc=Depends(connection_service)):
    return invoke(svc.plaid_exchange, body)


@router.get('')
def list_connections(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), svc=Depends(connection_service)):
    return invoke(svc.list, limit, offset)


@router.get('/{cid}')
def get(cid: str, svc=Depends(connection_service)):
    return invoke(svc.get, cid)


@router.post('/{cid}/sync', status_code=202)
def sync(cid: str, svc=Depends(connection_service)):
    return invoke(svc.sync, cid)


@router.post('/{cid}/disconnect')
def disconnect(cid: str, svc=Depends(connection_service)):
    return invoke(svc.disconnect, cid)


@router.get('/{cid}/items')
def items(cid: str, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), svc=Depends(connection_service)):
    return invoke(svc.items, cid, limit, offset)


@router.get('/{cid}/items/{iid}/original')
def original(cid: str, iid: str, svc=Depends(connection_service)):
    row, body = invoke(svc.original, cid, iid)
    return Response(body, media_type='application/octet-stream', headers={
        'Content-Disposition': "attachment; filename*=UTF-8''" + quote(row['filename'], safe=''),
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


@router.get('/{cid}/syncs')
def syncs(cid: str, limit: int = Query(20, ge=1, le=100), svc=Depends(connection_service)):
    return invoke(svc.syncs, cid, limit)
