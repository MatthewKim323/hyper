"""Single-evaluation chart selection over exact snapshots; no prose-generation wait."""
import os
import time
import uuid
from typing import Literal
import httpx
from pydantic import Field
from sqlalchemy import update, or_, and_
from .artifacts import ArtifactService, CreateArtifact, calculate_spec
from .database import artifacts
from .agent_events import emit


class ComposeArtifact(CreateArtifact):
    prompt: str = Field(min_length=1,max_length=2000)
    projection_months: Literal[0] = 0
    mode: Literal['fast'] = 'fast'


def compose(data, args):
    svc=ArtifactService(data)
    row=svc.create(args, initial_status='composition_pending')
    if row['status']=='ready':return row
    token=uuid.uuid4().hex
    now=int(time.time()*1000)
    with data.engine.begin() as db:
        claimed=db.execute(update(artifacts).where(artifacts.c.id==row['id'],artifacts.c.organization_id==data.oid,
            or_(artifacts.c.status.in_(['composition_pending','failed']),
                and_(artifacts.c.status=='composing',artifacts.c.lease_until<now))).values(
                status='composing',claim_token=token,lease_until=now+30000,error=None)).rowcount
    if not claimed:return svc.get(row['id'])
    owned=and_(artifacts.c.id==row['id'],artifacts.c.organization_id==data.oid,artifacts.c.claim_token==token)
    try:
        query=args.query
        measure=query.field if query.operation!='count' else 'records'
        title=f'{query.dataset}: {query.operation}({measure}) by {query.group_by[0]}'
        classic=calculate_spec(row['request'],row['snapshot'],dict(title=title,chart='line',
            summary='Historical query results. No forecast or inferred financial interpretation.',
            growth_percent='0',assumption='No projection'))
        props=classic['elements']['chart']['props']
        notes=classic['elements']['notes']['props']['text']
        with httpx.Client(timeout=10) as client:
            response=client.post(os.getenv('EVALUATOR_URL','http://127.0.0.1:8001')+'/artifact-compose',
                headers={'Authorization':'Bearer '+os.getenv('EVALUATOR_SECRET','')},
                json={'prompt':args.prompt,'chartProps':props,'notes':notes})
            response.raise_for_status();body=response.json()
        chosen=body.get('chart')
        if chosen not in ('line','bar'):raise ValueError('Invalid chart choice')
        spec=body['spec'];root=spec.get('root')
        expected={'root':root,'elements':{root:{'type':'FinancialArtifactCard',
            'props':{**props,'chart':chosen,'points':{'$state':'/points'},'notes':{'$state':'/notes'}},
            'children':[]}},'state':{'points':props['points'],'notes':notes}}
        if not isinstance(root,str) or spec!=expected:raise ValueError('Composition changed immutable financial content')
        evaluation=body.get('evaluation',{})
        if evaluation.get('stop_reason')!='finish' or evaluation.get('purpose')!='presentation_selection' or not isinstance(body.get('html'),str):
            raise ValueError('Incomplete composition')
        with data.engine.begin() as db:
            saved=db.execute(update(artifacts).where(owned).values(status='ready',spec=spec,html=body['html'],
                evaluation=evaluation,claim_token=None,lease_until=0,error=None)).rowcount
            if saved:emit(db,data.oid,'artifact:'+row['id'],'artifact.ready',{'artifact_id':row['id']})
    except Exception as exc:
        with data.engine.begin() as db:
            db.execute(update(artifacts).where(owned).values(status='failed',claim_token=None,lease_until=0,
                error=type(exc).__name__+': fast composition failed; retry with the same request key'))
    return svc.get(row['id'])
