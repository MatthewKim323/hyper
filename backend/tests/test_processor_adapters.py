import json
import time
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from app import main, auth, objects
from app.accounting import Accounting
from app.processor_adapters import Adapters
from app.processor_api import router
from app.settlements import Settlements, Batch, Statement
from app.database import adapter_imports
from test_simulator import setup

def upload(data,rows,key='export',id_field=None):
    return data.ingest(key+'.json',json.dumps(rows).encode(),dataset='export_'+key,source_key=key,id_field=id_field)['id']

def stripe_rows(payout='po_1',currency='usd',prefix='txn'):
    kinds=[('charge',100000),('refund',10000),('stripe_fee',3000),('chargeback',5000),
           ('chargeback_reversal',1000),('reserve',2000),('reserve_release',1500)]
    return [{'id':f'{prefix}_{i}','type':t,'amount':a,'currency':currency,'created':1758000000,
             'balance_transaction':f'{prefix}_bt{i}','payout_id':payout} for i,(t,a) in enumerate(kinds)]

def adyen_rows(payout='batch-1'):
    return [
        {'pspReference':'ady-1','category':'payment','grossAmount':100000,'commission':2500,'markup':500,'currency':'USD','payoutId':payout},
        {'pspReference':'ady-2','category':'refunded','grossAmount':10000,'currency':'USD','payoutId':payout},
        {'pspReference':'ady-3','category':'chargeback','grossAmount':5000,'currency':'USD','payoutId':payout},
        {'pspReference':'ady-4','category':'chargebackreversed','grossAmount':1000,'currency':'USD','payoutId':payout},
        {'pspReference':'ady-5','category':'reserve','grossAmount':2000,'currency':'USD','payoutId':payout},
        {'pspReference':'ady-6','category':'reserverelease','grossAmount':1500,'currency':'USD','payoutId':payout},
        {'pspReference':'ady-7','category':'fee','grossAmount':3000,'currency':'USD','payoutId':payout}]

def bank_rows():
    return [{'id':'bank-tx-1','reference':'po_1','booked_on':'2026-09-19','amount_minor':82500,'currency':'USD'}]

def proc_args(sid,**over):
    return {'source_id':sid,'provider':'stripe','bank_account_id':'bank-1',
            'expected_arrival':'2026-09-19','request_key':'rk-1',**over}

def bank_args(sid,**over):
    return {'source_id':sid,'bank_account_id':'bank-1','start':'2026-09-01','end':'2026-09-30',
            'complete':True,'request_key':'rk-bank',**over}

def packet(store,oid,sid,model):
    with Accounting(store,oid).transaction() as db:
        return Settlements(store,oid).load(db,sid,model)[0]

def test_stripe_maps_every_kind_to_strict_batch(setup):
    store,a,_,_,_=setup
    result=Adapters(a.data).execute('import_processor_report',proc_args(upload(a.data,stripe_rows())))
    assert result['movement_count']==7 and result['dropped_rows']==[]
    assert result['payout_id']==result['batch_id']=='po_1'
    assert result['amounts_minor_by_kind']=={'sale':100000,'refund':10000,'fee':3000,'chargeback':5000,
        'chargeback_reversal':1000,'reserve_hold':2000,'reserve_release':1500}
    batch=packet(store,a.oid,result['output_source_id'],Batch)
    assert batch.currency=='USD' and batch.payout_minor==82500 and batch.declared_count==7
    assert batch.bank_reference=='po_1' and batch.complete and str(batch.expected_arrival)=='2026-09-19'

def test_adyen_maps_kinds_and_fee_fields(setup):
    store,a,_,_,_=setup
    result=Adapters(a.data).execute('import_processor_report',proc_args(upload(a.data,adyen_rows()),provider='adyen',request_key='rk-adyen'))
    assert result['movement_count']==9 and result['dropped_rows']==[]
    assert result['amounts_minor_by_kind']=={'sale':100000,'refund':10000,'fee':6000,'chargeback':5000,
        'chargeback_reversal':1000,'reserve_hold':2000,'reserve_release':1500}
    batch=packet(store,a.oid,result['output_source_id'],Batch)
    assert batch.payout_minor==79500 and batch.batch_id=='batch-1'
    assert {m.id for m in batch.movements}>={'ady-1:commission','ady-1:markup'}

def test_unknown_type_and_missing_payout_dropped(setup):
    _,a,_,_,_=setup
    rows=stripe_rows()+[{'id':'txn_bad','type':'junk','amount':1,'currency':'usd','payout_id':'po_1'},
                        {'id':'txn_nop','type':'charge','amount':1,'currency':'usd'}]
    result=Adapters(a.data).execute('import_processor_report',proc_args(upload(a.data,rows)))
    assert result['movement_count']==7
    reasons={(d['row_number'],d['reason']) for d in result['dropped_rows']}
    assert reasons=={(8,'UNKNOWN_TYPE'),(9,'MISSING_PAYOUT')}

def test_missing_id_falls_through_to_drop(setup):
    _,a,_,_,_=setup
    rows=[{'balance_transaction':'bt_ok','type':'charge','amount':500,'currency':'usd','payout_id':'po_1'},
          {'type':'charge','amount':500,'currency':'usd','payout_id':'po_1'}]
    result=Adapters(a.data).execute('import_processor_report',proc_args(upload(a.data,rows)))
    assert result['movement_count']==1
    assert result['dropped_rows']==[{'row_number':2,'record_id':'row-2','reason':'MISSING_ID'}]

def test_multi_payout_requires_selection(setup):
    _,a,_,_,_=setup
    rows=stripe_rows('po_1',prefix='a')+stripe_rows('po_2',prefix='b')
    sid=upload(a.data,rows)
    svc=Adapters(a.data)
    with pytest.raises(ValueError,match='po_1.*po_2|po_2.*po_1'):
        svc.execute('import_processor_report',proc_args(sid))
    result=svc.execute('import_processor_report',proc_args(sid,payout_id='po_2'))
    assert result['payout_id']=='po_2' and result['movement_count']==7
    assert [d['reason'] for d in result['dropped_rows']]==['OTHER_PAYOUT']*7
    with pytest.raises(ValueError,match='not found'):
        svc.execute('import_processor_report',proc_args(sid,payout_id='po_9',request_key='rk-other'))

def test_mixed_currency_rejected(setup):
    _,a,_,_,_=setup
    rows=stripe_rows()+[{'id':'txn_eur','type':'charge','amount':1,'currency':'eur','payout_id':'po_1'}]
    with pytest.raises(ValueError,match='Mixed currencies'):
        Adapters(a.data).execute('import_processor_report',proc_args(upload(a.data,rows)))

def test_amount_parsing_exact_decimals_and_drops(setup):
    _,a,_,_,_=setup
    rows=[{'id':'d1','type':'charge','amount':'10.50','currency':'usd','payout_id':'po_1'},
          {'id':'d2','type':'charge','amount':'10.505','currency':'usd','payout_id':'po_1'},
          {'id':'d3','type':'refund','amount':'-5','currency':'usd','payout_id':'po_1'},
          {'id':'d4','type':'charge','amount':'abc','currency':'usd','payout_id':'po_1'}]
    result=Adapters(a.data).execute('import_processor_report',proc_args(upload(a.data,rows)))
    assert result['amounts_minor_by_kind']['sale']==1050
    reasons=[d['reason'] for d in result['dropped_rows']]
    assert reasons==['NON_MINOR_AMOUNT','INVALID_AMOUNT','INVALID_AMOUNT']

def test_bank_statement_maps_and_drops_outside_period(setup):
    store,a,_,_,_=setup
    rows=[{'id':'t1','reference':'po_1','booked_on':'2026-09-19','amount_minor':82500,'currency':'USD'},
          {'id':'t2','reference':'po_9','booked_on':'2026-10-05','amount_minor':1,'currency':'USD'},
          {'id':'t3','posted_at':'2026-09-20T10:00:00Z','amount':'12.34','currency':'USD'},
          {'id':'t4','reference':'x','amount_minor':5,'currency':'USD'}]
    result=Adapters(a.data).execute('import_bank_statement',bank_args(upload(a.data,rows,'bank')))
    assert result['deposit_count']==2 and result['currency']=='USD'
    assert [d['reason'] for d in result['dropped_rows']]==['OUTSIDE_PERIOD','MISSING_DATE']
    statement=packet(store,a.oid,result['output_source_id'],Statement)
    assert [d.id for d in statement.deposits]==['t1','t3']
    assert statement.deposits[1].reference=='t3' and statement.deposits[1].amount_minor==1234

def test_duplicate_ids_dropped(setup):
    _,a,_,_,_=setup
    dup=[{'reference':'po_1','booked_on':'2026-09-19','amount_minor':5,'currency':'USD'} for _ in range(2)]
    result=Adapters(a.data).execute('import_bank_statement',bank_args(upload(a.data,dup,'bank')))
    assert result['deposit_count']==1 and result['dropped_rows'][0]['reason']=='DUPLICATE_ID'
    rows=[{'balance_transaction':'bt_dup','type':'charge','amount':500,'currency':'usd','payout_id':'po_1'},
          {'balance_transaction':'bt_dup','type':'refund','amount':100,'currency':'usd','payout_id':'po_1'}]
    result=Adapters(a.data).execute('import_processor_report',proc_args(upload(a.data,rows,'dup2'),request_key='rk-dup'))
    assert result['movement_count']==1 and result['dropped_rows'][0]['reason']=='DUPLICATE_ID'

def test_zero_valid_rows_error_writes_nothing(setup):
    store,a,_,_,_=setup
    junk=[{'id':f'j{i}','type':'mystery','amount':1,'currency':'usd','payout_id':'po_1'} for i in range(3)]
    with pytest.raises(ValueError):
        Adapters(a.data).execute('import_processor_report',proc_args(upload(a.data,junk,'junk')))
    late=[{'id':'t1','reference':'po_1','booked_on':'2026-11-01','amount_minor':5,'currency':'USD'}]
    with pytest.raises(ValueError):
        Adapters(a.data).execute('import_bank_statement',bank_args(upload(a.data,late,'late')))
    with store.connect() as db:
        assert db.execute(select(func.count()).select_from(adapter_imports)).scalar()==0

def test_round_trip_reconcile_balanced(setup):
    store,a,_,_,_=setup
    svc=Adapters(a.data)
    proc=svc.execute('import_processor_report',proc_args(upload(a.data,stripe_rows())))
    bank=svc.execute('import_bank_statement',bank_args(upload(a.data,bank_rows(),'bank')))
    result=Settlements(store,a.oid).execute('reconcile_settlement',
        {'processor_source_id':proc['output_source_id'],'bank_source_id':bank['output_source_id']})
    assert result['status']=='balanced_unverified'
    assert result['processor_residual_minor']==result['bank_residual_minor']==0
    assert result['matched_bank_ids']==['bank-tx-1']

def test_tenant_isolation(setup):
    store,a,b,_,_=setup
    sid=upload(a.data,stripe_rows())
    with pytest.raises(LookupError):
        Adapters(b.data).execute('import_processor_report',proc_args(sid))
    result=Adapters(a.data).execute('import_processor_report',proc_args(sid))
    with pytest.raises(LookupError):
        Adapters(b.data).execute('get_adapter_import',{'import_id':result['import_id']})
    with pytest.raises(LookupError):
        Settlements(store,b.oid).execute('reconcile_settlement',
            {'processor_source_id':result['output_source_id'],'bank_source_id':result['output_source_id']})

def test_request_key_idempotency(setup):
    store,a,_,_,_=setup
    svc=Adapters(a.data);sid=upload(a.data,stripe_rows())
    first=svc.execute('import_processor_report',proc_args(sid))
    assert svc.execute('import_processor_report',proc_args(sid))==first
    with store.connect() as db:
        assert db.execute(select(func.count()).select_from(adapter_imports)).scalar()==1
    other=upload(a.data,stripe_rows(),'other')
    with pytest.raises(ValueError,match='request_key'):
        svc.execute('import_processor_report',proc_args(other))
    again=svc.execute('import_processor_report',proc_args(other,request_key='rk-2'))
    assert again['output_source_id']!=first['output_source_id']

def test_get_adapter_import_returns_persisted_row(setup):
    _,a,_,_,_=setup
    svc=Adapters(a.data)
    result=svc.execute('import_processor_report',proc_args(upload(a.data,stripe_rows())))
    row=svc.execute('get_adapter_import',{'import_id':result['import_id']})
    assert row['provider']=='stripe' and row['request_key']=='rk-1'
    assert row['output_source_id']==result['output_source_id']
    assert row['result']['movement_count']==7
    with pytest.raises(LookupError):svc.execute('get_adapter_import',{'import_id':'imp_missing'})

def test_http_permissions(setup,monkeypatch):
    store,a,_,_,fake=setup
    sid=upload(a.data,stripe_rows())
    monkeypatch.setattr(main,'store',store)
    monkeypatch.setattr(auth,'verify',lambda token:auth.Identity(token,int(time.time())+300))
    monkeypatch.setattr(objects,'ObjectStore',lambda:fake)
    store.add_member('teammate',a.oid)
    app=FastAPI();app.include_router(router)
    args=proc_args(sid)
    with TestClient(app) as client:
        assert client.post('/accounting/adapters/processor',json=args).status_code==401
        assert client.post('/accounting/adapters/processor',json=args,headers={'Authorization':'Bearer bob'}).status_code==404
        ok=client.post('/accounting/adapters/processor',json=args,headers={'Authorization':'Bearer teammate'})
        assert ok.status_code==200,ok.text
        imported=ok.json()
        assert client.post('/accounting/adapters/processor',json=args,headers={'Authorization':'Bearer alice'}).json()['import_id']==imported['import_id']
        url='/accounting/adapters/imports/'+imported['import_id']
        assert client.get(url,headers={'Authorization':'Bearer alice'}).status_code==200
        assert client.get(url,headers={'Authorization':'Bearer bob'}).status_code==404
        bad={'source_id':sid,'bank_account_id':'bank-1','start':'2026-10-01','end':'2026-09-01','complete':True,'request_key':'rk-bad'}
        assert client.post('/accounting/adapters/bank-statement',json=bad,headers={'Authorization':'Bearer alice'}).status_code==409
