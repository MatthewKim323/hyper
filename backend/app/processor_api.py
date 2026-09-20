from fastapi import APIRouter, Depends
from .data_api import service
from .accounting_api import invoke
from .processor_adapters import Adapters, ImportProcessor, ImportBankStatement

router=APIRouter(prefix='/accounting/adapters',tags=['processor and bank adapters'])

@router.post('/processor')
def import_processor(body:ImportProcessor,data=Depends(service)):
    return invoke(Adapters(data).execute,'import_processor_report',body.model_dump())

@router.post('/bank-statement')
def import_bank_statement(body:ImportBankStatement,data=Depends(service)):
    return invoke(Adapters(data).execute,'import_bank_statement',body.model_dump())

@router.get('/imports/{import_id}')
def get_import(import_id:str,data=Depends(service)):
    return invoke(Adapters(data).execute,'get_adapter_import',{'import_id':import_id})
