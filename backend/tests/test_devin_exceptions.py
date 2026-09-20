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
def world(tmp_path, monkeypatch):
    store = Store(str(tmp_path / 'bridge.db'))
    oid = store.workspace('alice')['id']
    objects = Objects()
    factory = lambda o: DataService(store, o, objects=objects)
    run = devin_exceptions.run_once
    monkeypatch.setattr(devin_exceptions, 'run_once', lambda s: run(s, factory))
    monkeypatch.delenv('DEVIN_CONTROL_PAIRS', raising=False)
    return store, oid, Counterparties(factory(oid))


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


def grade(store, scenario_id, outcome, summary):
    from app.database import counterparty_scenarios
    from sqlalchemy import update
    with store.engine.begin() as db:
        db.execute(update(counterparty_scenarios).where(counterparty_scenarios.c.id == scenario_id).values(status='scored', outcome=outcome, scored_at=1))
        db.execute(update(agent_tasks).values(status='complete', result={'outcome': 'complete', 'summary': summary, 'source_ids': []}))


def test_a_graded_case_becomes_one_lesson_that_the_next_task_reads(world):
    store, _, svc = world
    first = svc.spawn('claim_without_memo', 'owner', seed=1)
    devin_exceptions.run_once(store)
    grade(store, first['id'], 'fail', 'Supplier said a credit exists so I prepared the proposal.')
    devin_exceptions.run_once(store); devin_exceptions.run_once(store)
    (lesson,) = svc.lessons()
    assert 'graded WRONG' in lesson['lesson'] and 'Supplier said a credit exists' in lesson['lesson']
    svc.spawn('clean', 'owner', seed=2)
    devin_exceptions.run_once(store)
    assert 'graded WRONG' in queued(store)[-1]['objective']


def test_a_control_organization_mirrors_the_adversary_and_gets_no_memory(world, monkeypatch):
    store, oid, svc = world
    monkeypatch.setenv('DEVIN_CONTROL_PAIRS', oid + ':baseline')
    svc.add_lesson('scn_old', 'clean', 'Always inspect every credit memo.')
    svc.spawn('duplicate_credit', 'adversary', seed=5, difficulty=3)
    devin_exceptions.run_once(store); devin_exceptions.run_once(store)
    by_org = {t['organization_id']: t['objective'] for t in queued(store)}
    assert set(by_org) == {oid, 'baseline'}
    assert 'Always inspect every credit memo' in by_org[oid] and 'search_learned_skills for this kind' in by_org[oid]
    assert 'Always inspect' not in by_org['baseline'] and 'runs without memory' in by_org['baseline']
    from app.database import counterparty_scenarios
    with store.engine.connect() as db:
        twin = db.execute(select(counterparty_scenarios).where(counterparty_scenarios.c.organization_id == 'baseline')).mappings().all()
    assert [(t['family'], t['difficulty']) for t in twin] == [('duplicate_credit', 3)], 'mirrored once, same family and tier'


def test_cases_from_before_the_pair_existed_are_not_mirrored(world, monkeypatch):
    store, oid, svc = world
    for seed in range(3): svc.spawn('clean', 'adversary', seed=seed)
    monkeypatch.setenv('DEVIN_CONTROL_PAIRS', oid + ':baseline')
    monkeypatch.setattr(devin_exceptions, 'MAX_PENDING', 50)
    devin_exceptions.run_once(store); devin_exceptions.run_once(store)
    from app.database import counterparty_scenarios
    with store.engine.connect() as db:
        assert len(db.execute(select(counterparty_scenarios.c.id).where(counterparty_scenarios.c.organization_id == 'baseline')).all()) == 1


def test_sharded_workers_split_every_case_and_never_share_one(monkeypatch):
    from app import auto_agent
    ids = [f'scn_{i:032x}' for i in range(200)] + ['scn_5c938ee7e1824966', 'scn_cc888c03c3c849f7']
    owners = {}
    for k in range(4):
        monkeypatch.setenv('AUTO_AGENT_SHARD', f'{k}/4')
        for sid in ids:
            if auto_agent.owns(sid): owners.setdefault(sid, []).append(k)
    assert set(owners) == set(ids) and all(len(v) == 1 for v in owners.values())
    monkeypatch.delenv('AUTO_AGENT_SHARD')
    assert all(auto_agent.owns(sid) for sid in ids), 'unsharded, one worker owns everything'


def test_the_worker_may_bring_a_hold_to_the_owner_only_where_someone_is_there_and_the_queue_is_short(tmp_path, monkeypatch):
    from app import auto_agent
    from app.database import concerns
    store = Store(str(tmp_path / 'escalate.db'))
    oid = store.workspace('alice')['id']
    names = lambda on: {t['function']['name'] for t in auto_agent.tool_specs(on)}
    assert 'raise_concern' in names(True) and 'raise_concern' not in names(False)
    monkeypatch.setenv('AUTO_AGENT_CONCERN_ORGS', 'somewhere-else')
    assert not auto_agent.escalates(store, oid), 'a lab company has nobody to answer'
    monkeypatch.setenv('AUTO_AGENT_CONCERN_ORGS', oid)
    assert auto_agent.escalates(store, oid)
    with store.engine.begin() as db:
        for index in range(3):
            db.execute(concerns.insert().values(id=f'c{index}', organization_id=oid, request_key=f'k{index}', request={}, status='awaiting_response',
                       card_revision=0, decision_revision=0, evidence_snapshot=[], created_at=1, updated_at=1, lease_until=0))
    assert not auto_agent.escalates(store, oid), 'three decisions already waiting is enough'
