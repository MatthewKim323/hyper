"""Read-only knowledge graph routes. Organization scope comes from the signed-in user, never from the request."""
from fastapi import APIRouter, Depends
from .data_api import service, invoke
from .graph import Graph, EntityQuery, ExploreQuery, PathQuery, EntityEvidenceQuery

router = APIRouter(prefix='/graph', tags=['graph'])

def graph(data=Depends(service)): return Graph(data.engine, data.oid)

@router.get('/stats')
def stats(g=Depends(graph)): return invoke(g.stats)

@router.post('/entity')
def entity(body: EntityQuery, g=Depends(graph)): return invoke(g.card, body)

@router.post('/explore')
def explore(body: ExploreQuery, g=Depends(graph)): return invoke(g.explore, body)

@router.post('/path')
def path(body: PathQuery, g=Depends(graph)): return invoke(g.path, body)

@router.post('/evidence')
def evidence(body: EntityEvidenceQuery, g=Depends(graph)): return invoke(g.evidence, body)
