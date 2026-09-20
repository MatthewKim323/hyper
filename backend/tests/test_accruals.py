import json
from datetime import date
import pytest
from pydantic import ValidationError
from app.accruals import Accruals, Contract, Deliveries, Ledger, Approve, calculate
from test_simulator import setup

ATTEST='I verified delivery, rates, ledger completeness, and account mappings'

def packets():
    return (
        {'obligation_id':'service-1','vendor_id':'vendor-1','currency':'USD','start':'2026-09-01','end':'2026-10-31','authorized_qty':100,'unit_price_minor':100000,'expense_account':'6100','liability_account':'2100'},
        {'obligation_id':'service-1','vendor_id':'vendor-1','complete_through':'2026-10-31','complete':True,'receipts':[
            {'id':'receipt-1','delivered_on':'2026-09-20','quantity':40,'confirmed':True},
            {'id':'receipt-future','delivered_on':'2026-10-01','quantity':10,'confirmed':True}]},
        {'obligation_id':'service-1','vendor_id':'vendor-1','currency':'USD','coverage_from':'2026-09-01','coverage_through':'2026-10-31','complete':True,'entries':[]})

def calc(c,d,l):return calculate(Contract(**c),Deliveries(**d),Ledger(**l),date(2026,9,30))
def upload(data,key,packet):
    return data.ingest(key+'.json',json.dumps([{'id':key,'packet':packet}]).encode(),dataset='accrual_reports',source_key=key,id_field='id')['id']
def prepare(data,parts=None):
    c,d,l=parts or packets()
    args={'contract_source_id':upload(data,'contract',c),'delivery_source_id':upload(data,'delivery',d),'ledger_source_id':upload(data,'ledger',l),'cutoff':'2026-09-30'}
    return Accruals(data.store,data.oid).execute('prepare_expense_accrual',args),args

def approval(result):return Approve(accrual_id=result['accrual_id'],result_hash=result['result_hash'],attestation=ATTEST)

def test_exact_cutoff_journal_and_reversal():
    c,d,l=packets();result=calc(c,d,l)
    assert result['delivered_minor']==result['unrecorded_minor']==4000000
    assert result['included_receipt_ids']==['receipt-1']
    assert result['journal']['date']=='2026-09-30'
    assert result['reversal']['date']=='2026-10-01'
    for journal in (result['journal'],result['reversal']):
        assert sum(x['debit_minor'] for x in journal['lines'])==sum(x['credit_minor'] for x in journal['lines'])==4000000

def test_already_booked_and_partial_reversal():
    c,d,l=packets();l['entries']=[{'id':'old','posted_on':'2026-09-15','kind':'accrual','amount_minor':2000000},
       {'id':'reverse','posted_on':'2026-09-16','kind':'reversal','amount_minor':500000,'reverses_id':'old'},
       {'id':'invoice','posted_on':'2026-09-21','kind':'invoice','amount_minor':1000000},
       {'id':'future','posted_on':'2026-10-01','kind':'invoice','amount_minor':1000000}]
    assert calc(c,d,l)['unrecorded_minor']==1500000
    l['entries']=[{'id':'fully-booked','posted_on':'2026-09-30','kind':'invoice','amount_minor':4000000}]
    r=calc(c,d,l);assert r['status']=='no_accrual_needed' and r['journal'] is None

@pytest.mark.parametrize('mutation,issue',[
    ('delivery','UNCONFIRMED_DELIVERY'),('ledger','INCOMPLETE_LEDGER'),('duplicate','DUPLICATE_RECEIPT'),
    ('currency','CURRENCY_MISMATCH'),('vendor','VENDOR_MISMATCH'),('qty','QUANTITY_EXCEEDS_CONTRACT'),
    ('overbook','BOOKED_EXPENSE_OUT_OF_RANGE'),('reversal','INVALID_REVERSAL_LINK'),('accounts','IDENTICAL_ACCOUNTS'),
    ('prior','PRIOR_PERIOD_REVIEW_REQUIRED'),('coverage','INCOMPLETE_DELIVERIES')])
def test_blockers(mutation,issue):
    c,d,l=packets()
    if mutation=='delivery':d['receipts'][0]['confirmed']=False
    if mutation=='ledger':l['complete']=False
    if mutation=='duplicate':d['receipts'].append(d['receipts'][0])
    if mutation=='currency':l['currency']='EUR'
    if mutation=='vendor':l['vendor_id']='other'
    if mutation=='qty':c['authorized_qty']=1
    if mutation=='overbook':l['entries']=[{'id':'x','posted_on':'2026-09-30','kind':'invoice','amount_minor':4000001}]
    if mutation=='reversal':l['entries']=[{'id':'x','posted_on':'2026-09-30','kind':'reversal','amount_minor':1,'reverses_id':'missing'}]
    if mutation=='accounts':c['liability_account']=c['expense_account']
    if mutation=='prior':c['start']='2026-08-01';d['receipts'][0]['delivered_on']='2026-08-31';l['coverage_from']='2026-08-01'
    if mutation=='coverage':d['complete_through']='2026-09-29'
    result=calc(c,d,l)
    assert issue in result['issues'] and result['journal'] is None and result['status']=='blocked'

@pytest.mark.parametrize('value',[True,1.5,'100',-1])
def test_exact_types(value):
    c,_,_=packets();c['unit_price_minor']=value
    with pytest.raises(ValidationError):Contract(**c)

def test_persistence_approval_isolation_and_stale(setup):
    store,a,b,_,_=setup;svc=Accruals(store,a.oid);result,args=prepare(a.data)
    assert svc.execute('prepare_expense_accrual',args)==result
    with pytest.raises(LookupError):Accruals(store,b.oid).execute('prepare_expense_accrual',args)
    with pytest.raises(LookupError):Accruals(store,b.oid).execute('get_expense_accrual',{'accrual_id':result['accrual_id']})
    with pytest.raises(ValueError):svc.approve(approval(result).model_copy(update={'result_hash':'bad'}),'alice')
    assert svc.approve(approval(result),'alice')['status']=='approved_not_posted'
    c,d,l=packets();d['receipts'][0]['quantity']=41
    replacement,_=prepare(a.data,(c,d,l))
    assert svc.execute('get_expense_accrual',{'accrual_id':result['accrual_id']})['status']=='stale'
    with pytest.raises(ValueError):svc.approve(approval(result),'alice')
    with pytest.raises(ValueError,match='already exists'):svc.approve(approval(replacement),'alice')

def lifecycle(result):
    return {'accrual_id':result['accrual_id'],'obligation_id':'service-1','vendor_id':'vendor-1','currency':'USD',
        'complete_through':'2026-10-31','complete':True,'entries':[
        {'id':'posted','kind':'accrual_posting','posted_on':'2026-09-30','amount_minor':4000000},
        {'id':'reversed','kind':'reversal','posted_on':'2026-10-01','amount_minor':4000000},
        {'id':'inv','kind':'invoice','posted_on':'2026-10-12','amount_minor':4000000}]}

def test_lifecycle_persists_and_tracks_variance_and_staleness(setup):
    store,a,_,_,_=setup;svc=Accruals(store,a.oid);result,_=prepare(a.data)
    report=lifecycle(result)
    def track():return svc.execute('track_expense_accrual',{'accrual_id':result['accrual_id'],'source_id':upload(a.data,'lifecycle',report)})
    with pytest.raises(ValueError):track()
    svc.approve(approval(result),'alice')
    tracked=track();assert tracked['tracking']['status']=='matched_in_supplied_evidence'
    assert tracked['status']=='approved_not_posted' # no external posting claim
    report['entries'][-1]['amount_minor']=4000001
    changed=track();assert 'INVOICE_EXCEEDS_ACCRUAL' in changed['tracking']['issues']
    assert changed['tracking']['uninvoiced_minor']==-1
    report['entries'][-1]['amount_minor']=1000000
    assert track()['tracking']['status']=='awaiting_invoice'
    report['entries']=report['entries'][1:]
    assert 'POSTING_UNCONFIRMED_OR_MISMATCHED' in track()['tracking']['issues']
    report['complete']=False;upload(a.data,'lifecycle',report)
    assert svc.execute('get_expense_accrual',{'accrual_id':result['accrual_id']})['tracking']['status']=='stale'

def test_http_permissions_and_tools(setup,monkeypatch):
    import time
    from fastapi.testclient import TestClient
    from app import main,auth,data_tools
    store,a,_,_,_=setup;result,args=prepare(a.data)
    monkeypatch.setattr(main,'store',store)
    monkeypatch.setattr(auth,'verify',lambda token:auth.Identity(token,int(time.time())+300))
    store.add_member('teammate',a.oid);url='/accounting/accruals/'+result['accrual_id']
    with TestClient(main.app) as client:
        assert client.get(url).status_code==401
        assert client.get(url,headers={'Authorization':'Bearer bob'}).status_code==404
        assert client.post('/accounting/accruals',json=args,headers={'Authorization':'Bearer alice'}).status_code==200
        assert client.post(url+'/approve',json=approval(result).model_dump(),headers={'Authorization':'Bearer teammate'}).status_code==403
        assert client.post(url+'/approve',json=approval(result).model_dump(),headers={'Authorization':'Bearer alice'}).json()['status']=='approved_not_posted'
    assert 'approve_expense_accrual' not in data_tools.DESCRIPTIONS
    json.dumps(data_tools.execute(store,a.oid,'prepare_expense_accrual',args))
