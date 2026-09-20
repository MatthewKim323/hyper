import json
import pytest
from pydantic import ValidationError
from app.learned_skills import Skills,Draft,Run,Activate,Search,Retire
from test_simulator import setup

class Objects:
    def __init__(self):self.values={}
    def put(self,key,body,kind):self.values[key]=body
    def read(self,key):return self.values[key]
class SearchDown:
    def search(self,*args):raise RuntimeError('offline')
    def ensure_index(self):raise RuntimeError('offline')

ATTEST='I independently reviewed the tests, accounting assumptions, and evidence for this skill version'

def init(setup):
    store,a,b,_,_=setup;objects=Objects()
    source=a.data.ingest('evidence.txt',b'Test execution evidence: two independent arithmetic checks passed.')['id']
    svc=Skills(store,a.oid,objects,SearchDown())
    body=Draft(name='service-accrual',description='Calculate confirmed fixed-rate service expense accruals',instructions='Read the contract and confirmed receipts. Run scripts/calculate.py and tests/test_calc.py before preparing a journal.',applicability='Confirmed whole-unit USD service expenses only.',limitations='No taxes, FX or unconfirmed services; never post journals.',source_ids=[source],resources={'scripts/calculate.py':'def amount(qty, price): return qty * price\n','tests/test_calc.py':'from calculate import amount\nassert amount(40, 100000) == 4000000\n'})
    result=svc.save(body)
    return svc,body,result,source,objects,b

def report(svc,result,source,key='first',outcome='passed'):
    return svc.record(Run(skill_id=result['id'],request_key=key,package_hash=result['package_hash'],outcome=outcome,summary='Executed saved code against independent expected totals.',evidence_source_ids=[source],checks=['40 units times 100000 minor units equals 4000000'],duration_ms=100))
def activate(svc,result,run):
    return svc.activate(Activate(skill_id=result['id'],package_hash=result['package_hash'],run_id=run['run_id'],attestation=ATTEST),'human:alice')

def test_progressive_disclosure_and_activation(setup):
    svc,body,result,source,objects,_=init(setup)
    assert svc.save(body)==result
    assert svc.search(Search(query='accrual'))['skills']==[]
    loaded=svc.get(result['id']);assert 'skill_md' in loaded and 'def amount' not in json.dumps(loaded)
    assert svc.get(result['id'],'scripts/calculate.py')['content'].startswith('def amount')
    measured=report(svc,result,source);assert measured['verification']=='self_reported'
    assert activate(svc,result,measured)['status']=='active'
    found=svc.search(Search(query='accrual'))
    assert found['search_mode']=='keyword_fallback' and len(found['skills'])==1
    assert 'skill_md' not in json.dumps(found)

def test_failure_quarantines_and_latest_report_controls(setup):
    svc,body,result,source,_,_=init(setup)
    first=report(svc,result,source);activate(svc,result,first)
    report(svc,result,source,'failed','failed')
    assert svc.get(result['id'])['status']=='quarantined'
    assert not svc.search(Search())['skills']
    with pytest.raises(ValueError,match='latest'):activate(svc,result,first)
    last=report(svc,result,source,'retest');assert activate(svc,result,last)['status']=='active'

def test_versions_tenant_boundaries_and_retirement(setup):
    svc,body,result,source,objects,b=init(setup)
    with pytest.raises(LookupError):Skills(svc.store,b.oid,objects).get(result['id'])
    with pytest.raises(LookupError):Skills(svc.store,b.oid,objects).save(body)
    activate(svc,result,report(svc,result,source))
    changed=body.model_copy(update={'instructions':body.instructions+' Handle a missing receipt by escalating.'})
    with pytest.raises(ValueError,match='conflict'):svc.save(changed)
    second=svc.save(changed.model_copy(update={'based_on_version':1}));assert second['version']==2
    activate(svc,second,report(svc,second,source,'second'))
    assert svc.get(result['id'])['status']=='retired'
    assert [r['id'] for r in svc.search(Search())['skills']]==[second['id']]
    svc.retire(Retire(skill_id=second['id'],reason='Policy no longer applies'),'human:alice')
    assert not svc.search(Search())['skills']

def test_stale_evidence_and_integrity(setup):
    svc,body,result,source,objects,_=init(setup);activate(svc,result,report(svc,result,source))
    _,a,_,_,_=setup
    a.data.ingest('evidence.txt',b'Corrected evidence: original checks failed.')
    assert svc.get(result['id'])['status']=='stale'
    assert not svc.search(Search())['skills']
    with pytest.raises(ValueError,match='stale'):activate(svc,result,{'run_id':'missing'})
    key=next(iter(objects.values));objects.values[key]=b'{}'
    with pytest.raises(ValueError,match='integrity'):svc.get(result['id'])

@pytest.mark.parametrize('path',['../evil.py','scripts/../../evil.py','/tmp/code.py','scripts/a\\b.py','SKILL.md'])
def test_resource_paths(setup,path):
    _,body,_,_,_,_=init(setup)
    with pytest.raises(ValidationError):Draft(**dict(body.model_dump(),resources={path:'bad'}))

def test_activation_requires_tests_and_idempotency(setup):
    svc,body,result,source,_,_=init(setup)
    first=report(svc,result,source)
    assert report(svc,result,source)==first
    with pytest.raises(ValueError,match='reused'):report(svc,result,source,outcome='failed')
    second=svc.save(body.model_copy(update={'resources':{},'based_on_version':1}))
    with pytest.raises(ValueError,match='tests'):activate(svc,second,report(svc,second,source,'second'))

def test_http_owner_boundary(setup,monkeypatch):
    import time
    from fastapi.testclient import TestClient
    from app import main,auth,skills_api,data_tools
    store,a,_,_,_=setup;svc,body,result,source,_,_=init(setup)
    measured=report(svc,result,source)
    monkeypatch.setattr(main,'store',store);monkeypatch.setattr(skills_api,'library',lambda data:Skills(store,data.oid,svc.objects,SearchDown()))
    monkeypatch.setattr(auth,'verify',lambda token:auth.Identity(token,int(time.time())+300))
    store.add_member('member',a.oid);url='/skills/'+result['id']
    with TestClient(main.app) as client:
        assert client.get(url).status_code==401
        assert client.get(url,headers={'Authorization':'Bearer bob'}).status_code==404
        payload={'skill_id':result['id'],'package_hash':result['package_hash'],'run_id':measured['run_id'],'attestation':ATTEST}
        assert client.post(url+'/activate',json=payload,headers={'Authorization':'Bearer member'}).status_code==403
        assert client.post(url+'/activate',json=payload,headers={'Authorization':'Bearer alice'}).status_code==200
    assert 'activate_learned_skill' not in data_tools.DESCRIPTIONS

def test_execution_evidence_and_draft_discovery(setup):
    from app.learned_skills import ExecutionEvidence
    svc,body,result,source,_,_=init(setup)
    evidence=svc.save_evidence(ExecutionEvidence(request_key='run-001',content='Executed tests/test_calc.py; expected 4000000; actual 4000000; exit code 0.'))
    assert evidence['id']
    assert svc.save_evidence(ExecutionEvidence(request_key='run-001',content='Executed tests/test_calc.py; expected 4000000; actual 4000000; exit code 0.'))['id']==evidence['id']
    drafts=svc.search(Search(include_inactive=True))['skills']
    assert drafts[0]['id']==result['id'] and drafts[0]['status']=='draft'
    assert 'content' not in drafts[0]
