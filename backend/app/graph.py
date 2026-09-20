"""Company knowledge graph: typed entities, provenance-carrying edges, aliases and chunk mentions.

Built deterministically from active sources and rebuildable at any time. Nothing here merges two
identities: an uncertain link is a candidate with a method and a confidence, never a rewrite."""
import re
from collections import defaultdict
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, delete, func, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from .database import (sources, records, chunks, graph_nodes as nodes, graph_edges as edges,
                       graph_aliases as aliases, graph_mentions as mentions)

def T(type_, id_, label=None, edges=None, names=(), poly=None):
    return {'type':type_,'id':id_,'label':label,'edges':edges or {},'names':names,'poly':poly or {}}

# dataset -> entity type, id column, label column, {column: (EDGE, target type)}, alias columns,
# {polymorphic column: EDGE}. A target type may be {'by': column, value: type} when another column decides it.
ONTOLOGY={
    'accounts':T('gl_account','account','name'),
    'customers':T('customer','customer_id','name',{'contract_id':('HAS_CONTRACT','customer_contract')},('name','contact')),
    'vendors':T('vendor','vendor_id','name',{'approved_recipient':('APPROVED_REMIT','remit_account')},('name','contact')),
    'employees':T('employee','employee_id','name',{'department':('MEMBER_OF','department')},('name',)),
    'contracts':T('customer_contract','contract_id',None,{'customer_id':('WITH_CUSTOMER','customer')}),
    'usage_daily':T('usage','usage_id',None,{'customer_id':('USED_BY','customer'),'contract_id':('UNDER_CONTRACT','customer_contract')}),
    'ar_invoices':T('ar_invoice','invoice_id',None,{'customer_id':('BILLS_CUSTOMER','customer'),
        'contract_id':('BILLS_CONTRACT','customer_contract'),'usage_ids':('COVERS_USAGE','usage')}),
    'ar_invoice_lines':T('ar_invoice_line','line_id','description',{'invoice_id':('LINE_OF','ar_invoice')}),
    'ar_receipts':T('ar_receipt','receipt_id',None,{'customer_id':('RECEIVED_FROM','customer'),'account':('DEPOSITED_TO','gl_account')}),
    'ar_allocations':T('ar_allocation','allocation_id',None,{'receipt_id':('FROM_RECEIPT','ar_receipt'),'invoice_id':('ALLOCATED_TO','ar_invoice')}),
    'vendor_agreements':T('vendor_agreement','agreement_id','scope',{'vendor_id':('WITH_VENDOR','vendor')}),
    'purchase_orders':T('purchase_order','po_id',None,{'vendor_id':('ISSUED_TO','vendor'),'agreement_id':('GOVERNED_BY','vendor_agreement')}),
    'service_receipts':T('service_receipt','receipt_id',None,{'po_id':('RECEIVED_AGAINST','purchase_order'),'accepted_by':('ACCEPTED_BY','employee')}),
    'ap_invoices':T('ap_invoice','invoice_id',None,{'vendor_id':('INVOICED_BY','vendor'),'po_id':('BILLS','purchase_order')}),
    'ap_payments':T('ap_payment','payment_id',None,{'vendor_id':('PAID_TO','vendor'),'account':('PAID_FROM','gl_account')}),
    'ap_allocations':T('ap_allocation','allocation_id',None,{'payment_id':('FROM_PAYMENT','ap_payment'),'invoice_id':('ALLOCATED_TO','ap_invoice')}),
    'ap_credits':T('ap_credit','credit_id','scope',{'invoice_id':('CREDITS','ap_invoice'),'vendor_id':('ISSUED_BY','vendor')}),
    'credit_allocations':T('credit_allocation','allocation_id',None,{'credit_id':('FROM_CREDIT','ap_credit'),'invoice_id':('ALLOCATED_TO','ap_invoice')}),
    'journals':T('journal','journal_id','description',poly={'source_id':'POSTS'}),
    'journal_lines':T('journal_line','line_id',None,{'journal_id':('LINE_OF','journal'),'account':('HITS_ACCOUNT','gl_account')}),
    'settlement_movements':T('settlement_movement','movement_id',None,{'account':('MOVES_ON','gl_account'),
        'journal_id':('MIRRORS','journal')},poly={'source_id':'SETTLES'}),
    'aging':T('aging_snapshot','aging_id',None,{'invoice_id':('AGES',{'by':'side','ar':'ar_invoice','ap':'ap_invoice'})}),
    'trial_balance':T('trial_balance_entry','trial_balance_id',None,{'account':('BALANCE_OF','gl_account')}),
    'statements':T('financial_statement','statement_id'),
    'revenue_schedule':T('revenue_schedule_entry','schedule_id',None,{'contract_id':('RECOGNIZES','customer_contract')}),
    'payroll':T('payroll_run','payroll_id'),
    'payroll_lines':T('payroll_line','payroll_line_id',None,{'payroll_id':('PAID_IN','payroll_run'),'employee_id':('PAYS','employee')}),
    'payroll_remittances':T('payroll_remittance','remittance_id',None,{'payroll_id':('REMITS','payroll_run')}),
    'treasury_accounts':T('treasury_account','treasury_account_id','label',{'ledger_account':('LEDGER_ACCOUNT','gl_account'),
        'owner':('OWNED_BY','legal_entity')},('endpoint',)),
    'treasury_transfers':T('treasury_transfer','transfer_id','kind',{'from_account':('TRANSFERS_FROM','gl_account'),'to_account':('TRANSFERS_TO','gl_account')}),
    'treasury_fees':T('treasury_fee','fee_id','description'),
    'budgets':T('budget','budget_id','period'),
    'close_checklist':T('close_control','check_id','control',{'owner':('OWNED_BY','employee')}),
    'prepayments':T('prepayment','prepayment_id'),
    'amortization':T('amortization_entry','amortization_id',None,{'prepayment_id':('AMORTIZES','prepayment')}),
    'fixed_assets':T('fixed_asset','asset_id'),
    'depreciation':T('depreciation_entry','depreciation_id',None,{'asset_id':('DEPRECIATES','fixed_asset')}),
    'accruals':T('accrual','accrual_id','service'),
    'equity_events':T('equity_event','equity_id','instrument'),
}
# Untyped foreign keys (journals.source_id and similar) are typed by identifier prefix, longest first.
PREFIXES=sorted({'REM-PAY-':'payroll_remittance','APPAY-':'ap_payment','ARREC-':'ar_receipt','ASSET-':'fixed_asset',
    'AR-':'ar_invoice','AP-':'ap_invoice','CM-':'ap_credit','PAY-':'payroll_run','PRE-':'prepayment',
    'AM-':'amortization_entry','FEE-':'treasury_fee','DEP-':'depreciation_entry','EQ-':'equity_event',
    'TRF-':'treasury_transfer','REV-':'revenue_schedule_entry','ACC-':'accrual'}.items(),key=lambda x:-len(x[0]))
# Column names that identify a well-known entity in datasets the ontology has never seen (connectors, simulators).
FIELD_TYPES={'vendor_id':'vendor','customer_id':'customer','employee_id':'employee','contract_id':'customer_contract',
    'agreement_id':'vendor_agreement','po_id':'purchase_order','purchase_order_id':'purchase_order','journal_id':'journal'}
# Traversal never passes through these: almost everything touches them, so a path through one explains nothing.
HUBS={'gl_account','department','legal_entity'}
ID_SHAPE=re.compile(r'\b[A-Z]{1,10}(?:-[A-Z0-9]{1,14}){1,4}\b')

def norm(text):
    return ' '.join(re.findall(r'[a-z0-9]+',str(text).lower()))

def squash(text):
    # 'PO-00481', 'po 481' and ' PO481 ' collapse together. Used only to suggest candidates, never to resolve.
    return re.sub(r'(?<![0-9])0+(?=[0-9])','',re.sub(r'[^A-Z0-9]','',str(text).upper()))

def id_shaped(key):
    return bool(ID_SHAPE.fullmatch(key)) and any(c.isdigit() for c in key)

def node_id(type_, key):
    return f'{type_}:{key}'

def index_terms(node_ids):
    """Values for the search index: graph node IDs plus the bare identifier, so an exact ID is
    findable before (or without) the record that defines it being imported."""
    out=set(node_ids)
    for value in node_ids:
        key=value.split(':',1)[1]
        if id_shaped(key):out.add('identifier:'+key)
    return sorted(out)

class StrictModel(BaseModel):
    model_config=ConfigDict(extra='forbid')

class EntityQuery(StrictModel):
    entity: str = Field(min_length=1,max_length=256)

class ExploreQuery(StrictModel):
    entity: str = Field(min_length=1,max_length=256)
    edge_types: list[str] = Field(default_factory=list,max_length=20)
    depth: int = Field(default=1,ge=1,le=3)
    limit: int = Field(default=60,ge=1,le=200)

class PathQuery(StrictModel):
    from_entity: str = Field(min_length=1,max_length=256)
    to_entity: str = Field(min_length=1,max_length=256)
    max_depth: int = Field(default=5,ge=1,le=6)

class EntityEvidenceQuery(StrictModel):
    entity: str = Field(min_length=1,max_length=256)
    documents_only: bool = True
    limit: int = Field(default=10,ge=1,le=50)

TOOL_MODELS={'resolve_entity':EntityQuery,'explore_entity_graph':ExploreQuery,'find_entity_path':PathQuery,'get_entity_evidence':EntityEvidenceQuery}
DESCRIPTIONS={
    'resolve_entity':'Resolve an identifier, name or email to a company knowledge-graph entity (vendor, customer, employee, invoice, PO, agreement, payment, journal, account and more). Returns its recorded fields, relationship counts by type, co-mentioned entities and a source citation. Similar-looking identifiers are returned as candidates, never merged.',
    'explore_entity_graph':'Walk the knowledge graph outward from one entity, up to three hops, optionally only along given edge types. Returns cited nodes and edges. Use it to follow a chain such as invoice -> purchase order -> agreement -> vendor, or payment -> allocation -> invoice. Large fan-outs are truncated and say so; use query_financials for complete populations and totals.',
    'find_entity_path':'Find the shortest recorded relationship path between two entities, such as a bank movement and a vendor, or an employee and an invoice. Paths never run through general ledger accounts or departments. No path means none is recorded within max_depth, not that the entities are unrelated.',
    'get_entity_evidence':'List the documents and records that mention an entity, read from the authoritative database rather than the search index. Documents come first. Each hit says how the mention was recognized (exact ID, unique name, ambiguous name) and carries a citation.',
}

_alias_cache={}

def bulk_ignore(db, table, rows, size=400):
    insert=pg_insert if db.dialect.name=='postgresql' else sqlite_insert
    for start in range(0,len(rows),size):
        db.execute(insert(table).values(rows[start:start+size]).on_conflict_do_nothing())

def scalar_props(payload):
    out={}
    for k,v in payload.items():
        if isinstance(v,list):out[k+'_count']=len(v)
        elif isinstance(v,dict):continue
        elif v is not None:out[k]=v[:500] if isinstance(v,str) else v
    return out

class Graph:
    def __init__(self, engine, oid):
        self.engine,self.oid=engine,oid

    def active(self):
        return select(sources.c.id).where(sources.c.organization_id==self.oid,sources.c.active.is_(True))

    # ---- build -------------------------------------------------------------------------------
    def build_source(self, source):
        """Replace everything this source_key contributed. A superseded version contributes nothing."""
        sid=source['id'];counts={'nodes':0,'edges':0,'aliases':0,'mentions':0}
        with self.engine.begin() as db:
            family=select(sources.c.id).where(sources.c.organization_id==self.oid,sources.c.source_key==source['source_key'])
            for table in (nodes,edges,aliases,mentions):
                db.execute(delete(table).where(table.c.organization_id==self.oid,table.c.source_id.in_(family)))
            if not db.execute(select(sources.c.active).where(sources.c.id==sid,sources.c.organization_id==self.oid)).scalar():
                return counts
            if source['dataset']:self._records(db,source,counts)
            else:self._documents(db,source,counts)
        return counts

    def rebuild(self):
        """Structured sources first, so documents can resolve the names and IDs those sources define."""
        with self.engine.connect() as db:
            found=db.execute(select(sources).where(sources.c.organization_id==self.oid,sources.c.active.is_(True))
                .order_by(sources.c.dataset.is_(None),sources.c.created_at,sources.c.id)).mappings().all()
        total=defaultdict(int)
        for source in found:
            for k,v in self.build_source(dict(source)).items():total[k]+=v
        return {'sources':len(found),**total}

    def _target(self, spec_target, payload):
        if isinstance(spec_target,dict):return spec_target.get(str(payload.get(spec_target['by'])))
        return spec_target

    def _records(self, db, source, counts):
        sid,dataset=source['id'],source['dataset']
        spec=ONTOLOGY.get(dataset)
        lookup=None if spec else self.alias_index(db)
        after=0
        while True:
            page=db.execute(select(records.c.row_number,records.c.record_id,records.c.payload).where(
                records.c.source_id==sid,records.c.organization_id==self.oid,records.c.row_number>after)
                .order_by(records.c.row_number).limit(2000)).mappings().all()
            if not page:break
            after=page[-1]['row_number']
            n,e,a,m=[],[],[],[]
            for row in page:
                payload,number=row['payload'],row['row_number']
                key=str(row['record_id']);type_=spec['type'] if spec else dataset
                me=node_id(type_,key);chunk=f'{sid}:{number-1}'
                label=str(payload.get(spec['label']) if spec and spec['label'] else payload.get('name') or key)[:300]
                n.append(dict(organization_id=self.oid,id=me,type=type_,key=key,label=label,
                    props=scalar_props(payload),source_id=sid,row_number=number))
                linked={me}
                def alias(value,kind):
                    value=norm(value)
                    if len(value)>=4 and re.search('[a-z]',value):
                        a.append(dict(organization_id=self.oid,alias=value,kind=kind,node_id=me,source_id=sid))
                def edge(target,kind,column,method='foreign_key',confidence=100):
                    e.append(dict(organization_id=self.oid,src=me,dst=target,type=kind,props={'field':column},
                        method=method,confidence=confidence,source_id=sid,row_number=number))
                    linked.add(target)
                alias(key,'id')
                if id_shaped(key):a.append(dict(organization_id=self.oid,alias=squash(key),kind='squash',node_id=me,source_id=sid))
                if spec:
                    for column in spec['names']:
                        if payload.get(column):alias(payload[column],'name')
                    for column,(kind,target) in spec['edges'].items():
                        value=payload.get(column);target=self._target(target,payload)
                        if value in (None,'') or not target:continue
                        for item in (value if isinstance(value,list) else [value]):
                            edge(node_id(target,str(item)),kind,column)
                    for column,kind in spec['poly'].items():
                        value=str(payload.get(column) or '')
                        target=next((t for p,t in PREFIXES if value.startswith(p)),None)
                        if target:edge(node_id(target,value),kind,column,'id_prefix',95)
                else:
                    if payload.get('name'):alias(payload['name'],'name')
                    for column,value in payload.items():
                        if value in (None,'') or isinstance(value,(list,dict)) or str(value)==key:continue
                        if not (column.endswith('_id') or column in FIELD_TYPES):continue
                        kind='REFERS_TO_'+re.sub(r'_ID$','',column.upper())
                        known=[x for x,k in lookup.get(norm(value),[]) if k=='id']
                        if len(known)==1:edge(known[0],kind,column,'id_lookup',95)
                        elif column in FIELD_TYPES:edge(node_id(FIELD_TYPES[column],str(value)),kind,column,'field_name',80)
                m.extend(dict(chunk_id=chunk,node_id=x,organization_id=self.oid,source_id=sid,
                    method='record' if x==me else 'foreign_key',confidence=100) for x in linked)
            bulk_ignore(db,nodes,n);bulk_ignore(db,edges,e);bulk_ignore(db,aliases,a);bulk_ignore(db,mentions,m)
            for k,v in zip(counts,(n,e,a,m)):counts[k]+=len(v)
        _alias_cache.pop(self.oid,None)

    def _documents(self, db, source, counts):
        sid=source['id'];offset=0
        lookup=self.alias_index(db)
        while True:
            page=db.execute(select(chunks.c.id,chunks.c.content).where(chunks.c.source_id==sid,
                chunks.c.organization_id==self.oid).order_by(chunks.c.ordinal).offset(offset).limit(500)).mappings().all()
            if not page:break
            offset+=len(page)
            m=[dict(chunk_id=c['id'],node_id=x['id'],organization_id=self.oid,source_id=sid,
                method=x['method'],confidence=x['confidence']) for c in page for x in self.scan(c['content'],lookup)]
            bulk_ignore(db,mentions,m);counts['mentions']+=len(m)

    # ---- recognition -------------------------------------------------------------------------
    def alias_index(self, db=None):
        """IDs, names and contact addresses of the whole organization, cached until the alias table changes."""
        def load(db):
            stamp=tuple(db.execute(select(func.count(),func.max(aliases.c.sequence)).where(aliases.c.organization_id==self.oid)).one())
            cached=_alias_cache.get(self.oid)
            if cached and cached[0]==stamp:return cached[1]
            index=defaultdict(list)
            for alias,nid,kind in db.execute(select(aliases.c.alias,aliases.c.node_id,aliases.c.kind).where(
                    aliases.c.organization_id==self.oid,aliases.c.kind!='squash')):
                if (nid,kind) not in index[alias]:index[alias].append((nid,kind))
            _alias_cache[self.oid]=(stamp,dict(index))
            return _alias_cache[self.oid][1]
        if db is not None:return load(db)
        with self.engine.connect() as db:return load(db)

    def scan(self, text, lookup=None):
        """Entities named in free text. The longest alias wins, so RC-AP-00062 is a receipt and not also invoice AP-00062."""
        lookup=self.alias_index() if lookup is None else lookup
        tokens=re.findall(r'[a-z0-9]+',text.lower())
        covered=[False]*len(tokens);found={}
        for size in range(min(6,len(tokens)),0,-1):
            for i in range(len(tokens)-size+1):
                hits=lookup.get(' '.join(tokens[i:i+size]))
                if not hits or all(covered[i:i+size]):continue
                covered[i:i+size]=[True]*size
                for nid,kind in hits:
                    if len(hits)>1:method,confidence='ambiguous_alias',60
                    elif kind=='id':method,confidence='id_mention',100
                    else:method,confidence='alias_mention',90
                    if confidence>found.get(nid,{'confidence':0})['confidence']:
                        found[nid]={'id':nid,'method':method,'confidence':confidence}
        for token in set(ID_SHAPE.findall(text)):
            if id_shaped(token):found.setdefault('identifier:'+token,{'id':'identifier:'+token,'method':'id_token','confidence':100})
        return list(found.values())

    def resolve(self, text):
        text=text.strip()
        with self.engine.connect() as db:
            exact=[]
            if ':' in text:
                exact=self._nodes(db,[text])
            if not exact:
                ids=[nid for nid,_ in self.alias_index(db).get(norm(text),[])]
                exact=self._nodes(db,ids)
            seen={n['id'] for n in exact};candidates=[]
            if squash(text):
                ids=db.execute(select(aliases.c.node_id).where(aliases.c.organization_id==self.oid,aliases.c.kind=='squash',
                    aliases.c.alias==squash(text),aliases.c.source_id.in_(self.active())).limit(10)).scalars().all()
                candidates+=[{**n,'reason':'similar_identifier','confidence':40} for n in self._nodes(db,ids) if n['id'] not in seen]
            if not exact and len(text)>=3:
                pattern='%'+text.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
                ids=db.execute(select(nodes.c.id).where(nodes.c.organization_id==self.oid,nodes.c.label.ilike(pattern,escape='\\'),
                    nodes.c.source_id.in_(self.active())).order_by(func.length(nodes.c.label),nodes.c.id).limit(10)).scalars().all()
                known={c['id'] for c in candidates}
                candidates+=[{**n,'reason':'label_contains','confidence':50} for n in self._nodes(db,ids) if n['id'] not in seen|known]
        return exact,candidates

    def _one(self, text):
        exact,candidates=self.resolve(text)
        if len(exact)==1:return exact[0],None
        return None,{'resolved':False,'reason':'ambiguous' if exact else 'not_found',
            'candidates':exact+candidates,'note':'Pass a candidate id to continue. Candidates are suggestions, not the same entity.'}

    # ---- reads -------------------------------------------------------------------------------
    def _nodes(self, db, ids):
        ids=list(dict.fromkeys(ids))
        if not ids:return []
        found={}
        for start in range(0,len(ids),500):
            for r in db.execute(select(nodes.c.id,nodes.c.type,nodes.c.key,nodes.c.label,nodes.c.props,nodes.c.source_id,
                    nodes.c.row_number,sources.c.filename).select_from(nodes.join(sources,nodes.c.source_id==sources.c.id)).where(
                    nodes.c.organization_id==self.oid,nodes.c.id.in_(ids[start:start+500]),
                    sources.c.organization_id==self.oid,sources.c.active.is_(True))).mappings():
                found[r['id']]={'id':r['id'],'type':r['type'],'key':r['key'],'label':r['label'],'fields':r['props'],'recorded':True,
                    'citation':{'source_id':r['source_id'],'chunk_id':f"{r['source_id']}:{r['row_number']-1}",
                        'filename':r['filename'],'locator':f"row:{r['row_number']}"}}
        return [found[i] for i in ids if i in found]

    def describe(self, ids):
        """Nodes in request order. An ID that edges point at but no record defines is returned as unrecorded."""
        with self.engine.connect() as db:found={n['id']:n for n in self._nodes(db,ids)}
        return [found.get(i) or {'id':i,'type':i.split(':',1)[0],'key':i.split(':',1)[1],'label':i.split(':',1)[1],'recorded':False}
            for i in dict.fromkeys(ids)]

    def neighbors(self, frontier, edge_types=(), cap=25):
        """Edges touching the frontier, at most `cap` per node, direction and edge type."""
        frontier=list(frontier);out=[]
        if not frontier:return out
        with self.engine.connect() as db:
            for column in (edges.c.src,edges.c.dst):
                rank=func.row_number().over(partition_by=(column,edges.c.type),order_by=edges.c.sequence)
                cond=[edges.c.organization_id==self.oid,column.in_(frontier),edges.c.source_id.in_(self.active())]
                if edge_types:cond.append(edges.c.type.in_(edge_types))
                ranked=select(edges,rank.label('position')).where(*cond).subquery()
                out+=[dict(r) for r in db.execute(select(ranked).where(ranked.c.position<=cap)).mappings()]
        return out

    def related(self, seeds, depth=2, cap=25, limit=300):
        """{node id: hops} around the seeds, for widening a search. Hubs are never expanded."""
        hops={s:0 for s in seeds};frontier=[s for s in seeds if s.split(':',1)[0] not in HUBS]
        for hop in range(1,depth+1):
            following=[];found=self.neighbors(frontier,cap=cap)
            # A relation that hits the cap is a hub (the employee who accepted every receipt): an arbitrary
            # sample of it would add noise, so only relations small enough to be read whole are followed.
            crowded={(e[side],e['type'],side) for e in found for side in ('src','dst') if e['position']>=cap and e[side] in hops}
            for e in found:
                if (e['src'],e['type'],'src') in crowded or (e['dst'],e['type'],'dst') in crowded:continue
                for other in (e['src'],e['dst']):
                    if other not in hops and len(hops)<limit+len(seeds):
                        hops[other]=hop
                        if other.split(':',1)[0] not in HUBS:following.append(other)
            frontier=following
            if not frontier:break
        return {k:v for k,v in hops.items() if v}

    def _edge(self, e):
        return {'from':e['src'],'to':e['dst'],'type':e['type'],'method':e['method'],'confidence':e['confidence'],
            'citation':{'source_id':e['source_id'],'chunk_id':f"{e['source_id']}:{e['row_number']-1}",'locator':f"row:{e['row_number']}"}}

    def card(self, args: EntityQuery):
        node,problem=self._one(args.entity)
        if problem:return problem
        with self.engine.connect() as db:
            relationships=[]
            for column,direction in ((edges.c.src,'outgoing'),(edges.c.dst,'incoming')):
                relationships+=[{'type':t,'direction':direction,'count':c} for t,c in db.execute(
                    select(edges.c.type,func.count()).where(edges.c.organization_id==self.oid,column==node['id'],
                    edges.c.source_id.in_(self.active())).group_by(edges.c.type).order_by(edges.c.type))]
            # Entities that share a document with this one. Rows are excluded: a row mentions only its own keys.
            here=select(mentions.c.chunk_id).select_from(mentions.join(sources,mentions.c.source_id==sources.c.id)).where(
                mentions.c.organization_id==self.oid,mentions.c.node_id==node['id'],sources.c.dataset.is_(None),sources.c.active.is_(True))
            together=db.execute(select(mentions.c.node_id,func.count().label('documents')).where(mentions.c.organization_id==self.oid,
                mentions.c.chunk_id.in_(here),mentions.c.node_id!=node['id'],~mentions.c.node_id.like('identifier:%'))
                .group_by(mentions.c.node_id).order_by(func.count().desc(),mentions.c.node_id).limit(12)).all()
            documents=db.execute(select(func.count()).select_from(here.subquery())).scalar()
        labels={n['id']:n for n in self.describe([t[0] for t in together])}
        _,candidates=self.resolve(node['id'].split(':',1)[1])
        return {'resolved':True,'entity':node,'relationships':relationships,'document_mentions':documents,
            'mentioned_with':[{'id':i,'type':labels[i]['type'],'label':labels[i]['label'],'documents':c} for i,c in together],
            'similar_identifiers':[c for c in candidates if c['reason']=='similar_identifier']}

    def explore(self, args: ExploreQuery):
        node,problem=self._one(args.entity)
        if problem:return problem
        seen={node['id']:0};kept=[];frontier=[node['id']];truncated=False
        for hop in range(1,args.depth+1):
            following=[]
            for e in self.neighbors(frontier,args.edge_types):
                if e['position']>=25:truncated=True
                for other in (e['src'],e['dst']):
                    if other in seen:continue
                    if len(seen)>=args.limit:truncated=True;continue
                    seen[other]=hop
                    if other.split(':',1)[0] not in HUBS:following.append(other)
                if e['src'] in seen and e['dst'] in seen:kept.append(e)
            frontier=following
            if not frontier:break
        unique={e['sequence']:e for e in kept}
        return {'resolved':True,'root':node['id'],'nodes':[{**n,'hops':seen[n['id']]} for n in self.describe(list(seen))],
            'edges':[self._edge(e) for e in unique.values()],'truncated':truncated,
            'note':'Truncated graphs are samples. Use query_financials for complete populations and exact totals.' if truncated else None}

    def path(self, args: PathQuery):
        start,problem=self._one(args.from_entity)
        if problem:return {**problem,'argument':'from_entity'}
        goal,problem=self._one(args.to_entity)
        if problem:return {**problem,'argument':'to_entity'}
        came={start['id']:None};frontier=[start['id']]
        for _ in range(args.max_depth):
            if goal['id'] in came or not frontier:break
            following=[]
            for e in self.neighbors(frontier,cap=200):
                for a,b in ((e['src'],e['dst']),(e['dst'],e['src'])):
                    if a in came and b not in came:
                        came[b]=(a,e)
                        if b.split(':',1)[0] not in HUBS:following.append(b)
            frontier=following
        if goal['id'] not in came:
            return {'resolved':True,'found':False,'from':start['id'],'to':goal['id'],
                'note':f'No recorded path within {args.max_depth} hops. That is not evidence the entities are unrelated.'}
        steps=[];at=goal['id']
        while came[at]:
            previous,e=came[at];steps.append(e);at=previous
        steps.reverse()
        order=[start['id']]
        for e in steps:order.append(e['dst'] if e['src']==order[-1] else e['src'])
        return {'resolved':True,'found':True,'hops':len(steps),'nodes':self.describe(order),'edges':[self._edge(e) for e in steps]}

    def evidence(self, args: EntityEvidenceQuery):
        node,problem=self._one(args.entity)
        wanted=index_terms([node['id']]) if node else None
        if problem:
            # An identifier no record defines can still appear in documents.
            token=args.entity.strip().upper()
            if not id_shaped(token):return problem
            wanted=['identifier:'+token]
        with self.engine.connect() as db:
            cond=[mentions.c.organization_id==self.oid,mentions.c.node_id.in_(wanted),sources.c.organization_id==self.oid,
                sources.c.active.is_(True)]
            if args.documents_only:cond.append(sources.c.dataset.is_(None))
            found=db.execute(select(chunks.c.id,chunks.c.source_id,chunks.c.locator,chunks.c.content,mentions.c.method,
                mentions.c.confidence,sources.c.filename,sources.c.dataset,sources.c.source_key,sources.c.version)
                .select_from(mentions.join(chunks,mentions.c.chunk_id==chunks.c.id).join(sources,chunks.c.source_id==sources.c.id))
                .where(*cond).order_by(sources.c.dataset.is_not(None),mentions.c.confidence.desc(),sources.c.created_at.desc(),chunks.c.id)
                .limit(args.limit*2+1)).mappings().all()
        hits={}
        for r in found:hits.setdefault(r['id'],{**r,'content':r['content'][:4000]})
        return {'resolved':bool(node),'entity':node['id'] if node else wanted[0],'hits':list(hits.values())[:args.limit],
            'has_more':len(hits)>args.limit}

    def chunk_entities(self, chunk_ids):
        out=defaultdict(list)
        if not chunk_ids:return out
        with self.engine.connect() as db:
            for chunk,nid in db.execute(select(mentions.c.chunk_id,mentions.c.node_id).where(
                    mentions.c.organization_id==self.oid,mentions.c.chunk_id.in_(list(chunk_ids))).order_by(mentions.c.node_id)):
                out[chunk].append(nid)
        return out

    def stats(self):
        with self.engine.connect() as db:
            live=self.active()
            by_type=db.execute(select(nodes.c.type,func.count()).where(nodes.c.organization_id==self.oid,nodes.c.source_id.in_(live))
                .group_by(nodes.c.type).order_by(func.count().desc())).all()
            by_edge=db.execute(select(edges.c.type,func.count()).where(edges.c.organization_id==self.oid,edges.c.source_id.in_(live))
                .group_by(edges.c.type).order_by(func.count().desc())).all()
            # An edge whose target no record defines: a dangling reference, or an entity known only by name.
            dangling=db.execute(select(func.count()).select_from(edges.outerjoin(nodes,(nodes.c.organization_id==edges.c.organization_id)&(nodes.c.id==edges.c.dst)))
                .where(edges.c.organization_id==self.oid,edges.c.source_id.in_(live),nodes.c.id.is_(None))).scalar()
            mentioned=db.execute(select(func.count()).where(mentions.c.organization_id==self.oid,mentions.c.source_id.in_(live))).scalar()
        return {'nodes':sum(c for _,c in by_type),'edges':sum(c for _,c in by_edge),'mentions':mentioned,
            'unrecorded_targets':dangling,'node_types':[{'type':t,'count':c} for t,c in by_type],
            'edge_types':[{'type':t,'count':c} for t,c in by_edge]}

    def execute(self, name, args):
        parsed=TOOL_MODELS[name].model_validate(args)
        return {'resolve_entity':self.card,'explore_entity_graph':self.explore,'find_entity_path':self.path,
            'get_entity_evidence':self.evidence}[name](parsed)
