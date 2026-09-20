"""Governed extraction of completed agent work into evidence-bound draft skills."""
import uuid
from pydantic import Field
from sqlalchemy import select, insert, func
from .data_service import StrictModel
from .accounting import Accounting
from .learned_skills import Skills, Draft, digest, now
from .database import (skill_extractions as extractions, learned_skills as skills,
    agent_tasks as tasks, agent_cases as cases, agent_case_updates as case_updates,
    agent_attempts as attempts)

# Terminal success states written by AgentService.report; anything else is unfinished or failed.
COMPLETE={'complete'}

class Extraction(StrictModel):
    name: str = Field(pattern=r'^[a-z0-9]+(?:-[a-z0-9]+)*$',max_length=64)
    description: str = Field(min_length=10,max_length=500)
    instructions: str = Field(min_length=20,max_length=16000)
    applicability: str = Field(min_length=10,max_length=2000)
    limitations: str = Field(min_length=10,max_length=2000)
    resources: dict[str,str] = Field(default_factory=dict,max_length=30)
    research_urls: list[str] = Field(default_factory=list,max_length=20)
    evidence_source_ids: list[str] = Field(default_factory=list,max_length=30)
    based_on_version: int = Field(default=0,ge=0)
    request_key: str = Field(min_length=1,max_length=200)
class ExtractTask(Extraction):
    task_id: str = Field(min_length=1,max_length=200)
class ExtractCase(Extraction):
    case_id: str = Field(min_length=1,max_length=200)
class Lineage(StrictModel):
    skill_id: str = Field(min_length=1,max_length=200)

TOOL_MODELS={'draft_skill_from_task':ExtractTask,'draft_skill_from_case':ExtractCase,'get_skill_lineage':Lineage}
DESCRIPTIONS={
 'draft_skill_from_task':'Extract a reusable draft skill package from a completed agent task. Requires task status complete, at least one tests/ resource, and at least one active evidence source cited by the task result, its case state, attempts, or supplied evidence_source_ids. Saves a draft through the skills service; owner activation still requires a passing recorded run.',
 'draft_skill_from_case':'Extract a reusable draft skill package from an agent case. Cases carry no explicit status, so extraction assumes completion when the case state records findings with no pending next actions. Still requires a tests/ resource and at least one active evidence source. Saves a draft; activation stays owner-gated.',
 'get_skill_lineage':'List recorded extraction lineage rows for a skill: origin, request key, report and creation time.',
}

def source_ids(payload):
    found=set()
    if isinstance(payload,dict):
        for key,value in payload.items():
            if key=='source_ids' and isinstance(value,list):found.update(v for v in value if isinstance(v,str))
            else:found|=source_ids(value)
    elif isinstance(payload,list):
        for value in payload:found|=source_ids(value)
    return found

class Extractions:
    def __init__(self,store,oid,objects=None,search=None):
        self.store,self.oid=store,oid;self.objects=objects;self.search=search
    def skills(self):return Skills(self.store,self.oid,objects=self.objects,search=self.search)
    def owned(self,db,key):
        return db.execute(select(extractions).where(extractions.c.organization_id==self.oid,
            extractions.c.request_key==key)).mappings().first()
    def task_info(self,db,tid):
        row=db.execute(select(tasks).where(tasks.c.id==tid,tasks.c.organization_id==self.oid)).mappings().first()
        if not row:raise LookupError('Agent task not found')
        if row['status'] not in COMPLETE:
            raise ValueError("Task status '"+row['status']+"' is not complete; extraction requires a completed task")
        ids=set(source_ids(row['result']))
        case=db.execute(select(cases).where(cases.c.id==row['case_id'],cases.c.organization_id==self.oid)).mappings().first()
        if case:ids|=source_ids(case['state'])
        tries=db.execute(select(attempts).where(attempts.c.target_id==tid,attempts.c.organization_id==self.oid)).mappings().all()
        for attempt in tries:ids|=source_ids(attempt['details'])
        return ids,{'task_status':row['status'],'attempt_count':len(tries)}
    def case_info(self,db,cid):
        row=db.execute(select(cases).where(cases.c.id==cid,cases.c.organization_id==self.oid)).mappings().first()
        if not row:raise LookupError('Agent case not found')
        state=row['state'] if isinstance(row['state'],dict) else {}
        if not state.get('findings') or state.get('next_actions'):
            raise ValueError('Case does not indicate completion; recorded findings with no pending next actions are required')
        ids=set(source_ids(state))
        updates=db.execute(select(case_updates).where(case_updates.c.case_id==cid)).mappings().all()
        for update_row in updates:ids|=source_ids(update_row['state'])
        task_rows=db.execute(select(tasks).where(tasks.c.case_id==cid,tasks.c.organization_id==self.oid)).mappings().all()
        for task_row in task_rows:ids|=source_ids(task_row['result'])
        targets=[cid]+[task_row['id'] for task_row in task_rows]
        count=db.execute(select(func.count()).select_from(attempts).where(attempts.c.target_id.in_(targets),
            attempts.c.organization_id==self.oid)).scalar()
        return ids,{'case_version':row['version'],'update_count':len(updates),'task_count':len(task_rows),'attempt_count':count}
    def respond(self,db,row):
        skill=db.execute(select(skills).where(skills.c.id==row['skill_id'],skills.c.organization_id==self.oid)).mappings().one()
        return {**self.skills().summary(db,skill),'extraction_id':row['id'],'provenance':row['report']}
    def extract(self,body,kind,ref_id):
        origin={'kind':kind,'ref_id':ref_id}
        fingerprint=digest({'origin':origin,'request':body.model_dump(exclude={'request_key'})})
        with Accounting(self.store,self.oid).transaction() as db:
            existing=self.owned(db,body.request_key)
            if existing:
                if existing['report'].get('request')!=fingerprint:
                    raise ValueError('Extraction request key reused with different arguments')
                return self.respond(db,existing)
            ids,report=(self.task_info if kind=='agent_task' else self.case_info)(db,ref_id)
            ids=sorted(ids|set(body.evidence_source_ids))
            if not ids:
                raise ValueError('Skill extraction requires at least one evidence source; the completed work recorded none and none were supplied')
            self.skills().evidence(db,ids)
            if not any(path.startswith('tests/') for path in body.resources):
                raise ValueError('Skill extraction requires at least one tests/ resource')
            report.update(evidence_source_ids=ids,request=fingerprint)
        # Skills.save owns draft persistence and its own transaction; version conflicts surface unchanged.
        summary=self.skills().save(Draft(name=body.name,description=body.description,instructions=body.instructions,
            applicability=body.applicability,limitations=body.limitations,source_ids=ids,
            research_urls=body.research_urls,resources=body.resources,based_on_version=body.based_on_version))
        report.update(name=summary['name'],version=summary['version'])
        with Accounting(self.store,self.oid).transaction() as db:
            existing=self.owned(db,body.request_key)
            if existing:
                if existing['report'].get('request')!=fingerprint:
                    raise ValueError('Extraction request key reused with different arguments')
                return self.respond(db,existing)
            eid='ext_'+uuid.uuid4().hex
            db.execute(insert(extractions).values(id=eid,organization_id=self.oid,request_key=body.request_key,
                skill_id=summary['id'],origin=origin,report=report,created_at=now()))
            return {**summary,'extraction_id':eid,'provenance':report}
    def lineage(self,skill_id):
        with self.store.engine.connect() as db:
            rows=db.execute(select(extractions).where(extractions.c.organization_id==self.oid,
                extractions.c.skill_id==skill_id).order_by(extractions.c.created_at,extractions.c.id)).mappings().all()
        return {'extractions':[{'id':r['id'],'origin':r['origin'],'request_key':r['request_key'],
            'report':r['report'],'created_at':r['created_at']} for r in rows]}
    def execute(self,name,args):
        body=TOOL_MODELS[name].model_validate(args)
        if name=='get_skill_lineage':return self.lineage(body.skill_id)
        if name=='draft_skill_from_task':return self.extract(body,'agent_task',body.task_id)
        return self.extract(body,'agent_case',body.case_id)
