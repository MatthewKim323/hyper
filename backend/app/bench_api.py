"""Benchmark timeline for the Benchmarks page. Sandbox aggregates only: counts and timings, never a document."""
import os
from fastapi import APIRouter, Depends, Query
from .data_api import service
from .bench_timeline import document

router = APIRouter(prefix='/benchmarks', tags=['benchmarks'])

@router.get('/timeline')
def timeline(since: int = Query(default=0, ge=0), data=Depends(service)):
    # The caller's own organization, plus the shared lab the unattended loop runs in.
    labs = [x.strip() for x in os.getenv('BENCH_TIMELINE_ORGS', 'hyper-lab').split(',') if x.strip()]
    return document(data.engine, list(dict.fromkeys([data.oid, *labs])), since)
