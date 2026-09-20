from fastapi import APIRouter, Depends, HTTPException
from .data_api import service, invoke
from .accounting_api import owner
from .learned_skills import Skills, Draft, Run, Activate, Retire, Search, ExecutionEvidence

router=APIRouter(prefix='/skills',tags=['learned skills'])
def library(data):return Skills(data.store,data.oid,objects=data.objects)

@router.get('')
def search(query:str='',limit:int=10,include_inactive:bool=False,data=Depends(service)):
    return invoke(lambda:library(data).search(Search(query=query,limit=limit,include_inactive=include_inactive)))
@router.post('')
def save(body:Draft,data=Depends(service)):
    return invoke(library(data).save,body)
@router.post('/execution-evidence')
def evidence(body:ExecutionEvidence,data=Depends(service)):
    return invoke(library(data).save_evidence,body)

@router.get('/{skill_id}')
def get(skill_id:str,data=Depends(service)):
    return invoke(library(data).get,skill_id)
@router.get('/{skill_id}/resource')
def resource(skill_id:str,path:str,data=Depends(service)):
    return invoke(library(data).get,skill_id,path)
@router.post('/{skill_id}/runs')
def record(skill_id:str,body:Run,data=Depends(service)):
    if skill_id!=body.skill_id:raise HTTPException(422,'Skill ID mismatch')
    return invoke(library(data).record,body)
@router.post('/{skill_id}/activate')
def activate(skill_id:str,body:Activate,access=Depends(owner)):
    if skill_id!=body.skill_id:raise HTTPException(422,'Skill ID mismatch')
    data,identity=access
    return invoke(library(data).activate,body,'human:'+identity.user_id)
@router.post('/{skill_id}/retire')
def retire(skill_id:str,body:Retire,access=Depends(owner)):
    if skill_id!=body.skill_id:raise HTTPException(422,'Skill ID mismatch')
    data,identity=access
    return invoke(library(data).retire,body,'human:'+identity.user_id)
