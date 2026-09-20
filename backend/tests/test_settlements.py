import json
import pytest
from pydantic import ValidationError
from app.settlements import Batch, Statement, Settlements, Verify, calculate
from test_simulator import setup


def packets():
    batch={'batch_id':'batch-1','bank_account_id':'bank-1','bank_reference':'payout-1','currency':'USD',
           'expected_arrival':'2026-09-19','complete':True,'declared_count':7,'payout_minor':82500,
           'movements':[{'id':str(i),'kind':kind,'amount_minor':amount} for i,(kind,amount) in enumerate([
               ('sale',100000),('refund',10000),('fee',3000),('chargeback',5000),
               ('chargeback_reversal',1000),('reserve_hold',2000),('reserve_release',1500)])]}
    statement={'bank_account_id':'bank-1','currency':'USD','start':'2026-09-01','end':'2026-09-30','complete':True,
               'deposits':[{'id':'bank-tx-1','reference':'payout-1','booked_on':'2026-09-19','amount_minor':82500}]}
    return batch,statement

def upload(data,packet,key):
    return data.ingest(key+'.json',json.dumps([{'id':key,'packet':packet}]).encode(),dataset='settlement_reports',source_key=key,id_field='id')['id']

def run(data):
    batch,bank=packets()
    args={'processor_source_id':upload(data,batch,'processor'),'bank_source_id':upload(data,bank,'bank')}
    return Settlements(data.store,data.oid).execute('reconcile_settlement',args),args

def test_exact_mixed_movements():
    batch,bank=packets();r=calculate(Batch(**batch),Statement(**bank))
    assert r['expected_payout_minor']==82500
    assert r['processor_residual_minor']==r['bank_residual_minor']==0
    assert r['status']=='balanced_unverified'

@pytest.mark.parametrize('mutation,issue',[
    ('duplicate','DUPLICATE_PROCESSOR_ID'),('count','COUNT_MISMATCH'),('incomplete','INCOMPLETE_REPORT'),
    ('currency','CURRENCY_MISMATCH'),('reference','BANK_REFERENCE_MISSING'),('ambiguous','AMBIGUOUS_BANK_REFERENCE'),
    ('processor','PROCESSOR_RESIDUAL'),('bank','BANK_RESIDUAL'),('account','BANK_ACCOUNT_MISMATCH'),
    ('period','ARRIVAL_OUTSIDE_STATEMENT'),('bank_duplicate','DUPLICATE_BANK_ID')])
def test_blockers(mutation,issue):
    b,s=packets()
    if mutation=='duplicate':b['movements'][1]['id']='0'
    if mutation=='count':b['declared_count']=8
    if mutation=='incomplete':b['complete']=False
    if mutation=='currency':s['currency']='EUR'
    if mutation=='reference':s['deposits'][0]['reference']='unrelated-same-amount'
    if mutation=='ambiguous':s['deposits'].append(dict(s['deposits'][0],id='another'))
    if mutation=='processor':b['movements'][0]['amount_minor']+=1
    if mutation=='bank':s['deposits'][0]['amount_minor']+=1
    if mutation=='account':s['bank_account_id']='other'
    if mutation=='period':s['end']='2026-09-18'
    if mutation=='bank_duplicate':s['deposits'].append(dict(s['deposits'][0],reference='other'))
    r=calculate(Batch(**b),Statement(**s))
    assert issue in r['issues'] and r['status']=='blocked'

@pytest.mark.parametrize('amount',[True,1.2,'100',-1])
def test_no_coercion(amount):
    b,_=packets();b['movements'][0]['amount_minor']=amount
    with pytest.raises(ValidationError):Batch(**b)

def test_persistence_isolation_idempotency_and_stale_review(setup):
    store,a,b,_,_=setup;svc=Settlements(store,a.oid)
    result,args=run(a.data)
    assert svc.execute('reconcile_settlement',args)==result
    with pytest.raises(LookupError):Settlements(store,b.oid).execute('reconcile_settlement',args)
    with pytest.raises(LookupError):Settlements(store,b.oid).execute('get_settlement_reconciliation',{'reconciliation_id':result['reconciliation_id']})
    body=Verify(reconciliation_id=result['reconciliation_id'],result_hash=result['result_hash'],attestation='I verified the source reports, batch membership, and completeness')
    with pytest.raises(ValueError):svc.verify(body.model_copy(update={'result_hash':'wrong'}),'alice')
    assert svc.verify(body,'alice')['status']=='verified'
    _,bank=packets();bank['deposits'][0]['amount_minor']+=1
    upload(a.data,bank,'bank')
    assert svc.execute('get_settlement_reconciliation',{'reconciliation_id':result['reconciliation_id']})['status']=='stale'
    with pytest.raises(ValueError):svc.verify(body,'alice')

def test_blocked_cannot_verify(setup):
    store,a,_,_,_=setup;b,s=packets();b['complete']=False
    result=Settlements(store,a.oid).execute('reconcile_settlement',{'processor_source_id':upload(a.data,b,'p'),'bank_source_id':upload(a.data,s,'b')})
    with pytest.raises(ValueError):Settlements(store,a.oid).verify(Verify(reconciliation_id=result['reconciliation_id'],result_hash=result['result_hash'],attestation='I verified the source reports, batch membership, and completeness'),'alice')

def test_http_and_agent_permissions(setup,monkeypatch):
    import time
    from fastapi.testclient import TestClient
    from app import main,auth,data_tools
    store,a,_,_,_=setup;result,args=run(a.data)
    monkeypatch.setattr(main,'store',store)
    monkeypatch.setattr(auth,'verify',lambda token:auth.Identity(token,int(time.time())+300))
    store.add_member('teammate',a.oid)
    url='/accounting/settlements/'+result['reconciliation_id']
    body={'reconciliation_id':result['reconciliation_id'],'result_hash':result['result_hash'],'attestation':'I verified the source reports, batch membership, and completeness'}
    with TestClient(main.app) as client:
        assert client.get(url).status_code==401
        assert client.get(url,headers={'Authorization':'Bearer bob'}).status_code==404
        assert client.post('/accounting/settlements',json=args,headers={'Authorization':'Bearer alice'}).status_code==200
        assert client.post(url+'/verify',json=body,headers={'Authorization':'Bearer teammate'}).status_code==403
        assert client.post(url+'/verify',json=body,headers={'Authorization':'Bearer alice'}).json()['status']=='verified'
    assert not any('settlement' in name and 'verify' in name for name in data_tools.DESCRIPTIONS)
    json.dumps(data_tools.execute(store,a.oid,'reconcile_settlement',args))

def test_bank_deposit_cannot_verify_twice(setup):
    store,a,_,_,_=setup;svc=Settlements(store,a.oid);first,args=run(a.data)
    def verify(result):
        return svc.verify(Verify(reconciliation_id=result['reconciliation_id'],result_hash=result['result_hash'],attestation='I verified the source reports, batch membership, and completeness'),'alice')
    verify(first)
    b,_=packets();b['batch_id']='second-batch'
    args['processor_source_id']=upload(a.data,b,'processor-second')
    second=svc.execute('reconcile_settlement',args)
    with pytest.raises(ValueError,match='already belongs'):verify(second)
