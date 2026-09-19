#!/usr/bin/env python3
import argparse,calendar,json
from collections import defaultdict
from datetime import date
from pathlib import Path

def load(root):return {p.stem:[json.loads(x) for x in p.read_text().splitlines()] for p in (Path(root)/'visible').glob('*.jsonl')}
def validate(root):
 t=load(root);errors=[]
 def check(ok,msg):
  if not ok:errors.append(msg)
 def unique(table,key):
  ids=[r[key] for r in t[table]];check(len(ids)==len(set(ids)),f'duplicate {table} {key}')
 for table,key in [('journals','journal_id'),('journal_lines','line_id'),('ar_invoices','invoice_id'),('ap_invoices','invoice_id'),('ap_credits','credit_id'),('credit_allocations','allocation_id'),('ar_allocations','allocation_id'),('ap_allocations','allocation_id'),('prepayments','prepayment_id'),('settlement_movements','movement_id')]:unique(table,key)
 jmap={x['journal_id']:x for x in t['journals']};account_map={x['account']:x for x in t['accounts']};lines=defaultdict(list)
 primary_keys={'equity_events':'equity_id','treasury_transfers':'transfer_id','ar_invoices':'invoice_id','ap_invoices':'invoice_id','revenue_schedule':'schedule_id','ap_credits':'credit_id','payroll':'payroll_id','payroll_remittances':'remittance_id','prepayments':'prepayment_id','amortization':'amortization_id','fixed_assets':'asset_id','depreciation':'depreciation_id','treasury_fees':'fee_id','ar_receipts':'receipt_id','ap_payments':'payment_id','accruals':'accrual_id'}
 source_ids={row[key] for table,key in primary_keys.items() for row in t[table]}
 source_records={row[key]:row for table,key in primary_keys.items() for row in t[table]}
 for row in t['journal_lines']:
  check(row['journal_id'] in jmap,'orphan journal line');check(row['account'] in account_map,'unknown account');check(type(row['debit_cents']) is int and type(row['credit_cents']) is int,'noninteger money');check(row['debit_cents']>=0 and row['credit_cents']>=0,'negative debit/credit');lines[row['journal_id']].append(row)
 for j in t['journals']:
  check('2025-01-01'<=j['date']<='2026-06-30','posting cutoff');check(j['source_id'] in source_ids,'missing journal source '+j['source_id']);check(bool(lines[j['journal_id']]) and sum(x['debit_cents']-x['credit_cents'] for x in lines[j['journal_id']])==0,'unbalanced '+j['journal_id'])
 for side,paytable,paykey in [('ar','ar_receipts','receipt_id'),('ap','ap_payments','payment_id')]:
  inv={x['invoice_id']:x for x in t[side+'_invoices']};pay={x[paykey]:x for x in t[paytable]};paid=defaultdict(int);used=defaultdict(int)
  for row in t[side+'_allocations']:
   check(row['invoice_id'] in inv and row[paykey] in pay,'orphan allocation');paid[row['invoice_id']]+=row['amount_cents'];used[row[paykey]]+=row['amount_cents']
   if row['invoice_id'] in inv and row[paykey] in pay:
    check(inv[row['invoice_id']]['date']<=row['date']==pay[row[paykey]]['date'],'allocation chronology');check(row['amount_cents']>0,'nonpositive allocation')
    owner='customer_id' if side=='ar' else 'vendor_id';check(inv[row['invoice_id']][owner]==pay[row[paykey]][owner],'counterparty mismatch')
  if side=='ap':
   credits={x['credit_id']:x for x in t['ap_credits']};credit_used=defaultdict(int)
   for row in t['credit_allocations']:
    check(row['credit_id'] in credits and row['invoice_id'] in inv,'orphan credit');credit_used[row['credit_id']]+=row['amount_cents'];paid[row['invoice_id']]+=row['amount_cents']
    if row['credit_id'] in credits:
     cr=credits[row['credit_id']];check(cr['invoice_id']==row['invoice_id'],'wrong credit scope');check(cr['date']<=row['date'],'credit chronology')
   for cid,amt in credit_used.items():check(amt<=credits[cid]['amount_cents'],'credit overallocated')
  for iid,amt in paid.items():
   if iid in inv:check(amt<=inv[iid]['amount_cents'],'invoice overapplied '+iid)
  for pid,amt in used.items():
   if pid in pay:check(amt==pay[pid]['amount_cents'],'payment allocation mismatch')
 for j in t['journals']:
  src=source_records.get(j['source_id'])
  if src:check(j['date']==src['date'],'source/journal chronology')
 by_source={j['source_id']:j['journal_id'] for j in t['journals']}
 for table,key,acct,sign in [('ar_receipts','receipt_id','1200',-1),('ap_payments','payment_id','2000',1),('ar_invoices','invoice_id','1200',1),('ap_invoices','invoice_id','2000',-1),('ap_credits','credit_id','2000',1)]:
  for src in t[table]:
   jid=by_source.get(src[key]);check(jid is not None,'source missing posting')
   if jid:check(sum(l['debit_cents']-l['credit_cents'] for l in lines[jid] if l['account']==acct)==sign*src['amount_cents'],'source posting amount mismatch')
 # Verify commercial joins and date ordering, not only monetary totals.
 vendors={r['vendor_id'] for r in t['vendors']};customers={r['customer_id'] for r in t['customers']};employees={r['employee_id'] for r in t['employees']}
 pos={r['po_id']:r for r in t['purchase_orders']};agreements={r['agreement_id']:r for r in t['vendor_agreements']}
 for inv in t['ap_invoices']:
  check(inv['vendor_id'] in vendors and inv['po_id'] in pos,'AP master/PO reference')
  if inv['po_id'] in pos:
   po=pos[inv['po_id']];check(po['vendor_id']==inv['vendor_id'] and po['date']<=inv['date'],'PO vendor/chronology');check(po['amount_cents']==inv['amount_cents'],'historical PO invoice amount')
 for po in t['purchase_orders']:check(po['agreement_id'] in agreements,'missing vendor agreement')
 for r in t['service_receipts']:check(r['po_id'] in pos and r['accepted_by'] in employees,'service receipt reference')
 for inv in t['ar_invoices']:check(inv['customer_id'] in customers,'AR customer missing')
 assets={r['asset_id']:r for r in t['fixed_assets']}
 for dep in t['depreciation']:
  check(dep['asset_id'] in assets,'depreciation asset missing')
  if dep['asset_id'] in assets:check(dep['date']>=assets[dep['asset_id']]['date'],'depreciation before service')
 # Each movement must match one ledger asset posting, with no fabricated balance snapshots.
 expected=defaultdict(int);actual=defaultdict(int)
 for l in t['journal_lines']:
  if l['account'] in ('1000','1100','1110'):expected[(l['journal_id'],l['account'])]+=l['debit_cents']-l['credit_cents']
 for m in t['settlement_movements']:
  actual[(m['journal_id'],m['account'])]+=m['amount_cents'];check(m['journal_id'] in jmap,'orphan movement')
  if m['journal_id'] in jmap:
   check(m['date']==jmap[m['journal_id']]['date'],'movement date mismatch')
   check(m['source_id']==jmap[m['journal_id']]['source_id'],'movement source mismatch')
 check(dict(expected)==dict(actual),'settlement/ledger mismatch')
 # Day-level solvency in the explicit funded scenario.
 funds=defaultdict(int)
 for dt in sorted({m['date'] for m in t['settlement_movements']}):
  for m in t['settlement_movements']:
   if m['date']==dt:funds[m['account']]+=m['amount_cents']
  check(all(x>=0 for x in funds.values()),'negative liquid asset '+dt)
 expected_dates=[str(date(2025+i//12,i%12+1,calendar.monthrange(2025+i//12,i%12+1)[1])) for i in range(18)]
 check([r['date'] for r in t['statements']]==expected_dates,'missing duplicate or unordered monthly statements')
 prev_cash=0;prevprofit=0
 for stmt in t['statements']:
  dt=stmt['date'];b=defaultdict(int)
  for j in t['journals']:
   if j['date']<=dt:
    for l in lines[j['journal_id']]:b[l['account']]+=l['debit_cents']-l['credit_cents']
  check(sum(b.values())==0,'trial balance '+dt)
  assets=sum(v for a,v in b.items() if account_map[a]['kind'] in ('asset','contra_asset'));liab=sum(-v for a,v in b.items() if account_map[a]['kind']=='liability');rev=sum(-v for a,v in b.items() if account_map[a]['kind']=='revenue');expense=sum(v for a,v in b.items() if account_map[a]['kind']=='expense');profit=rev-expense
  bs=stmt['balance_sheet'];check(bs['assets_cents']==assets and bs['liabilities_cents']==liab and bs['equity_cents']==-b['3000']+profit,'statement ledger mismatch '+dt);check(assets==liab+bs['equity_cents'],'balance sheet identity '+dt)
  check(stmt['income_statement']['cumulative_profit_cents']==profit and stmt['income_statement']['monthly_profit_cents']==profit-prevprofit,'income rollforward');prevprofit=profit
  cf=stmt['bank_cash_flow'];check(cf['opening_cents']==prev_cash and cf['closing_cents']==b['1000'] and cf['opening_cents']+sum(cf[k+'_cents'] for k in ('operating','investing','financing'))==cf['closing_cents'],'cash flow tie '+dt);prev_cash=b['1000']
  for side,acct in [('ar','1200'),('ap','2000')]:
   invoiced=sum(x['amount_cents'] for x in t[side+'_invoices'] if x['date']<=dt);paid=sum(x['amount_cents'] for x in t[side+'_allocations'] if x['date']<=dt);credit=sum(x['amount_cents'] for x in t['credit_allocations'] if x['date']<=dt) if side=='ap' else 0
   balance=invoiced-paid-credit;check(balance==b[acct]*(1 if side=='ar' else -1),'subledger tie '+side+' '+dt);check(balance==sum(x['outstanding_cents'] for x in t['aging'] if x['date']==dt and x['side']==side),'aging tie')
  check(b['1300']==sum(x['amount_cents'] for x in t['prepayments'] if x['date']<=dt)-sum(x['amount_cents'] for x in t['amortization'] if x['date']<=dt),'prepaid rollforward')
  check(b['1510']==-sum(x['amount_cents'] for x in t['depreciation'] if x['date']<=dt),'depreciation tie')
  check(-b['2200']==sum(x['amount_cents'] for x in t['ar_invoices'] if x['date']<=dt and x['invoice_type']=='annual_advance')-sum(x['amount_cents'] for x in t['revenue_schedule'] if x['date']<=dt),'deferred revenue rollforward')
  check(b['1500']==sum(x['cost_cents'] for x in t['fixed_assets'] if x['date']<=dt),'equipment cost rollforward')
  check(-b['2100']==sum(x['withholding_cents']+x['employer_cents'] for x in t['payroll'] if x['date']<=dt)-sum(x['amount_cents'] for x in t['payroll_remittances'] if x['date']<=dt),'payroll liability rollforward')
  for row in [x for x in t['trial_balance'] if x['date']==dt]:check(row['balance_cents']==b[row['account']],'exported trial balance mismatch')
 # Billing ties to usage and declared subscription terms.
 usage=defaultdict(int)
 for row in t['usage_daily']:usage[(row['date'][:7],row['customer_id'])]+=row['amount_cents'];check(row['amount_cents']==row['units']*row['rate_cents'],'usage arithmetic')
 contracts={x['contract_id']:x for x in t['contracts']}
 for inv in t['ar_invoices']:
  c=contracts[inv['contract_id']];expected_amount=c['monthly_base_cents']*12 if inv['invoice_type']=='annual_advance' else usage[(inv['date'][:7],inv['customer_id'])]+(0 if c['billing']=='annual_advance' else c['monthly_base_cents'])
  check(inv['amount_cents']==expected_amount,'invoice billing tie')
 packets=[json.loads(s) for s in (Path(root)/'private/narrative_packets.jsonl').read_text().splitlines()]
 check(len(packets)==102 and len({p['packet_id'] for p in packets})==102,'narrative packet count')
 return {'valid':not errors,'errors':errors,'rows':sum(map(len,t.values())),'tables':len(t),'monthly_statements':len(t['statements']),'narrative_packets':len(packets)}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('root');a=p.parse_args();report=validate(a.root);print(json.dumps(report,indent=2));raise SystemExit(not report['valid'])
