"""Authenticated control plane; generation is always delegated to the worker."""
from fastapi import APIRouter, Depends, HTTPException, Query
from .data_api import service
from .simulator import SimulatorService, CreateSimulation, Conflict

router = APIRouter(prefix='/simulations', tags=['simulator'])


def simulator(data=Depends(service)):
    return SimulatorService(data)


def invoke(fn, *args):
    try:
        return fn(*args)
    except LookupError:
        raise HTTPException(404, 'Simulation not found') from None
    except Conflict as exc:
        raise HTTPException(409, str(exc)) from None


@router.post('', status_code=201)
def create(body: CreateSimulation, svc=Depends(simulator)):
    return invoke(svc.create, body)


@router.get('')
def list_runs(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), svc=Depends(simulator)):
    return invoke(svc.list, limit, offset)


@router.get('/{sid}')
def get(sid: str, svc=Depends(simulator)):
    return invoke(svc.get, sid)


@router.post('/{sid}/start', status_code=202)
def start(sid: str, svc=Depends(simulator)):
    return invoke(svc.control, sid, 'start')


@router.post('/{sid}/pause')
def pause(sid: str, svc=Depends(simulator)):
    return invoke(svc.control, sid, 'pause')


@router.post('/{sid}/tick', status_code=202)
def tick(sid: str, svc=Depends(simulator)):
    return invoke(svc.control, sid, 'tick')


@router.get('/{sid}/events')
def events(sid: str, after: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), svc=Depends(simulator)):
    return invoke(svc.events, sid, after, limit)
