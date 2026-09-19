import json
import time
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from app import auth, main, data_api
from app.store import Store
from app.data_service import DataService, FinancialQuery, EvidenceQuery, SourceQuery
from app.database import sources, jobs, chunks
from app.ingestion_worker import run_once
from app.parsing import parse_file
from app.retrieval import ElasticSearch
from app.data_tools import tool_definitions

class MemoryObjects:
    def __init__(self):self.data={}
    def put(self,key,body,content_type):self.data[key]=body
    def read(self,key):return self.data[key]

class SearchDouble:
    mode='hybrid'
    def __init__(self):self.docs={};self.fail=False;self.filters=None
    def ensure_index(self):pass
    def index_chunks(self,source,rows):
        if self.fail:raise RuntimeError('failure')
        for r in rows:self.docs[r['id']]=dict(r)
    def refresh(self):pass
    def search(self,oid,ids,query,limit):
        self.filters=(oid,ids)
        return [{'_source':{'chunk_id':r['id']},'_score':1} for r in self.docs.values()
                if r['organization_id']==oid and r['source_id'] in ids][:limit]

@pytest.fixture
def services(tmp_path):
    store=Store(str(tmp_path/'db'))
    objects=MemoryObjects();search=SearchDouble()
    a=DataService(store,store.workspace('alice')['id'],objects,search)
    b=DataService(store,store.workspace('bob')['id'],objects,search)
    return store,a,b,objects,search

def upload(svc,amount=123):
    return svc.ingest('invoices.jsonl',json.dumps({'invoice_id':'INV-1','amount_cents':amount,'date':'2026-09-01'}).encode(),dataset='invoices',currency='USD')

def test_original_dedup_version_and_no_double_count(services):
    store,a,b,objects,_=services
    first=upload(a)
    assert upload(a)['id']==first['id']
    assert len(objects.data)==1
    second=upload(a,456)
    assert second['version']==2
    assert not a.source(first['id'])['active']
    result=a.query_financials(FinancialQuery(dataset='invoices'))
    assert len(result['rows'])==1
    assert result['rows'][0]['payload']['amount_cents']=='456'
    assert result['rows'][0]['source_id']==second['id']
    assert a.get_source(SourceQuery(source_id=first['id']))['chunks'][0]['locator']=='row:1'
    assert a.source(first['id'])['sha256'] != a.source(second['id'])['sha256']
    with pytest.raises(LookupError):b.source(first['id'])
    with pytest.raises(LookupError):b.query_financials(FinancialQuery(dataset='invoices'))

def test_reject_overlapping_export_and_bad_numbers(services):
    _,a,*_=services
    upload(a)
    with pytest.raises(ValueError,match='overlaps'):
        a.ingest('another.json',b'{"invoice_id":"INV-1","amount_cents":100}',dataset='invoices')
    with pytest.raises(ValueError):
        a.ingest('bad.json',b'{"id":"A","amount_cents":"NaN"}',dataset='bad')
    with pytest.raises(ValueError):
        a.ingest('overflow.json',b'{"id":"A","amount_cents":"1e1000000"}',dataset='bad')
    assert len(a.list_sources()['sources'])==1

def test_csv_schema_and_filters(services):
    _,a,*_=services
    a.ingest('cost.csv',b'id,amount,date\nx,0.10,2026-09-01\ny,0.20,2026-09-02\n',
        dataset='cost',currency='USD',field_types={'amount':'numeric'})
    result=a.query_financials(FinancialQuery(dataset='cost',filters=[{'field':'amount','op':'gte','value':'0.15'}]))
    assert result['total_matching']==1
    assert result['rows'][0]['record_id']=='y'
    with pytest.raises(ValueError):
        a.query_financials(FinancialQuery(dataset='cost',filters=[{'field':'missing','value':'x'}]))
    with pytest.raises(ValueError,match='Postgres'):
        a.query_financials(FinancialQuery(dataset='cost',operation='sum',field='amount'))
    with pytest.raises(ValueError):
        FinancialQuery(dataset='cost',organization_id='other')
    with pytest.raises(ValueError):
        FinancialQuery(dataset='cost; DROP TABLE sources')

def test_search_coverage_citations_and_retry(services):
    store,a,b,objects,search=services
    first=upload(a)
    assert a.search_evidence(EvidenceQuery(query='invoice'))['unindexed_sources']==1
    search.fail=True
    assert run_once(store,search)
    assert a.job_status(first['id'])['status']=='failed'
    assert a.source(first['id'])['index_status']=='failed'
    assert len(objects.data)==1
    search.fail=False
    a.retry(first['id'])
    assert run_once(store,search)
    result=a.search_evidence(EvidenceQuery(query='invoice'))
    assert result['coverage_complete']
    assert result['hits'][0]['source_id']==first['id']
    assert search.filters==(a.oid,[first['id']])
    assert not b.search_evidence(EvidenceQuery(query='invoice'))['hits']
    second=upload(a,234)
    assert not a.search_evidence(EvidenceQuery(query='invoice'))['hits']
    assert run_once(store,search)
    assert a.search_evidence(EvidenceQuery(query='invoice'))['hits'][0]['source_id']==second['id']

def test_crashed_job_is_reclaimed(services):
    store,a,_,_,search=services
    source=upload(a)
    with store.engine.begin() as db:
        db.execute(update(jobs).where(jobs.c.source_id==source['id']).values(status='running',lease_until=1,claim_token='abandoned'))
    assert run_once(store,search)
    assert a.job_status(source['id'])['status']=='complete'

def test_sql_rechecks_malicious_index_result(services):
    store,a,b,_,search=services
    mine=upload(a);theirs=upload(b)
    run_once(store,search);run_once(store,search)
    search.search=lambda *args:[{'_source':{'chunk_id':theirs['id']+':0'},'_score':100}]
    assert a.search_evidence(EvidenceQuery(query='invoice'))['hits']==[]

def test_parser_provenance_and_rejections():
    _,_,chunks_=parse_file('memo.md',b'Custody pricing changed in September.')
    assert chunks_[0]['locator'].startswith('text:chars:0-')
    for body in (b'id,id\n1,2',b'id,amount\n1,2,3'):
        with pytest.raises(ValueError):parse_file('bad.csv',body,'cost')
    with pytest.raises(ValueError):parse_file('bad.exe',b'abc')
    with pytest.raises(ValueError):parse_file('x.json',b'[{"id":"x"},{"id":"x"}]','cost')

def test_hybrid_filters_every_retriever(monkeypatch):
    monkeypatch.setenv('ELASTIC_INFERENCE_ID','test-embedding')
    es=ElasticSearch();captured={}
    def request(method,path,**kwargs):
        captured.update(kwargs['json'])
        return {'hits':{'hits':[]}}
    es.request=request
    es.search('org-1',['source-1'],'custody fee',4)
    branches=captured['retriever']['rrf']['retrievers']
    for branch in branches:
        assert branch['standard']['query']['bool']['filter']==[
            {'term':{'organization_id':'org-1'}},{'terms':{'source_id':['source-1']}}]

def test_partial_bulk_is_failure(monkeypatch):
    es=ElasticSearch()
    es.request=lambda *args,**kwargs:{'errors':True}
    with pytest.raises(RuntimeError):es.index_chunks({'id':'s','organization_id':'o','dataset':None,'filename':'a'},[])

def test_agent_tools_are_scoped_and_reference_free():
    defs=tool_definitions()
    assert {d['name'] for d in defs}=={'investigate_financial_evidence','get_evidence_investigation','list_datasets','query_financials','search_evidence','get_source','raise_concern','get_concern','list_concerns','claim_concern','resolve_concern','renew_concern_claim','create_financial_artifact','get_financial_artifact'}
    assert '$ref' not in json.dumps(defs)
    assert all('organization_id' not in d['parameters']['properties'] for d in defs)

def test_authenticated_data_api(services,monkeypatch):
    store,a,b,objects,search=services
    monkeypatch.setattr(main,'store',store)
    def identity(token):
        if token not in ('alice','bob'):raise HTTPException(401)
        return auth.Identity(token,int(time.time())+300)
    monkeypatch.setattr(auth,'verify',identity)
    def service(identity=__import__('fastapi').Depends(auth.current_user)):
        org=store.workspace(identity.user_id)
        return DataService(store,org['id'],objects,search)
    main.app.dependency_overrides[data_api.service]=service
    try:
        with TestClient(main.app) as client:
            headers={'Authorization':'Bearer alice'}
            assert client.get('/sources').status_code==401
            r=client.post('/sources',headers=headers,files={'file':('memo.md',b'Custody contract')})
            assert r.status_code==201,r.text
            sid=r.json()['id']
            assert client.get(f'/sources/{sid}',headers=headers).status_code==200
            assert client.get(f'/sources/{sid}/download',headers=headers).content==b'Custody contract'
            assert client.get(f'/sources/{sid}',headers={'Authorization':'Bearer bob'}).status_code==404
            assert client.get(f'/sources/{sid}/download',headers={'Authorization':'Bearer bob'}).status_code==404
            assert client.post('/financials/query',headers=headers,json={'dataset':'x','organization_id':b.oid}).status_code==422
            assert client.get(f'/sources/{sid}/status',headers=headers).json()['status']=='pending'
            session=store.create('alice')
            archived=client.post(f"/sessions/{session['id']}/archive",headers=headers)
            assert archived.status_code==201
            assert client.post(f"/sessions/{session['id']}/archive",headers={'Authorization':'Bearer bob'}).status_code==404

    finally:main.app.dependency_overrides.clear()

def test_failed_object_write_does_not_publish_source(services):
    _,svc,_,objects,_=services
    def fail(*args):raise RuntimeError('unavailable')
    objects.put=fail
    with pytest.raises(RuntimeError):upload(svc)
    assert svc.list_sources()['sources']==[]

def test_query_tools_use_current_organization(services):
    store,a,b,*_=services
    upload(a)
    from app import data_tools
    result=data_tools.execute(store,a.oid,'query_financials',{'dataset':'invoices','operation':'count'})
    assert result['results'][0]['value']=='1'
    with pytest.raises(LookupError):
        data_tools.execute(store,b.oid,'query_financials',{'dataset':'invoices'})
