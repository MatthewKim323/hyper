#!/usr/bin/env python3
"""Deterministic linked synthetic financial history. Monetary values are USD cents."""
import argparse,calendar,hashlib,json,random
from collections import defaultdict
from datetime import date,timedelta
from pathlib import Path
START=date(2025,1,1); END=date(2026,6,30)
def month(i): return 2025+i//12,i%12+1
def end(i):
 y,m=month(i);return date(y,m,calendar.monthrange(y,m)[1])
def dump(path,obj): path.write_text(json.dumps(obj,indent=2)+'\n')
def generate(root,seed=20260919):
 root=Path(root)
 if root.exists() and any(root.iterdir()): raise ValueError('Output must be empty; use a fresh directory')
 visible=root/'visible';private=root/'private';visible.mkdir(parents=True,exist_ok=True);private.mkdir()
 rng=random.Random(seed); t=defaultdict(list)
 def add(table,**row): t[table].append(row);return row
 def journal(dt,source,desc,legs,flow='operating'):
  assert sum(v for _,v in legs)==0
  jid=f'J-{len(t["journals"])+1:06}'
  add('journals',journal_id=jid,date=str(dt),source_id=source,description=desc)
  for n,(account,value) in enumerate(legs):
   add('journal_lines',line_id=f'{jid}-{n+1}',journal_id=jid,account=account,debit_cents=max(value,0),credit_cents=max(-value,0))
   if account in ('1000','1100','1110'):
    add('settlement_movements',movement_id=f'MOV-{len(t["settlement_movements"])+1:06}',date=str(dt),account=account,amount_cents=value,source_id=source,journal_id=jid,asset='USD' if account=='1000' else 'USDC',status='confirmed',cash_flow_category=flow,external_reference=f'SIM-SETTLEMENT-{jid}-{n}',simulation=True)
  return jid
 coa={'1000':('USD operating bank','asset'),'1100':('USDC treasury wallet','asset'),'1110':('USDC disbursement wallet','asset'),'1200':('Accounts receivable','asset'),'1300':('Prepaid services','asset'),'1500':('Equipment cost','asset'),'1510':('Accumulated depreciation','contra_asset'),'2000':('Accounts payable','liability'),'2100':('Payroll deductions payable','liability'),'2200':('Deferred subscription revenue','liability'),'2300':('Accrued cloud services','liability'),'3000':('Contributed equity','equity'),'4000':('Subscription revenue','revenue'),'4010':('Usage revenue','revenue'),'5000':('Cloud and vendor service expense','expense'),'5100':('Gross payroll expense','expense'),'5110':('Employer payroll expense','expense'),'5200':('Insurance and software expense','expense'),'5300':('Depreciation expense','expense'),'5400':('Treasury service fees','expense')}
 for code,(name,kind) in coa.items():add('accounts',account=code,name=name,kind=kind)
 company={'company_id':'MERIDIAN-001','name':'Meridian Ledger Labs, Inc.','synthetic':True,'currency':'USD','period_start':str(START),'period_end':str(END),'business':'Blockchain monitoring and API SaaS; company-owned funds only; no custody or token issuance','headcount':48,'customers':120,'vendors':60,'assumptions':{'valuation':'USDC fixed at $1 solely for this simulation; tracked separately from bank cash','tax':'No income/sales tax model; synthetic payroll withholding 20%, employer cost 8%; not statutory rates','revenue':'Hosted subscription earned monthly; annual advance base billings deferred; monthly usage earned as delivered','cash_flow':'Bank-only management cash-flow view; USDC purchases/redemptions shown as investing. Not a standards-compliant statement classification opinion.','settlement':'SIM identifiers; sponsored network gas charged as USD provider fee; no native gas token model','population':'48 staff,120 customers,60 vendors in scope throughout, not a hiring or customer acquisition simulation','period':'18-month established-business scenario initialized at zero balances immediately before seed financing'}}
 dump(visible/'company.json',company)
 for code,label,asset in [('1000','Operating bank','USD'),('1100','Treasury wallet','USDC'),('1110','Disbursement wallet','USDC')]:add('treasury_accounts',treasury_account_id=f'SIM-{code}',ledger_account=code,label=label,asset=asset,owner=company['company_id'],endpoint=f'SIM-NONROUTABLE-{code}',approved=True)
 names=['Avery','Morgan','Jordan','Riley','Casey','Taylor','Quinn','Cameron']
 for i in range(48):add('employees',employee_id=f'EMP-{i+1:03}',name=f'{names[i%8]} Team{i+1:02}',department=['Engineering','Sales','Security','Operations','Finance','People'][i%6],monthly_gross_cents=650000+(i%8)*75000,active_from=str(START))
 for i in range(120):
  cid=f'CUS-{i+1:03}';base=150000+(i%12)*35000
  add('customers',customer_id=cid,name=f'{["Aster","Cedar","Orion","Juniper","Harbor","Lattice"][i%6]} Network {i+1:03}',contact=f'finance{i+1}@customer.example',contract_id=f'CON-{i+1:03}')
  add('contracts',contract_id=f'CON-{i+1:03}',customer_id=cid,effective_date=str(START),end_date='2026-12-31',monthly_base_cents=base,usage_block_price_cents=1,billing='annual_advance' if i%6==0 else 'monthly_arrears',service='Hosted access and metered API blocks',terms_days=30)
 for i in range(60):add('vendors',vendor_id=f'VEN-{i+1:03}',name=f'{["Northstar Cloud","Granite Legal","Beacon Security","Pine Software","Atlas Services","Cobalt Contractors"][i%6]} {i+1:03}',contact=f'ap{i+1}@supplier.example',category=['cloud','legal','security','software','services','contractor'][i%6],approved_recipient=f'SIM-RECIPIENT-{i+1:03}',terms_days=30)
 equity=add('equity_events',equity_id='EQ-001',date=str(START),amount_cents=1200000000,instrument='Synthetic priced equity; no preferred terms modeled')
 journal(START,'EQ-001','Seed financing',[('1000',equity['amount_cents']),('3000',-equity['amount_cents'])],'financing')
 def transfer(dt,amount,src,dst,kind):
  tid=f'TRF-{len(t["treasury_transfers"])+1:03}'
  add('treasury_transfers',transfer_id=tid,date=str(dt),from_account=src,to_account=dst,amount_cents=amount,kind=kind,measurement_usd_per_usdc='1.00')
  journal(dt,tid,kind,[(dst,amount),(src,-amount)],'investing' if '1000' in (src,dst) else 'internal')
 transfer(START,100000000,'1000','1100','USD to USDC conversion')
 transfer(START,30000000,'1100','1110','Own-wallet transfer')
 usage_totals=defaultdict(int);usage_refs=defaultdict(list)
 d=START
 while d<=END:
  for i,c in enumerate(t['customers']):
   units=80+rng.randrange(420);key=(str(d)[:7],c['customer_id']);uid=f'USE-{len(t["usage_daily"])+1:06}'
   add('usage_daily',usage_id=uid,date=str(d),customer_id=c['customer_id'],contract_id=c['contract_id'],meter='1000_api_request_block',units=units,rate_cents=1,amount_cents=units)
   usage_totals[key]+=units;usage_refs[key].append(uid)
  d+=timedelta(days=1)
 for mi in range(18):
  y,m=month(mi);first=date(y,m,1);me=end(mi);period=str(first)[:7]
  if mi and mi%3==0:transfer(first,15000000,'1100','1110','Own-wallet transfer')
  for i,c in enumerate(t['customers']):
   contract=t['contracts'][i];base=contract['monthly_base_cents'];annual=contract['billing']=='annual_advance';amount=usage_totals[(period,c['customer_id'])]+(0 if annual else base)
   items=[('usage',amount if annual else amount-base,'4010')]
   if not annual:items.append(('monthly_access',base,'4000'))
   if annual and m==1:
    ai=f'AR-{len(t["ar_invoices"])+1:05}';total=base*12
    add('ar_invoices',invoice_id=ai,customer_id=c['customer_id'],contract_id=contract['contract_id'],date=str(first),due_date=str(first+timedelta(days=30)),amount_cents=total,invoice_type='annual_advance',status='posted')
    add('ar_invoice_lines',line_id=ai+'-1',invoice_id=ai,description='12 months hosted access',amount_cents=total)
    journal(first,ai,'Advance subscription billing',[('1200',total),('2200',-total)])
   iid=f'AR-{len(t["ar_invoices"])+1:05}'
   add('ar_invoices',invoice_id=iid,customer_id=c['customer_id'],contract_id=contract['contract_id'],date=str(me),due_date=str(me+timedelta(days=30)),amount_cents=amount,invoice_type='monthly',status='posted',usage_ids=usage_refs[(period,c['customer_id'])])
   legs=[('1200',amount)]
   for n,(desc,amt,acct) in enumerate(items):
    add('ar_invoice_lines',line_id=f'{iid}-{n+1}',invoice_id=iid,description=desc,amount_cents=amt);legs.append((acct,-amt))
   journal(me,iid,'Service delivered and billed',legs)
   if annual:
    r=add('revenue_schedule',schedule_id=f'REV-{len(t["revenue_schedule"])+1:04}',date=str(me),contract_id=contract['contract_id'],amount_cents=base)
    journal(me,r['schedule_id'],'Monthly deferred revenue release',[('2200',base),('4000',-base)])
  for i,v in enumerate(t['vendors']):
   amount=90000+(i%10)*20000+rng.randrange(5000);iid=f'AP-{len(t["ap_invoices"])+1:05}';po=f'PO-{len(t["purchase_orders"])+1:05}';dt=me-timedelta(days=3)
   add('vendor_agreements',agreement_id='VA-'+iid,vendor_id=v['vendor_id'],date=str(first),scope='Monthly accepted services',agreed_amount_cents=amount)
   add('purchase_orders',po_id=po,vendor_id=v['vendor_id'],date=str(first),amount_cents=amount,agreement_id='VA-'+iid)
   add('service_receipts',receipt_id='RC-'+iid,po_id=po,date=str(dt),accepted_amount_cents=amount,accepted_by='EMP-005')
   add('ap_invoices',invoice_id=iid,vendor_id=v['vendor_id'],po_id=po,date=str(dt),due_date=str(dt+timedelta(days=30)),amount_cents=amount,status='posted')
   journal(dt,iid,'Accepted supplier service',[('5000',amount),('2000',-amount)])
   if (mi*60+i)%29==0:
    credit=amount//10;cr=f'CM-{len(t["ap_credits"])+1:04}'
    add('ap_credits',credit_id=cr,invoice_id=iid,vendor_id=v['vendor_id'],date=str(me),amount_cents=credit,scope='Accepted service concession',status='verified')
    add('credit_allocations',allocation_id='CA-'+cr,credit_id=cr,invoice_id=iid,date=str(me),amount_cents=credit)
    journal(me,cr,'Supplier concession',[('2000',credit),('5000',-credit)])
  payroll_id=f'PAY-{mi+1:03}';gross=0;deductions=0;employer=0
  for e in t['employees']:
   g=e['monthly_gross_cents'];w=g//5;em=g*8//100;gross+=g;deductions+=w;employer+=em
   add('payroll_lines',payroll_line_id=payroll_id+'-'+e['employee_id'],payroll_id=payroll_id,employee_id=e['employee_id'],date=str(me),gross_cents=g,withholding_cents=w,employer_cents=em,net_cents=g-w)
  add('payroll',payroll_id=payroll_id,date=str(me),gross_cents=gross,withholding_cents=deductions,employer_cents=employer,net_cents=gross-deductions)
  journal(me,payroll_id,'Payroll recognized and net pay settled',[('5100',gross),('5110',employer),('1000',-(gross-deductions)),('2100',-(deductions+employer))])
  remit=me+timedelta(days=10)
  if remit<=END:
   rr=add('payroll_remittances',remittance_id='REM-'+payroll_id,date=str(remit),payroll_id=payroll_id,amount_cents=deductions+employer)
   journal(remit,rr['remittance_id'],'Payroll deductions and employer cost remitted',[('2100',deductions+employer),('1000',-(deductions+employer))])
  if m==1:
   pre=f'PRE-{y}';add('prepayments',prepayment_id=pre,date=str(first),amount_cents=3600000,coverage_end=f'{y}-12-31',months=12)
   journal(first,pre,'Annual insurance prepaid',[('1300',3600000),('1000',-3600000)])
  am=add('amortization',amortization_id=f'AM-{mi+1:03}',date=str(me),prepayment_id=f'PRE-{y}',amount_cents=300000)
  journal(me,am['amortization_id'],'Insurance consumed',[('5200',300000),('1300',-300000)])
  if mi in (2,8,14):
   aid=f'ASSET-{mi:02}';add('fixed_assets',asset_id=aid,date=str(first),cost_cents=5400000,useful_life_months=36,residual_cents=0)
   journal(first,aid,'Equipment acquired',[('1500',5400000),('1000',-5400000)],'investing')
  for asset in t['fixed_assets']:
   dep=add('depreciation',depreciation_id=f'DEP-{len(t["depreciation"])+1:03}',date=str(me),asset_id=asset['asset_id'],amount_cents=150000)
   journal(me,dep['depreciation_id'],'Straight-line equipment depreciation',[('5300',150000),('1510',-150000)])
  fee=add('treasury_fees',fee_id=f'FEE-{mi:03}',date=str(me),amount_cents=3500,description='Synthetic sponsored-network provider service')
  journal(me,fee['fee_id'],'Treasury provider fee',[('5400',3500),('1000',-3500)])
  add('budgets',budget_id=f'BUD-{mi:03}',date=str(first),period=period,revenue_cents=36000000+mi*250000,expense_cents=65000000,approved_on='2024-12-20')
 # Settlement occurs after invoice dates; installment and late payment variations.
 for i,inv in enumerate(t['ar_invoices']):
  dt=date.fromisoformat(inv['date']); lag=75 if i%17==0 else 20+(i%20)
  installments=[(lag,inv['amount_cents'])] if i%13 else [(20,inv['amount_cents']//2),(65,inv['amount_cents']-inv['amount_cents']//2)]
  for days,amt in installments:
   pd=dt+timedelta(days=days)
   if pd>END:continue
   pid=f'ARREC-{len(t["ar_receipts"])+1:05}';acct='1100' if i%4==0 else '1000'
   add('ar_receipts',receipt_id=pid,customer_id=inv['customer_id'],date=str(pd),amount_cents=amt,account=acct,status='confirmed')
   add('ar_allocations',allocation_id='ALLOC-'+pid,receipt_id=pid,invoice_id=inv['invoice_id'],date=str(pd),amount_cents=amt)
   journal(pd,pid,'Customer settlement',[ (acct,amt),('1200',-amt)])
 credited=defaultdict(int)
 for x in t['credit_allocations']:credited[x['invoice_id']]+=x['amount_cents']
 for i,inv in enumerate(t['ap_invoices']):
  pd=date.fromisoformat(inv['date'])+timedelta(days=60 if i%19==0 else 30)
  if pd>END:continue
  amt=inv['amount_cents']-credited[inv['invoice_id']];pid=f'APPAY-{len(t["ap_payments"])+1:05}';acct='1110' if i%5==0 else '1000'
  add('ap_payments',payment_id=pid,vendor_id=inv['vendor_id'],date=str(pd),amount_cents=amt,account=acct,status='confirmed')
  add('ap_allocations',allocation_id='ALLOC-'+pid,payment_id=pid,invoice_id=inv['invoice_id'],date=str(pd),amount_cents=amt)
  journal(pd,pid,'Supplier settlement',[('2000',amt),(acct,-amt)])
 # Received but unbilled June cloud capacity stays accrued at cutoff.
 add('accruals',accrual_id='ACC-001',date=str(END),amount_cents=1800000,service='June burst cloud capacity',invoice_received=False)
 journal(END,'ACC-001','Unbilled service accrued',[('5000',1800000),('2300',-1800000)])
 # Rebuild reports exclusively from dated ledger postings, never running future balances.
 jmap={j['journal_id']:j for j in t['journals']};previous=defaultdict(int);previous_cash=0
 for mi in range(18):
  me=str(end(mi));balance=defaultdict(int)
  for line in t['journal_lines']:
   if jmap[line['journal_id']]['date']<=me:balance[line['account']]+=line['debit_cents']-line['credit_cents']
  period=str(end(mi))[:7];rev=sum(-v for a,v in balance.items() if coa[a][1]=='revenue');exp=sum(v for a,v in balance.items() if coa[a][1]=='expense');prevrev=sum(-v for a,v in previous.items() if coa[a][1]=='revenue');prevexp=sum(v for a,v in previous.items() if coa[a][1]=='expense')
  assets=sum(v for a,v in balance.items() if coa[a][1] in ('asset','contra_asset'));liab=sum(-v for a,v in balance.items() if coa[a][1]=='liability');capital=-balance['3000'];profit=rev-exp
  flow={k:sum(x['amount_cents'] for x in t['settlement_movements'] if x['account']=='1000' and x['date'][:7]==period and x['cash_flow_category']==k) for k in ('operating','investing','financing')}
  add('statements',statement_id=f'STMT-{period}',date=me,balance_sheet={'assets_cents':assets,'liabilities_cents':liab,'equity_cents':capital+profit,'bank_cash_cents':balance['1000'],'usdc_cents':balance['1100']+balance['1110'],'ar_cents':balance['1200'],'ap_cents':-balance['2000'],'prepaids_cents':balance['1300'],'equipment_net_cents':balance['1500']+balance['1510'],'deferred_revenue_cents':-balance['2200']},income_statement={'monthly_revenue_cents':rev-prevrev,'monthly_expense_cents':exp-prevexp,'monthly_profit_cents':rev-prevrev-exp+prevexp,'cumulative_profit_cents':profit},bank_cash_flow={'opening_cents':previous_cash,**{k+'_cents':v for k,v in flow.items()},'closing_cents':balance['1000']},equity={'contributions_to_date_cents':capital,'cumulative_profit_cents':profit,'closing_cents':capital+profit})
  for a in coa:add('trial_balance',trial_balance_id=f'TB-{period}-{a}',date=me,account=a,balance_cents=balance[a])
  previous=balance;previous_cash=balance['1000']
 # Point-in-time outstanding items, aging and close checklists.
 for mi in range(18):
  cutoff=str(end(mi))
  for side,table,allocation in [('ar','ar_invoices','ar_allocations'),('ap','ap_invoices','ap_allocations')]:
   allocated=defaultdict(int)
   for row in t[allocation]+(t['credit_allocations'] if side=='ap' else []):
    if row['date']<=cutoff:allocated[row['invoice_id']]+=row['amount_cents']
   for inv in t[table]:
    if inv['date']<=cutoff and inv['amount_cents']>allocated[inv['invoice_id']]:
     add('aging',aging_id=f'AGE-{len(t["aging"])+1:05}',date=cutoff,side=side,invoice_id=inv['invoice_id'],outstanding_cents=inv['amount_cents']-allocated[inv['invoice_id']],days_past_due=max(0,(date.fromisoformat(cutoff)-date.fromisoformat(inv['due_date'])).days))
  for control in ('bank','wallets','ap','ar','payroll','prepaids','assets','deferred_revenue','accruals'):
   add('close_checklist',check_id=f'CLOSE-{mi:02}-{control}',date=cutoff,control=control,owner='EMP-005',status='prepared_for_review')
 # Authoring packets span the entire period and related business records.
 packets=[]
 for n in range(102):
  mi=n%18;period=str(end(mi))[:7];category=n%3
  if category==0:
   inv=[x for x in t['ar_invoices'] if x['date'][:7]==period][(n*7)%120];customer=next(x for x in t['customers'] if x['customer_id']==inv['customer_id']);contract=next(x for x in t['contracts'] if x['contract_id']==inv['contract_id']);facts={'invoice':{k:v for k,v in inv.items() if k!='usage_ids'},'customer':customer,'contract':contract};participants=[{'name':customer['name'],'role':'Customer finance contact'},{'name':'Casey Team05','role':'Finance owner'}]
  elif category==1:
   inv=[x for x in t['ap_invoices'] if x['date'][:7]==period][n%60];vendor=next(x for x in t['vendors'] if x['vendor_id']==inv['vendor_id']);po=next(x for x in t['purchase_orders'] if x['po_id']==inv['po_id']);facts={'invoice':inv,'vendor':vendor,'purchase_order':po,'service_receipt':next(x for x in t['service_receipts'] if x['po_id']==po['po_id'])};participants=[{'name':vendor['name'],'role':'Supplier billing contact'},{'name':'Casey Team05','role':'Finance owner'}]
  else:
   payroll=t['payroll'][mi];facts={'payroll':payroll,'company_id':'MERIDIAN-001','settlement_policy':'Only confirmed external movements are settled; proposals are not settlements'};participants=[{'name':'Casey Team05','role':'Finance owner'},{'name':'Taylor Team06','role':'People operations'}]
  packets.append({'packet_id':f'packet-{n+1:03}','date':str(end(mi)),'company':company['name'],'participants':participants,'immutable_facts':facts,'allowed_unknowns':['Missing explanations should be requested, not invented','No additional approval or payment is established by these draft documents'],'requested_document_types':['email','chat','operational_note','contract_excerpt','reconciliation_question','follow_up']})
 for table,rows in t.items():
  with (visible/(table+'.jsonl')).open('w') as f:
   for row in rows:f.write(json.dumps(row,separators=(',',':'))+'\n')
 with (private/'narrative_packets.jsonl').open('w') as f:
  for p in packets:f.write(json.dumps(p)+'\n')
 dump(root/'manifest.json',{'seed':seed,'synthetic':True,'tables':{k:len(v) for k,v in t.items()},'rows':sum(map(len,t.values())),'narrative_packets':102,'files':{str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(root.rglob('*')) if f.is_file()}})
 return t
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--seed',type=int,default=20260919);a=p.parse_args();tables=generate(a.output,a.seed);print(json.dumps({'rows':sum(map(len,tables.values())),'tables':{k:len(v) for k,v in tables.items()}},indent=2))
