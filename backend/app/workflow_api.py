"""Authenticated workspace journal. A client cannot choose another workspace."""
from fastapi import APIRouter, Depends, Query
from .data_api import service
from .workflow import WorkflowService

router = APIRouter(prefix='/workflow', tags=['workflow'])


def journal(data=Depends(service)):
    return WorkflowService(data.store, data.oid)


@router.get('/events')
def events(after: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), svc=Depends(journal)):
    return svc.feed(after, limit)


@router.get('/snapshot')
def snapshot(limit: int = Query(50, ge=1, le=100), svc=Depends(journal)):
    return svc.snapshot(limit)


@router.get('/history')
def history(before: int | None = Query(None, ge=1), limit: int = Query(50, ge=1, le=100), svc=Depends(journal)):
    return svc.history(before, limit)
