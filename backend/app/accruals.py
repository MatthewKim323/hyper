"""Evidence-backed fixed-rate expense accruals. Approval never implies posting."""
import calendar
import hashlib
import json
import time
import uuid
from datetime import date, timedelta
from typing import Annotated, Literal
from pydantic import Field, StrictBool, StrictInt
from sqlalchemy import select, insert, update
from .data_service import StrictModel
from .settlements import Identifier, Money, Currency, Settlements
from .accounting import Accounting
from .database import accrual_runs, accrual_followups, sources

Qty = Annotated[StrictInt, Field(gt=0, le=10**9)]

class Contract(StrictModel):
    obligation_id: Identifier
    vendor_id: Identifier
    currency: Currency
    start: date
    end: date
    authorized_qty: Qty
    unit_price_minor: Money
    expense_account: Identifier
    liability_account: Identifier

class Receipt(StrictModel):
    id: Identifier
    delivered_on: date
    quantity: Qty
    confirmed: StrictBool

class Deliveries(StrictModel):
    obligation_id: Identifier
    vendor_id: Identifier
    complete_through: date
    complete: StrictBool
    receipts: list[Receipt] = Field(max_length=10000)

class Entry(StrictModel):
    id: Identifier
    posted_on: date
    kind: Literal['invoice','accrual','reversal']
    amount_minor: Money
    reverses_id: Identifier | None = None

class Ledger(StrictModel):
    obligation_id: Identifier
    vendor_id: Identifier
    currency: Currency
    coverage_from: date
    coverage_through: date
    complete: StrictBool
    entries: list[Entry] = Field(max_length=10000)

class Prepare(StrictModel):
    contract_source_id: Identifier
    delivery_source_id: Identifier
    ledger_source_id: Identifier
    cutoff: date

class AccrualID(StrictModel):
    accrual_id: Identifier

class Approve(AccrualID):
    result_hash: Identifier
    attestation: Literal['I verified delivery, rates, ledger completeness, and account mappings']

class LifecycleEntry(StrictModel):
    id: Identifier
    kind: Literal['accrual_posting','reversal','invoice']
    posted_on: date
    amount_minor: Money

class Lifecycle(StrictModel):
    accrual_id: Identifier
    obligation_id: Identifier
    vendor_id: Identifier
    currency: Currency
    complete_through: date
    complete: StrictBool
    # Each invoice amount is explicitly allocated to this accrual's scope.
    entries: list[LifecycleEntry] = Field(max_length=10000)

class Followup(AccrualID):
    source_id: Identifier

TOOL_MODELS={'prepare_expense_accrual':Prepare,'get_expense_accrual':AccrualID,'track_expense_accrual':Followup}
DESCRIPTIONS={
    'prepare_expense_accrual':'Calculate a fixed-rate service accrual from stored contract, delivery and complete ledger source IDs at a month-end cutoff. Exact units times rate minus posted expense; returns blocking issues, citations and proposed balanced journals. Cannot approve or post.',
    'get_expense_accrual':'Read an accrual proposal, owner approval, current evidence freshness and latest posting/reversal/invoice tracking. Approval is not posting.',
    'track_expense_accrual':'Compare a stored lifecycle report explicitly allocated to an approved accrual with expected posting, reversal and invoice amounts. Persist evidence and discrepancies; no external ledger writes. Never invent allocation or claim independent provider verification.',
}

def calculate(contract, deliveries, ledger, cutoff):
    issues=[]
    def check(ok,code):
        if not ok and code not in issues:issues.append(code)
    check(cutoff.day==calendar.monthrange(cutoff.year,cutoff.month)[1],'NOT_MONTH_END')
    check(contract.start<=contract.end,'INVALID_CONTRACT_PERIOD')
    check(contract.expense_account!=contract.liability_account,'IDENTICAL_ACCOUNTS')
    check(deliveries.obligation_id==ledger.obligation_id==contract.obligation_id,'OBLIGATION_MISMATCH')
    check(deliveries.vendor_id==ledger.vendor_id==contract.vendor_id,'VENDOR_MISMATCH')
    check(ledger.currency==contract.currency,'CURRENCY_MISMATCH')
    check(deliveries.complete and deliveries.complete_through>=cutoff,'INCOMPLETE_DELIVERIES')
    check(ledger.complete and ledger.coverage_from<=contract.start and ledger.coverage_through>=cutoff,'INCOMPLETE_LEDGER')
    check(len({r.id for r in deliveries.receipts})==len(deliveries.receipts),'DUPLICATE_RECEIPT')
    check(len({e.id for e in ledger.entries})==len(ledger.entries),'DUPLICATE_ENTRY')
    check(all(contract.start<=r.delivered_on<=contract.end and r.delivered_on<=deliveries.complete_through for r in deliveries.receipts),'INVALID_DELIVERY_DATE')
    check(all(ledger.coverage_from<=e.posted_on<=ledger.coverage_through for e in ledger.entries),'ENTRY_OUTSIDE_COVERAGE')
    check(sum(r.quantity for r in deliveries.receipts)<=contract.authorized_qty,'QUANTITY_EXCEEDS_CONTRACT')
    eligible=[r for r in deliveries.receipts if r.delivered_on<=cutoff]
    check(all(r.confirmed for r in eligible),'UNCONFIRMED_DELIVERY')
    entries={e.id:e for e in ledger.entries};reversed_amounts={}
    for e in ledger.entries:
        if e.kind=='reversal':
            original=entries.get(e.reverses_id)
            check(original is not None and original.kind=='accrual' and original.posted_on<=e.posted_on,'INVALID_REVERSAL_LINK')
            reversed_amounts[e.reverses_id]=reversed_amounts.get(e.reverses_id,0)+e.amount_minor
        else:check(e.reverses_id is None,'UNEXPECTED_REVERSAL_LINK')
    for eid,amount in reversed_amounts.items():
        check(eid in entries and amount<=entries[eid].amount_minor,'EXCESS_REVERSAL')
    delivered=sum(r.quantity*contract.unit_price_minor for r in eligible)
    booked=sum(e.amount_minor*(-1 if e.kind=='reversal' else 1) for e in ledger.entries if e.posted_on<=cutoff)
    check(0<=booked<=delivered,'BOOKED_EXPENSE_OUT_OF_RANGE')
    remaining=delivered-booked
    # Cumulative catch-up may include earlier delivery: surface it, do not hide cutoff judgment.
    prior=sum(r.quantity*contract.unit_price_minor for r in eligible if r.delivered_on.month!=cutoff.month or r.delivered_on.year!=cutoff.year)
    check(prior==0,'PRIOR_PERIOD_REVIEW_REQUIRED')
    journal=None
    if not issues and remaining>0:
        journal={'date':cutoff.isoformat(),'currency':contract.currency,'lines':[
            {'account':contract.expense_account,'debit_minor':remaining,'credit_minor':0},
            {'account':contract.liability_account,'debit_minor':0,'credit_minor':remaining}]}
    reversal=None if journal is None else {'date':(cutoff+timedelta(days=1)).isoformat(),'currency':contract.currency,'lines':[
        {'account':line['account'],'debit_minor':line['credit_minor'],'credit_minor':line['debit_minor']} for line in journal['lines']]}
    return {'obligation_id':contract.obligation_id,'vendor_id':contract.vendor_id,'currency':contract.currency,'cutoff':cutoff.isoformat(),
            'delivered_minor':delivered,'booked_minor':booked,'unrecorded_minor':remaining,'included_receipt_ids':[r.id for r in eligible],
            'issues':issues,'journal':journal,'reversal':reversal,'status':'blocked' if issues else ('awaiting_approval' if remaining else 'no_accrual_needed')}

class Accruals:
    def __init__(self,store,oid):self.store,self.oid=store,oid
    def owned(self,db,rid):
        row=db.execute(select(accrual_runs).where(accrual_runs.c.id==rid,accrual_runs.c.organization_id==self.oid)).mappings().first()
        if not row:raise LookupError('Accrual not found')
        return row
    def fresh(self,db,evidence):
        return all(db.execute(select(sources.c.id).where(sources.c.id==e['source_id'],sources.c.organization_id==self.oid,sources.c.sha256==e['sha256'],sources.c.active.is_(True))).scalar() for e in evidence)
    def current(self,db,row):
        result=dict(row['result']);fresh=self.fresh(db,result['evidence'])
        result.update(accrual_id=row['id'],result_hash=row['result_hash'],approved_by=row['approved_by'],approved_at=row['approved_at'],evidence_current=fresh)
        if not fresh:result['status']='stale'
        elif row['approved_by']:result['status']='approved_not_posted'
        follow=db.execute(select(accrual_followups).where(accrual_followups.c.accrual_id==row['id'],accrual_followups.c.organization_id==self.oid).order_by(accrual_followups.c.sequence.desc()).limit(1)).mappings().first()
        result['tracking']=None
        if follow:
            tracked=dict(follow['result'])
            if not fresh or not self.fresh(db,tracked['evidence']):tracked['status']='stale'
            result['tracking']=tracked
        return result
    def execute(self,name,args):
        body=TOOL_MODELS[name].model_validate(args)
        with Accounting(self.store,self.oid).transaction() as db:
            if name=='get_expense_accrual':return self.current(db,self.owned(db,body.accrual_id))
            loader=Settlements(self.store,self.oid)
            if name=='track_expense_accrual':return self.track(db,body,loader)
            contract,ce=loader.load(db,body.contract_source_id,Contract)
            deliveries,de=loader.load(db,body.delivery_source_id,Deliveries)
            ledger,le=loader.load(db,body.ledger_source_id,Ledger)
            result=calculate(contract,deliveries,ledger,body.cutoff)
            result.update(engine_version=1,evidence=[ce,de,le])
            digest=hashlib.sha256(json.dumps(result,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            existing=db.execute(select(accrual_runs).where(accrual_runs.c.organization_id==self.oid,accrual_runs.c.result_hash==digest)).mappings().first()
            if existing:return self.current(db,existing)
            row={'id':str(uuid.uuid4()),'organization_id':self.oid,'result_hash':digest,'result':result,'approved_by':None,'approved_at':None}
            db.execute(insert(accrual_runs).values(**row))
            return self.current(db,row)
    def approve(self,body,actor):
        with Accounting(self.store,self.oid).transaction() as db:
            row=self.owned(db,body.accrual_id);result=self.current(db,row)
            if body.result_hash!=row['result_hash'] or result['status'] not in ('awaiting_approval','approved_not_posted'):raise ValueError('Accrual is blocked, stale, unnecessary, or hash mismatched')
            if row['approved_by']:return result
            # Keep historical approvals reserved even when stale: external posting cannot be inferred absent.
            others=db.execute(select(accrual_runs).where(accrual_runs.c.organization_id==self.oid,accrual_runs.c.approved_by.is_not(None))).mappings().all()
            if any(o['result']['obligation_id']==result['obligation_id'] and o['result']['cutoff']==result['cutoff'] for o in others):
                raise ValueError('An approved accrual already exists for this obligation and cutoff; reconcile its disposition first')
            values={'approved_by':actor,'approved_at':int(time.time()*1000)}
            db.execute(update(accrual_runs).where(accrual_runs.c.id==row['id']).values(**values))
            return self.current(db,dict(row,**values))
    def track(self,db,body,loader):
        row=self.owned(db,body.accrual_id);result=self.current(db,row)
        if result['status']!='approved_not_posted':raise ValueError('Current owner-approved accrual required')
        report,evidence=loader.load(db,body.source_id,Lifecycle)
        if (report.accrual_id,report.obligation_id,report.vendor_id,report.currency)!=(row['id'],result['obligation_id'],result['vendor_id'],result['currency']):raise ValueError('Lifecycle identity or currency mismatch')
        totals={kind:sum(e.amount_minor for e in report.entries if e.kind==kind) for kind in ('accrual_posting','reversal','invoice')}
        issues=[];cutoff=date.fromisoformat(result['cutoff']);amount=result['unrecorded_minor']
        if not report.complete:issues.append('INCOMPLETE_LIFECYCLE')
        if len({e.id for e in report.entries})!=len(report.entries):issues.append('DUPLICATE_ENTRY')
        if report.complete_through<cutoff+timedelta(days=1):issues.append('INCOMPLETE_LIFECYCLE_PERIOD')
        if any(e.kind=='reversal' and e.posted_on!=cutoff+timedelta(days=1) for e in report.entries):issues.append('REVERSAL_DATE_MISMATCH')
        if any(e.posted_on>report.complete_through or (e.posted_on!=cutoff if e.kind=='accrual_posting' else e.posted_on<=cutoff) for e in report.entries):issues.append('INVALID_LIFECYCLE_DATE')
        if totals['accrual_posting']!=amount:issues.append('POSTING_UNCONFIRMED_OR_MISMATCHED')
        if totals['reversal']!=amount:issues.append('REVERSAL_UNCONFIRMED_OR_MISMATCHED')
        if totals['invoice']>amount:issues.append('INVOICE_EXCEEDS_ACCRUAL')
        outstanding=amount-totals['invoice']
        tracked={'status':'exceptions' if issues else ('matched_in_supplied_evidence' if outstanding==0 else 'awaiting_invoice'),
                 'issues':issues,'totals':totals,'uninvoiced_minor':outstanding,'evidence':[evidence],'observed_at':int(time.time()*1000)}
        db.execute(insert(accrual_followups).values(organization_id=self.oid,accrual_id=row['id'],result=tracked))
        return self.current(db,row)
