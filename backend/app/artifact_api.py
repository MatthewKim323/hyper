from fastapi import APIRouter,Depends,HTTPException
from fastapi.responses import HTMLResponse
from .data_api import service,invoke
from .artifacts import ArtifactService,CreateArtifact
router=APIRouter(prefix='/artifacts',tags=['artifacts'])
@router.post('',status_code=202)
def create(body:CreateArtifact,data=Depends(service)):
    return invoke(ArtifactService(data).create,body)
@router.get('/{aid}')
def get(aid:str,data=Depends(service)):
    return invoke(ArtifactService(data).get,aid)
@router.get('/{aid}/html',response_class=HTMLResponse)
def html(aid:str,data=Depends(service)):
    return HTMLResponse(invoke(ArtifactService(data).html,aid),headers={'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox",'X-Content-Type-Options':'nosniff'})
