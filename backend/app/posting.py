"""Append-only journal posting. Corrections happen only through reversal entries."""
import hashlib
import json
import time
import uuid
from datetime import date
from typing import Annotated, Literal
from pydantic import Field, StrictInt
from sqlalchemy import select, insert, update
from .data_service import StrictModel
from .settlements import Identifier, Money, Currency
from .accounting import Accounting
from .accruals import Accruals
from .database import journal_drafts, journal_entries, sources

Memo = Annotated[str, Field(min_length=1, max_length=500)]

class Line(StrictModel):
    account: Identifier
    debit_minor: Money
    credit_minor: Money

class PostAccrual(StrictModel):
    accrual_id: Identifier
    request_key: Identifier

class PrepareManual(StrictModel):
    request_key: Identifier
    posted_on: date
    currency: Currency
    lines: list[Line] = Field(min_length=1, max_length=200)
    memo: Memo
    evidence_source_ids: list[Identifier] = Field(min_length=1, max_length=50)

class ListEntries(StrictModel):
    account: Identifier | None = None
    currency: Currency | None = None
    from_date: date | None = None
    through: date | None = None
    limit: Annotated[StrictInt, Field(ge=1, le=200)] = 50
    offset: Annotated[StrictInt, Field(ge=0, le=100000)] = 0

class EntryID(StrictModel):
    entry_id: Identifier

class Trial(StrictModel):
    through: date
    currency: Currency

class ApproveDraft(StrictModel):
    draft_id: Identifier
    attestation: Literal['I reviewed this journal, its account mappings, and its evidence']

class PostDraft(ApproveDraft):
    request_key: Identifier

class Reverse(StrictModel):
    entry_id: Identifier
    request_key: Identifier
    attestation: Literal['I verified this entry must be reversed']

# Posting to the append-only ledger is execution authority, so it stays off the agent
# bridge and is reachable only through posting_api's owner-gated route, the same way
# accruals keeps approve out of TOOL_MODELS. execute() still dispatches it for that route.
OWNER_ONLY={'post_accrual_journal':PostAccrual}
TOOL_MODELS={'prepare_manual_journal':PrepareManual,'list_journal_entries':ListEntries,'get_journal_entry':EntryID,'trial_balance':Trial}
DESCRIPTIONS={
    'prepare_manual_journal':'Create a balanced-journal draft bound to active evidence source IDs and a stable request_key for owner review. Validation and persistence only; cannot approve drafts, post entries, or reverse entries.',
    'list_journal_entries':'Read posted journal entries newest first, including origin and reversal links, filtered by account, currency or date range. Read only.',
    'get_journal_entry':'Read one posted journal entry and whether a reversal entry has reversed it. Read only.',
    'trial_balance':'Exact per-account debit, credit and net totals across posted entries for one currency through a date, plus a grand-total debit-equals-credit check. Reversal entries count as their own lines. Read only.',
}

def validate(journal):
    """Every stored journal must balance on unique, one-sided accounts."""
    if journal.get('currency') not in ('USD','EUR','GBP'):raise ValueError('Unsupported currency')
    try:date.fromisoformat(journal['date'])
    except (KeyError,TypeError,ValueError):raise ValueError('Journal requires an ISO date') from None
    lines=journal.get('lines') or []
    if not lines:raise ValueError('Journal requires at least one line')
    if len({line.get('account') for line in lines})!=len(lines):raise ValueError('Duplicate account in journal')
    for line in lines:
        account=line.get('account');debit=line.get('debit_minor');credit=line.get('credit_minor')
        if not isinstance(account,str) or not 1<=len(account)<=200:raise ValueError('Account must be a nonempty string of at most 200 characters')
        if any(not isinstance(v,int) or isinstance(v,bool) or v<0 for v in (debit,credit)):raise ValueError('Amounts must be nonnegative integer minor units')
        if (debit==0)==(credit==0):raise ValueError('Each line needs exactly one nonzero side')
    if sum(line['debit_minor'] for line in lines)!=sum(line['credit_minor'] for line in lines):raise ValueError('Journal debits must equal credits')

class Posting:
    def __init__(self,store,oid):self.store,self.oid=store,oid
    def fresh(self,db,evidence):
        return all(db.execute(select(sources.c.id).where(sources.c.id==e['source_id'],sources.c.organization_id==self.oid,sources.c.sha256==e['sha256'],sources.c.active.is_(True))).scalar() for e in evidence)
    def owned_entry(self,db,eid):
        row=db.execute(select(journal_entries).where(journal_entries.c.id==eid,journal_entries.c.organization_id==self.oid)).mappings().first()
        if not row:raise LookupError('Journal entry not found')
        return row
    def owned_draft(self,db,did):
        row=db.execute(select(journal_drafts).where(journal_drafts.c.id==did,journal_drafts.c.organization_id==self.oid)).mappings().first()
        if not row:raise LookupError('Journal draft not found')
        return row
    def replay(self,db,request_key,kind,ref_id):
        existing=db.execute(select(journal_entries).where(journal_entries.c.organization_id==self.oid,journal_entries.c.request_key==request_key)).mappings().first()
        if not existing:return None
        origin=existing['origin']
        if origin.get('kind')==kind and origin.get('ref_id')==ref_id:return existing
        raise ValueError('request_key already used for a different journal')
    def entry_view(self,db,row):
        reversed_by=db.execute(select(journal_entries.c.id).where(journal_entries.c.organization_id==self.oid,journal_entries.c.reverses_id==row['id'])).scalar()
        return {'entry_id':row['id'],'sequence':row['sequence'],'request_key':row['request_key'],'entry':row['entry'],
                'origin':row['origin'],'reverses_id':row['reverses_id'],'reversed':reversed_by is not None,'reversed_by':reversed_by,
                'posted_by':row['posted_by'],'posted_at':row['posted_at']}
    def draft_view(self,db,row):
        result={k:v for k,v in row['result'].items() if k!='request'}
        result.update(draft_id=row['id'],request_key=row['request_key'],status=row['status'],
                      approved_by=row['approved_by'],approved_at=row['approved_at'],entry_id=row['entry_id'],
                      evidence_current=self.fresh(db,result['evidence']))
        return result
    def append(self,db,request_key,journal,origin,actor,reverses_id=None):
        validate(journal)
        db.execute(insert(journal_entries).values(id=str(uuid.uuid4()),organization_id=self.oid,request_key=request_key,
            entry=journal,origin=origin,reverses_id=reverses_id,posted_by=actor,posted_at=int(time.time()*1000)))
        return db.execute(select(journal_entries).where(journal_entries.c.organization_id==self.oid,journal_entries.c.request_key==request_key)).mappings().one()
    def execute(self,name,args):
        body=(TOOL_MODELS.get(name) or OWNER_ONLY[name]).model_validate(args)
        with Accounting(self.store,self.oid).transaction() as db:
            if name=='list_journal_entries':return self.entries(db,body)
            if name=='get_journal_entry':return self.entry_view(db,self.owned_entry(db,body.entry_id))
            if name=='trial_balance':return self.balance(db,body)
            if name=='prepare_manual_journal':return self.prepare(db,body)
            return self.post_accrual(db,body)
    def prepare(self,db,body):
        request=body.model_dump(mode='json')
        existing=db.execute(select(journal_drafts).where(journal_drafts.c.organization_id==self.oid,journal_drafts.c.request_key==body.request_key)).mappings().first()
        if existing:
            if existing['result'].get('request')==request:return self.draft_view(db,existing)
            raise ValueError('request_key already used for a different journal')
        journal={'date':body.posted_on.isoformat(),'currency':body.currency,
                 'lines':[{'account':line.account,'debit_minor':line.debit_minor,'credit_minor':line.credit_minor} for line in body.lines],
                 'memo':body.memo}
        validate(journal)
        evidence=[]
        for sid in dict.fromkeys(body.evidence_source_ids):
            source=db.execute(select(sources).where(sources.c.id==sid,sources.c.organization_id==self.oid,sources.c.active.is_(True))).mappings().first()
            if not source:raise LookupError('Active evidence source not found')
            evidence.append({'source_id':sid,'sha256':source['sha256']})
        digest=hashlib.sha256(json.dumps({'journal':journal,'evidence':evidence},sort_keys=True,separators=(',',':')).encode()).hexdigest()
        row={'id':str(uuid.uuid4()),'organization_id':self.oid,'request_key':body.request_key,
             'result':{'engine_version':1,'journal':journal,'evidence':evidence,'result_hash':digest,'request':request},
             'status':'draft','approved_by':None,'approved_at':None,'entry_id':None}
        db.execute(insert(journal_drafts).values(**row))
        return self.draft_view(db,row)
    def post_accrual(self,db,body):
        existing=self.replay(db,body.request_key,'accrual',body.accrual_id)
        if existing:return self.entry_view(db,existing)
        accruals=Accruals(self.store,self.oid)
        row=accruals.owned(db,body.accrual_id)
        for entry in db.execute(select(journal_entries).where(journal_entries.c.organization_id==self.oid)).mappings():
            origin=entry['origin']
            if origin.get('kind')=='accrual' and origin.get('ref_id')==row['id']:return self.entry_view(db,entry)
        result=accruals.current(db,row)
        if result['status']!='approved_not_posted' or not result.get('journal'):raise ValueError('Accrual must be owner-approved with fresh evidence before posting')
        entry=self.append(db,body.request_key,result['journal'],{'kind':'accrual','ref_id':row['id'],'ref_hash':row['result_hash']},'agent:posting')
        return self.entry_view(db,entry)
    def entries(self,db,body):
        rows=db.execute(select(journal_entries).where(journal_entries.c.organization_id==self.oid).order_by(journal_entries.c.sequence.desc())).mappings().all()
        def keep(row):
            entry=row['entry']
            if body.account and not any(line['account']==body.account for line in entry['lines']):return False
            if body.currency and entry['currency']!=body.currency:return False
            if body.from_date and entry['date']<body.from_date.isoformat():return False
            if body.through and entry['date']>body.through.isoformat():return False
            return True
        matched=[row for row in rows if keep(row)]
        page=matched[body.offset:body.offset+body.limit]
        return {'entries':[self.entry_view(db,row) for row in page],'has_more':body.offset+len(page)<len(matched),'next_offset':body.offset+len(page)}
    def balance(self,db,body):
        accounts={}
        for entry in db.execute(select(journal_entries.c.entry).where(journal_entries.c.organization_id==self.oid)).scalars():
            if entry['currency']!=body.currency or entry['date']>body.through.isoformat():continue
            for line in entry['lines']:
                totals=accounts.setdefault(line['account'],{'account':line['account'],'debit_minor':0,'credit_minor':0})
                totals['debit_minor']+=line['debit_minor'];totals['credit_minor']+=line['credit_minor']
        ordered=[dict(v,net_minor=v['debit_minor']-v['credit_minor']) for _,v in sorted(accounts.items())]
        debits=sum(a['debit_minor'] for a in ordered);credits=sum(a['credit_minor'] for a in ordered)
        return {'currency':body.currency,'through':body.through.isoformat(),'accounts':ordered,
                'total_debit_minor':debits,'total_credit_minor':credits,'balanced':debits==credits}
    def drafts(self,limit=50,offset=0):
        with Accounting(self.store,self.oid).transaction() as db:
            rows=db.execute(select(journal_drafts).where(journal_drafts.c.organization_id==self.oid).order_by(journal_drafts.c.id).offset(offset).limit(limit)).mappings().all()
            return {'drafts':[self.draft_view(db,row) for row in rows]}
    def draft(self,draft_id):
        with Accounting(self.store,self.oid).transaction() as db:
            return self.draft_view(db,self.owned_draft(db,draft_id))
    def approve_draft(self,body,actor):
        with Accounting(self.store,self.oid).transaction() as db:
            row=self.owned_draft(db,body.draft_id)
            if row['status']=='posted':raise ValueError('Draft is already posted')
            if not self.fresh(db,row['result']['evidence']):raise ValueError('Draft evidence is stale or missing')
            if row['status']=='approved':return self.draft_view(db,row)
            db.execute(update(journal_drafts).where(journal_drafts.c.id==row['id']).values(status='approved',approved_by=actor,approved_at=int(time.time()*1000)))
            return self.draft_view(db,self.owned_draft(db,body.draft_id))
    def post_draft(self,body,actor):
        with Accounting(self.store,self.oid).transaction() as db:
            existing=self.replay(db,body.request_key,'manual',body.draft_id)
            if existing:return self.entry_view(db,existing)
            row=self.owned_draft(db,body.draft_id)
            if row['status']!='approved':raise ValueError('Draft must be owner-approved before posting')
            result=row['result']
            if not self.fresh(db,result['evidence']):raise ValueError('Draft evidence is stale or missing')
            entry=self.append(db,body.request_key,result['journal'],{'kind':'manual','ref_id':row['id'],'ref_hash':result['result_hash']},actor)
            db.execute(update(journal_drafts).where(journal_drafts.c.id==row['id']).values(status='posted',entry_id=entry['id']))
            return self.entry_view(db,entry)
    def reverse(self,body,actor):
        with Accounting(self.store,self.oid).transaction() as db:
            existing=self.replay(db,body.request_key,'reversal',body.entry_id)
            if existing:return self.entry_view(db,existing)
            row=self.owned_entry(db,body.entry_id)
            if db.execute(select(journal_entries.c.id).where(journal_entries.c.organization_id==self.oid,journal_entries.c.reverses_id==row['id'])).scalar():
                raise ValueError('Entry has already been reversed')
            original=row['entry']
            journal={'date':original['date'],'currency':original['currency'],'memo':'Reversal of '+row['id'],
                     'lines':[{'account':line['account'],'debit_minor':line['credit_minor'],'credit_minor':line['debit_minor']} for line in original['lines']]}
            ref_hash=hashlib.sha256(json.dumps(original,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            entry=self.append(db,body.request_key,journal,{'kind':'reversal','ref_id':row['id'],'ref_hash':ref_hash},actor,reverses_id=row['id'])
            return self.entry_view(db,entry)
