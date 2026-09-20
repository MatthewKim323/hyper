from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from .data_api import service
from .accounting_api import owner, invoke
from .posting import Posting, ApproveDraft, PostDraft, Reverse

router=APIRouter(prefix='/accounting/journals',tags=['journal posting'])

@router.get('')
def entries(account:str|None=None,currency:str|None=None,from_date:date|None=None,through:date|None=None,limit:int=50,offset:int=0,data=Depends(service)):
    args={'limit':limit,'offset':offset}
    args.update({k:v for k,v in {'account':account,'currency':currency,'from_date':from_date,'through':through}.items() if v is not None})
    return invoke(Posting(data.store,data.oid).execute,'list_journal_entries',args)

@router.get('/trial-balance')
def trial_balance(through:date,currency:str,data=Depends(service)):
    return invoke(Posting(data.store,data.oid).execute,'trial_balance',{'through':through,'currency':currency})

@router.get('/drafts')
def drafts(limit:int=50,offset:int=0,data=Depends(service)):
    return invoke(Posting(data.store,data.oid).drafts,limit,offset)

@router.get('/drafts/{draft_id}')
def draft(draft_id:str,data=Depends(service)):
    return invoke(Posting(data.store,data.oid).draft,draft_id)

@router.post('/drafts/{draft_id}/approve')
def approve(draft_id:str,body:ApproveDraft,access=Depends(owner)):
    if draft_id!=body.draft_id:raise HTTPException(422,'Draft ID mismatch')
    data,identity=access
    return invoke(Posting(data.store,data.oid).approve_draft,body,'human:'+identity.user_id)

@router.post('/drafts/{draft_id}/post')
def post(draft_id:str,body:PostDraft,access=Depends(owner)):
    if draft_id!=body.draft_id:raise HTTPException(422,'Draft ID mismatch')
    data,identity=access
    return invoke(Posting(data.store,data.oid).post_draft,body,'human:'+identity.user_id)

@router.post('/entries/{entry_id}/reverse')
def reverse(entry_id:str,body:Reverse,access=Depends(owner)):
    if entry_id!=body.entry_id:raise HTTPException(422,'Entry ID mismatch')
    data,identity=access
    return invoke(Posting(data.store,data.oid).reverse,body,'human:'+identity.user_id)
