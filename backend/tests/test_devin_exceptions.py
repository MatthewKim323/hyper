"""Open sandbox exceptions become Devin investigations exactly once, and never flood the queue."""
import pytest
from sqlalchemy import select

from app import devin_exceptions
from app.counterparty import Counterparties
from app.data_service import DataService
from app.database import agent_cases as cases, agent_tasks
from app.store import Store


class Objects:
    def __init__(self): self.values = {}
    def put(self, key, body, content_type): self.values[key] = body
    def read(self, key): return self.values[key]


@pytest.fixture
def world(tmp_path):
    store = Store(str(tmp_path / 'bridge.db'))
    oid = store.workspace('alice')['id']
    return store, oid, Counterparties(DataService(store, oid, objects=Objects()))


def queued(store):
    with store.engine.connect() as db: return [dict(r) for r in db.execute(select(agent_tasks).order_by(agent_tasks.c.created_at)).mappings()]


def test_an_open_exception_is_queued_once_with_its_opening_documents(world):
    store, oid, svc = world
    scenario = svc.spawn('partial_correction', 'owner', seed=7)
    assert devin_exceptions.run_once(store) == 1
    assert devin_exceptions.run_once(store) == 0
    (task,) = queued(store)
    assert task['organization_id'] == oid and task['status'] == 'queued'
    assert scenario['invoice_id'] in task['objective'] and 'prepare_payable_proposal' in task['objective']
    with store.engine.connect() as db: state = db.execute(select(cases.c.state).where(cases.c.id == task['case_id'])).scalar()
    assert state['source_ids'], 'the session starts from the ERP documents that opened the exception'


def test_the_private_fact_sheet_never_reaches_the_task(world):
    store, _, svc = world
    svc.spawn('bank_change_attack', 'owner', seed=3)
    devin_exceptions.run_once(store)
    text = queued(store)[0]['objective']
    assert 'bank_change_attack' not in text and 'expected' not in text.lower()


def test_the_queue_is_bounded(world, monkeypatch):
    store, _, svc = world
    monkeypatch.setattr(devin_exceptions, 'MAX_PENDING', 2)
    for seed in range(4): svc.spawn('clean', 'owner', seed=seed)
    assert devin_exceptions.run_once(store) == 2
    assert len(queued(store)) == 2


def test_scored_exceptions_are_left_alone(world):
    store, _, svc = world
    svc.spawn('clean', 'owner', seed=1)
    from app.database import counterparty_scenarios
    from sqlalchemy import update
    with store.engine.begin() as db: db.execute(update(counterparty_scenarios).values(status='scored', outcome='timeout'))
    assert devin_exceptions.run_once(store) == 0
