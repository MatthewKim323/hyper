import time
import pytest
from sqlalchemy import insert
from app.database import agent_tasks, agent_cases, agent_case_updates, agent_attempts
from app.learned_skills import Skills
from app.skill_extraction import Extractions
from test_simulator import setup

NOW=int(time.time()*1000)

class Objects:
    def __init__(self):self.values={}
    def put(self,key,body,kind):self.values[key]=body
    def read(self,key):return self.values[key]

def init(setup):
    store,a,b,_,_=setup;objects=Objects()
    source=a.data.ingest('evidence.txt',b'Execution evidence: independent accrual checks passed.')['id']
    return store,a,b,Extractions(store,a.oid,objects=objects),source,objects

def complete_state(source=None,**kw):
    state={'findings':['Reconciled the accrual against confirmed deliveries'],'unknowns':[],
        'next_actions':[],'source_ids':[source] if source else [],'concern_ids':[]}
    state.update(kw);return state

def add_case(store,oid,cid='case_1',state=None):
    state=state if state is not None else complete_state()
    with store.engine.begin() as db:
        db.execute(insert(agent_cases).values(id=cid,organization_id=oid,case_key='key-'+cid,
            title='Service accrual investigation',state=state,version=2,updated_at=NOW))
        db.execute(insert(agent_case_updates).values(id='update_'+cid,case_id=cid,version=2,state=state,created_at=NOW))

def add_task(store,oid,tid='task_1',cid='case_1',status='complete',result=None):
    with store.engine.begin() as db:
        db.execute(insert(agent_tasks).values(id=tid,organization_id=oid,case_id=cid,request_key='req-'+tid,
            objective='Reconcile the September service accrual',status=status,result=result,created_at=NOW,
            credential_expires=0,lease_until=0,next_poll_at=0))

def add_attempt(store,oid,target='task_1'):
    with store.engine.begin() as db:
        db.execute(insert(agent_attempts).values(id='attempt_'+target,organization_id=oid,target_id=target,
            operation='create',status='succeeded',details={'session_id':'sess_1'},created_at=NOW))

def args(tid,key='extract-1',**kw):
    body={'task_id':tid,'name':'accrual-reconciliation',
        'description':'Reconcile fixed-rate service accruals from confirmed deliveries',
        'instructions':'Load contract, delivery and ledger evidence. Run scripts/calculate.py and tests/test_calc.py before drafting any journal.',
        'applicability':'Confirmed fixed-rate USD service accruals only.',
        'limitations':'No taxes, FX, unconfirmed deliveries or posting authority.',
        'resources':{'scripts/calculate.py':'def amount(qty,price): return qty*price\n',
            'tests/test_calc.py':'from calculate import amount\nassert amount(40,100000)==4000000\n'},
        'request_key':key}
    body.update(kw);return body

def case_args(cid,key='extract-1',**kw):
    body=args('unused',key,**kw);del body['task_id'];body['case_id']=cid;return body

def test_completed_task_extracts_retrievable_draft_and_lineage(setup):
    store,a,_,svc,source,objects=init(setup)
    add_case(store,a.oid);add_attempt(store,a.oid)
    add_task(store,a.oid,result={'outcome':'complete','summary':'Reconciled','source_ids':[source]})
    out=svc.execute('draft_skill_from_task',args('task_1'))
    assert out['status']=='draft' and out['version']==1 and out['extraction_id']
    prov=out['provenance']
    assert (prov['task_status'],prov['attempt_count'],prov['evidence_source_ids'],prov['name'],prov['version'])==('complete',1,[source],'accrual-reconciliation',1)
    draft=Skills(store,a.oid,objects).get(out['id'])
    assert draft['name']=='accrual-reconciliation' and 'tests/test_calc.py' in draft['resources']
    rows=svc.execute('get_skill_lineage',{'skill_id':out['id']})['extractions']
    assert len(rows)==1 and rows[0]['id']==out['extraction_id']
    assert rows[0]['origin']=={'kind':'agent_task','ref_id':'task_1'} and rows[0]['request_key']=='extract-1'
    assert rows[0]['report']['task_status']=='complete' and rows[0]['created_at']

@pytest.mark.parametrize('status',['queued','launching','running','needs_input','failed'])
def test_unfinished_task_rejected(setup,status):
    store,a,_,svc,_,_=init(setup)
    add_case(store,a.oid);add_task(store,a.oid,status=status)
    with pytest.raises(ValueError,match=status):svc.execute('draft_skill_from_task',args('task_1'))
    with pytest.raises(LookupError):svc.execute('draft_skill_from_task',args('missing'))

def test_evidence_required_and_explicit_ids_accepted(setup):
    store,a,_,svc,source,_=init(setup)
    add_case(store,a.oid)
    add_task(store,a.oid,result={'outcome':'complete','summary':'Done without citations','source_ids':[]})
    with pytest.raises(ValueError,match='evidence'):svc.execute('draft_skill_from_task',args('task_1'))
    with pytest.raises(LookupError):svc.execute('draft_skill_from_task',args('task_1',evidence_source_ids=['src_missing']))
    out=svc.execute('draft_skill_from_task',args('task_1',evidence_source_ids=[source]))
    assert out['provenance']['evidence_source_ids']==[source]

def test_tests_resource_required(setup):
    store,a,_,svc,source,_=init(setup)
    add_case(store,a.oid)
    add_task(store,a.oid,result={'outcome':'complete','summary':'Done','source_ids':[source]})
    bad=args('task_1',resources={'scripts/calculate.py':'def amount(qty,price): return qty*price\n'})
    with pytest.raises(ValueError,match='tests/'):svc.execute('draft_skill_from_task',bad)

def test_request_key_idempotency(setup):
    store,a,_,svc,source,_=init(setup)
    add_case(store,a.oid)
    add_task(store,a.oid,result={'outcome':'complete','summary':'Done','source_ids':[source]})
    first=svc.execute('draft_skill_from_task',args('task_1'))
    assert svc.execute('draft_skill_from_task',args('task_1'))==first
    changed=args('task_1',description='A different description under the same request key')
    with pytest.raises(ValueError,match='reused'):svc.execute('draft_skill_from_task',changed)
    add_task(store,a.oid,tid='task_2',result={'outcome':'complete','summary':'Other','source_ids':[source]})
    with pytest.raises(ValueError,match='reused'):svc.execute('draft_skill_from_task',args('task_2'))
    assert len(svc.execute('get_skill_lineage',{'skill_id':first['id']})['extractions'])==1

def test_tenant_isolation(setup):
    store,a,b,svc,source,objects=init(setup)
    add_case(store,a.oid)
    add_task(store,a.oid,result={'outcome':'complete','summary':'Done','source_ids':[source]})
    out=svc.execute('draft_skill_from_task',args('task_1'))
    other=Extractions(store,b.oid,objects=objects)
    with pytest.raises(LookupError):other.execute('draft_skill_from_task',args('task_1'))
    assert other.execute('get_skill_lineage',{'skill_id':out['id']})['extractions']==[]
    add_case(store,b.oid,cid='case_b');add_task(store,b.oid,tid='task_b',cid='case_b',
        result={'outcome':'complete','summary':'Done','source_ids':[]})
    foreign=args('task_b',request_key='other',evidence_source_ids=[source])
    with pytest.raises(LookupError):other.execute('draft_skill_from_task',foreign)

def test_case_extraction(setup):
    store,a,_,svc,source,objects=init(setup)
    add_case(store,a.oid,state=complete_state(source));add_attempt(store,a.oid,target='case_1')
    out=svc.execute('draft_skill_from_case',case_args('case_1'))
    assert out['status']=='draft'
    rows=svc.execute('get_skill_lineage',{'skill_id':out['id']})['extractions']
    assert rows[0]['origin']=={'kind':'agent_case','ref_id':'case_1'}
    assert rows[0]['report']['update_count']==1 and rows[0]['report']['attempt_count']==1
    assert rows[0]['report']['evidence_source_ids']==[source]

@pytest.mark.parametrize('state',[complete_state(next_actions=['Awaiting a user decision']),
    {'findings':[],'unknowns':[],'next_actions':[],'source_ids':[],'concern_ids':[]}])
def test_incomplete_case_rejected(setup,state):
    store,a,_,svc,_,_=init(setup)
    add_case(store,a.oid,state=state)
    with pytest.raises(ValueError,match='completion'):svc.execute('draft_skill_from_case',case_args('case_1'))

def test_http_permissions(setup,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app import main,auth,skill_extraction_api
    store,a,b,svc,source,objects=init(setup)
    add_case(store,a.oid)
    add_task(store,a.oid,result={'outcome':'complete','summary':'Done','source_ids':[source]})
    monkeypatch.setattr(main,'store',store)
    monkeypatch.setattr(auth,'verify',lambda token:auth.Identity(token,int(time.time())+300))
    monkeypatch.setattr(skill_extraction_api,'library',lambda data:Extractions(store,data.oid,objects=objects))
    store.add_member('member',a.oid)
    app=FastAPI();app.include_router(skill_extraction_api.router)
    with TestClient(app) as client:
        body=args('task_1')
        assert client.post('/accounting/skills/extract/task',json=body).status_code==401
        assert client.post('/accounting/skills/extract/task',json=body,headers={'Authorization':'Bearer bob'}).status_code==404
        result=client.post('/accounting/skills/extract/task',json=body,headers={'Authorization':'Bearer member'})
        assert result.status_code==200;result=result.json();sid=result['id']
        assert client.get('/accounting/skills/lineage/'+sid).status_code==401
        assert client.get('/accounting/skills/lineage/'+sid,headers={'Authorization':'Bearer bob'}).json()['extractions']==[]
        rows=client.get('/accounting/skills/lineage/'+sid,headers={'Authorization':'Bearer member'}).json()['extractions']
        assert rows[0]['id']==result['extraction_id']
        conflict=args('task_1',description='A different description under the same request key')
        assert client.post('/accounting/skills/extract/task',json=conflict,headers={'Authorization':'Bearer member'}).status_code==409
