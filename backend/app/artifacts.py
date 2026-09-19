"""Snapshot-backed json-render artifacts with explicit, calculated projection assumptions."""
import json
import os
import re
import time
import uuid
from decimal import Decimal
from typing import Literal
import httpx
from pydantic import Field, model_validator
from sqlalchemy import select, update, and_, or_
from .database import artifacts, insert_ignore
from .data_service import StrictModel, FinancialQuery, DataService
from .agent_events import emit


class CreateArtifact(StrictModel):
    request_key: str = Field(min_length=1,max_length=160)
    prompt: str = Field(min_length=1,max_length=4000)
    query: FinancialQuery
    unit: Literal['major_currency','minor_currency','number']
    projection_months: int = Field(default=0,ge=0,le=24)

    @model_validator(mode='after')
    def validate_query(self):
        if self.query.operation not in ('sum','avg','count') or len(self.query.group_by)!=1 or self.query.offset:
            raise ValueError('Artifact requires sum/avg/count grouped by one field, with offset zero')
        return self


class ArtifactID(StrictModel):
    artifact_id: str


class ArtifactService:
    def __init__(self,data):self.data,self.engine,self.oid=data,data.engine,data.oid

    def create(self,args):
        with self.engine.connect() as db:
            old=db.execute(select(artifacts).where(artifacts.c.organization_id==self.oid,artifacts.c.request_key==args.request_key)).mappings().first()
        if old:
            if old['request']!=args.model_dump():raise ValueError('Request key already used')
            return self.get(old['id'])
        snapshot=self.data.query_financials(args.query)
        if snapshot['has_more']:raise ValueError('Too many groups; narrow the query rather than charting a truncated result')
        rows=snapshot['results']
        if not rows or any(r['value'] is None for r in rows):raise ValueError('No complete numeric observations')
        if len({r['currency'] for r in rows})!=1:raise ValueError('Filter to one currency before charting')
        if args.unit!='number' and not rows[0]['currency']:raise ValueError('Monetary series needs source currency')
        if args.projection_months:
            periods=[r['group'][args.query.group_by[0]] for r in rows]
            if not all(isinstance(p,str) and re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',p) for p in periods):
                raise ValueError('Projections require YYYY-MM monthly groups')
        rid='artifact_'+uuid.uuid4().hex
        with self.engine.begin() as db:
            insert_ignore(db,artifacts,dict(id=rid,organization_id=self.oid,request_key=args.request_key,
                request=args.model_dump(),snapshot=snapshot,status='pending',lease_until=0,created_at=int(time.time()*1000)))
            row=db.execute(select(artifacts).where(artifacts.c.organization_id==self.oid,artifacts.c.request_key==args.request_key)).mappings().one()
            if row['request']!=args.model_dump():raise ValueError('Request key already used')
        return self.get(row['id'])

    def get(self,aid):
        with self.engine.connect() as db:
            row=db.execute(select(artifacts).where(artifacts.c.id==aid,artifacts.c.organization_id==self.oid)).mappings().first()
        if not row:raise LookupError('Artifact not found')
        return {k:v for k,v in row.items() if k not in ('organization_id','html','claim_token','lease_until')}

    def html(self,aid):
        row=self.get(aid)
        if row['status']!='ready':raise ValueError('Artifact is not ready')
        with self.engine.connect() as db:
            return db.execute(select(artifacts.c.html).where(artifacts.c.id==aid,artifacts.c.organization_id==self.oid)).scalar_one()


def calculate_spec(request,snapshot,plan):
    if set(plan)!={'title','chart','summary','growth_percent','assumption'}:raise ValueError('Invalid presentation plan')
    if plan['chart'] not in ('line','bar'):raise ValueError('Invalid chart')
    for key in ('title','summary','assumption'):
        if not isinstance(plan[key],str) or not plan[key].strip() or len(plan[key])>3000:raise ValueError('Invalid text')
    rate=Decimal(str(plan['growth_percent']))
    if not rate.is_finite() or not -100<=rate<=100:raise ValueError('Unsupported growth assumption')
    group=request['query']['group_by'][0]
    points=[{'period':str(r['group'][group]),'value':str(Decimal(r['value'])),'kind':'actual'} for r in snapshot['results']]
    points.sort(key=lambda p:p['period'])
    last=Decimal(points[-1]['value'])
    for n in range(request['projection_months']):
        year,month=map(int,points[-1]['period'].split('-'))
        month+=1
        if month==13:year,month=year+1,1
        last=(last*(1+rate/100)).quantize(Decimal('0.01'))
        points.append({'period':f'{year:04d}-{month:02d}','value':str(last),'kind':'projected'})
    notes=plan['summary']
    if request['projection_months']:
        notes+='\nScenario projection, not a prediction. Assumed monthly growth: '+str(rate)+'%. '+plan['assumption']
        notes+=' Formula: prior month × (1 + growth / 100), rounded to 0.01 imported units.'
    notes+='\nSource IDs: '+', '.join(snapshot['source_ids'])+'\nQuery: '+json.dumps(request['query'],sort_keys=True)
    notes+='\nUnits: '+request['unit']+'. No currency conversion. Historical values are a saved query snapshot.'
    spec={'root':'root','elements':{
        'root':{'type':'Stack','props':{},'children':['chart','notes']},
        'chart':{'type':'FinanceChart','props':{'title':plan['title'],'chart':plan['chart'],
            'currency':snapshot['results'][0]['currency'] or '', 'unit':request['unit'],'points':points},'children':[]},
        'notes':{'type':'Notes','props':{'text':notes},'children':[]}}}
    return spec


def run_once(store):
    now=int(time.time()*1000); token=uuid.uuid4().hex
    with store.engine.begin() as db:
        if db.dialect.name=='sqlite':db.exec_driver_sql('BEGIN IMMEDIATE')
        row=db.execute(select(artifacts).where(or_(artifacts.c.status=='pending',and_(artifacts.c.status=='generating',artifacts.c.lease_until<now)))
            .order_by(artifacts.c.created_at).limit(1).with_for_update(skip_locked=True)).mappings().first()
        if not row:return False
        row=dict(row)
        db.execute(update(artifacts).where(artifacts.c.id==row['id']).values(status='generating',claim_token=token,lease_until=now+240000))
    owned=and_(artifacts.c.id==row['id'],artifacts.c.claim_token==token)
    try:
        base=os.getenv('EVALUATOR_URL','http://127.0.0.1:8001')
        headers={'Authorization':'Bearer '+os.getenv('EVALUATOR_SECRET','')}
        with httpx.Client(timeout=90) as client:
            result=client.post(base+'/artifact-plan',headers=headers,json={'request':row['request'],'snapshot':row['snapshot']})
            result.raise_for_status(); plan=result.json()
            spec=calculate_spec(row['request'],row['snapshot'],plan)
            result=client.post(base+'/artifact-render',headers=headers,json={'request':row['request'],'snapshot':row['snapshot'],'spec':spec})
            result.raise_for_status(); rendered=result.json()
        if rendered.get('approved') is not True or not isinstance(rendered.get('html'),str):raise ValueError('Artifact evaluation failed')
        with store.engine.begin() as db:
            if db.execute(update(artifacts).where(owned).values(status='ready',spec=spec,html=rendered['html'],evaluation=rendered['evaluation'],claim_token=None,lease_until=0)).rowcount:
                emit(db,row['organization_id'],'artifact:'+row['id'],'artifact.ready',{'artifact_id':row['id']})
    except Exception as exc:
        with store.engine.begin() as db:
            db.execute(update(artifacts).where(owned).values(status='failed',claim_token=None,lease_until=0,error=type(exc).__name__+': artifact generation failed'))
    return True
