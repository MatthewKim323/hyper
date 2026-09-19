import json
import httpx
import pytest
from fastapi.testclient import TestClient
from app import main,data_api,data_tools
from app.artifacts import ArtifactService
from app.fast_artifacts import ComposeArtifact,compose
from app.data_service import FinancialQuery
from test_simulator import setup
from test_artifacts import snapshot


def args(key='fast-1'):
    return ComposeArtifact(request_key=key,prompt='Show the revenue trend',unit='major_currency',
        query=FinancialQuery(dataset='monthly',operation='sum',field='revenue',group_by=['month']))


@pytest.fixture
def flow(setup,monkeypatch):
    store,a,b,_,_=setup
    monkeypatch.setattr(a.data,'query_financials',lambda q:snapshot())
    real=httpx.Client;calls=[]
    def respond(req):
        calls.append(req)
        assert req.url.path=='/artifact-compose'
        body=json.loads(req.content);props=body['chartProps'];notes=body['notes']
        return httpx.Response(200,json={'chart':'bar','html':'<html>Static export</html>',
            'spec':{'root':'node_0','elements':{'node_0':{'type':'FinancialArtifactCard','children':[],
                'props':{**props,'chart':'bar','points':{'$state':'/points'},'notes':{'$state':'/notes'}}}},
                'state':{'points':props['points'],'notes':notes}},
            'evaluation':{'purpose':'presentation_selection','stop_reason':'finish','evaluations':1}})
    monkeypatch.setattr(httpx,'Client',lambda **kw:real(transport=httpx.MockTransport(respond),**kw))
    return store,a.data,b.data,calls


def test_one_call_persisted_idempotent_and_scoped(flow):
    store,data,other,calls=flow
    result=compose(data,args())
    assert result['status']=='ready'
    assert [p['value'] for p in result['spec']['state']['points']]==['100','110']
    assert result['spec']['elements']['node_0']['props']['chart']=='bar'
    assert compose(data,args())['id']==result['id']
    assert len(calls)==1
    with pytest.raises(LookupError):ArtifactService(other).get(result['id'])
    with pytest.raises(ValueError):compose(data,args().model_copy(update={'prompt':'Different request'}))
    assert 'Static export' in ArtifactService(data).html(result['id'])


def test_api_and_agent_tool_dispatch(flow,monkeypatch):
    store,data,other,calls=flow
    main.app.dependency_overrides[data_api.service]=lambda:data
    try:
        client=TestClient(main.app)
        response=client.post('/artifacts/compose',json=args().model_dump())
        assert response.status_code==200 and response.json()['status']=='ready'
    finally:main.app.dependency_overrides.clear()
    monkeypatch.setattr(data_tools,'DataService',lambda *a,**kw:data)
    response=data_tools.execute(store,data.oid,'compose_financial_artifact',args('agent').model_dump())
    assert response['status']=='ready'
    assert len(calls)==2


def test_failure_can_retry_same_key_and_mutated_values_rejected(flow,monkeypatch):
    _,data,_,calls=flow
    real=httpx.Client
    class Broken:
        def __enter__(self):return self
        def __exit__(self,*a):pass
        def post(self,*a,**kw):raise httpx.ReadTimeout('secret provider detail')
    monkeypatch.setattr(httpx,'Client',lambda **kw:Broken())
    failed=compose(data,args())
    assert failed['status']=='failed' and 'secret provider detail' not in failed['error']
    monkeypatch.setattr(httpx,'Client',real)
    ready=compose(data,args())
    assert ready['id']==failed['id'] and ready['status']=='ready'
    assert len(calls)==1


def test_rejects_projection_in_fast_path():
    with pytest.raises(ValueError):ComposeArtifact(**{**args().model_dump(),'projection_months':1})


def test_rejects_composer_changing_snapshot(flow,monkeypatch):
    _,data,_,_=flow
    # Wrap the otherwise valid provider fixture and corrupt just one returned value.
    factory=httpx.Client
    class Corrupt:
        def __enter__(self):self.inner=factory();return self
        def __exit__(self,*a):self.inner.close()
        def post(self,*a,**kw):
            response=self.inner.post(*a,**kw)
            body=response.json();body['spec']['state']['points'][0]['value']='999999'
            return httpx.Response(200,json=body,request=response.request)
    monkeypatch.setattr(httpx,'Client',lambda **kw:Corrupt())
    result=compose(data,args())
    assert result['status']=='failed' and result['spec'] is None
