from fastapi import APIRouter, Depends, HTTPException, Query
from . import auth
from .data_api import service
from .concerns import ConcernService, RaiseConcern, Respond, Finish, Conflict, DecisionCommand

router = APIRouter(prefix='/concerns', tags=['concerns'])


def concerns(data=Depends(service)):
    return ConcernService(data)


def invoke(fn, *args):
    try:
        return fn(*args)
# Exactly LookupError, never its KeyError/IndexError subclasses: services raise the base
# class for a genuine miss, so catching subclasses turned an ordinary bug (a missing dict
# key, an off-by-one index) into a 404 that reads as normal operation and is never retried.
    except LookupError as exc:
        if type(exc) is not LookupError: raise
        raise HTTPException(404, 'Concern or evidence not found') from None
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except Conflict as exc:
        raise HTTPException(409, str(exc)) from None
    except ValueError:
        raise HTTPException(422, 'Invalid concern data') from None


@router.post('', status_code=201)
def create(body: RaiseConcern, svc=Depends(concerns)):
    return invoke(svc.raise_concern, body)


@router.get('')
def list_concerns(status: str | None = None, limit: int = Query(50, ge=1, le=100),
                  offset: int = Query(0, ge=0), svc=Depends(concerns)):
    return svc.list(status, limit, offset)


@router.get('/{cid}')
def get(cid: str, svc=Depends(concerns)):
    return invoke(svc.get, cid)


@router.post('/{cid}/card')
def regenerate(cid: str, svc=Depends(concerns)):
    return invoke(svc.generate, cid)


@router.post('/{cid}/respond')
def respond(cid: str, body: Respond, identity=Depends(auth.current_user), svc=Depends(concerns)):
    return invoke(svc.respond, cid, body, identity.user_id)


@router.post('/{cid}/claim')
def claim(cid: str, svc=Depends(concerns)):
    raise HTTPException(403, 'Concern execution is managed by the scoped resolution worker')


@router.post('/{cid}/resolve')
def resolve(cid: str, body: Finish, svc=Depends(concerns)):
    if body.concern_id != cid:
        raise HTTPException(422, 'Concern ID must match route')
    raise HTTPException(403, 'Concern completion requires verified executor receipts')


@router.post('/{cid}/decisions')
def decide(cid: str, body: DecisionCommand, identity=Depends(auth.current_user), svc=Depends(concerns)):
    if body.concernId != cid:
        raise HTTPException(422, 'Concern ID must match route')
    return invoke(svc.accept, body, identity.user_id)


@router.get('/{cid}/jobs/{jid}')
def job(cid: str, jid: str, svc=Depends(concerns)):
    return invoke(svc.job, cid, jid)
