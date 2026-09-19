"""Authenticated investigation API and a separate trusted Workflow callback."""
import hmac
import os
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from .data_api import service
from .elastic_investigations import InvestigationService, Investigate, Finding, ElasticCloud
from .concerns import Conflict

router = APIRouter(prefix='/elastic', tags=['elastic'])


def invoke(fn, *args):
    try: return fn(*args)
    except PermissionError: raise HTTPException(403, 'Elastic is not configured for this organization') from None
    except LookupError: raise HTTPException(404, 'Investigation or source not found') from None
    except Conflict as exc: raise HTTPException(409, str(exc)) from None
    except ValueError as exc: raise HTTPException(422, str(exc)) from None
    except Exception: raise HTTPException(503, 'Elastic unavailable') from None


@router.post('/investigations', status_code=202)
def create(body: Investigate, data=Depends(service)):
    invoke(ElasticCloud().require, data.oid)
    return invoke(InvestigationService(data).create, body)


@router.get('/investigations')
def list_runs(limit: int = Query(50, ge=1, le=100), data=Depends(service)):
    return InvestigationService(data).list(limit)


@router.get('/investigations/{iid}')
def get(iid: str, data=Depends(service)):
    return invoke(InvestigationService(data).get, iid)


@router.post('/investigations/{iid}/result')
def callback(iid: str, body: Finding, authorization: str = Header(default='')):
    expected = os.getenv('ELASTIC_CALLBACK_SECRET', '')
    if len(expected) < 32 or not hmac.compare_digest(authorization, 'Bearer ' + expected):
        raise HTTPException(401, 'Invalid Workflow credential')
    oid = os.getenv('ELASTIC_AGENT_ORGANIZATION_ID', '')
    if not oid: raise HTTPException(503, 'Elastic organization missing')
    from .main import store
    from .data_service import DataService
    return invoke(InvestigationService(DataService(store, oid)).accept, iid, body)


@router.post('/investigations/{iid}/retry')
def retry(iid: str, data=Depends(service)):
    return invoke(InvestigationService(data).retry, iid)


@router.post('/investigations/{iid}/refresh')
def refresh(iid: str, data=Depends(service)):
    return invoke(InvestigationService(data).refresh, iid, ElasticCloud())
