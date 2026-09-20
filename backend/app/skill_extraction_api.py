from fastapi import APIRouter, Depends
from .data_api import service
from .accounting_api import owner, invoke
from .skill_extraction import Extractions, ExtractTask, ExtractCase

router=APIRouter(prefix='/accounting/skills',tags=['skill extraction'])
def library(data):return Extractions(data.store,data.oid,objects=data.objects)

@router.get('/lineage/{skill_id}')
def lineage(skill_id:str,data=Depends(service)):
    return invoke(library(data).execute,'get_skill_lineage',{'skill_id':skill_id})

@router.post('/extract/task')
def extract_task(body:ExtractTask,data=Depends(service)):
    return invoke(library(data).execute,'draft_skill_from_task',body.model_dump())

@router.post('/extract/case')
def extract_case(body:ExtractCase,data=Depends(service)):
    return invoke(library(data).execute,'draft_skill_from_case',body.model_dump())
