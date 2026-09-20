"""Exact, evidence-bound single-payout reconciliation. No ledger posting."""
import hashlib
import json
import uuid
from datetime import date
from typing import Annotated, Literal
from pydantic import Field, StrictBool, StrictInt
from sqlalchemy import select, insert, update
from .data_service import StrictModel
from .database import sources, records, settlement_runs
from .accounting import Accounting

Identifier = Annotated[str, Field(min_length=1, max_length=200)]
Money = Annotated[StrictInt, Field(ge=0, le=10**15)]
Currency = Literal['USD', 'EUR', 'GBP']

class Movement(StrictModel):
    id: Identifier
    kind: Literal['sale','refund','fee','chargeback','chargeback_reversal','reserve_hold','reserve_release']
    amount_minor: Money

class Batch(StrictModel):
    batch_id: Identifier
    bank_account_id: Identifier
    bank_reference: Identifier
    currency: Currency
    expected_arrival: date
    complete: StrictBool
    declared_count: Annotated[StrictInt, Field(ge=1)]
    payout_minor: Money
    movements: list[Movement] = Field(min_length=1,max_length=100000)

class Deposit(StrictModel):
    id: Identifier
    reference: Identifier
    booked_on: date
    amount_minor: Money

class Statement(StrictModel):
    bank_account_id: Identifier
    currency: Currency
    start: date
    end: date
    complete: StrictBool
    deposits: list[Deposit] = Field(max_length=100000)

class Reconcile(StrictModel):
    processor_source_id: Identifier
    bank_source_id: Identifier

class RunID(StrictModel):
    reconciliation_id: Identifier

class Verify(RunID):
    result_hash: Identifier
    attestation: Literal['I verified the source reports, batch membership, and completeness']

TOOL_MODELS = {'reconcile_settlement': Reconcile, 'get_settlement_reconciliation': RunID}
DESCRIPTIONS = {
    'reconcile_settlement': 'Reconcile one normalized processor batch and bank statement from stored source IDs. Exact minor-unit math, reference matching, completeness and duplicate checks. Returns persisted exceptions and source citations. Balanced is provisional until owner review; never invent missing movements or batch membership.',
    'get_settlement_reconciliation': 'Read a persisted settlement reconciliation and current source freshness. Stale evidence invalidates verification. Does not post entries or transfer money.',
}

def calculate(batch, statement):
    issues=[]
    def check(condition, code):
        if not condition: issues.append(code)
    check(batch.complete and statement.complete, 'INCOMPLETE_REPORT')
    check(len(batch.movements)==batch.declared_count, 'COUNT_MISMATCH')
    check(len({m.id for m in batch.movements})==len(batch.movements), 'DUPLICATE_PROCESSOR_ID')
    check(len({d.id for d in statement.deposits})==len(statement.deposits), 'DUPLICATE_BANK_ID')
    check(batch.currency==statement.currency, 'CURRENCY_MISMATCH')
    check(batch.bank_account_id==statement.bank_account_id, 'BANK_ACCOUNT_MISMATCH')
    check(statement.start<=batch.expected_arrival<=statement.end, 'ARRIVAL_OUTSIDE_STATEMENT')
    check(all(statement.start<=d.booked_on<=statement.end for d in statement.deposits), 'INVALID_STATEMENT_PERIOD')
    totals={kind:0 for kind in ('sale','refund','fee','chargeback','chargeback_reversal','reserve_hold','reserve_release')}
    for movement in batch.movements: totals[movement.kind]+=movement.amount_minor
    expected=sum(totals[k] for k in ('sale','chargeback_reversal','reserve_release'))-sum(totals[k] for k in ('refund','fee','chargeback','reserve_hold'))
    processor_residual=expected-batch.payout_minor
    check(processor_residual==0,'PROCESSOR_RESIDUAL')
    matches=[d for d in statement.deposits if d.reference==batch.bank_reference]
    check(len(matches)==1,'BANK_REFERENCE_MISSING' if not matches else 'AMBIGUOUS_BANK_REFERENCE')
    bank_residual=matches[0].amount_minor-batch.payout_minor if len(matches)==1 and batch.currency==statement.currency else None
    if bank_residual is not None:check(bank_residual==0,'BANK_RESIDUAL')
    return {'bank_account_id':batch.bank_account_id,'batch_id':batch.batch_id,'currency':batch.currency,'unit':'minor','totals':totals,
            'expected_payout_minor':expected,'reported_payout_minor':batch.payout_minor,
            'processor_residual_minor':processor_residual,'bank_residual_minor':bank_residual,
            'matched_bank_ids':[d.id for d in matches], 'issues':issues,
            'status':'blocked' if issues else 'balanced_unverified'}

class Settlements:
    def __init__(self,store,oid):self.store,self.oid=store,oid
    def load(self,db,sid,model):
        source=db.execute(select(sources).where(sources.c.id==sid,sources.c.organization_id==self.oid,sources.c.active.is_(True))).mappings().first()
        if not source:raise LookupError('Active source not found')
        rows=db.execute(select(records.c.payload).where(records.c.source_id==sid,records.c.organization_id==self.oid).order_by(records.c.row_number)).scalars().all()
        # A nested packet preserves strict integers through the generic ingestion layer.
        if len(rows)!=1 or set(rows[0])!={'id','packet'}:raise ValueError('Expected exactly one structured row with id and packet fields')
        return model.model_validate(rows[0]['packet']), {'source_id':sid,'sha256':source['sha256'],'row_number':1}
    def current(self,db,row):
        result=dict(row['result'])
        fresh=all(db.execute(select(sources.c.id).where(sources.c.id==e['source_id'],sources.c.organization_id==self.oid,sources.c.sha256==e['sha256'],sources.c.active.is_(True))).scalar() for e in result['evidence'])
        result.update(reconciliation_id=row['id'],result_hash=row['result_hash'],verified_by=row['verified_by'],evidence_current=bool(fresh))
        if not fresh:result['status']='stale'
        elif row['verified_by']:result['status']='verified'
        return result
    def owned(self,db,rid):
        row=db.execute(select(settlement_runs).where(settlement_runs.c.id==rid,settlement_runs.c.organization_id==self.oid)).mappings().first()
        if not row:raise LookupError('Reconciliation not found')
        return row
    def execute(self,name,args):
        body=TOOL_MODELS[name].model_validate(args)
        with Accounting(self.store,self.oid).transaction() as db:
            if name=='get_settlement_reconciliation':return self.current(db,self.owned(db,body.reconciliation_id))
            batch,processor=self.load(db,body.processor_source_id,Batch)
            statement,bank=self.load(db,body.bank_source_id,Statement)
            result=calculate(batch,statement)
            result.update(engine_version=1,evidence=[processor,bank])
            digest=hashlib.sha256(json.dumps(result,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            existing=db.execute(select(settlement_runs).where(settlement_runs.c.organization_id==self.oid,settlement_runs.c.result_hash==digest)).mappings().first()
            if existing:return self.current(db,existing)
            row={'id':str(uuid.uuid4()),'organization_id':self.oid,'result_hash':digest,'result':result,'verified_by':None}
            db.execute(insert(settlement_runs).values(**row))
            return self.current(db,row)
    def verify(self,body,actor):
        with Accounting(self.store,self.oid).transaction() as db:
            row=self.owned(db,body.reconciliation_id);result=self.current(db,row)
            if result['status'] not in ('balanced_unverified','verified') or body.result_hash!=row['result_hash']:raise ValueError('Result is blocked, stale, or hash does not match')
            others=db.execute(select(settlement_runs).where(settlement_runs.c.organization_id==self.oid,settlement_runs.c.id!=row['id'],settlement_runs.c.verified_by.is_not(None))).mappings().all()
            for other in others:
                previous=self.current(db,other)
                if previous['status']=='verified' and previous['bank_account_id']==result['bank_account_id'] and set(previous['matched_bank_ids']) & set(result['matched_bank_ids']):
                    raise ValueError('Bank transaction already belongs to another verified reconciliation')
            db.execute(update(settlement_runs).where(settlement_runs.c.id==row['id']).values(verified_by=actor))
            return self.current(db,dict(row,verified_by=actor))
