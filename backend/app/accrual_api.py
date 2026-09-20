from fastapi import APIRouter, Depends, HTTPException
from .data_api import service
from .accounting_api import owner, invoke
from .accruals import Accruals, Prepare, Approve, Followup

router=APIRouter(prefix='/accounting/accruals',tags=['expense accruals'])

@router.post('')
def prepare(body:Prepare,data=Depends(service)):
    return invoke(Accruals(data.store,data.oid).execute,'prepare_expense_accrual',body.model_dump())

@router.get('/{accrual_id}')
def get(accrual_id:str,data=Depends(service)):
    return invoke(Accruals(data.store,data.oid).execute,'get_expense_accrual',{'accrual_id':accrual_id})

@router.post('/{accrual_id}/approve')
def approve(accrual_id:str,body:Approve,access=Depends(owner)):
    if accrual_id!=body.accrual_id:raise HTTPException(422,'Accrual ID mismatch')
    data,identity=access
    return invoke(Accruals(data.store,data.oid).approve,body,'human:'+identity.user_id)

@router.post('/{accrual_id}/track')
def track(accrual_id:str,body:Followup,data=Depends(service)):
    if accrual_id!=body.accrual_id:raise HTTPException(422,'Accrual ID mismatch')
    return invoke(Accruals(data.store,data.oid).execute,'track_expense_accrual',body.model_dump())
