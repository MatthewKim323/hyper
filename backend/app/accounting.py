"""Evidence-backed AP analysis. Agents cannot promote evidence or approve proposals."""
import hashlib
import json
import re
from contextlib import contextmanager
from datetime import date
from typing import Literal
from pydantic import Field
from sqlalchemy import select, insert
from mirror_resolve import store as ledger, casework, creditmemo, proposals
from mirror_resolve.ingest import get_record
from mirror_resolve.intake import receive_record
from mirror_resolve.schemas import RECORD_TYPES
from .database import organizations, sources, records, accounting_evidence
from .database import counterparty_scenarios
from .workflow import emit as workflow_emit
from .data_service import StrictModel

class PromoteRecord(StrictModel):
    source_id: str
    row_number: int = Field(ge=1)
    record_type: Literal['VENDOR_MASTER','PURCHASE_ORDER','AGREEMENT','GOODS_RECEIPT','INVOICE','CHANGE_ORDER','CHANGE_ORDER_ACK','BACKORDER_NOTICE','CREDIT_MEMO']
    attestation: Literal['I verified this structured record against its source']
class OpenInvoice(StrictModel):
    invoice_id: str = Field(min_length=1,max_length=200)
class CaseID(StrictModel):
    case_id: str
class InspectCredit(CaseID):
    credit_id: str
class Propose(CaseID):
    based_on_revision: int = Field(ge=1)
class Approval(StrictModel):
    proposal_id: str
    proposal_hash: str
    decision: Literal['APPROVED','REJECTED']
class ListLimit(StrictModel):
    limit: int = Field(default=50,ge=1,le=100)
class Aging(StrictModel):
    as_of: date | None = None

TOOL_MODELS={'open_payable_case':OpenInvoice,'analyze_payable':CaseID,'inspect_payable_credit':InspectCredit,'prepare_payable_proposal':Propose,'list_payable_cases':ListLimit,'list_payable_proposals':ListLimit,'ap_aging':Aging}
DESCRIPTIONS={
    'open_payable_case':'Open or resume a deterministic AP case for an original invoice_id from owner-verified accounting records. Does not trust model-extracted records.',
    'analyze_payable':'Recompute exact invoice/PO/receipt matching, verified credits, residual, blocking issues and evidence links. Never substitute a narrative for failed checks.',
    'inspect_payable_credit':'Verify an original credit memo ID against an AP case using code-owned checks. Partial correction does not resolve other discrepancies.',
    'prepare_payable_proposal':'Prepare a hash-bound payable proposal from current accounting evidence and revision. Runs deterministic validation; returns blockers or an approval packet. Does not approve, commit entries, or move money.',
    'list_payable_cases':'List every AP case with its recomputed supported amounts, residual and open blocking issues. Read only; a failed recompute is reported, never guessed.',
    'list_payable_proposals':'List payable proposals with current validation checks and approval standing. Read only; approval status is reported, never inferred.',
    'ap_aging':'Bucket unresolved AP residual by days since invoice date (0-30, 31-60, 61-90, 90+) per currency as of a date. Exact recomputation from owner-verified records; cases with unreadable invoices are reported, not dropped silently.',
}

class Accounting:
    def __init__(self, store, oid):self.store,self.oid=store,oid
    def internal_id(self,value):
        return hashlib.sha256(self.oid.encode()).hexdigest()[:24]+':'+value
    def namespace(self,value):
        if isinstance(value,list):return [self.namespace(v) for v in value]
        if isinstance(value,dict):return {k:self.internal_id(v) if isinstance(v,str) and (k.endswith('_id') or k=='amends') else self.namespace(v) for k,v in value.items()}
        return value
    def exact_integers(self,value):
        # The ingestion layer stores top-level numeric fields as decimal strings.
        if isinstance(value,list):return [self.exact_integers(v) for v in value]
        if isinstance(value,dict):return {k:int(v) if isinstance(v,str) and (k.endswith('_cents') or k in ('qty','amendment_no')) and re.fullmatch(r'-?\d+',v) else self.exact_integers(v) for k,v in value.items()}
        return value
    @contextmanager
    def transaction(self):
        with self.store.engine.begin() as db:
            if db.dialect.name=='sqlite':db.exec_driver_sql('BEGIN IMMEDIATE')
            if not db.execute(select(organizations.c.id).where(organizations.c.id==self.oid).with_for_update()).scalar():raise LookupError('Organization not found')
            yield db
    def owned_case(self,db,cid):
        row=db.execute(select(ledger.cases).where(ledger.cases.c.case_id==cid,ledger.cases.c.company_id==self.oid)).mappings().first()
        if not row:raise LookupError('Accounting case not found')
        return dict(row)
    def current_evidence(self,db):
        # Fail closed if a promoted document was withdrawn/replaced in the evidence corpus.
        rows=db.execute(select(ledger.records.c.doc_id).where(ledger.records.c.company_id==self.oid,ledger.records.c.status=='ACTIVE',ledger.records.c.trust=='TRUSTED')).scalars().all()
        for doc_id in rows:
            active=db.execute(select(sources.c.active).join(accounting_evidence,accounting_evidence.c.source_id==sources.c.id).where(accounting_evidence.c.organization_id==self.oid,accounting_evidence.c.doc_id==doc_id)).scalars().all()
            if not active or not any(active):raise ValueError('Accounting evidence is missing or superseded; an owner must verify its replacement before analysis')
    def promote(self,args,actor,source_system='ERP',channel='OWNER_VERIFIED',sender=None):
        """Owner attestation is the default trust basis. The only other caller is the sandbox
        counterparty service, which passes a simulated portal channel and the namespaced sender so
        resolve applies its own supplier-portal rule (sender must be the approved vendor)."""
        with self.transaction() as db:
            source=db.execute(select(sources).where(sources.c.id==args.source_id,sources.c.organization_id==self.oid,sources.c.active.is_(True))).mappings().first()
            row=db.execute(select(records.c.payload).where(records.c.source_id==args.source_id,records.c.organization_id==self.oid,records.c.row_number==args.row_number)).scalar()
            if not source or row is None:raise LookupError('Active structured source row not found')
            previous=db.execute(select(accounting_evidence).where(accounting_evidence.c.organization_id==self.oid,accounting_evidence.c.source_id==args.source_id,accounting_evidence.c.row_number==args.row_number)).mappings().first()
            if previous:
                if previous['record_type']!=args.record_type:raise ValueError('Source row already promoted as another record type')
                return dict(previous)
            model,key=RECORD_TYPES[args.record_type]
            clean=json.loads(model.model_validate_json(json.dumps(self.exact_integers(row)),strict=True).model_dump_json())
            if clean.get('currency') and clean['currency'] not in {'USD','EUR','GBP'}:raise ValueError('This AP engine currently supports USD, EUR and GBP minor units only')
            for field in ('lines','prices','basis'):
                if field in clean:
                    ids=[v['item_id'] for v in clean[field]]
                    if not ids or len(set(ids))!=len(ids):raise ValueError('Nonempty unique item lines required; split/duplicate lines need explicit allocation')
            namespaced=self.namespace(clean)
            old=get_record(db,self.oid,namespaced[key])
            if old and old['record_type']!=args.record_type:raise ValueError('Record ID already belongs to another type')
            if old and args.record_type=='CREDIT_MEMO' and old['data']!=namespaced:raise ValueError('A credit memo cannot be overwritten; issue a new memo ID for review')
            # The trust basis is an authenticated OWNER attestation, not a source label supplied by an LLM.
            rec=receive_record(db,self.oid,args.record_type,namespaced,source_system=source_system,channel=channel,sender=self.internal_id(sender) if sender else None,actor=actor,source_msg_id=args.source_id+':'+str(args.row_number))
            result=dict(organization_id=self.oid,source_id=args.source_id,row_number=args.row_number,record_type=args.record_type,
                        original_record_id=clean[key],doc_id=rec['doc_id'],source_sha256=source['sha256'],verified_by=actor)
            db.execute(insert(accounting_evidence).values(**result))
            return result
    def inventory(self):
        with self.transaction() as db:
            return {'records':[dict(r) for r in db.execute(select(accounting_evidence).where(accounting_evidence.c.organization_id==self.oid)).mappings()]}
    def snapshot(self,db,cid):
        self.owned_case(db,cid);self.current_evidence(db)
        calculation=proposals.calculate_supported_payable(db,cid)
        evaluation=casework.evaluate_case(db,cid)
        doc_ids={ref['doc_id'] for ref in evaluation['match']['sources']}
        doc_ids.update(credit['doc_id'] for credit in evaluation['verified_credits'])
        return {'case':casework.get_case(db,cid),'calculation':calculation,'issues':casework.list_issues(db,cid),
                'evidence':[dict(r) for r in db.execute(select(accounting_evidence).where(accounting_evidence.c.organization_id==self.oid,accounting_evidence.c.doc_id.in_(doc_ids))).mappings()],
                'authority':'analysis_only','policy':'explicit_ap_rules_not_inferred_practice'}
    def display(self,value):
        """Strip the tenant namespace from IDs for people. Internal IDs never leave as lookup keys."""
        prefix=self.internal_id('')
        if isinstance(value,list):return [self.display(v) for v in value]
        if isinstance(value,dict):return {k:self.display(v) for k,v in value.items()}
        return value[len(prefix):] if isinstance(value,str) and value.startswith(prefix) else value
    def workflow_event(self, db, key, kind, cid, facts, actor='engine'):
        case = self.owned_case(db, cid)
        invoice = self.display(case['invoice_id'])
        simulated = bool(db.execute(select(counterparty_scenarios.c.id).where(
            counterparty_scenarios.c.organization_id == self.oid, counterparty_scenarios.c.invoice_id == invoice)).scalar())
        return workflow_emit(db, self.oid, key, kind, workflow_id='invoice:' + invoice,
            actor=actor, case_id=cid, entity_revision=case['revision'],
            facts={'invoiceId': invoice, **facts}, section='review' if kind != 'evidence.verified' else 'evidence',
            simulated=simulated)

    def list_cases(self,limit=50):
        """Every engine case for this organization with its recomputed position. Read only."""
        with self.transaction() as db:
            rows=db.execute(select(ledger.cases).where(ledger.cases.c.company_id==self.oid).order_by(ledger.cases.c.updated_at.desc()).limit(limit)).mappings().all()
            out=[]
            for row in rows:
                entry={'case_id':row['case_id'],'invoice_id':self.display(row['invoice_id']),'revision':row['revision'],
                       'work_status':row['work_status'],'authorization_status':row['authorization_status'],'payment_status':row['payment_status'],
                       'updated_at':row['updated_at'].isoformat()}
                try:
                    calc=proposals.calculate_supported_payable(db,row['case_id'])
                    issues=casework.list_issues(db,row['case_id'])
                    entry.update(calculation=self.display({k:calc[k] for k in ('currency','invoice_face_cents','verified_credits_total_cents','net_after_credits_cents','independently_supported_cents','residual_cents','ties')}),
                                 blocking_issues=[self.display({'type':i['type'],'description':i['description'],'next_action':i.get('next_action')}) for i in issues if i['blocking'] and i['status']=='OPEN'])
                except Exception as exc:
                    # One unreadable case must not blank the list; say why instead of guessing a number.
                    entry.update(calculation=None,blocking_issues=[],error=str(exc)[:300])
                out.append(entry)
            return {'cases':out}
    def list_proposals(self,limit=50):
        """Payable proposals with the checks they pass now and where approval stands. Read only."""
        with self.transaction() as db:
            rows=db.execute(select(ledger.proposals).join(ledger.cases,ledger.cases.c.case_id==ledger.proposals.c.case_id)
                .where(ledger.cases.c.company_id==self.oid).order_by(ledger.proposals.c.created_at.desc()).limit(limit)).mappings().all()
            out=[]
            for row in rows:
                approval=db.execute(select(ledger.approvals).where(ledger.approvals.c.proposal_id==row['proposal_id']).order_by(ledger.approvals.c.requested_at.desc())).mappings().first()
                try:checks=[{'name':c.get('name') or c.get('check'),'ok':bool(c['ok']),'detail':c.get('detail')} for c in proposals.validate_proposal(db,row['proposal_id'])]
                except Exception as exc:checks=[{'name':'validation','ok':False,'detail':str(exc)[:300]}]
                out.append({'proposal_id':row['proposal_id'],'case_id':row['case_id'],'hash':row['hash'],'status':row['status'],
                            'based_on_revision':row['based_on_revision'],'created_by':row['created_by'],'created_at':row['created_at'].isoformat(),
                            'payload':self.display(row['payload']),'checks':checks,
                            'approval':None if not approval else {'status':approval['status'],'decided_by':approval['decided_by'],
                                'decided_at':approval['decided_at'].isoformat() if approval['decided_at'] else None}})
            return {'proposals':out}
    def aging(self,as_of=None):
        as_of=as_of or date.today()
        with self.transaction() as db:
            rows=db.execute(select(ledger.cases).where(ledger.cases.c.company_id==self.oid)).mappings().all()
            buckets={k:{'cases':0,'residual_cents':0,'invoice_ids':[]} for k in ('0_30','31_60','61_90','over_90')}
            unreadable=[];resolved=0;by_currency={}
            for row in rows:
                try:
                    record=get_record(db,self.oid,row['invoice_id'])
                    if not record or 'invoice_date' not in record['data']:raise ValueError('invoice record missing date')
                    invoice_date=date.fromisoformat(record['data']['invoice_date'])
                    calc=proposals.calculate_supported_payable(db,row['case_id'])
                    residual=calc['residual_cents']
                except Exception as exc:
                    unreadable.append({'case_id':row['case_id'],'invoice_id':self.display(row['invoice_id']),'reason':str(exc)[:200]})
                    continue
                if residual<=0:resolved+=1;continue
                age=(as_of-invoice_date).days
                bucket='0_30' if age<=30 else '31_60' if age<=60 else '61_90' if age<=90 else 'over_90'
                buckets[bucket]['cases']+=1;buckets[bucket]['residual_cents']+=residual
                buckets[bucket]['invoice_ids'].append(self.display(row['invoice_id']))
                currency=calc['currency']
                by_currency.setdefault(currency,0);by_currency[currency]+=residual
            return {'as_of':as_of.isoformat(),'unit':'minor','buckets':buckets,'open_residual_minor':by_currency,
                    'resolved_cases':resolved,'unreadable_cases':unreadable}
    def execute(self,name,args):
        parsed=TOOL_MODELS[name].model_validate(args)
        if name=='list_payable_cases':return self.list_cases(parsed.limit)
        if name=='list_payable_proposals':return self.list_proposals(parsed.limit)
        if name=='ap_aging':return self.aging(parsed.as_of)
        with self.transaction() as db:
            self.current_evidence(db)
            if name=='open_payable_case':
                invoice=get_record(db,self.oid,self.internal_id(parsed.invoice_id))
                if not invoice or invoice['record_type']!='INVOICE':raise LookupError('Verified invoice not found')
                case=casework.open_case(db,self.oid,invoice['record_id'],actor='agent:accounting')
                return self.snapshot(db,case['case_id'])
            self.owned_case(db,parsed.case_id)
            if name=='analyze_payable':return self.snapshot(db,parsed.case_id)
            if name=='inspect_payable_credit':
                credit=creditmemo.inspect_credit_memo(db,parsed.case_id,self.internal_id(parsed.credit_id),'agent:accounting')
                result = {'credit':credit,**self.snapshot(db,parsed.case_id)}
                if credit.get('usable') and credit.get('state') in ('VERIFIED', 'ALLOCATED'):
                    self.workflow_event(db, 'credit:' + parsed.case_id + ':' + parsed.credit_id + ':' + str(result['case']['revision']),
                        'evidence.verified', parsed.case_id, {'sourceIds': sorted({e['source_id'] for e in result['evidence']})})
                return result
            snapshot=self.snapshot(db,parsed.case_id)
            if parsed.based_on_revision!=snapshot['case']['revision']:raise ValueError('Stale case revision; recompute before proposing')
            prop=proposals.propose_payable_update(db,parsed.case_id,parsed.based_on_revision,actor='agent:accounting',evidence_refs=snapshot['evidence'])
            review=proposals.record_review(db,prop['proposal_id'],reviewer='engine:deterministic_validator',verdict='PASS')
            approval=proposals.request_controller_approval(db,prop['proposal_id'],actor='agent:accounting') if review['verdict']=='PASS' else None
            if approval and approval['status'] == 'PENDING':
                self.workflow_event(db, 'proposal:' + prop['proposal_id'], 'proposal.prepared', parsed.case_id,
                    {'proposalId': prop['proposal_id'], 'proposalHash': prop['hash']})
            return {'proposal':prop,'validation':review,'approval':approval,'committed':False}
    def approve(self,args,user_id):
        with self.transaction() as db:
            prop=proposals.get_proposal(db,args.proposal_id)
            self.owned_case(db,prop['case_id']);self.current_evidence(db)
            if prop['hash']!=args.proposal_hash:raise ValueError('Proposal hash mismatch')
            if any(not c['ok'] for c in proposals.validate_proposal(db,args.proposal_id)):raise ValueError('Proposal no longer passes accounting checks')
            approval=proposals.request_controller_approval(db,args.proposal_id,actor='human:'+user_id)
            result = proposals.decide_approval(db,approval['approval_id'],decided_by='human:'+user_id,role='CONTROLLER',decision=args.decision,proposal_hash=args.proposal_hash)
            self.workflow_event(db, 'approval:' + approval['approval_id'] + ':' + args.decision,
                'approval.recorded', prop['case_id'], {'proposalId': prop['proposal_id'],
                    'proposalHash': args.proposal_hash, 'decision': args.decision}, actor={'kind': 'human', 'id': user_id})
            return result

def invalidate_replaced_sources(db, oid, source_key, new_source_id):
    """Raw source replacement revokes dependent drafts before anyone re-verifies it."""
    docs=db.execute(select(accounting_evidence.c.doc_id).join(sources, sources.c.id==accounting_evidence.c.source_id).where(
        accounting_evidence.c.organization_id==oid, sources.c.source_key==source_key, sources.c.id!=new_source_id)).scalars().all()
    touched=set()
    for rec in db.execute(select(ledger.records).where(ledger.records.c.company_id==oid,ledger.records.c.doc_id.in_(docs),ledger.records.c.status=='ACTIVE')).mappings():
        touched.update(casework.affected_cases(db,oid,dict(rec)))
    for cid in touched:casework.bump_revision(db,cid,'Backing source replaced; replacement requires owner verification',actor='engine:source_version')
