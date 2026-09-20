import json
import httpx
import pytest
from sqlalchemy import select,update
from app.elastic_a2a import ElasticA2A,A2AResponseError
from app.elastic_investigations import ElasticCloud,run_once
from app.elastic_setup import definitions
from app.database import sources,chunks
from test_elastic import flow,queue,finding
from test_simulator import setup

class A2ACloud:
    mode='a2a';agent_id='finance-agent'
    def __init__(self,oid,chunk):self.organization=oid;self.chunk=chunk;self.calls=[];self.fail=False
    def require(self,oid):assert oid==self.organization
    def request(self,method,path,**kw):
        self.calls.append((method,path,kw))
        if method=='GET':return {'protocolVersion':'0.3.0','url':'https://untrusted.example/never-follow'}
        if self.fail:raise httpx.ReadTimeout('do not leak credentials')
        return {'jsonrpc':'2.0','id':kw['json']['id'],'result':{'kind':'message','role':'agent','messageId':'response-1',
            'parts':[{'kind':'text','text':finding(self.chunk).model_dump_json()}]}}

def test_protocol_and_scoped_citations(flow):
    store,svc,_,factory,_,sid,chunk=flow;cloud=A2ACloud(svc.oid,chunk);row=queue(flow)
    assert run_once(store,factory,cloud)
    saved=svc.get(row['id']);assert saved['status']=='reviewed' and saved['transport']=='a2a'
    assert len(saved['citations'])==1
    assert saved['citations'][0]['id']==chunk and saved['citations'][0]['source_id']==sid
    assert saved['citations'][0]['locator']
    sent=cloud.calls[-1]
    assert sent[1]=='/api/agent_builder/a2a/finance-agent'
    assert sent[2]['json']['method']=='message/send' and sent[2]['json']['params']['configuration']['blocking'] is True
    assert not any('untrusted.example' in p for _,p,_ in cloud.calls)

def test_new_current_citation_hydrated_but_foreign_rejected(flow):
    store,svc,other,factory,_,_,_=flow
    def extra(data,name):
        sid=data.ingest(name+'.txt',b'Additional evidence discovered during search')['id']
        with store.engine.begin() as db:
            db.execute(update(sources).where(sources.c.id==sid).values(index_status='ready'))
            return db.execute(select(chunks.c.id).where(chunks.c.source_id==sid)).scalar_one()
    local=extra(svc.data,'new');row=queue(flow)
    run_once(store,factory,A2ACloud(svc.oid,local))
    assert svc.get(row['id'])['status']=='reviewed'
    assert svc.get(row['id'])['citations'][0]['id']==local
    foreign=extra(other.data,'foreign');second=queue(flow,'second')
    # Publish the first result without involving the card generator.
    from app.database import elastic_investigations as runs
    with store.engine.begin() as db:db.execute(update(runs).where(runs.c.id==row['id']).values(status='complete'))
    run_once(store,factory,A2ACloud(svc.oid,foreign))
    assert svc.get(second['id'])['result'] is None

def test_timeout_not_replayed(flow):
    store,svc,_,factory,_,_,chunk=flow;cloud=A2ACloud(svc.oid,chunk);cloud.fail=True;row=queue(flow)
    run_once(store,factory,cloud);assert svc.get(row['id'])['status']=='dispatch_unknown'
    assert not run_once(store,factory,cloud)
    assert len([c for c in cloud.calls if c[0]=='POST'])==1
    assert 'credentials' not in svc.get(row['id'])['error']

@pytest.mark.parametrize('kind',['task','data'])
def test_completed_task_and_data_parts(kind):
    cloud=A2ACloud('org','chunk');adapter=ElasticA2A(cloud)
    value=finding('chunk').model_dump()
    result={'kind':'message','role':'agent','parts':[{'kind':'data','data':value}]}
    if kind=='task':result={'kind':'task','id':'task-1','status':{'state':'completed'},'artifacts':[{'parts':result['parts']}]}
    cloud.request=lambda *a,**kw:{'jsonrpc':'2.0','id':'request-1','result':result}
    parsed,execution=adapter.investigate({'investigation_id':'request-1','context':'{}'})
    assert parsed.evidence_chunk_ids==['chunk'] and execution.startswith('a2a:')

@pytest.mark.parametrize('result',[
    {'kind':'task','id':'pending','status':{'state':'working'}},
    {'kind':'message','role':'user','parts':[]},
    {'kind':'message','role':'agent','parts':[{'kind':'text','text':'Not JSON'}]},
    {'kind':'message','role':'agent','parts':[{'kind':'data','data':{}},{'kind':'data','data':{}}]},
])
def test_invalid_results_rejected(result):
    cloud=A2ACloud('org','chunk');cloud.request=lambda *a,**kw:{'jsonrpc':'2.0','id':'request','result':result}
    with pytest.raises(A2AResponseError):ElasticA2A(cloud).investigate({'investigation_id':'request','context':'{}'})

def test_discovery_rejects_unknown_version():
    cloud=A2ACloud('org','chunk');cloud.request=lambda *a,**kw:{'protocolVersion':'1.0.0'}
    with pytest.raises(ValueError,match='Unsupported'):ElasticA2A(cloud).prepare()

def test_a2a_definitions_do_not_need_callback():
    spec=definitions('org-a','company-index','',transport='a2a')
    assert 'workflow' not in spec
    assert 'backend validates' in spec['agent']['configuration']['instructions']
    for tool in spec['tools']:assert 'organization_id == "org-a"' in tool['configuration']['query']

def test_configured_http_auth_and_organization(monkeypatch):
    monkeypatch.setenv('ELASTIC_AGENT_TRANSPORT','a2a');monkeypatch.setenv('ELASTIC_A2A_AGENT_ID','agent')
    monkeypatch.setenv('ELASTIC_KIBANA_URL','https://elastic.example');monkeypatch.setenv('ELASTIC_KIBANA_API_KEY','test-key')
    monkeypatch.setenv('ELASTIC_KIBANA_SPACE','finance');monkeypatch.setenv('ELASTIC_AGENT_ORGANIZATION_ID','org-a')
    real=httpx.Client
    def respond(request):
        assert request.headers['Authorization']=='ApiKey test-key'
        assert request.url.path=='/s/finance/api/agent_builder/a2a/agent.json'
        return httpx.Response(200,json={'protocolVersion':'0.3.0'})
    monkeypatch.setattr(httpx,'Client',lambda **kw:real(transport=httpx.MockTransport(respond),**kw))
    cloud=ElasticCloud();cloud.require('org-a')
    with pytest.raises(PermissionError):cloud.require('org-b')
    assert ElasticA2A(cloud).prepare()['protocolVersion']=='0.3.0'
