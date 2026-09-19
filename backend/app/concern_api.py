from fastapi import APIRouter, Depends, HTTPException, Query
from . import auth
from .data_api import service
from .concerns import ConcernService, RaiseConcern, Respond, Finish, Conflict

router = APIRouter(prefix='/concerns', tags=['concerns'])


def concerns(data=Depends(service)):
    return ConcernService(data)


def invoke(fn, *args):
    try:
        return fn(*args)
    except LookupError:
        raise HTTPException(404, 'Concern or evidence not found') from None
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
    return invoke(svc.claim, cid)


@router.post('/{cid}/resolve')
def resolve(cid: str, body: Finish, svc=Depends(concerns)):
    if body.concern_id != cid:
        raise HTTPException(422, 'Concern ID must match route')
    return invoke(svc.finish, body)
