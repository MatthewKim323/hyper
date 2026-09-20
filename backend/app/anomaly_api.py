from fastapi import APIRouter, Depends, HTTPException, Query
from .data_api import service
from .accounting_api import owner, invoke
from .anomalies import Anomalies, RunScan, Dismiss

router = APIRouter(prefix='/accounting/anomalies', tags=['anomaly scanner'])


@router.get('/findings')
def list_findings(kind: str | None = None, status: str | None = None,
                  limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                  data=Depends(service)):
    return invoke(Anomalies(data.store, data.oid).execute, 'list_anomaly_findings',
                  {'kind': kind, 'status': status, 'limit': limit, 'offset': offset})


@router.get('/findings/{finding_id}')
def get_finding(finding_id: str, data=Depends(service)):
    return invoke(Anomalies(data.store, data.oid).execute, 'get_anomaly_finding',
                  {'finding_id': finding_id})


@router.post('/scans')
def scan(body: RunScan, data=Depends(service)):
    return invoke(Anomalies(data.store, data.oid).execute, 'run_anomaly_scan', body.model_dump())


@router.post('/findings/{finding_id}/dismiss')
def dismiss(finding_id: str, body: Dismiss, access=Depends(owner)):
    if finding_id != body.finding_id:
        raise HTTPException(422, 'Finding ID mismatch')
    data, identity = access
    return invoke(Anomalies(data.store, data.oid).dismiss, body, 'human:' + identity.user_id)
