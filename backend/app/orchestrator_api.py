from fastapi import APIRouter,Depends,HTTPException,Request
from pydantic import Field
from . import auth,data_tools
from .data_api import service
from .data_service import StrictModel
from .orchestrator import AgentService,Page,MODELS,WORKER_TOOLS,authenticate,execute,ServiceError,Investigation
router=APIRouter(prefix='/agents',tags=['agents'])
class Control(StrictModel):enabled:bool
class Call(StrictModel):
    name:str=Field(min_length=1,max_length=100)
    arguments:dict=Field(default_factory=dict)

def machine(request:Request):
    from .main import store
    try:return authenticate(store,request.headers.get('authorization','').removeprefix('Bearer '))
    except PermissionError:raise HTTPException(401,'Invalid agent credential') from None

def invoke(fn,*args):
    try:return fn(*args)
    except PermissionError as exc:raise HTTPException(403,str(exc)) from None
# Exactly LookupError, never its KeyError/IndexError subclasses: services raise the base
# class for a genuine miss, so catching subclasses turned an ordinary bug (a missing dict
# key, an off-by-one index) into a 404 that reads as normal operation and is never retried.
    except LookupError as exc:
        if type(exc) is not LookupError: raise
        raise HTTPException(404,'Agent resource not found') from None
    except ServiceError as exc:raise HTTPException(409,str(exc)) from None
    except ValueError as exc:raise HTTPException(422,str(exc)) from None

@router.get('/controller')
def controller(data=Depends(service)):return AgentService(data.store,data.oid).controller()
@router.post('/controller')
def control(body:Control,data=Depends(service)):return AgentService(data.store,data.oid).enable(body.enabled)
@router.get('/cases')
def cases(data=Depends(service)):return AgentService(data.store,data.oid).list_cases(Page())
@router.get('/tasks')
def tasks(data=Depends(service)):return AgentService(data.store,data.oid).list_tasks(Page())
@router.post('/investigations')
def investigate(body:Investigation,data=Depends(service)):
    return invoke(AgentService(data.store,data.oid).start_investigation,body)
@router.get('/tasks/{task_id}')
def task(task_id:str,data=Depends(service)):
    return invoke(AgentService(data.store,data.oid).get_task,task_id)
@router.get('/tool-definitions')
def definitions(identity=Depends(machine)):
    tools=data_tools.tool_definitions()+[{'name':name,'parameters':model.model_json_schema()} for name,model in MODELS.items()]
    if identity['role']=='worker':
        # One source of truth with _execute's enforcement; see WORKER_TOOLS.
        tools=[t for t in tools if t['name'] in WORKER_TOOLS]
    return {'identity':{k:v for k,v in identity.items() if k!='organization_id'},'tools':tools}
@router.post('/tools')
def call(body:Call,identity=Depends(machine)):
    from .main import store
    return invoke(execute,store,identity,body.name,body.arguments)
