"""Durable application state for resumable Devin coordinators and bounded workers."""
import hashlib
import json
import os
import secrets
import time
import uuid
from typing import Literal
from pydantic import Field, model_validator
from sqlalchemy import select,update,func
from .database import (agent_controllers as controllers,agent_cases as cases,agent_case_updates as case_updates,
    agent_tasks as tasks,agent_events as events,agent_attempts as attempts,insert_ignore)
from .data_service import StrictModel,DataService,SourceQuery
from .agent_events import emit


def now():return int(time.time()*1000)
def uid(prefix):return prefix+'_'+uuid.uuid4().hex
def digest(token):return hashlib.sha256(token.encode()).hexdigest()
def public(row):return {k:v for k,v in dict(row).items() if k not in ('organization_id','credential_hash','credential_expires','claim_token','lease_until')}

class Page(StrictModel):
    offset:int=Field(default=0,ge=0)
    limit:int=Field(default=50,ge=1,le=100)
class EventAck(StrictModel):
    event_ids:list[str]=Field(min_length=1,max_length=100)
class CaseState(StrictModel):
    findings:list[str]=Field(default_factory=list,max_length=30)
    unknowns:list[str]=Field(default_factory=list,max_length=30)
    next_actions:list[str]=Field(default_factory=list,max_length=30)
    source_ids:list[str]=Field(default_factory=list,max_length=30)
    concern_ids:list[str]=Field(default_factory=list,max_length=20)
class PutCase(StrictModel):
    case_key:str=Field(min_length=1,max_length=160)
    title:str=Field(min_length=1,max_length=200)
    expected_version:int=Field(ge=0)
    state:CaseState
class CaseID(StrictModel):
    case_id:str
class Delegate(StrictModel):
    request_key:str=Field(min_length=1,max_length=160)
    case_id:str
    objective:str=Field(min_length=1,max_length=8000)
class TaskID(StrictModel):
    task_id:str
class Investigation(StrictModel):
    request_key:str=Field(min_length=1,max_length=128)
    title:str=Field(min_length=1,max_length=200)
    objective:str=Field(min_length=1,max_length=8000)
    source_ids:list[str]=Field(default_factory=list,max_length=30)
class Report(TaskID):
    outcome:Literal['complete','needs_input','failed']
    summary:str=Field(min_length=1,max_length=8000)
    source_ids:list[str]=Field(default_factory=list,max_length=30)
    @model_validator(mode='after')
    def require_completion_evidence(self):
        if self.outcome=='complete' and not self.source_ids:
            raise ValueError('Completed investigations require source citations')
        return self
class Checkpoint(StrictModel):
    summary:str=Field(min_length=1,max_length=12000)
class ServiceError(ValueError):pass


class AgentService:
    def __init__(self,store,oid):self.store,self.engine,self.oid=store,store.engine,oid
    def data(self):return DataService(self.store,self.oid)
    def start_investigation(self,args):
        for source_id in args.source_ids:self.data().source(source_id)
        key='dashboard:'+args.request_key
        with self.engine.begin() as db:
            if db.dialect.name=='sqlite':db.exec_driver_sql('BEGIN IMMEDIATE')
            insert_ignore(db,controllers,dict(organization_id=self.oid,enabled=True,status='pending',checkpoint={},lease_until=0,next_poll_at=0,credential_expires=0,launch_count=0))
            control=db.execute(select(controllers).where(controllers.c.organization_id==self.oid).with_for_update()).mappings().one()
            existing=db.execute(select(tasks).where(tasks.c.organization_id==self.oid,tasks.c.request_key==key)).mappings().first()
            if existing:
                case=db.execute(select(cases).where(cases.c.id==existing['case_id'])).mappings().one()
                if existing['objective']!=args.objective or case['title']!=args.title or case['state']['source_ids']!=args.source_ids:
                    raise ServiceError('Investigation request key reused with different inputs')
                return public(existing)
            if not control['enabled']:raise ServiceError('Investigations are paused; resume through agent controls first')
            cid=uid('case');tid=uid('task');state=CaseState(source_ids=args.source_ids,next_actions=[args.objective]).model_dump()
            db.execute(cases.insert().values(id=cid,organization_id=self.oid,case_key=key,title=args.title,state=state,version=1,updated_at=now()))
            db.execute(case_updates.insert().values(id=uid('update'),case_id=cid,version=1,state=state,created_at=now()))
            db.execute(tasks.insert().values(id=tid,organization_id=self.oid,case_id=cid,request_key=key,objective=args.objective,status='queued',created_at=now(),credential_expires=0,lease_until=0,next_poll_at=0))
            db.execute(update(controllers).where(controllers.c.organization_id==self.oid).values(next_poll_at=0))
            emit(db,self.oid,'investigation:'+tid,'task.queued',{'task_id':tid,'case_id':cid})
        return self.get_task(tid)
    def controller(self):
        with self.engine.connect() as db:
            row=db.execute(select(controllers).where(controllers.c.organization_id==self.oid)).mappings().first()
        return public(row) if row else {'enabled':False,'status':'not_started'}
    def enable(self,enabled):
        with self.engine.begin() as db:
            insert_ignore(db,controllers,dict(organization_id=self.oid,enabled=enabled,status='pending',checkpoint={},lease_until=0,next_poll_at=0,credential_expires=0,launch_count=0))
            db.execute(update(controllers).where(controllers.c.organization_id==self.oid).values(enabled=enabled,next_poll_at=0))
            if enabled:emit(db,self.oid,'controller-start:'+uid('start'),'controller.started',{})
        return self.controller()
    def list_events(self,args):
        with self.engine.connect() as db:
            rows=db.execute(select(events).where(events.c.organization_id==self.oid,events.c.acknowledged.is_(False))
                .order_by(events.c.created_at,events.c.id).offset(args.offset).limit(args.limit+1)).mappings().all()
        return {'events':[public(r) for r in rows[:args.limit]],'has_more':len(rows)>args.limit}
    def ack_events(self,args):
        with self.engine.begin() as db:
            db.execute(update(events).where(events.c.organization_id==self.oid,events.c.id.in_(args.event_ids)).values(acknowledged=True))
        return {'acknowledged':True}
    def get_case(self,cid):
        with self.engine.connect() as db:
            row=db.execute(select(cases).where(cases.c.id==cid,cases.c.organization_id==self.oid)).mappings().first()
        if not row:raise LookupError('Case not found')
        return public(row)
    def list_cases(self,args):
        with self.engine.connect() as db:
            rows=db.execute(select(cases).where(cases.c.organization_id==self.oid).order_by(cases.c.updated_at,cases.c.id)
                .offset(args.offset).limit(args.limit+1)).mappings().all()
        return {'cases':[public(r) for r in rows[:args.limit]],'has_more':len(rows)>args.limit}
    def put_case(self,args):
        state=args.state.model_dump()
        if len(json.dumps(state))>30000:raise ValueError('Case state too large')
        for sid in state['source_ids']:self.data().source(sid)
        from .concerns import ConcernService
        for cid in state['concern_ids']:ConcernService(self.data()).get(cid)
        with self.engine.begin() as db:
            if db.dialect.name=='sqlite':db.exec_driver_sql('BEGIN IMMEDIATE')
            row=db.execute(select(cases).where(cases.c.organization_id==self.oid,cases.c.case_key==args.case_key).with_for_update()).mappings().first()
            if not row:
                if args.expected_version!=0:raise ServiceError('Case version conflict')
                cid=uid('case');version=1
                insert_ignore(db,cases,dict(id=cid,organization_id=self.oid,case_key=args.case_key,title=args.title,state=state,version=version,updated_at=now()))
                if db.execute(select(cases.c.id).where(cases.c.organization_id==self.oid,cases.c.case_key==args.case_key)).scalar()!=cid:
                    raise ServiceError('Case concurrently created; reload')
            else:
                cid=row['id'];version=row['version']+1
                if not db.execute(update(cases).where(cases.c.id==cid,cases.c.version==args.expected_version).values(title=args.title,state=state,version=version,updated_at=now())).rowcount:
                    raise ServiceError('Case version conflict')
            db.execute(case_updates.insert().values(id=uid('update'),case_id=cid,version=version,state=state,created_at=now()))
        return self.get_case(cid)
    def delegate(self,args):
        self.get_case(args.case_id)
        with self.engine.begin() as db:
            insert_ignore(db,tasks,dict(id=uid('task'),organization_id=self.oid,case_id=args.case_id,
                request_key=args.request_key,objective=args.objective,status='queued',created_at=now(),credential_expires=0,lease_until=0,next_poll_at=0))
            row=db.execute(select(tasks).where(tasks.c.organization_id==self.oid,tasks.c.request_key==args.request_key)).mappings().one()
            if row['objective']!=args.objective or row['case_id']!=args.case_id:raise ServiceError('Task request key reused')
        return public(row)
    def get_task(self,tid):
        with self.engine.connect() as db:
            row=db.execute(select(tasks).where(tasks.c.id==tid,tasks.c.organization_id==self.oid)).mappings().first()
        if not row:raise LookupError('Task not found')
        return public(row)
    def list_tasks(self,args):
        with self.engine.connect() as db:
            rows=db.execute(select(tasks).where(tasks.c.organization_id==self.oid).order_by(tasks.c.created_at,tasks.c.id)
                .offset(args.offset).limit(args.limit+1)).mappings().all()
        return {'tasks':[public(r) for r in rows[:args.limit]],'has_more':len(rows)>args.limit}
    def report(self,args):
        for sid in args.source_ids:self.data().source(sid)
        result=args.model_dump(exclude={'task_id'})
        with self.engine.begin() as db:
            row=db.execute(select(tasks).where(tasks.c.id==args.task_id,tasks.c.organization_id==self.oid)).mappings().first()
            if not row:raise LookupError('Task not found')
            if row['result']==result:return public(row)
            if not db.execute(update(tasks).where(tasks.c.id==args.task_id,tasks.c.status=='running').values(status=args.outcome,result=result,credential_hash=None)).rowcount:
                raise ServiceError('Task no longer running')
            emit(db,self.oid,'task:'+args.task_id,'task.finished',{'task_id':args.task_id,'case_id':row['case_id'],'result':result})
        return self.get_task(args.task_id)
    def checkpoint(self,args):
        with self.engine.begin() as db:
            db.execute(update(controllers).where(controllers.c.organization_id==self.oid).values(checkpoint=args.model_dump()))
        return {'saved':True}


def authenticate(store,token):
    if not token.startswith('agt_'):raise PermissionError('Invalid agent credential')
    hashed=digest(token)
    with store.engine.connect() as db:
        controller=db.execute(select(controllers).where(controllers.c.credential_hash==hashed,controllers.c.credential_expires>now(),controllers.c.enabled.is_(True))).mappings().first()
        if controller and os.getenv('DEVIN_COORDINATOR_ENABLED','false').lower()=='true':return {'organization_id':controller['organization_id'],'role':'coordinator','task_id':None}
        task=db.execute(select(tasks).join(controllers,tasks.c.organization_id==controllers.c.organization_id).where(
            tasks.c.credential_hash==hashed,tasks.c.credential_expires>now(),tasks.c.status=='running',controllers.c.enabled.is_(True))).mappings().first()
        if task:return {'organization_id':task['organization_id'],'role':'worker','task_id':task['id'],'case_id':task['case_id']}
    raise PermissionError('Agent credential expired or revoked')


MODELS={'list_events':Page,'ack_events':EventAck,'list_cases':Page,'get_case':CaseID,'update_case':PutCase,
        'delegate_task':Delegate,'get_task':TaskID,'list_tasks':Page,'report_task_result':Report,'checkpoint':Checkpoint}

def execute(store,identity,name,args):
    from . import data_tools
    oid=identity['organization_id'];svc=AgentService(store,oid)
    if identity['role']=='worker':
        permitted={'list_datasets','query_financials','search_evidence','get_source','get_case','get_task','report_task_result','raise_concern','create_financial_artifact','get_financial_artifact'}
        if name not in permitted:raise PermissionError('Tool not permitted for workers')
        if name in ('get_task','report_task_result') and args.get('task_id')!=identity['task_id']:raise PermissionError('Task scope mismatch')
        if name=='get_case' and args.get('case_id')!=identity['case_id']:raise PermissionError('Case scope mismatch')
    if name in data_tools.DESCRIPTIONS:return data_tools.execute(store,oid,name,args)
    if name not in MODELS:raise ValueError('Unknown tool')
    parsed=MODELS[name].model_validate(args)
    methods={'update_case':'put_case','delegate_task':'delegate','report_task_result':'report'}
    if name=='get_case':return svc.get_case(parsed.case_id)
    if name=='get_task':return svc.get_task(parsed.task_id)
    return getattr(svc,methods.get(name,name))(parsed)
