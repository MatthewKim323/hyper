"""Owner-facing controls for the sandbox counterparties and the adversary. Nothing here exposes a fact sheet."""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from .data_api import service
from .data_service import StrictModel
from .counterparty import Counterparties, FAMILIES

router = APIRouter(prefix='/counterparty', tags=['counterparty'])

class Spawn(StrictModel):
    family: Literal[FAMILIES]
class Adversary(StrictModel):
    enabled: bool
    interval_seconds: int = Field(default=30, ge=5, le=3600)
    max_open: int = Field(default=4, ge=1, le=12)

def invoke(fn, *args):
    try: return fn(*args)
    except PermissionError as exc: raise HTTPException(403, str(exc)) from None
# Exactly LookupError, never its KeyError/IndexError subclasses: services raise the base
# class for a genuine miss, so catching subclasses turned an ordinary bug (a missing dict
# key, an off-by-one index) into a 404 that reads as normal operation and is never retried.
    except LookupError as exc:
        if type(exc) is not LookupError: raise
        raise HTTPException(404, 'Counterparty resource not found') from None
    except ValueError as exc: raise HTTPException(422, str(exc)) from None

@router.get('/scenarios')
def scenarios(data=Depends(service)): return Counterparties(data).list()

@router.post('/scenarios', status_code=201)
def spawn(body: Spawn, data=Depends(service)): return invoke(Counterparties(data).spawn, body.family, 'owner')

@router.get('/threads/{invoice_id}')
def thread(invoice_id: str, data=Depends(service)): return invoke(Counterparties(data).thread, invoice_id)

@router.get('/adversary')
def adversary(data=Depends(service)):
    svc = Counterparties(data)
    return {'control': svc.control(), 'scoreboard': svc.scoreboard(), 'lessons': svc.lessons()}

@router.post('/adversary')
def set_adversary(body: Adversary, data=Depends(service)):
    return invoke(Counterparties(data).control, {**body.model_dump(), 'next_spawn_at': 0})


@router.get('/learning')
def learning(data=Depends(service)):
    """The loop's own account of what the worker learned: the score with and without memory, each trap case by
    case, and every miss with the audit finding and the lesson written from it. The same content the loop commits
    to backend/benchmarks/learning/ on a machine with a checkout; production has none, so it is served live.
    Reads the lab pair named by LEARNING_ORGS ("treatment:control"), simulated cases only, any signed-in user."""
    import os
    from .learning_log import CAVEATS, snapshot
    treatment, _, control = os.getenv('LEARNING_ORGS', 'hyper-lab:hyper-lab-control').partition(':')
    return {**snapshot(data.store, treatment, control or treatment + '-control'), 'treatment': treatment, 'control': control or treatment + '-control', 'caveats': CAVEATS}
