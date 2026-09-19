import json
import httpx
import pytest
from sqlalchemy import select, update
from fastapi.testclient import TestClient
from app import main, data_api
from app.database import sources, chunks, elastic_investigations as runs
from app.elastic_investigations import InvestigationService, Investigate, Finding, ElasticCloud, run_once
from app.elastic_setup import definitions
from app.concerns import ConcernService, Conflict
from app.retrieval import ElasticSearch
from test_simulator import setup


class Search:
    mode='hybrid+rerank'
    def search(self,*args): return []


class Cloud:
    def __init__(self,oid):self.organization=oid;self.calls=[];self.fail=False
    def require(self,oid):assert oid==self.organization
    def start(self,inputs):
        self.calls.append(inputs)
        if self.fail:raise httpx.ReadTimeout('credential must not leak')
        return 'execution-1'


@pytest.fixture
def flow(setup):
    store,a,b,factory,_=setup
    sid=a.data.ingest('invoice.txt',b'Invoice INV-42 demands 120 USD; contract price is 100 USD.')['id']
    with store.engine.begin() as db:
        db.execute(update(sources).where(sources.c.id==sid).values(index_status='ready'))
        chunk=db.execute(select(chunks.c.id).where(chunks.c.source_id==sid)).scalar_one()
    def make(oid):
        data=factory(oid);data.search=Search();return data
    svc=InvestigationService(make(a.data.oid))
    return store,svc,InvestigationService(make(b.data.oid)),make,Cloud(svc.oid),sid,chunk


def queue(flow,key='first'):
    store,svc,other,factory,cloud,sid,chunk=flow
    row=svc.create(Investigate(source_id=sid,request_key=key))
    return row


def finding(chunk):
    return Finding(outcome='concern',title='Price discrepancy',explanation='Contract and invoice disagree.',evidence_chunk_ids=[chunk])


def test_queue_workflow_callback_and_concern(flow,monkeypatch):
    store,svc,other,factory,cloud,sid,chunk=flow
    row=queue(flow)
    assert queue(flow)['id']==row['id']
    with pytest.raises(LookupError):other.get(row['id'])
    with pytest.raises(LookupError):other.create(Investigate(source_id=sid,request_key='foreign'))
    with pytest.raises(Conflict):svc.create(Investigate(source_id=sid,request_key='first',question='different'))
    assert run_once(store,factory,cloud)
    assert svc.get(row['id'])['status']=='running'
    assert json.loads(cloud.calls[0]['context'])['evidence'][0]['id']==chunk
    assert not run_once(store,factory,cloud)
    assert svc.accept(row['id'],finding(chunk))['status']=='reviewed'
    assert svc.accept(row['id'],finding(chunk))['status']=='reviewed'
    with pytest.raises(Conflict):svc.accept(row['id'],finding(chunk).model_copy(update={'title':'Changed'}))
    calls=[]
    def concern(self,args):calls.append(args);return {'id':'concern-1'}
    monkeypatch.setattr(ConcernService,'raise_concern',concern)
    assert run_once(store,factory,cloud)
    completed=svc.get(row['id'])
    assert completed['status']=='complete' and completed['concern_id']=='concern-1'
    assert calls[0].source_ids==[sid]
    assert not run_once(store,factory,cloud)
    assert 'context' not in completed and 'claim_token' not in completed


def test_unknown_dispatch_never_replayed(flow):
    store,svc,_,factory,cloud,_,_=flow
    row=queue(flow);cloud.fail=True
    assert run_once(store,factory,cloud)
    result=svc.get(row['id'])
    assert result['status']=='dispatch_unknown'
    assert 'credential must not leak' not in result['error']
    assert not run_once(store,factory,cloud)
    assert len(cloud.calls)==1


def test_callback_rejects_forged_and_superseded_evidence(flow):
    store,svc,_,factory,cloud,sid,chunk=flow
    row=queue(flow)
    with pytest.raises(Conflict):svc.accept(row['id'],finding(chunk))
    run_once(store,factory,cloud)
    with pytest.raises(ValueError):svc.accept(row['id'],finding('foreign-chunk'))
    with store.engine.begin() as db:db.execute(update(sources).where(sources.c.id==sid).values(active=False))
    with pytest.raises(ValueError):svc.accept(row['id'],finding(chunk))


def test_incomplete_coverage_cannot_clear_case(flow):
    store,svc,_,factory,cloud,_,chunk=flow
    svc.data.ingest('pending.txt',b'Another document is waiting for indexing.')
    row=queue(flow);run_once(store,factory,cloud)
    with pytest.raises(ValueError,match='Incomplete'):
        svc.accept(row['id'],finding(chunk).model_copy(update={'outcome':'no_concern'}))
    assert svc.accept(row['id'],finding(chunk).model_copy(update={'outcome':'insufficient_evidence'}))['status']=='reviewed'


def test_capacity_and_expired_dispatch(flow,monkeypatch):
    store,svc,_,factory,cloud,_,_=flow
    monkeypatch.setenv('ELASTIC_MAX_ACTIVE_INVESTIGATIONS','1')
    row=queue(flow);queue(flow,'second');run_once(store,factory,cloud)
    assert not run_once(store,factory,cloud)
    with store.engine.begin() as db:
        db.execute(update(runs).where(runs.c.id==row['id']).values(status='dispatching',lease_until=0))
    assert not run_once(store,factory,cloud)
    assert svc.get(row['id'])['status']=='dispatch_unknown'


def test_callback_auth_and_org_boundary(flow,monkeypatch):
    store,svc,_,factory,cloud,_,chunk=flow
    row=queue(flow);run_once(store,factory,cloud)
    monkeypatch.setattr(main,'store',store)
    monkeypatch.setenv('ELASTIC_CALLBACK_SECRET','x'*40)
    monkeypatch.setenv('ELASTIC_AGENT_ORGANIZATION_ID',svc.oid)
    client=TestClient(main.app)
    url='/elastic/investigations/'+row['id']+'/result'
    assert client.post(url,json=finding(chunk).model_dump()).status_code==401
    assert client.post(url,json=finding(chunk).model_dump(),headers={'Authorization':'Bearer '+'x'*40}).status_code==200
    main.app.dependency_overrides[data_api.service]=lambda:flow[2].data
    try:assert client.get('/elastic/investigations/'+row['id']).status_code==404
    finally:main.app.dependency_overrides.clear()


def test_reranking_keeps_authorization_in_both_branches(monkeypatch):
    monkeypatch.setenv('ELASTIC_INFERENCE_ID','jina-embedding')
    monkeypatch.setenv('ELASTIC_RERANK_INFERENCE_ID','jina-rerank')
    search=ElasticSearch();requests=[]
    def request(*args,**kwargs):requests.append(kwargs['json']);return {'hits':{'hits':[]}}
    monkeypatch.setattr(search,'request',request)
    search.search('org-a',['source-a'],'invoice 42',8)
    rerank=requests[0]['retriever']['text_similarity_reranker']
    assert rerank['inference_id']=='jina-rerank'
    for branch in rerank['retriever']['rrf']['retrievers']:
        assert branch['standard']['query']['bool']['filter']==[{'term':{'organization_id':'org-a'}},{'terms':{'source_id':['source-a']}}]
    search.search('org-a',[],'anything',8)
    assert len(requests)==1


def test_scoped_definitions_and_structured_workflow():
    spec=definitions('org-a','hyper-evidence-v2','callback-connector')
    for tool in spec['tools']:
        assert 'organization_id == "org-a"' in tool['configuration']['query']
        assert 'organization_id' not in tool['configuration']['params']
    configured=spec['agent']['configuration']['tools'][0]['tool_ids']
    assert not any(t.startswith('platform.') for t in configured)
    workflow=spec['workflow']
    assert workflow['steps'][0]['agent-id']==spec['agent']['id']
    assert workflow['steps'][1]['with']['body']=='${{ steps.investigate.output.structured_output }}'
    assert 'schema' in workflow['steps'][0]['with']
    with pytest.raises(ValueError):definitions('org-a','*','connector')
    with pytest.raises(ValueError):definitions('org-a" OR true','index','connector')


def test_cloud_api_contract(monkeypatch):
    monkeypatch.setenv('ELASTIC_KIBANA_URL','https://elastic.example')
    monkeypatch.setenv('ELASTIC_KIBANA_API_KEY','test-key')
    monkeypatch.setenv('ELASTIC_WORKFLOW_ID','workflow-1')
    monkeypatch.setenv('ELASTIC_KIBANA_SPACE','finance')
    monkeypatch.setenv('ELASTIC_AGENT_ORGANIZATION_ID','org-a')
    real=httpx.Client
    def response(request):
        assert request.url.path=='/s/finance/api/workflows/workflow/workflow-1/run'
        assert request.headers['kbn-xsrf']=='true'
        assert json.loads(request.content)=={'inputs':{'investigation_id':'run-1','context':'{}'}}
        return httpx.Response(200,json={'workflowExecutionId':'exec-1'})
    monkeypatch.setattr(httpx,'Client',lambda **kw:real(transport=httpx.MockTransport(response),**kw))
    cloud=ElasticCloud();cloud.require('org-a')
    with pytest.raises(PermissionError):cloud.require('org-b')
    assert cloud.start({'investigation_id':'run-1','context':'{}'})=='exec-1'


def test_auto_event_consumption_does_not_acknowledge_devin(flow,monkeypatch):
    from app.agent_events import emit
    from app.database import agent_events
    store,svc,_,factory,cloud,sid,_=flow
    with store.engine.begin() as db:emit(db,svc.oid,'indexed:'+sid,'source.indexed',{'source_id':sid})
    monkeypatch.setenv('ELASTIC_AUTO_INVESTIGATE','true')
    assert run_once(store,factory,cloud)
    assert not run_once(store,factory,cloud)
    assert len(svc.list()['investigations'])==1
    with store.engine.connect() as db:
        assert db.execute(select(agent_events.c.acknowledged).where(agent_events.c.kind=='source.indexed')).scalar() is False


def test_retry_only_confirmed_failure_and_publication_revalidates(flow,monkeypatch):
    store,svc,_,factory,cloud,sid,chunk=flow
    row=queue(flow);run_once(store,factory,cloud)
    with pytest.raises(Conflict):svc.retry(row['id'])
    svc.accept(row['id'],finding(chunk))
    with store.engine.begin() as db:db.execute(update(sources).where(sources.c.id==sid).values(active=False))
    monkeypatch.setattr(ConcernService,'raise_concern',lambda *a:pytest.fail('stale evidence must not publish'))
    run_once(store,factory,cloud)
    assert svc.get(row['id'])['status']=='failed'
    assert svc.retry(row['id'])['status']=='reviewed'


def test_callback_before_start_response(flow):
    store,svc,_,factory,cloud,sid,chunk=flow
    row=queue(flow)
    def start(inputs):
        svc.accept(row['id'],finding(chunk))
        return 'fast-execution'
    cloud.start=start
    run_once(store,factory,cloud)
    assert svc.get(row['id'])['status']=='reviewed'
    assert svc.get(row['id'])['execution_id']=='fast-execution'


def test_failed_cloud_execution_can_be_retried(flow):
    store,svc,_,factory,cloud,_,_=flow
    row=queue(flow);run_once(store,factory,cloud)
    cloud.request=lambda *a,**kw:{'status':'failed'}
    assert svc.refresh(row['id'],cloud)['status']=='failed'
    assert svc.retry(row['id'])['status']=='pending'
    assert run_once(store,factory,cloud)
    assert len(cloud.calls)==2


def test_keyword_reranker_and_mapping_alias_upgrade(monkeypatch):
    monkeypatch.setenv('ELASTIC_INFERENCE_ID','')
    monkeypatch.setenv('ELASTIC_SEARCH_INFERENCE_ID','')
    monkeypatch.setenv('ELASTIC_RERANK_INFERENCE_ID','jina-rerank')
    search=ElasticSearch();calls=[]
    def request(method,path,**kw):
        calls.append((method,path,kw))
        if method=='GET':return {'concrete-index':{'mappings':{'properties':{'content':{'type':'text'}}}}}
        return {'hits':{'hits':[]}}
    monkeypatch.setattr(search,'request',request)
    search.ensure_index()
    assert calls[1][0]=='PUT' and 'source_version' in calls[1][2]['json']['properties']
    search.search('org-a',['source-a'],'test',8)
    rerank=calls[-1][2]['json']['retriever']['text_similarity_reranker']
    assert 'standard' in rerank['retriever']
