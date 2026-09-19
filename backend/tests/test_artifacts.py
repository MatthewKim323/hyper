import httpx
import pytest
from app.artifacts import ArtifactService,CreateArtifact,calculate_spec,run_once
from app.data_service import FinancialQuery
from test_simulator import setup


def snapshot():
    return {'results':[{'group':{'month':'2026-01'},'currency':'USD','value':'100'},{'group':{'month':'2026-02'},'currency':'USD','value':'110'}],'has_more':False,'source_ids':['snapshot-source']}


def request(key='chart'):
    return CreateArtifact(request_key=key,prompt='Show revenue with a hypothetical growth scenario',unit='major_currency',projection_months=2,
        query=FinancialQuery(dataset='monthly',operation='sum',field='revenue',group_by=['month']))


def test_snapshot_calculation_and_isolation(setup,monkeypatch):
    store,a,b,_,_=setup
    a.data.ingest('monthly.csv',b'month,revenue\n2026-01,100\n2026-02,110\n',dataset='monthly',currency='USD',field_types={'month':'text','revenue':'numeric'})
    monkeypatch.setattr(a.data,'query_financials',lambda query: snapshot())
    svc=ArtifactService(a.data);row=svc.create(request())
    assert svc.create(request())['id']==row['id']
    with pytest.raises(LookupError):ArtifactService(b.data).get(row['id'])
    plan={'title':'Revenue','chart':'line','summary':'Monthly gross revenue','growth_percent':'10','assumption':'Hypothetical 10% per month'}
    spec=calculate_spec(row['request'],row['snapshot'],plan)
    points=spec['elements']['chart']['props']['points']
    assert [p['value'] for p in points]==['100','110','121.00','133.10']
    assert points[-1]['period']=='2026-04'
    assert points[-1]['kind']=='projected'
    assert 'not a prediction' in spec['elements']['notes']['props']['text']
    assert row['snapshot']['source_ids']


def test_no_partial_or_mixed_currency_artifacts(setup,monkeypatch):
    _,a,_,_,_=setup
    a.data.ingest('a.csv',b'month,revenue\n2026-01,100\n2026-02,200\n',dataset='monthly',currency='USD')
    monkeypatch.setattr(a.data,'query_financials',lambda query: dict(snapshot(),has_more=True))
    req=request();req.query.limit=1
    with pytest.raises(ValueError,match='truncated'):ArtifactService(a.data).create(req)
    mixed=snapshot();mixed['results'][1]['currency']='EUR'
    monkeypatch.setattr(a.data,'query_financials',lambda query:mixed)
    with pytest.raises(ValueError,match='currency'):ArtifactService(a.data).create(request())


def test_worker_jev_gate_and_saved_spec(setup,monkeypatch):
    store,a,_,_,_=setup
    a.data.ingest('a.csv',b'month,revenue\n2026-01,100\n',dataset='monthly',currency='USD')
    monkeypatch.setattr(a.data,'query_financials',lambda query: snapshot())
    svc=ArtifactService(a.data);row=svc.create(request())
    approved=False;real=httpx.Client
    def respond(req):
        if req.url.path=='/artifact-plan':return httpx.Response(200,json={'title':'Revenue','chart':'bar','summary':'One month','growth_percent':'0','assumption':'Flat scenario'})
        return httpx.Response(200,json={'approved':approved,'html':'<html>Chart</html>','evaluation':{'model':'typesafe-ai/jev'}})
    monkeypatch.setattr(httpx,'Client',lambda **kw:real(transport=httpx.MockTransport(respond),**kw))
    assert run_once(store)
    assert svc.get(row['id'])['status']=='failed'
    with pytest.raises(ValueError):svc.html(row['id'])
    approved=True;row=svc.create(request('new-run'))
    assert run_once(store)
    assert svc.get(row['id'])['status']=='ready'
    assert '<html>' in svc.html(row['id'])


def test_artifact_route_returns_202_and_scopes_reads(setup,monkeypatch):
    from fastapi.testclient import TestClient
    from app import main,data_api
    store,a,b,_,_=setup
    monkeypatch.setattr(main,'store',store)
    monkeypatch.setattr(a.data,'query_financials',lambda query:snapshot())
    main.app.dependency_overrides[data_api.service]=lambda:a.data
    try:
        with TestClient(main.app) as client:
            response=client.post('/artifacts',json=request().model_dump())
            assert response.status_code==202
            aid=response.json()['id']
            assert client.get('/artifacts/'+aid).json()['status']=='pending'
            assert client.get('/artifacts/'+aid+'/html').status_code==422
            main.app.dependency_overrides[data_api.service]=lambda:b.data
            assert client.get('/artifacts/'+aid).status_code==404
    finally:main.app.dependency_overrides.clear()
