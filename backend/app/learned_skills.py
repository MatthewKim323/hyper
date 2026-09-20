"""Organization-scoped procedural memory. Package content is not execution authority."""
import hashlib
import json
import re
import time
import uuid
from typing import Literal
from pydantic import Field, model_validator
from sqlalchemy import select, insert, update, func
from .data_service import StrictModel, DataService
from .accounting import Accounting
from .database import learned_skills as skills, learned_skill_runs as runs, sources
from .objects import ObjectStore
from .retrieval import ElasticSearch

class Draft(StrictModel):
    name: str = Field(pattern=r'^[a-z0-9]+(?:-[a-z0-9]+)*$',max_length=64)
    description: str = Field(min_length=10,max_length=500)
    instructions: str = Field(min_length=20,max_length=16000)
    applicability: str = Field(min_length=10,max_length=2000)
    limitations: str = Field(min_length=10,max_length=2000)
    source_ids: list[str] = Field(min_length=1,max_length=30)
    research_urls: list[str] = Field(default_factory=list,max_length=20)
    resources: dict[str,str] = Field(default_factory=dict,max_length=30)
    based_on_version: int = Field(default=0,ge=0)
    @model_validator(mode='after')
    def package_bounds(self):
        for path,content in self.resources.items():
            if not re.fullmatch(r'(scripts|references|tests|assets)/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\.[A-Za-z0-9]+',path):
                raise ValueError('Resource must be a safe relative scripts/references/tests/assets path')
            if len(content.encode())>100000:raise ValueError('Resource exceeds 100 KB')
        if sum(len(v.encode()) for v in self.resources.values())>500000:raise ValueError('Package exceeds 500 KB')
        if any(not u.startswith('https://') for u in self.research_urls):raise ValueError('Research citations must be HTTPS URLs')
        return self

class SkillID(StrictModel):
    skill_id: str
class Resource(SkillID):
    path: str = Field(min_length=1,max_length=200)
class Search(StrictModel):
    query: str = Field(default='',max_length=500)
    include_inactive: bool = False
    limit: int = Field(default=10,ge=1,le=30)
class Run(SkillID):
    request_key: str = Field(min_length=1,max_length=200)
    package_hash: str
    outcome: Literal['passed','failed','needs_input']
    summary: str = Field(min_length=10,max_length=4000)
    evidence_source_ids: list[str] = Field(min_length=1,max_length=30)
    checks: list[str] = Field(min_length=1,max_length=30)
    duration_ms: int = Field(ge=0)
    @model_validator(mode='after')
    def check_bounds(self):
        if any(not c.strip() or len(c)>1000 for c in self.checks):raise ValueError('Invalid check description')
        return self
class ExecutionEvidence(StrictModel):
    request_key: str = Field(min_length=1,max_length=100,pattern=r'^[a-zA-Z0-9_-]+$')
    content: str = Field(min_length=10,max_length=100000)

class Activate(SkillID):
    package_hash: str
    run_id: str
    attestation: Literal['I independently reviewed the tests, accounting assumptions, and evidence for this skill version']
class Retire(SkillID):
    reason: str = Field(min_length=10,max_length=2000)

TOOL_MODELS={'save_skill_execution_evidence':ExecutionEvidence,'search_learned_skills':Search,'get_learned_skill':SkillID,'get_skill_resource':Resource,'save_learned_skill':Draft,'record_skill_run':Run}
DESCRIPTIONS={
 'save_skill_execution_evidence':'Persist execution logs, assertions and outputs from your isolated workspace as an organization evidence source. Supply a stable request_key and content; it is labeled agent-reported, never independently verified. Use returned source ID in record_skill_run.',
 'search_learned_skills':'Discover organization skills by short summaries. Defaults to current owner-activated versions; include_inactive exposes draft/history metadata for inspection only. Search before solving a recurring workflow. No full instructions or code are returned.',
 'get_learned_skill':'Load one versioned SKILL.md and resource names on demand. Only active and evidence_current packages are eligible for reuse. Draft, stale, retired or quarantined versions are inspection-only. A skill never grants posting or approval permissions.',
 'get_skill_resource':'Read one named skill script, test or reference on demand. Content is returned, never executed by the API. Check package status and hash before running in an isolated Devin workspace.',
 'save_learned_skill':'Save an immutable draft learned procedure, code, tests, applicability, limits and source citations. Set based_on_version to the last saved version (0 for new). The API generates SKILL.md. Saving does not activate or validate the skill.',
 'record_skill_run':'Persist a reported execution/test outcome tied to a package hash and evidence sources. Claims are self-reported, not independently verified. Failed runs quarantine active skills. Activation requires separate owner review.',
}

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def now():return int(time.time()*1000)

class Skills:
    def __init__(self,store,oid,objects=None,search=None):
        self.store,self.oid=store,oid;self.objects=objects;self.search_engine=search
    def storage(self):
        if self.objects is None:self.objects=ObjectStore()
        return self.objects
    def owned(self,db,sid):
        row=db.execute(select(skills).where(skills.c.id==sid,skills.c.organization_id==self.oid)).mappings().first()
        if not row:raise LookupError('Skill not found')
        return dict(row)
    def evidence(self,db,ids):
        result=[]
        for sid in sorted(set(ids)):
            row=db.execute(select(sources.c.sha256).where(sources.c.id==sid,sources.c.organization_id==self.oid,sources.c.active.is_(True))).first()
            if not row:raise LookupError('Active evidence source not found')
            result.append({'source_id':sid,'sha256':row[0]})
        return result
    def fresh(self,db,evidence):
        try:return self.evidence(db,[e['source_id'] for e in evidence])==evidence
        except LookupError:return False
    def summary(self,db,row):
        result={k:row[k] for k in ('id','name','version','description','status','package_hash','created_at','activated_by')}
        result['evidence_current']=self.fresh(db,row['evidence'])
        if not result['evidence_current']:result['status']='stale'
        return result
    def package(self,row):
        raw=self.storage().read(row['object_key']);package=json.loads(raw)
        if digest(package)!=row['package_hash']:raise ValueError('Stored skill integrity check failed')
        return package
    def save(self,body):
        with Accounting(self.store,self.oid).transaction() as db:
            evidence=self.evidence(db,body.source_ids)
            payload=body.model_dump(exclude={'based_on_version'});payload['evidence']=evidence
            payload['skill_md']='---\nname: '+body.name+'\ndescription: '+json.dumps(body.description)+'\n---\n\n'+body.instructions+'\n\n## Applicability\n'+body.applicability+'\n\n## Limitations\n'+body.limitations+'\n'
            if body.resources:payload['skill_md']+='\n## Resources\n'+'\n'.join('- '+path for path in sorted(body.resources))+'\n'
            checksum=digest(payload)
            previous=db.execute(select(skills).where(skills.c.organization_id==self.oid,skills.c.name==body.name).order_by(skills.c.version.desc()).limit(1)).mappings().first()
            if previous and previous['package_hash']==checksum:return self.summary(db,previous)
            version=previous['version'] if previous else 0
            if version!=body.based_on_version:raise ValueError('Skill version conflict; load latest version before revising')
            sid=str(uuid.uuid4());key=f'{self.oid}/learned-skills/{sid}/{checksum}.json'
            self.storage().put(key,json.dumps(payload).encode(),'application/json')
            row=dict(id=sid,organization_id=self.oid,name=body.name,version=version+1,description=body.description,status='draft',package_hash=checksum,object_key=key,evidence=evidence,created_at=now(),activated_by=None,activation=None)
            db.execute(insert(skills).values(**row));return self.summary(db,row)
    def get(self,sid,path=None):
        with self.store.engine.connect() as db:
            row=self.owned(db,sid);result=self.summary(db,row)
            stats=db.execute(select(runs.c.outcome,func.count()).where(runs.c.skill_id==sid,runs.c.organization_id==self.oid).group_by(runs.c.outcome)).all()
            result['reported_runs']=dict(stats);result['evidence']=row['evidence'];result['activation']=row['activation']
        package=self.package(row)
        if path is not None:
            if path not in package['resources']:raise LookupError('Skill resource not found')
            result.update(path=path,content=package['resources'][path])
        else:result.update(skill_md=package['skill_md'],resources=sorted(package['resources']),research_urls=package['research_urls'])
        return result
    def search(self,body):
        with self.store.engine.connect() as db:
            statement=select(skills).where(skills.c.organization_id==self.oid)
            if not body.include_inactive:statement=statement.where(skills.c.status=='active')
            rows=db.execute(statement.order_by(skills.c.name,skills.c.version.desc())).mappings().all()
            valid={r['id']:self.summary(db,r) for r in rows if body.include_inactive or self.fresh(db,r['evidence'])}
        mode='catalog';ordered=list(valid)
        if body.query:
            terms=re.findall(r'\w+',body.query.lower())
            rank=lambda sid:sum(t in (valid[sid]['name']+' '+valid[sid]['description']).lower() for t in terms)
            ordered=sorted((sid for sid in valid if rank(sid)),key=lambda sid:(-rank(sid),sid));mode='keyword_fallback'
            try:
                search=self.search_engine or ElasticSearch()
                hits=search.search(self.oid,list(valid),body.query,body.limit)
                matched=[h['_source']['source_id'] for h in hits if h['_source']['source_id'] in valid]
                ordered=list(dict.fromkeys(matched+ordered));mode='elastic+'+search.mode
            except Exception:pass # SQL catalogue remains authoritative and available.
        return {'skills':[valid[sid] for sid in ordered[:body.limit]],'search_mode':mode,'has_more':len(ordered)>body.limit}
    def record(self,body):
        with Accounting(self.store,self.oid).transaction() as db:
            row=self.owned(db,body.skill_id)
            if body.package_hash!=row['package_hash']:raise ValueError('Package hash mismatch')
            evidence=self.evidence(db,body.evidence_source_ids);payload=body.model_dump();payload['evidence']=evidence
            existing=db.execute(select(runs).where(runs.c.organization_id==self.oid,runs.c.request_key==body.request_key)).mappings().first()
            if existing:
                if existing['report']!=payload:raise ValueError('Run request key reused with different report')
                return {'run_id':existing['id'],'outcome':existing['outcome'],'verification':'self_reported'}
            rid=str(uuid.uuid4());db.execute(insert(runs).values(id=rid,organization_id=self.oid,skill_id=row['id'],request_key=body.request_key,outcome=body.outcome,report=payload,created_at=now()))
            if body.outcome=='failed' and row['status']=='active':db.execute(update(skills).where(skills.c.id==row['id']).values(status='quarantined'))
            return {'run_id':rid,'outcome':body.outcome,'verification':'self_reported'}
    def activate(self,body,actor):
        with Accounting(self.store,self.oid).transaction() as db:
            row=self.owned(db,body.skill_id)
            if body.package_hash!=row['package_hash'] or not self.fresh(db,row['evidence']):raise ValueError('Skill hash mismatch or stale evidence')
            if row['status'] not in ('draft','quarantined','active'):raise ValueError('Retired skill cannot be activated; create a new version')
            report=db.execute(select(runs).where(runs.c.id==body.run_id,runs.c.skill_id==row['id'],runs.c.organization_id==self.oid)).mappings().first()
            if not report or report['outcome']!='passed' or not self.fresh(db,report['report']['evidence']):raise ValueError('Current passing execution evidence required')
            latest=db.execute(select(runs.c.id).where(runs.c.skill_id==row['id']).order_by(runs.c.sequence.desc()).limit(1)).scalar()
            if latest!=body.run_id:raise ValueError('Review the latest execution report')
            package=self.package(row)
            if not any(p.startswith('tests/') for p in package['resources']):raise ValueError('Reusable skill requires tests')
            db.execute(update(skills).where(skills.c.organization_id==self.oid,skills.c.name==row['name'],skills.c.status=='active',skills.c.id!=row['id']).values(status='retired'))
            activation={'actor':actor,'run_id':body.run_id,'attestation':body.attestation,'at':now()}
            db.execute(update(skills).where(skills.c.id==row['id']).values(status='active',activated_by=actor,activation=activation))
            row.update(status='active',activated_by=actor,activation=activation);result=self.summary(db,row)
        # Rebuildable search accelerator: failures never lose the durable package or approval.
        try:
            search=self.search_engine or ElasticSearch();search.ensure_index()
            search.index_chunks({'id':row['id'],'organization_id':self.oid,'dataset':None,'filename':row['name'],'sha256':row['package_hash'],'created_at':row['created_at']},[{'id':'skill:'+row['id'],'locator':'skill-summary','content':row['name']+' '+row['description']}])
            result['index_status']='indexed'
        except Exception:result['index_status']='keyword_fallback'
        return result
    def retire(self,body,actor):
        with Accounting(self.store,self.oid).transaction() as db:
            row=self.owned(db,body.skill_id)
            db.execute(update(skills).where(skills.c.id==row['id']).values(status='retired',activation={**(row['activation'] or {}),'retirement':{'actor':actor,'reason':body.reason,'at':now()}}))
            return {'skill_id':row['id'],'status':'retired'}
    def save_evidence(self,body):
        return DataService(self.store,self.oid,objects=self.storage()).ingest('skill-execution-'+body.request_key+'.txt',('AGENT-REPORTED EXECUTION EVIDENCE. Not independent verification.\n'+body.content).encode(),source_key='skill-execution:'+body.request_key)
    def execute(self,name,args):
        body=TOOL_MODELS[name].model_validate(args)
        if name=='save_skill_execution_evidence':return self.save_evidence(body)
        if name=='save_learned_skill':return self.save(body)
        if name=='search_learned_skills':return self.search(body)
        if name=='get_learned_skill':return self.get(body.skill_id)
        if name=='get_skill_resource':return self.get(body.skill_id,body.path)
        return self.record(body)
