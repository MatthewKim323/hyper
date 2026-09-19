import pytest
from sqlalchemy import select,update
from app.orchestrator import AgentService,PutCase,CaseState,Delegate,Report,Page,EventAck,Checkpoint,authenticate,execute,ServiceError
from app.database import agent_controllers as controllers,agent_tasks as tasks
from app.devin_worker import run_once
from test_simulator import setup

@pytest.fixture(autouse=True)
def legacy_coordinator_mode(monkeypatch):
    monkeypatch.setenv('DEVIN_COORDINATOR_ENABLED','true')

class Provider:
    def __init__(self):self.sessions={};self.created=[];self.messages=[];self.timeout=False
    def create(self,prompt,key,token):
        sid='devin-'+str(len(self.created)+1)
        self.created.append((prompt,key,token))
        self.sessions[sid]={'session_id':sid,'status':'running','status_detail':'working','tags':[key]}
        if self.timeout:raise TimeoutError()
        return self.sessions[sid]
    def get(self,sid):return self.sessions[sid]
    def find(self,key):return next((s for s in self.sessions.values() if key in s['tags']),None)
    def message(self,sid,message):self.messages.append((sid,message))

def due(store,oid):
    with store.engine.begin() as db:db.execute(update(controllers).where(controllers.c.organization_id==oid).values(next_poll_at=0))


def test_dispatch_session_reuse_worker_scope_and_result(setup,monkeypatch):
    store,a,b,_,_=setup
    monkeypatch.setenv('AGENT_PUBLIC_BASE_URL','https://example.test')
    source=a.data.ingest('invoice.txt',b'Invoice 123: $100')['id']
    svc=AgentService(store,a.oid);svc.enable(True);p=Provider()
    assert run_once(store,p)
    assert len(p.created)==1
    ident=authenticate(store,p.created[0][2])
    assert ident['organization_id']==a.oid
    case=execute(store,ident,'update_case',{'case_key':'invoice123','title':'Invoice review','expected_version':0,'state':{'source_ids':[source]}})
    with pytest.raises(ServiceError):svc.put_case(PutCase(case_key='invoice123',title='x',expected_version=0,state=CaseState()))
    with pytest.raises(LookupError):AgentService(store,b.oid).get_case(case['id'])
    task=svc.delegate(Delegate(request_key='check',case_id=case['id'],objective='Reconcile invoice'))
    assert svc.delegate(Delegate(request_key='check',case_id=case['id'],objective='Reconcile invoice'))['id']==task['id']
    due(store,a.oid);run_once(store,p)
    assert len(p.created)==2
    worker=authenticate(store,p.created[1][2])
    with pytest.raises(PermissionError):execute(store,worker,'delegate_task',{'case_id':case['id'],'request_key':'escape','objective':'escape'})
    with pytest.raises(PermissionError):execute(store,worker,'report_task_result',{'task_id':'wrong'})
    result=execute(store,worker,'report_task_result',{'task_id':task['id'],'outcome':'complete','summary':'Invoice matches supporting evidence.','source_ids':[source]})
    assert result['status']=='complete'
    with pytest.raises(PermissionError):authenticate(store,p.created[1][2])
    events=svc.list_events(Page())['events']
    assert any(e['kind']=='task.finished' for e in events)
    sid=svc.controller()['session_id'];p.sessions[sid].update(status='suspended',status_detail='inactivity')
    due(store,a.oid);run_once(store,p)
    assert p.messages and len(p.created)==2
    svc.ack_events(EventAck(event_ids=[e['id'] for e in svc.list_events(Page())['events']]))
    assert svc.list_events(Page())['events']==[]
    svc.enable(False)
    with pytest.raises(PermissionError):authenticate(store,p.created[0][2])


def test_uncertain_create_reconciled_without_duplicate(setup,monkeypatch):
    store,a,_,_,_=setup
    monkeypatch.setenv('AGENT_PUBLIC_BASE_URL','https://example.test')
    svc=AgentService(store,a.oid);svc.enable(True);p=Provider();p.timeout=True
    run_once(store,p)
    assert len(p.created)==1
    due(store,a.oid);run_once(store,p)
    assert svc.controller()['session_id']=='devin-1'
    assert len(p.created)==1


def test_two_worker_limit_and_controller_recovery(setup,monkeypatch):
    store,a,_,_,_=setup
    monkeypatch.setenv('AGENT_PUBLIC_BASE_URL','https://example.test')
    svc=AgentService(store,a.oid);svc.enable(True);p=Provider();run_once(store,p)
    case=svc.put_case(PutCase(case_key='x',title='x',expected_version=0,state=CaseState()))
    for i in range(3):svc.delegate(Delegate(request_key=str(i),case_id=case['id'],objective='Investigate '+str(i)))
    due(store,a.oid);run_once(store,p)
    assert len(p.created)==3 # coordinator + two workers
    assert sum(t['status']=='queued' for t in svc.list_tasks(Page())['tasks'])==1
    svc.checkpoint(Checkpoint(summary='Preserve these findings'))
    p.sessions['devin-1']['status']='error'
    due(store,a.oid);run_once(store,p)
    assert svc.controller()['session_id'] is None
    due(store,a.oid);run_once(store,p)
    assert len(p.created)==4
    assert 'Preserve these findings' in p.created[-1][0]


def test_machine_api_rejects_cross_task_and_disabled_org(setup,monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    store,a,_,_,_=setup
    monkeypatch.setenv('AGENT_PUBLIC_BASE_URL','https://example.test')
    monkeypatch.setattr(main,'store',store)
    svc=AgentService(store,a.oid);svc.enable(True);p=Provider();run_once(store,p)
    headers={'Authorization':'Bearer '+p.created[0][2]}
    with TestClient(main.app) as client:
        assert client.get('/agents/tool-definitions').status_code==401
        assert client.get('/agents/tool-definitions',headers=headers).status_code==200
        response=client.post('/agents/tools',headers=headers,json={'name':'list_events','arguments':{}})
        assert response.status_code==200 and response.json()['events']
        svc.enable(False)
        assert client.post('/agents/tools',headers=headers,json={'name':'list_events','arguments':{}}).status_code==401


def test_launch_budget_and_quota_do_not_spawn_more_sessions(setup,monkeypatch):
    store,a,_,_,_=setup
    monkeypatch.setenv('AGENT_PUBLIC_BASE_URL','https://example.test')
    monkeypatch.setenv('DEVIN_MAX_SESSIONS_PER_ORG','1')
    svc=AgentService(store,a.oid);svc.enable(True);p=Provider();run_once(store,p)
    case=svc.put_case(PutCase(case_key='x',title='x',expected_version=0,state=CaseState()))
    svc.delegate(Delegate(request_key='work',case_id=case['id'],objective='Inspect invoice'))
    due(store,a.oid);run_once(store,p)
    assert len(p.created)==1
    assert svc.controller()['status']=='blocked'

def test_dashboard_worker_only_dispatch_and_recovery(setup,monkeypatch):
    from app.orchestrator import Investigation
    from app import dashboard
    store,a,b,_,_=setup
    monkeypatch.setenv('DEVIN_COORDINATOR_ENABLED','false')
    monkeypatch.setenv('AGENT_PUBLIC_BASE_URL','https://example.test')
    source=a.data.ingest('evidence.txt',b'Invoice 123: $100')['id']
    state={'organization_id':a.oid}
    args={'request_key':'first','title':'Invoice review','objective':'Reconcile invoice 123','source_ids':[source]}
    task=dashboard.execute(store,state,'start_investigation',args)
    assert dashboard.execute(store,state,'start_investigation',args)['id']==task['id']
    svc=AgentService(store,a.oid)
    with pytest.raises(ServiceError):svc.start_investigation(Investigation(**{**args,'objective':'different'}))
    with pytest.raises(LookupError):dashboard.execute(store,{'organization_id':b.oid},'get_investigation',{'task_id':task['id']})
    p=Provider();p.timeout=True
    run_once(store,p)
    assert len(p.created)==1 and 'investigator' in p.created[0][0]
    due(store,a.oid);run_once(store,p)
    assert len(p.created)==1
    assert svc.controller()['session_id'] is None
    worker=authenticate(store,p.created[0][2])
    assert worker['role']=='worker'
    execute(store,worker,'report_task_result',{'task_id':task['id'],'outcome':'complete','summary':'Invoice matches','source_ids':[source]})
    result=dashboard.execute(store,state,'get_investigation',{'task_id':task['id']})
    assert result['result']['source_ids']==[source] and result['status']=='complete'
    due(store,a.oid);run_once(store,p)
    assert len(p.created)==1 # completion/source events never spawn a coordinator
    svc.enable(False)
    with pytest.raises(ServiceError):svc.start_investigation(Investigation(**{**args,'request_key':'paused'}))


def test_worker_only_limit_and_budget(setup,monkeypatch):
    from app.orchestrator import Investigation
    store,a,_,_,_=setup
    monkeypatch.setenv('DEVIN_COORDINATOR_ENABLED','false')
    monkeypatch.setenv('AGENT_PUBLIC_BASE_URL','https://example.test')
    monkeypatch.setenv('DEVIN_MAX_SESSIONS_PER_ORG','2')
    svc=AgentService(store,a.oid)
    for i in range(3):svc.start_investigation(Investigation(request_key=str(i),title='Review',objective='Review '+str(i)))
    p=Provider();run_once(store,p)
    assert len(p.created)==2 and svc.controller()['session_id'] is None
    assert sum(t['status']=='queued' for t in svc.list_tasks(Page())['tasks'])==1
    p.sessions['devin-1']['status']='error'
    due(store,a.oid);run_once(store,p)
    assert len(p.created)==2 and svc.controller()['status']=='blocked'

def test_missing_evidence_can_be_reported_but_not_completed():
    assert Report(task_id='task',outcome='needs_input',summary='No documents available').source_ids==[]
    with pytest.raises(ValueError):Report(task_id='task',outcome='complete',summary='Done')
