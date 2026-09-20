from fastapi import APIRouter, Depends
from .data_api import service
from .accounting_api import owner, invoke
from .settlements import Settlements, Reconcile, Verify

router=APIRouter(prefix='/accounting/settlements',tags=['settlement reconciliation'])

@router.post('')
def reconcile(body:Reconcile,data=Depends(service)):
    return invoke(Settlements(data.store,data.oid).execute,'reconcile_settlement',body.model_dump())

@router.get('/{reconciliation_id}')
def get(reconciliation_id:str,data=Depends(service)):
    return invoke(Settlements(data.store,data.oid).execute,'get_settlement_reconciliation',{'reconciliation_id':reconciliation_id})

@router.post('/{reconciliation_id}/verify')
def verify(reconciliation_id:str,body:Verify,access=Depends(owner)):
    if reconciliation_id!=body.reconciliation_id:
        from fastapi import HTTPException
        raise HTTPException(422,'Reconciliation ID mismatch')
    data,identity=access
    return invoke(Settlements(data.store,data.oid).verify,body,'human:'+identity.user_id)
