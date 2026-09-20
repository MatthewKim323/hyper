import json
import pytest
from sqlalchemy import select
from mirror_resolve import store as ledger
from mirror_resolve.fixtures import hero
from app.accounting import Accounting, PromoteRecord, Approval
from test_simulator import setup

ATTEST='I verified this structured record against its source'

def promote(data, typ, record, **kwargs):
    source=data.ingest(typ+'-'+str(next(iter(record.values())))+'.json',json.dumps([record]).encode(),dataset='ap_'+typ.lower(),**kwargs)
    svc=Accounting(data.store,data.oid)
    return svc.promote(PromoteRecord(source_id=source['id'],row_number=1,record_type=typ,attestation=ATTEST),'human:alice')

def initial(data):
    eng=ledger.make_engine('sqlite:///:memory:')
    with eng.begin() as db:
        hero.seed_initial(db)
        rows=[dict(r) for r in db.execute(select(ledger.records).order_by(ledger.records.c.id)).mappings()]
    for row in rows:promote(data,row['record_type'],row['data'])
    eng.dispose()
    return Accounting(data.store,data.oid).execute('open_payable_case',{'invoice_id':'INV-1042'})['case']['case_id']

def deliver(data,built):
    typ,record,_=built
    return promote(data,typ,record)

def proposal(svc,cid):
    snapshot=svc.execute('analyze_payable',{'case_id':cid})
    return svc.execute('prepare_payable_proposal',{'case_id':cid,'based_on_revision':snapshot['case']['revision']})

def test_partial_credit_blocks_then_exact_proposal_and_invalidation(setup):
    store,a,_,_,_=setup;data=a.data;svc=Accounting(store,a.oid)
    cid=initial(data)
    before=svc.execute('analyze_payable',{'case_id':cid})
    assert before['calculation']['invoice_face_cents']==12_000_000
    deliver(data,hero.cancellation_record());deliver(data,hero.supplier_ack())
    deliver(data,hero.price_credit())
    svc.execute('inspect_payable_credit',{'case_id':cid,'credit_id':'CM-201'})
    partial=proposal(svc,cid)
    assert partial['proposal']['payload']['net_payable_cents']==10_000_000
    assert partial['validation']['verdict']=='FAIL' and partial['approval'] is None
    deliver(data,hero.quantity_credit())
    svc.execute('inspect_payable_credit',{'case_id':cid,'credit_id':'CM-202'})
    full=proposal(svc,cid)
    assert full['validation']['verdict']=='PASS'
    assert full['proposal']['payload']['net_payable_cents']==8_000_000
    assert full['approval']['status']=='PENDING'
    prop=full['proposal']
    with pytest.raises(ValueError):svc.approve(Approval(proposal_id=prop['proposal_id'],proposal_hash='wrong',decision='APPROVED'),'alice')
    assert svc.approve(Approval(proposal_id=prop['proposal_id'],proposal_hash=prop['hash'],decision='APPROVED'),'alice')['status']=='APPROVED'
    # A corrected receipt invalidates the old proposal AND credit verification.
    promote(data,'GOODS_RECEIPT',{'gr_id':'GR-771','po_id':'PO-481','received_on':'2026-09-08','lines':[{'item_id':hero.ITEM,'qty':850}]})
    with pytest.raises(ValueError):svc.approve(Approval(proposal_id=prop['proposal_id'],proposal_hash=prop['hash'],decision='APPROVED'),'alice')
    after=svc.execute('analyze_payable',{'case_id':cid})
    assert after['calculation']['verified_credits_total_cents']==0
    with store.engine.connect() as db:assert db.execute(select(ledger.economic_events)).first() is None

def test_tenant_ids_source_provenance_and_unsupported_currency(setup):
    store,a,b,_,_=setup
    ca=initial(a.data);cb=initial(b.data)
    assert ca!=cb
    svc=Accounting(store,a.oid)
    with pytest.raises(LookupError):Accounting(store,b.oid).execute('analyze_payable',{'case_id':ca})
    source=a.data.ingest('record.json',json.dumps([{'vendor_id':'X','name':'X','approved_contact':'a','remit_account_ref':'b'}]).encode(),dataset='new')
    args=PromoteRecord(source_id=source['id'],row_number=1,record_type='VENDOR_MASTER',attestation=ATTEST)
    with pytest.raises(LookupError):Accounting(store,b.oid).promote(args,'human:bob')
    first=svc.promote(args,'human:alice')
    assert svc.promote(args,'human:alice')==first
    assert first['source_sha256'] and first['verified_by']=='human:alice'
    with pytest.raises(ValueError):promote(a.data,'PURCHASE_ORDER',{'po_id':'crypto','vendor_id':'X','currency':'ETH','lines':[{'item_id':'I','qty':1,'unit_price_cents':10}]})

def test_http_owner_only_and_no_agent_approval_tool(setup,monkeypatch):
    from fastapi.testclient import TestClient
    from app import main, auth, data_tools
    import time
    store,a,_,_,_=setup
    monkeypatch.setattr(main,'store',store)
    monkeypatch.setattr(auth,'verify',lambda token:auth.Identity(token,int(time.time())+300))
    store.add_member('teammate',a.oid)
    source=a.data.ingest('vendor.json',json.dumps([{'vendor_id':'V','name':'v','approved_contact':'a','remit_account_ref':'b'}]).encode(),dataset='vendors')
    body={'source_id':source['id'],'row_number':1,'record_type':'VENDOR_MASTER','attestation':ATTEST}
    with TestClient(main.app) as client:
        assert client.post('/accounting/records/verify',json=body).status_code==401
        assert client.post('/accounting/records/verify',json=body,headers={'Authorization':'Bearer teammate'}).status_code==403
        assert client.post('/accounting/records/verify',json=body,headers={'Authorization':'Bearer alice'}).status_code==200
    assert 'prepare_payable_proposal' in data_tools.DESCRIPTIONS
    assert not any('approve' in name or 'commit' in name or 'verify_record' in name for name in data_tools.DESCRIPTIONS)

def test_source_replacement_revokes_proposal_before_verification(setup):
    from app import data_tools
    store,a,_,_,_=setup;cid=initial(a.data);svc=Accounting(store,a.oid)
    result=proposal(svc,cid);pid=result['proposal']['proposal_id']
    # Even a pending/blocked draft becomes stale when its raw backing record changes.
    a.data.ingest('INVOICE-INV-1042.json',json.dumps([{'invoice_id':'INV-1042','unverified':'replacement'}]).encode(),dataset='ap_invoice')
    with store.engine.connect() as db:
        assert db.execute(select(ledger.proposals.c.status).where(ledger.proposals.c.proposal_id==pid)).scalar()=='INVALIDATED'
    with pytest.raises(ValueError,match='superseded'):svc.execute('analyze_payable',{'case_id':cid})
    json.dumps(data_tools.execute(store,a.oid,'list_accounting_records',{}))


def test_currency_mismatch_and_invoice_total_block_proposal(setup):
    store,a,_,_,_=setup;cid=initial(a.data);svc=Accounting(store,a.oid)
    # Cross-currency contract prices must never be used as if denominated in USD.
    promote(a.data,'AGREEMENT',{'agreement_id':'AGR-220','vendor_id':hero.VENDOR,'currency':'EUR','effective_from':'2026-01-01','prices':[{'item_id':hero.ITEM,'unit_price_cents':10000}]})
    result=svc.execute('analyze_payable',{'case_id':cid})
    assert any('currency' in str(issue['detail']) for issue in result['issues'])
    assert proposal(svc,cid)['validation']['verdict']=='FAIL'

def test_agent_read_tools_and_aging(setup):
    from app import data_tools
    store,a,b,_,_=setup;data=a.data;svc=Accounting(store,a.oid)
    empty=svc.execute('ap_aging',{'as_of':'2026-10-15'})
    assert empty['resolved_cases']==0 and all(not bucket['cases'] for bucket in empty['buckets'].values())
    cid=initial(data)
    listed=svc.execute('list_payable_cases',{})['cases']
    assert [c['case_id'] for c in listed]==[cid] and listed[0]['invoice_id']=='INV-1042'
    aging=svc.execute('ap_aging',{'as_of':'2026-10-15'})
    # 35 days since the 2026-09-10 invoice; residual is the unreconciled remainder.
    assert aging['buckets']['31_60']['cases']==1 and aging['buckets']['31_60']['invoice_ids']==['INV-1042']
    assert aging['buckets']['31_60']['residual_cents']>0 and aging['open_residual_minor']['USD']>0
    for name in ('list_payable_cases','list_payable_proposals','ap_aging'):
        json.dumps(data_tools.execute(store,a.oid,name,{'as_of':'2026-10-15'} if name=='ap_aging' else {}))
    # Tenant isolation: organization b sees empty books, not organization a's cases.
    assert data_tools.execute(store,b.oid,'list_payable_cases',{})['cases']==[]
    assert data_tools.execute(store,b.oid,'ap_aging',{})['buckets']['31_60']['cases']==0
    # Agents prepare and propose; owners approve, post, commit, reverse, dismiss and verify.
    # propose_/prepare_ tools are explicitly allowed: they only stage work for owner confirmation,
    # so match on the acting verb rather than on the word appearing anywhere in the name.
    acting=[name for name in data_tools.DESCRIPTIONS
            if not name.startswith(('propose_','prepare_'))
            and any(word in name for word in ('approve','commit','reverse','dismiss','verify_record'))]
    assert not acting, acting
    assert not [name for name in data_tools.DESCRIPTIONS if name.startswith('post_')]

def test_case_and_proposal_listings_for_the_workspace(setup,monkeypatch):
    store,a,b,_,_=setup;data=a.data;svc=Accounting(store,a.oid)
    assert svc.list_cases()=={'cases':[]} and svc.list_proposals()=={'proposals':[]}
    cid=initial(data)
    listed=svc.list_cases()['cases']
    assert [c['case_id'] for c in listed]==[cid]
    # People see the original invoice ID, never the tenant-namespaced one.
    assert listed[0]['invoice_id']=='INV-1042' and listed[0]['calculation']['invoice_face_cents']==12_000_000
    assert listed[0]['calculation']['ties'] is False and listed[0]['blocking_issues']
    deliver(data,hero.cancellation_record());deliver(data,hero.supplier_ack())
    deliver(data,hero.price_credit());deliver(data,hero.quantity_credit())
    svc.execute('inspect_payable_credit',{'case_id':cid,'credit_id':'CM-201'})
    svc.execute('inspect_payable_credit',{'case_id':cid,'credit_id':'CM-202'})
    full=proposal(svc,cid)['proposal']
    ready=svc.list_proposals()['proposals'][0]
    assert ready['proposal_id']==full['proposal_id'] and ready['hash']==full['hash']
    assert ready['payload']['net_payable_cents']==8_000_000 and ready['payload']['invoice_id']=='INV-1042'
    assert ready['approval']['status']=='PENDING' and all(c['ok'] for c in ready['checks'])
    assert svc.list_cases()['cases'][0]['calculation']['ties'] is True
    svc.approve(Approval(proposal_id=full['proposal_id'],proposal_hash=full['hash'],decision='APPROVED'),'alice')
    assert svc.list_proposals()['proposals'][0]['approval']['status']=='APPROVED'
    # Another organization sees none of it.
    assert Accounting(store,b.oid).list_cases()=={'cases':[]} and Accounting(store,b.oid).list_proposals()=={'proposals':[]}

def ready_proposal(data,svc):
    cid=initial(data)
    deliver(data,hero.cancellation_record());deliver(data,hero.supplier_ack())
    deliver(data,hero.price_credit());deliver(data,hero.quantity_credit())
    for credit in ('CM-201','CM-202'):svc.execute('inspect_payable_credit',{'case_id':cid,'credit_id':credit})
    return proposal(svc,cid)['proposal']

def test_handoff_packet_for_the_teams_after_ap(setup):
    from app import handoff
    store,a,b,_,_=setup;data=a.data;svc=Accounting(store,a.oid)
    prop=ready_proposal(data,svc)
    before=handoff.packet(store,a.oid,prop['proposal_id'])
    # Prepared but not approved: nothing downstream may act on it yet.
    assert before['ready'] is False and before['state']=='pending' and before['boundary']=='prepared_not_posted'
    svc.approve(Approval(proposal_id=prop['proposal_id'],proposal_hash=prop['hash'],decision='APPROVED'),'alice')
    pack=handoff.packet(store,a.oid,prop['proposal_id'])
    assert pack['ready'] is True and pack['state']=='approved' and pack['hash']==prop['hash']
    # Payments: who, where, how much. IDs are the original ones, never tenant-namespaced.
    assert pack['payment']['amount_cents']==8_000_000 and pack['payment']['invoice_id']=='INV-1042'
    assert pack['payment']['remit_account_ref'] and pack['payment']['remit_verified'] is True and ':' not in pack['payment']['vendor_id']
    # Ledger: a balanced entry for exactly the approved amount.
    assert pack['ledger']['balanced'] is True and pack['ledger']['econ_id'] is None
    assert sum(e['debit_cents'] for e in pack['ledger']['entries'])==8_000_000
    # Close: what was wrong, what fixed it, who signed, and the evidence behind it.
    assert pack['close']['approval']['decided_by']=='human:alice' and pack['close']['approval']['proposal_hash']==prop['hash']
    assert {c['credit_id'] for c in pack['close']['credits_applied']}=={'CM-201','CM-202'} and pack['close']['evidence']
    assert all(c['ok'] for c in pack['close']['checks'])
    # Forecast: the cash that actually leaves, and what the resolution saved against the bill.
    assert pack['forecast']['cash_out_cents']==8_000_000 and pack['forecast']['billed_cents']==12_000_000 and pack['forecast']['avoided_cents']==4_000_000
    assert pack['forecast']['expected_date'] is None and pack['forecast']['basis']=='no_payment_terms_on_file'
    # Another organization cannot read it.
    with pytest.raises(LookupError):handoff.packet(store,b.oid,prop['proposal_id'])

def test_payment_date_uses_vendor_terms_when_on_file(setup):
    from app import handoff
    store,a,_,_,_=setup;data=a.data;svc=Accounting(store,a.oid)
    prop=ready_proposal(data,svc)
    svc.approve(Approval(proposal_id=prop['proposal_id'],proposal_hash=prop['hash'],decision='APPROVED'),'alice')
    vendor=handoff.packet(store,a.oid,prop['proposal_id'])['payment']['vendor_id']
    data.ingest('vendors.json',json.dumps([{'vendor_id':vendor,'name':'Listed vendor','terms_days':30}]).encode(),dataset='vendors')
    pack=handoff.packet(store,a.oid,prop['proposal_id'])
    assert pack['payment']['terms_days']==30 and pack['payment']['due_date'] and pack['forecast']['expected_date']==pack['payment']['due_date']
    assert pack['forecast']['basis']=='invoice_date_plus_vendor_terms'

def test_owner_commit_is_idempotent_and_moves_no_cash(setup):
    from app import handoff
    store,a,_,_,_=setup;data=a.data;svc=Accounting(store,a.oid)
    prop=ready_proposal(data,svc)
    with pytest.raises(Exception):handoff.commit(store,a.oid,prop['proposal_id'],prop['hash'],'alice')  # not approved yet
    svc.approve(Approval(proposal_id=prop['proposal_id'],proposal_hash=prop['hash'],decision='APPROVED'),'alice')
    with pytest.raises(ValueError):handoff.commit(store,a.oid,prop['proposal_id'],'wrong','alice')
    first=handoff.commit(store,a.oid,prop['proposal_id'],prop['hash'],'alice')
    again=handoff.commit(store,a.oid,prop['proposal_id'],prop['hash'],'alice')
    assert first['committed'] and not first['replayed'] and again['replayed'] and again['econ_id']==first['econ_id']
    pack=handoff.packet(store,a.oid,prop['proposal_id'])
    assert pack['state']=='committed' and pack['ready'] and pack['ledger']['econ_id']==first['econ_id'] and pack['payment_status']=='PAYMENT_READY'
    with store.engine.connect() as db:assert [e['type'] for e in db.execute(select(ledger.economic_events)).mappings()]==['AP_RECOGNITION']
