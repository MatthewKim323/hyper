"""Organization-scoped ingestion, exact SQL queries, and cited evidence retrieval."""
import hashlib
import json
import mimetypes
import re
import time
import uuid
from decimal import Decimal
from pathlib import PurePosixPath
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, update, func, cast, Numeric, text
from .database import sources, records, chunks, jobs, organizations
from .parsing import parse_file, numeric, NAME

class StrictModel(BaseModel):
    model_config=ConfigDict(extra='forbid')

class RecordFilter(StrictModel):
    field: str = Field(pattern=NAME)
    op: Literal['eq','ne','gt','gte','lt','lte','in'] = 'eq'
    value: str | int | list[str | int]

class FinancialQuery(StrictModel):
    dataset: str = Field(pattern=NAME)
    filters: list[RecordFilter] = Field(default_factory=list,max_length=12)
    operation: Literal['rows','count','sum','avg','min','max'] = 'rows'
    field: str | None = Field(default=None,pattern=NAME)
    group_by: list[str] = Field(default_factory=list,max_length=3)
    limit: int = Field(default=50,ge=1,le=200)
    offset: int = Field(default=0,ge=0,le=100000)
    @model_validator(mode='after')
    def validate_aggregate(self):
        if self.operation in ('sum','avg','min','max') and not self.field:
            raise ValueError('Aggregate requires a numeric field')
        if len(set(self.group_by)) != len(self.group_by) or any(x in ('_currency','_value','_record_count') for x in self.group_by):
            raise ValueError('Duplicate or reserved grouping field')
        if self.operation=='rows' and self.group_by:
            raise ValueError('group_by requires an aggregate')
        return self

class EvidenceQuery(StrictModel):
    query: str = Field(min_length=1,max_length=2000)
    dataset: str | None = Field(default=None,pattern=NAME)
    documents_only: bool = False
    limit: int = Field(default=8,ge=1,le=20)
    @model_validator(mode='after')
    def one_scope(self):
        if self.dataset and self.documents_only:raise ValueError('documents_only excludes datasets; drop one')
        return self

class SourceQuery(StrictModel):
    source_id: str = Field(min_length=1,max_length=128)
    offset: int = Field(default=0,ge=0,le=100000)
    limit: int = Field(default=10,ge=1,le=50)

def source_public(row):
    return {k:v for k,v in row.items() if k not in ('object_key','organization_id')}

class DataService:
    def __init__(self, store, oid, objects=None, search=None):
        self.store,self.engine,self.oid=store,store.engine,oid
        self._objects,self.search=objects,search

    @property
    def objects(self):
        if self._objects is None:
            from .objects import ObjectStore
            self._objects=ObjectStore()
        return self._objects

    def ingest(self, filename, body, source_key=None, dataset=None, currency=None, field_types=None, id_field=None, import_revision=None, transaction_guard=None):
        filename=PurePosixPath(filename.replace('\\','/')).name
        if not filename or len(filename)>255:
            raise ValueError('Invalid filename')
        source_key=source_key or filename
        if not 1<=len(source_key)<=256:
            raise ValueError('source_key must be 1–256 characters')
        if currency and not re.fullmatch('[A-Z0-9]{2,12}',currency):
            raise ValueError('Currency must be an uppercase currency/asset code')
        schema, rows, evidence=parse_file(filename,body,dataset,field_types,id_field)
        # Include parsing settings: same bytes with corrected schema is a new import version.
        digest=hashlib.sha256(body).hexdigest()
        fingerprint_parts=[digest,dataset,currency,schema,id_field]
        if import_revision is not None:
            fingerprint_parts.append(str(import_revision))
        fingerprint=hashlib.sha256(json.dumps(fingerprint_parts,sort_keys=True).encode()).hexdigest()
        with self.engine.begin() as db:
            # Serializes source versions and dataset ID overlap checks.
            if db.dialect.name=='postgresql':
                db.execute(select(organizations.c.id).where(organizations.c.id==self.oid).with_for_update())
                db.execute(text('SELECT pg_advisory_xact_lock(hashtext(:key))'),{'key':'ingest:'+self.oid})
            else:
                db.exec_driver_sql('BEGIN IMMEDIATE')
            if transaction_guard:
                transaction_guard(db)
            existing=db.execute(select(sources).where(sources.c.organization_id==self.oid,
                sources.c.source_key==source_key,sources.c.import_fingerprint==fingerprint)).mappings().first()
            if existing:
                return {**source_public(existing),'deduplicated':True}
            latest=db.execute(select(func.max(sources.c.version)).where(
                sources.c.organization_id==self.oid,sources.c.source_key==source_key)).scalar() or 0
            if dataset:
                other_sources=select(sources.c.id).where(sources.c.organization_id==self.oid,
                    sources.c.active.is_(True),sources.c.source_key!=source_key,sources.c.dataset==dataset)
                # Avoid silently double-counting overlapping exports.
                ids=[r['record_id'] for r in rows]
                for start in range(0,len(ids),500):
                    conflict=db.execute(select(records.c.record_id).where(records.c.organization_id==self.oid,
                        records.c.source_id.in_(other_sources),records.c.record_id.in_(ids[start:start+500])).limit(1)).scalar()
                    if conflict:
                        raise ValueError('Record ID overlaps another active source in this dataset; replace the same source_key or use a distinct dataset')
            sid='src_'+uuid.uuid4().hex
            key=f'organizations/{self.oid}/sources/{sid}/{digest}'
            content_type=mimetypes.guess_type(filename)[0] or 'application/octet-stream'
            self.objects.put(key,body,content_type)
            now=int(time.time()*1000)
            source=dict(id=sid,organization_id=self.oid,source_key=source_key,version=latest+1,
                filename=filename,content_type=content_type,object_key=key,sha256=digest,import_fingerprint=fingerprint,
                size_bytes=len(body),dataset=dataset,currency=currency,schema=schema,
                record_count=len(rows),created_at=now,active=True,index_status='pending',index_error=None)
            db.execute(update(sources).where(sources.c.organization_id==self.oid,
                sources.c.source_key==source_key,sources.c.active.is_(True)).values(active=False))
            db.execute(sources.insert().values(**source))
            for start in range(0,len(rows),500):
                db.execute(records.insert(),[dict(source_id=sid,organization_id=self.oid,dataset=dataset,**r) for r in rows[start:start+500]])
            for start in range(0,len(evidence),500):
                db.execute(chunks.insert(),[dict(id=f'{sid}:{i}',source_id=sid,organization_id=self.oid,
                    ordinal=i,**r) for i,r in enumerate(evidence[start:start+500],start)])
            db.execute(jobs.insert().values(id='job_'+uuid.uuid4().hex,source_id=sid,
                organization_id=self.oid,status='pending',attempts=0,lease_until=0,created_at=now))
            from .agent_events import emit
            from .accounting import invalidate_replaced_sources
            invalidate_replaced_sources(db, self.oid, source_key, sid)
            emit(db,self.oid,'source:'+sid,'source.created',{'source_id':sid,'dataset':dataset,'index_status':'pending'})
        return {**source_public(source),'deduplicated':False}

    def list_sources(self, limit=50, offset=0):
        with self.engine.connect() as db:
            rows=db.execute(select(sources).where(sources.c.organization_id==self.oid)
                .order_by(sources.c.created_at.desc(),sources.c.id).offset(offset).limit(limit+1)).mappings().all()
        return {'sources':[source_public(r) for r in rows[:limit]],'has_more':len(rows)>limit,'next_offset':offset+min(len(rows),limit)}

    def source(self, sid):
        with self.engine.connect() as db:
            row=db.execute(select(sources).where(sources.c.id==sid,sources.c.organization_id==self.oid)).mappings().first()
        if not row:raise LookupError('Source not found')
        return dict(row)

    def get_source(self, args: SourceQuery):
        source=self.source(args.source_id)
        with self.engine.connect() as db:
            found=db.execute(select(chunks.c.id,chunks.c.locator,chunks.c.content).where(
                chunks.c.source_id==source['id'],chunks.c.organization_id==self.oid)
                .order_by(chunks.c.ordinal).offset(args.offset).limit(args.limit+1)).mappings().all()
        return {'source':source_public(source),'chunks':[dict(c) for c in found[:args.limit]],
            'has_more':len(found)>args.limit,'next_offset':args.offset+min(len(found),args.limit),
            'download_url':f"/sources/{source['id']}/download"}

    def catalog(self):
        with self.engine.connect() as db:
            rows=db.execute(select(sources.c.id,sources.c.dataset,sources.c.schema,sources.c.currency,
                sources.c.record_count).where(sources.c.organization_id==self.oid,
                sources.c.active.is_(True),sources.c.dataset.is_not(None))).mappings().all()
        groups={}
        for row in rows:
            entry=groups.setdefault(row['dataset'],{'dataset':row['dataset'],'sources':[],'record_count':0})
            entry['sources'].append(dict(row));entry['record_count']+=row['record_count']
        return {'datasets':list(groups.values()),'rules':[
            'Amounts retain their imported units: *_cents are cents; token quantities are not dollars.',
            'Aggregates are grouped by source currency; no FX conversion is implied.',
            'Search results are evidence samples, never a complete population for totals.']}

    def query_financials(self, args: FinancialQuery):
        with self.engine.connect() as db:
            if db.dialect.name!='postgresql' and args.operation in ('sum','avg','min','max'):
                raise ValueError('Exact numeric aggregates require Postgres; configure DATABASE_URL')
            if db.dialect.name=='postgresql':
                db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
            active_sources=db.execute(select(sources.c.id,sources.c.schema,sources.c.currency).where(
                sources.c.organization_id==self.oid,sources.c.dataset==args.dataset,
                sources.c.active.is_(True))).mappings().all()
            if not active_sources:
                raise LookupError('Dataset not found; call list_datasets first')
            def column(name):
                kinds={r['schema'].get(name) for r in active_sources}
                if len(kinds)!=1 or None in kinds:
                    raise ValueError('Field is missing or has conflicting types across active sources')
                kind=next(iter(kinds))
                col=records.c.payload[name].as_string()
                return (cast(col,Numeric(38,12)) if kind=='numeric' else col),kind
            conditions=[records.c.organization_id==self.oid,records.c.dataset==args.dataset,
                        sources.c.organization_id==self.oid,sources.c.active.is_(True)]
            for f in args.filters:
                col,kind=column(f.field)
                values=f.value if isinstance(f.value,list) else [f.value]
                if not 1<=len(values)<=100 or (f.op!='in' and isinstance(f.value,list)):
                    raise ValueError('Only in accepts a list of 1–100 values')
                converted=[Decimal(numeric(v)) if kind=='numeric' else str(v) for v in values]
                value=converted[0]
                conditions.append({'eq':lambda:col==value,'ne':lambda:col!=value,'gt':lambda:col>value,
                    'gte':lambda:col>=value,'lt':lambda:col<value,'lte':lambda:col<=value,
                    'in':lambda:col.in_(converted)}[f.op]())
            joined=records.join(sources,records.c.source_id==sources.c.id)
            if args.operation=='rows':
                total=db.execute(select(func.count()).select_from(joined).where(*conditions)).scalar()
                found=db.execute(select(records.c.source_id,records.c.row_number,records.c.record_id,
                    records.c.payload,sources.c.currency).select_from(joined).where(*conditions)
                    .order_by(records.c.source_id,records.c.row_number).offset(args.offset).limit(args.limit)).mappings().all()
                return {'dataset':args.dataset,'rows':[dict(r) for r in found],'total_matching':total,
                    'has_more':args.offset+len(found)<total,'next_offset':args.offset+len(found)}
            group_cols=[column(f)[0].label(f) for f in args.group_by]
            if args.operation=='count':
                aggregate=func.count()
            else:
                col,kind=column(args.field)
                if kind!='numeric':
                    raise ValueError('Aggregates require a numeric column; specify field_types when importing')
                aggregate=getattr(func,args.operation)(col)
            # Currency remains a grouping key even if the caller forgets to request it.
            grouping=[sources.c.currency.label('_currency')]+group_cols
            query=select(*grouping,aggregate.label('_value'),func.count().label('_record_count')).select_from(joined).where(
                *conditions).group_by(*grouping).order_by(*grouping).offset(args.offset).limit(args.limit+1)
            found=db.execute(query).mappings().all()
            results=[]
            for r in found[:args.limit]:
                results.append({'currency':r['_currency'],'group':{f:str(r[f]) if isinstance(r[f],Decimal) else r[f] for f in args.group_by},
                    'value':str(r['_value']) if r['_value'] is not None else None,'record_count':r['_record_count']})
            return {'dataset':args.dataset,'operation':args.operation,'field':args.field,'results':results,
                'has_more':len(found)>args.limit,'next_offset':args.offset+min(len(found),args.limit),
                'source_ids':[r['id'] for r in active_sources],
                'units':'Imported field units; no currency conversion. Decimal values are strings.'}

    def search_evidence(self, args: EvidenceQuery):
        if not args.query.strip():raise ValueError('Query is blank')
        with self.engine.connect() as db:
            cond=[sources.c.organization_id==self.oid,sources.c.active.is_(True)]
            if args.dataset:cond.append(sources.c.dataset==args.dataset)
            if args.documents_only:cond.append(sources.c.dataset.is_(None))
            all_sources=db.execute(select(sources.c.id,sources.c.index_status).where(*cond)).mappings().all()
        ready=[s['id'] for s in all_sources if s['index_status']=='ready']
        pending=len(all_sources)-len(ready)
        if not ready:
            return {'mode':self.search.mode,'hits':[],'unindexed_sources':pending,'coverage_complete':pending==0}
        # Entities the question names, widened along the knowledge graph: a question about a vendor
        # also reaches the documents that only cite that vendor's invoices, orders and receipts.
        from .graph import Graph, index_terms
        graph=Graph(self.engine,self.oid)
        named=[x['id'] for x in graph.scan(args.query)]
        wanted=args.limit*2
        if named and getattr(self.search,'graph_aware',False):
            exact=index_terms(named)
            related={t:hops for k,hops in graph.related([n for n in named if not n.startswith('identifier:')]).items()
                for t in index_terms([k]) if t not in exact}
            hits=self.search.search(self.oid,ready,args.query,wanted,entities=exact,related=related)
            mode=self.search.mode+'+graph'
        else:
            hits=self.search.search(self.oid,ready,args.query,wanted);mode=self.search.mode
        result=[]
        # Re-authorize index results against SQL, including source activation. Never trust ES _source content.
        with self.engine.connect() as db:
            for hit in hits:
                row=db.execute(select(chunks.c.id,chunks.c.source_id,chunks.c.locator,chunks.c.content,
                    sources.c.filename,sources.c.version,sources.c.dataset,sources.c.currency,sources.c.source_key).select_from(chunks.join(sources,chunks.c.source_id==sources.c.id))
                    .where(chunks.c.id==hit['_source']['chunk_id'],chunks.c.organization_id==self.oid,
                        sources.c.organization_id==self.oid,sources.c.active.is_(True),
                        sources.c.index_status=='ready')).mappings().first()
                if row:result.append({**row,'score':hit.get('_score')})
        # Superseded chunks were dropped above; over-fetching keeps the page full.
        result=result[:args.limit]
        mentioned=graph.chunk_entities([r['id'] for r in result])
        result=[{**r,'entities':[e for e in mentioned[r['id']] if not e.startswith('identifier:')][:20]} for r in result]
        return {'mode':mode,'hits':result,'unindexed_sources':pending,'coverage_complete':pending==0,
            'query_entities':[{k:n[k] for k in ('id','type','label','recorded')} for n in graph.describe([n for n in named if not n.startswith('identifier:')])]}

    def job_status(self, sid):
        self.source(sid)
        with self.engine.connect() as db:
            row=db.execute(select(jobs).where(jobs.c.source_id==sid,jobs.c.organization_id==self.oid)).mappings().one()
        return {k:v for k,v in row.items() if k not in ('organization_id','claim_token')}

    def retry(self, sid):
        self.source(sid)
        with self.engine.begin() as db:
            result=db.execute(update(jobs).where(jobs.c.source_id==sid,jobs.c.organization_id==self.oid,
                jobs.c.status!='running').values(status='pending',attempts=0,error=None,lease_until=0,claim_token=None))
            if not result.rowcount:raise ValueError('Indexing is already running')
            db.execute(update(sources).where(sources.c.id==sid,sources.c.organization_id==self.oid)
                .values(index_status='pending',index_error=None))
        return {'source_id':sid,'status':'pending'}
