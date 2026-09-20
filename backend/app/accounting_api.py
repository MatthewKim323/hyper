from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from mirror_resolve.casework import CaseError
from mirror_resolve.proposals import ProposalError
from . import auth
from .data_api import service
from .database import memberships
from .accounting import Accounting, PromoteRecord, OpenInvoice, CaseID, InspectCredit, Propose, Approval

router=APIRouter(prefix='/accounting',tags=['accounting'])
def invoke(fn,*args):
    try:return fn(*args)
    except LookupError:raise HTTPException(404,'Accounting resource not found') from None
    except (ValueError,CaseError,ProposalError) as exc:raise HTTPException(409,str(exc)) from None

def owner(identity=Depends(auth.current_user),data=Depends(service)):
    with data.store.engine.connect() as db:
        role=db.execute(select(memberships.c.role).where(memberships.c.organization_id==data.oid,memberships.c.user_id==identity.user_id)).scalar()
    if role!='owner':raise HTTPException(403,'Organization owner required for accounting attestation or approval')
    return data,identity

@router.get('/records')
def records(data=Depends(service)):return Accounting(data.store,data.oid).inventory()
@router.post('/records/verify')
def verify(body:PromoteRecord,access=Depends(owner)):
    data,identity=access
    return invoke(Accounting(data.store,data.oid).promote,body,'human:'+identity.user_id)
@router.post('/cases')
def open_case(body:OpenInvoice,data=Depends(service)):
    return invoke(Accounting(data.store,data.oid).execute,'open_payable_case',body.model_dump())
@router.get('/cases/{case_id}')
def analyze(case_id:str,data=Depends(service)):
    return invoke(Accounting(data.store,data.oid).execute,'analyze_payable',{'case_id':case_id})
@router.post('/credits/inspect')
def inspect(body:InspectCredit,data=Depends(service)):
    return invoke(Accounting(data.store,data.oid).execute,'inspect_payable_credit',body.model_dump())
@router.post('/proposals')
def propose(body:Propose,data=Depends(service)):
    return invoke(Accounting(data.store,data.oid).execute,'prepare_payable_proposal',body.model_dump())
@router.post('/approvals')
def approve(body:Approval,access=Depends(owner)):
    data,identity=access
    return invoke(Accounting(data.store,data.oid).approve,body,identity.user_id)
