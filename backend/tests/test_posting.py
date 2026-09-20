import json
import pytest
from pydantic import ValidationError
from app.accruals import Accruals, Approve
from app.posting import Posting, PrepareManual, ApproveDraft, PostDraft, Reverse, validate
from test_simulator import setup

ACCRUAL_ATTEST='I verified delivery, rates, ledger completeness, and account mappings'
JOURNAL_ATTEST='I reviewed this journal, its account mappings, and its evidence'
REVERSE_ATTEST='I verified this entry must be reversed'

def packets():
    return (
        {'obligation_id':'service-1','vendor_id':'vendor-1','currency':'USD','start':'2026-09-01','end':'2026-10-31','authorized_qty':100,'unit_price_minor':100000,'expense_account':'6100','liability_account':'2100'},
        {'obligation_id':'service-1','vendor_id':'vendor-1','complete_through':'2026-10-31','complete':True,'receipts':[
            {'id':'receipt-1','delivered_on':'2026-09-20','quantity':40,'confirmed':True}]},
        {'obligation_id':'service-1','vendor_id':'vendor-1','currency':'USD','coverage_from':'2026-09-01','coverage_through':'2026-10-31','complete':True,'entries':[]})

def upload(data,key,packet):
    return data.ingest(key+'.json',json.dumps([{'id':key,'packet':packet}]).encode(),dataset='accrual_reports',source_key=key,id_field='id')['id']

def accrual(data,parts=None):
    c,d,l=parts or packets()
    args={'contract_source_id':upload(data,'contract',c),'delivery_source_id':upload(data,'delivery',d),'ledger_source_id':upload(data,'ledger',l),'cutoff':'2026-09-30'}
    return Accruals(data.store,data.oid).execute('prepare_expense_accrual',args)

def approved(store,data):
    result=accrual(data)
    Accruals(store,data.oid).approve(Approve(accrual_id=result['accrual_id'],result_hash=result['result_hash'],attestation=ACCRUAL_ATTEST),'alice')
    return result

def journal_args(key,source_id,**overrides):
    args={'request_key':key,'posted_on':'2026-09-30','currency':'USD','memo':'September service accrual','evidence_source_ids':[source_id],
          'lines':[{'account':'6100','debit_minor':4000000,'credit_minor':0},{'account':'2100','debit_minor':0,'credit_minor':4000000}]}
    args.update(overrides)
    return args

def posted(store,data,key='manual-1',**overrides):
    svc=Posting(store,data.oid)
    sid=upload(data,'evidence',{'invoice':'ev-1'})
    draft=svc.execute('prepare_manual_journal',journal_args(key,sid,**overrides))
    svc.approve_draft(ApproveDraft(draft_id=draft['draft_id'],attestation=JOURNAL_ATTEST),'human:alice')
    entry=svc.post_draft(PostDraft(draft_id=draft['draft_id'],request_key=key+'-post',attestation=JOURNAL_ATTEST),'human:alice')
    return draft,entry

@pytest.mark.parametrize('mutation',[
    {'lines':[{'account':'6100','debit_minor':4000000,'credit_minor':0},{'account':'2100','debit_minor':0,'credit_minor':3999999}]},
    {'lines':[{'account':'6100','debit_minor':0,'credit_minor':0},{'account':'2100','debit_minor':0,'credit_minor':1}]},
    {'lines':[{'account':'6100','debit_minor':100,'credit_minor':100},{'account':'2100','debit_minor':0,'credit_minor':100}]},
    {'lines':[{'account':'6100','debit_minor':100,'credit_minor':0},{'account':'6100','debit_minor':0,'credit_minor':100}]},
    {'lines':[]},
    {'currency':'BTC'},
    {'lines':[{'account':'','debit_minor':100,'credit_minor':0},{'account':'2100','debit_minor':0,'credit_minor':100}]},
    {'lines':[{'account':'6100','debit_minor':-100,'credit_minor':0},{'account':'2100','debit_minor':0,'credit_minor':-100}]}])
def test_journal_validation(mutation):
    journal={'date':'2026-09-30','currency':'USD','lines':[]}
    journal.update(mutation)
    with pytest.raises(ValueError):validate(journal)

def test_valid_journal_and_strict_line_types():
    validate({'date':'2026-09-30','currency':'USD','lines':[{'account':'6100','debit_minor':100,'credit_minor':0},{'account':'2100','debit_minor':0,'credit_minor':100}]})
    for bad in (True,1.5,'100'):
        with pytest.raises(ValidationError):
            PrepareManual(request_key='k',posted_on='2026-09-30',currency='USD',memo='m',evidence_source_ids=['s'],
                          lines=[{'account':'a','debit_minor':bad,'credit_minor':0},{'account':'b','debit_minor':0,'credit_minor':100}])

def test_post_accrual_journal_end_to_end(setup):
    store,a,_,_,_=setup;svc=Posting(store,a.oid);result=approved(store,a.data)
    args={'accrual_id':result['accrual_id'],'request_key':'post-1'}
    entry=svc.execute('post_accrual_journal',args)
    assert entry['entry']==result['journal']
    assert entry['origin']=={'kind':'accrual','ref_id':result['accrual_id'],'ref_hash':result['result_hash']}
    assert entry['posted_by']=='agent:posting' and entry['reverses_id'] is None and not entry['reversed']
    assert svc.execute('post_accrual_journal',args)['entry_id']==entry['entry_id']
    assert svc.execute('post_accrual_journal',{'accrual_id':result['accrual_id'],'request_key':'post-2'})['entry_id']==entry['entry_id']
    c,d,l=packets();d['receipts'][0]['quantity']=41
    second=accrual(a.data,(c,d,l))
    with pytest.raises(ValueError):svc.execute('post_accrual_journal',{'accrual_id':second['accrual_id'],'request_key':'post-1'})
    with pytest.raises(ValueError):svc.execute('post_accrual_journal',{'accrual_id':second['accrual_id'],'request_key':'post-3'})
    with pytest.raises(LookupError):svc.execute('post_accrual_journal',{'accrual_id':'missing','request_key':'post-4'})

def test_manual_draft_approve_post_and_trial_balance(setup):
    store,a,_,_,_=setup;svc=Posting(store,a.oid)
    sid=upload(a.data,'evidence',{'invoice':'ev-1'})
    args=journal_args('manual-1',sid)
    draft=svc.execute('prepare_manual_journal',args)
    assert draft['status']=='draft' and draft['journal']['memo']=='September service accrual' and draft['evidence_current']
    assert svc.execute('prepare_manual_journal',args)['draft_id']==draft['draft_id']
    with pytest.raises(ValueError):svc.execute('prepare_manual_journal',dict(args,memo='changed'))
    with pytest.raises(LookupError):svc.execute('prepare_manual_journal',journal_args('manual-2','missing-source'))
    with pytest.raises(ValueError):
        svc.execute('prepare_manual_journal',journal_args('manual-3',sid,lines=[{'account':'a','debit_minor':1,'credit_minor':0}]))
    with pytest.raises(ValueError):svc.post_draft(PostDraft(draft_id=draft['draft_id'],request_key='manual-1-post',attestation=JOURNAL_ATTEST),'human:alice')
    approved_draft=svc.approve_draft(ApproveDraft(draft_id=draft['draft_id'],attestation=JOURNAL_ATTEST),'human:alice')
    assert approved_draft['status']=='approved' and approved_draft['approved_by']=='human:alice' and approved_draft['approved_at']
    entry=svc.post_draft(PostDraft(draft_id=draft['draft_id'],request_key='manual-1-post',attestation=JOURNAL_ATTEST),'human:alice')
    assert entry['origin']=={'kind':'manual','ref_id':draft['draft_id'],'ref_hash':draft['result_hash']}
    assert entry['posted_by']=='human:alice'
    assert svc.draft(draft['draft_id'])['status']=='posted'
    assert svc.draft(draft['draft_id'])['entry_id']==entry['entry_id']
    assert svc.post_draft(PostDraft(draft_id=draft['draft_id'],request_key='manual-1-post',attestation=JOURNAL_ATTEST),'human:alice')['entry_id']==entry['entry_id']
    balance=svc.execute('trial_balance',{'through':'2026-09-30','currency':'USD'})
    assert balance['balanced'] and balance['total_debit_minor']==balance['total_credit_minor']==4000000
    assert {x['account']:(x['debit_minor'],x['credit_minor'],x['net_minor']) for x in balance['accounts']}=={'2100':(0,4000000,-4000000),'6100':(4000000,0,4000000)}

def test_reversal_flow_and_net_trial_balance(setup):
    store,a,_,_,_=setup;svc=Posting(store,a.oid);_,entry=posted(store,a.data)
    body=Reverse(entry_id=entry['entry_id'],request_key='rev-1',attestation=REVERSE_ATTEST)
    reversal=svc.reverse(body,'human:alice')
    assert reversal['reverses_id']==entry['entry_id']
    assert reversal['entry']['lines']==[{'account':'6100','debit_minor':0,'credit_minor':4000000},{'account':'2100','debit_minor':4000000,'credit_minor':0}]
    assert reversal['posted_by']=='human:alice'
    view=svc.execute('get_journal_entry',{'entry_id':entry['entry_id']})
    assert view['reversed'] and view['reversed_by']==reversal['entry_id']
    assert svc.reverse(body,'human:alice')['entry_id']==reversal['entry_id']
    with pytest.raises(ValueError):svc.reverse(Reverse(entry_id=entry['entry_id'],request_key='rev-2',attestation=REVERSE_ATTEST),'human:alice')
    with pytest.raises(LookupError):svc.reverse(Reverse(entry_id='missing',request_key='rev-3',attestation=REVERSE_ATTEST),'human:alice')
    with pytest.raises(LookupError):svc.reverse(Reverse(entry_id='draft-id-not-an-entry',request_key='rev-4',attestation=REVERSE_ATTEST),'human:alice')
    balance=svc.execute('trial_balance',{'through':'2026-09-30','currency':'USD'})
    assert balance['balanced'] and balance['total_debit_minor']==balance['total_credit_minor']==8000000
    assert all(x['net_minor']==0 for x in balance['accounts'])
    listed=svc.execute('list_journal_entries',{})
    assert [x['entry_id'] for x in listed['entries']]==[reversal['entry_id'],entry['entry_id']]
    assert listed['entries'][0]['origin']['kind']=='reversal'

def test_trial_balance_filters(setup):
    store,a,_,_,_=setup
    posted(store,a.data,'october',posted_on='2026-10-15',lines=[{'account':'6100','debit_minor':500,'credit_minor':0},{'account':'2100','debit_minor':0,'credit_minor':500}])
    posted(store,a.data,'euro',currency='EUR',lines=[{'account':'6100','debit_minor':700,'credit_minor':0},{'account':'2100','debit_minor':0,'credit_minor':700}])
    posted(store,a.data,'september')
    svc=Posting(store,a.oid)
    early=svc.execute('trial_balance',{'through':'2026-09-30','currency':'USD'})
    assert early['total_debit_minor']==4000000
    later=svc.execute('trial_balance',{'through':'2026-10-31','currency':'USD'})
    assert later['total_debit_minor']==later['total_credit_minor']==4000500
    euro=svc.execute('trial_balance',{'through':'2026-10-31','currency':'EUR'})
    assert euro['total_debit_minor']==euro['total_credit_minor']==700
    page=svc.execute('list_journal_entries',{'account':'6100','currency':'USD','from_date':'2026-10-01','limit':1})
    assert len(page['entries'])==1 and page['entries'][0]['entry']['date']=='2026-10-15'

def test_tenant_isolation(setup):
    store,a,b,_,_=setup;result=approved(store,a.data);_,entry=posted(store,a.data)
    other=Posting(store,b.oid)
    with pytest.raises(LookupError):other.execute('post_accrual_journal',{'accrual_id':result['accrual_id'],'request_key':'x'})
    with pytest.raises(LookupError):other.execute('get_journal_entry',{'entry_id':entry['entry_id']})
    with pytest.raises(LookupError):other.draft(entry['origin']['ref_id'])
    assert other.execute('list_journal_entries',{})['entries']==[]
    assert other.execute('trial_balance',{'through':'2026-12-31','currency':'USD'})['accounts']==[]
    assert other.drafts()['drafts']==[]

def test_http_permissions(setup,monkeypatch):
    import time
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app import main,auth
    from app.posting_api import router
    store,a,_,_,_=setup;svc=Posting(store,a.oid)
    sid=upload(a.data,'evidence',{'invoice':'ev-1'})
    draft=svc.execute('prepare_manual_journal',journal_args('http-1',sid))
    monkeypatch.setattr(main,'store',store)
    monkeypatch.setattr(auth,'verify',lambda token:auth.Identity(token,int(time.time())+300))
    store.add_member('teammate',a.oid)
    web=FastAPI();web.include_router(router)
    base='/accounting/journals';url=base+'/drafts/'+draft['draft_id']
    approve={'draft_id':draft['draft_id'],'attestation':JOURNAL_ATTEST}
    with TestClient(web) as client:
        assert client.get(base).status_code==401
        assert client.get(url,headers={'Authorization':'Bearer bob'}).status_code==404
        assert client.get(url,headers={'Authorization':'Bearer teammate'}).json()['draft_id']==draft['draft_id']
        assert client.post(url+'/approve',json=approve,headers={'Authorization':'Bearer teammate'}).status_code==403
        assert client.post(url+'/approve',json=approve,headers={'Authorization':'Bearer alice'}).json()['status']=='approved'
        post=dict(approve,request_key='http-post-1')
        assert client.post(url+'/post',json=post,headers={'Authorization':'Bearer teammate'}).status_code==403
        entry=client.post(url+'/post',json=post,headers={'Authorization':'Bearer alice'}).json()
        assert entry['posted_by']=='human:alice' and entry['origin']['kind']=='manual'
        balance=client.get(base+'/trial-balance?through=2026-09-30&currency=USD',headers={'Authorization':'Bearer alice'}).json()
        assert balance['balanced'] and balance['total_debit_minor']==4000000
        reverse={'entry_id':entry['entry_id'],'request_key':'http-rev-1','attestation':REVERSE_ATTEST}
        reversal_url=base+'/entries/'+entry['entry_id']+'/reverse'
        assert client.post(reversal_url,json=reverse,headers={'Authorization':'Bearer teammate'}).status_code==403
        assert client.post(reversal_url,json=reverse,headers={'Authorization':'Bearer alice'}).json()['reverses_id']==entry['entry_id']
        assert client.get(url,headers={'Authorization':'Bearer alice'}).json()['status']=='posted'
        listed=client.get(base,headers={'Authorization':'Bearer alice'}).json()['entries']
        assert [x['entry_id'] for x in listed]==[e['entry_id'] for e in listed]
        assert client.get(base+'/drafts',headers={'Authorization':'Bearer alice'}).json()['drafts'][0]['status']=='posted'
