import json
from functools import lru_cache
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from . import auth
from .data_service import DataService, FinancialQuery, EvidenceQuery, SourceQuery
from .retrieval import ElasticSearch
from .parsing import MAX_BYTES

router=APIRouter()

@lru_cache
def search():
    return ElasticSearch()

def service(identity=Depends(auth.current_user)):
    from .main import store
    try:org=store.workspace(identity.user_id)
    except PermissionError:raise HTTPException(403,'Workspace access removed')
    return DataService(store,org['id'],search=search())

def invoke(fn,*args,**kwargs):
    try:
        return fn(*args,**kwargs)
    except LookupError:
        raise HTTPException(404,'Source or dataset not found') from None
    except (ValueError,UnicodeError) as e:
        raise HTTPException(422,str(e)) from None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503,'Storage or search unavailable; saved uploads can be retried') from None

@router.post('/sources',status_code=201)
async def upload(file: UploadFile=File(...),source_key: str | None=Form(None),
                 dataset: str | None=Form(None),currency: str | None=Form(None),
                 field_types: str=Form('{}'),id_field: str | None=Form(None),
                 svc: DataService=Depends(service)):
    try:
        body=await file.read(MAX_BYTES+1)
        if len(body)>MAX_BYTES:raise HTTPException(413,'File exceeds 20 MiB')
        try:
            fields=json.loads(field_types)
            if not isinstance(fields,dict):raise ValueError()
        except ValueError:
            raise HTTPException(422,'field_types must be a JSON object')
        return await run_in_threadpool(invoke,svc.ingest,file.filename or '',body,source_key,dataset,currency,fields,id_field)
    finally:
        await file.close()

@router.get('/sources')
def list_sources(limit: int=Query(50,ge=1,le=100),offset: int=Query(0,ge=0),svc: DataService=Depends(service)):
    return invoke(svc.list_sources,limit,offset)

@router.get('/sources/{sid}')
def get_source(sid: str,offset: int=Query(0,ge=0,le=100000),limit: int=Query(10,ge=1,le=50),svc: DataService=Depends(service)):
    return invoke(svc.get_source,SourceQuery(source_id=sid,offset=offset,limit=limit))

@router.get('/sources/{sid}/download')
def download(sid: str,svc: DataService=Depends(service)):
    source=invoke(svc.source,sid)
    body=invoke(svc.objects.read,source['object_key'])
    from urllib.parse import quote
    return Response(body,media_type='application/octet-stream',headers={
        'Content-Disposition':"attachment; filename*=UTF-8''"+quote(source['filename'],safe=''),
        'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'})

@router.get('/sources/{sid}/status')
def status(sid: str,svc: DataService=Depends(service)):
    return invoke(svc.job_status,sid)

@router.post('/sources/{sid}/reindex')
def reindex(sid: str,svc: DataService=Depends(service)):
    return invoke(svc.retry,sid)

@router.get('/datasets')
def datasets(svc: DataService=Depends(service)):
    return invoke(svc.catalog)

@router.post('/financials/query')
def financials(args: FinancialQuery,svc: DataService=Depends(service)):
    return invoke(svc.query_financials,args)

@router.post('/evidence/search')
def evidence(args: EvidenceQuery,svc: DataService=Depends(service)):
    return invoke(svc.search_evidence,args)

@router.post('/sessions/{sid}/archive',status_code=201)
def archive_session(sid: str,identity=Depends(auth.current_user),svc: DataService=Depends(service)):
    """Explicitly index a persisted transcript as a versioned source for later conversations."""
    from .main import store
    state=store.get(sid,identity.user_id)
    if not state or state['organization_id']!=svc.oid:
        raise HTTPException(404,'Session not found')
    body=json.dumps({'session_id':sid,'transcript':state['transcript'],'context':state['context']},
                    ensure_ascii=False).encode()
    return invoke(svc.ingest,f'conversation-{sid}.json',body,source_key=f'conversation/{sid}')
