import json
import os
from pathlib import Path
import httpx
from pydantic import BaseModel, Field

VISIBLE = Path(__file__).resolve().parents[2] / 'data/generated/visible'

class Fact(BaseModel):
    claim: str
    source: str
    kind: str = 'user_statement'

class Brief(BaseModel):
    company: str = ''
    objective: str = ''
    scope: str = ''
    success_criteria: str = ''
    facts: list[Fact] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    next_action: str = ''

async def evaluate(state):
    # Full transcript, never a lossy summary. If too large, fail closed rather than truncate.
    if len(json.dumps(state)) > 1_500_000:
        return {'status': 'unavailable', 'reason': 'Session exceeds evaluator context budget'}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.post(os.getenv('EVALUATOR_URL', 'http://127.0.0.1:8001') + '/evaluate', headers={'Authorization': 'Bearer ' + os.getenv('EVALUATOR_SECRET', '')}, json=state)
            res.raise_for_status()
            verdict = res.json()
        brief = state['context']
        gates = all(brief.get(k) for k in ('company', 'objective', 'scope', 'success_criteria', 'next_action'))
        ready = gates and verdict.get('ready') is True
        return {'status': 'ready' if ready else 'collecting', 'evaluation': verdict, 'revision': state['revision'], 'authority': 'read_only_investigation'}
    except (httpx.HTTPError, ValueError):
        return {'status': 'unavailable', 'reason': 'Readiness evaluator unavailable; no completion decision', 'revision': state['revision']}
