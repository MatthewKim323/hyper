"""The counterparties answer from private facts, and the engine, not the conversation, decides release."""
import json
import os
import random
import time
from contextlib import nullcontext
from types import SimpleNamespace

import pytest
from sqlalchemy import event, select, update
from sqlalchemy.dialects import postgresql

from app import counterparty as cp, data_tools
from app.counterparty import Counterparties, FAMILIES, build
from app.counterparty_worker import run_once
from app.data_service import DataService
from app.database import counterparty_messages, counterparty_scenarios
from app.store import Store


class Objects:
    def __init__(self): self.values = {}
    def put(self, key, body, content_type): self.values[key] = body
    def read(self, key): return self.values[key]


@pytest.fixture
def world(tmp_path, monkeypatch):
    store = Store(str(tmp_path / 'cp.db'))
    objects = Objects()
    factory = lambda oid: DataService(store, oid, objects=objects)
    monkeypatch.setattr(data_tools, 'DataService', lambda s, oid, search=None: factory(oid))
    oid = store.workspace('alice')['id']
    return store, oid, factory, Counterparties(factory(oid))


def tool(store, oid, name, **args): return data_tools.execute(store, oid, name, args)

def flush(store, factory):
    """Make every scheduled reply due, then let the worker deliver."""
    with store.engine.begin() as db:
        db.execute(update(counterparty_messages).where(counterparty_messages.c.status == 'scheduled').values(deliver_at=0))
    run_once(store, factory)


def test_every_family_builds_valid_records():
    for index, family in enumerate(FAMILIES):
        built = build(family, index + 1, random.Random(index))
        assert built['facts']['expected'] in (cp.READY, cp.HOLD)
        assert (built['facts']['expected_net_cents'] is None) == (built['facts']['expected'] == cp.HOLD)
        assert len(built['facts']['opening']) == 5


def test_public_views_never_carry_the_fact_sheet(world):
    store, oid, factory, svc = world
    svc.spawn('partial_correction', 'owner', seed=3)
    blob = json.dumps([svc.list(), tool(store, oid, 'list_open_exceptions')])
    for secret in ('expected', 'facts', 'partial_correction', 'expected_net_cents'):
        assert secret not in blob


def test_first_credit_does_not_release_and_the_follow_up_does(world):
    store, oid, factory, svc = world
    scenario = svc.spawn('partial_correction', 'owner', seed=3)
    inv = scenario['invoice_id']
    expected = build('partial_correction', 1, random.Random(3))['facts']['expected_net_cents']
    case = tool(store, oid, 'open_payable_case', invoice_id=inv)
    cid = case['case']['case_id']
    assert {i['type'] for i in case['issues']} == {'PRICE_VARIANCE', 'QUANTITY_VARIANCE'}

    tool(store, oid, 'request_supplier_document', invoice_id=inv, request='price_correction', message='The unit price exceeds the agreement price.', request_key='r1')
    flush(store, factory)
    reply = tool(store, oid, 'get_counterparty_thread', invoice_id=inv)['messages'][-1]
    assert 'settle' in reply['body'] and reply['source_ids']            # the supplier claims it is done
    credits = [r for r in tool(store, oid, 'list_accounting_records')['records'] if r['record_type'] == 'CREDIT_MEMO']
    tool(store, oid, 'inspect_payable_credit', case_id=cid, credit_id=credits[0]['original_record_id'])
    state = tool(store, oid, 'analyze_payable', case_id=cid)
    assert not state['calculation']['ties']                              # the engine knows it is not
    draft = tool(store, oid, 'prepare_payable_proposal', case_id=cid, based_on_revision=state['case']['revision'])
    assert draft['approval'] is None and draft['validation']['verdict'] == 'FAIL'

    # The supplier will not credit a cancellation it has never been shown.
    tool(store, oid, 'request_supplier_document', invoice_id=inv, request='quantity_correction', message='Please credit the cancelled units.', request_key='r2')
    flush(store, factory)
    assert 'no record of any cancellation' in tool(store, oid, 'get_counterparty_thread', invoice_id=inv)['messages'][-1]['body']


def test_full_path_reaches_the_expected_amount_and_is_scored(world):
    store, oid, factory, svc = world
    inv = svc.spawn('partial_correction', 'owner', seed=3)['invoice_id']
    expected = build('partial_correction', 1, random.Random(3))['facts']['expected_net_cents']
    cid = tool(store, oid, 'open_payable_case', invoice_id=inv)['case']['case_id']
    tool(store, oid, 'request_internal_confirmation', invoice_id=inv, request='quantity_status', message='What happened to the unreceived units?', request_key='q1')
    tool(store, oid, 'request_supplier_document', invoice_id=inv, request='price_correction', message='The unit price exceeds the agreement price.', request_key='p1')
    flush(store, factory)
    tool(store, oid, 'request_supplier_document', invoice_id=inv, request='quantity_correction', message='Please accept the cancellation and credit the units.', request_key='p2')
    flush(store, factory)
    for record in tool(store, oid, 'list_accounting_records')['records']:
        if record['record_type'] == 'CREDIT_MEMO':
            tool(store, oid, 'inspect_payable_credit', case_id=cid, credit_id=record['original_record_id'])
    state = tool(store, oid, 'analyze_payable', case_id=cid)
    assert state['calculation']['ties'] and state['calculation']['net_after_credits_cents'] == expected
    draft = tool(store, oid, 'prepare_payable_proposal', case_id=cid, based_on_revision=state['case']['revision'])
    assert draft['approval']['status'] == 'PENDING' and draft['committed'] is False
    assert [s['outcome'] for s in svc.score()] == ['pass']
    assert svc.scoreboard()['correct'] == 1


def test_repeat_requests_are_counted_and_not_answered_twice(world):
    store, oid, factory, svc = world
    inv = svc.spawn('price_only', 'owner', seed=5)['invoice_id']
    first = tool(store, oid, 'request_supplier_document', invoice_id=inv, request='price_correction', message='Price exceeds agreement, please correct.', request_key='a')
    again = tool(store, oid, 'request_supplier_document', invoice_id=inv, request='price_correction', message='Price exceeds agreement, please correct.', request_key='a')
    assert again['status'] == 'already_sent' and again['message_id'] == first['message_id']
    tool(store, oid, 'request_supplier_document', invoice_id=inv, request='price_correction', message='Asking again for the same correction.', request_key='b')
    flush(store, factory)
    thread = tool(store, oid, 'get_counterparty_thread', invoice_id=inv)['messages']
    assert sum(1 for m in thread if m['direction'] == 'in') == 1
    assert svc.list()['scenarios'][0]['repeated_requests'] == 1


def test_doing_nothing_is_not_a_correct_hold(world):
    store, oid, factory, svc = world
    svc.spawn('silent_supplier', 'owner', seed=9)
    with store.engine.begin() as db:
        db.execute(update(counterparty_scenarios).values(created_at=0))
    assert [s['outcome'] for s in svc.score()] == ['timeout']           # nobody even asked the supplier
    inv = svc.spawn('silent_supplier', 'owner', seed=10)['invoice_id']
    tool(store, oid, 'request_supplier_document', invoice_id=inv, request='price_correction', message='Price exceeds agreement, please correct.', request_key='s1')
    with store.engine.begin() as db:
        db.execute(update(counterparty_scenarios).where(counterparty_scenarios.c.invoice_id == inv).values(created_at=cp.now() - 120000))
    assert [s['outcome'] for s in svc.score()] == ['correct_hold']      # asked, got silence, kept it blocked


def test_adversary_spawns_on_schedule_and_raises_difficulty(world):
    store, oid, factory, svc = world
    svc.control({'enabled': True, 'interval_seconds': 5, 'max_open': 2, 'next_spawn_at': 0})
    run_once(store, factory); run_once(store, factory)
    assert len(svc.list()['scenarios']) == 1                                # interval respected
    rows = [{'outcome': 'pass'}] * 3
    assert Counterparties.level(rows) == 2 and Counterparties.level(rows + [{'outcome': 'fail'}]) == 1


def test_worker_sessions_resume_on_replies_and_learn_after_grading(world):
    """A scripted model stands in for the provider: the loop, resumption and lesson plumbing are what is under test."""
    from app import auto_agent
    store, oid, factory, svc = world
    inv = svc.spawn('price_only', 'owner', seed=5)['invoice_id']
    script = iter([
        [('open_payable_case', {'invoice_id': inv})],
        [('request_supplier_document', {'invoice_id': inv, 'request': 'price_correction', 'message': 'Price exceeds agreement, please correct.', 'request_key': 'k1'})],
        'STATUS: WAITING asked the supplier for a price credit',
    ])
    def llm(payload):
        step = next(script)
        if isinstance(step, str): return {'choices': [{'message': {'role': 'assistant', 'content': step}}]}
        return {'choices': [{'message': {'role': 'assistant', 'content': '', 'tool_calls': [
            {'id': f'c{i}', 'type': 'function', 'function': {'name': n, 'arguments': json.dumps(a)}} for i, (n, a) in enumerate(step)]}}]}
    assert auto_agent.run_once(store, factory, llm) == 1
    agent = svc.list()['scenarios'][0]['agent']
    assert agent['status'] == 'WAITING' and [t.get('tool') for t in agent['trace'][:2]] == ['open_payable_case', 'request_supplier_document']
    assert auto_agent.run_once(store, factory, llm) == 0                 # nothing new arrived, so no second session and no model call
    flush(store, factory)
    script = iter(['STATUS: HOLD nothing further'])
    assert auto_agent.run_once(store, factory, llm) == 1                 # the reply woke it up


def test_worker_activity_is_visible_during_provider_calls_and_idle_after_success(world, monkeypatch):
    from app import auto_agent
    store, oid, factory, svc = world
    inv = svc.spawn('price_only', 'owner', seed=5)['invoice_id']
    assert svc.list()['scenarios'][0]['agent']['activity'] is None
    clock = [1_000_000]
    monkeypatch.setattr(auto_agent, 'now', lambda: clock[0])
    observed = []

    def llm(payload):
        # Read through another database connection, as the polling UI does while the model is busy.
        agent = svc.list()['scenarios'][0]['agent']
        activity = agent['activity']
        observed.append(activity)
        assert activity == {'status': 'running', 'started_at': 1_000_000, 'updated_at': clock[0],
                            'expires_at': clock[0] + auto_agent.ACTIVITY_TTL_MS, 'error': None}
        assert activity['expires_at'] - activity['updated_at'] > 180_000
        assert agent['sessions'] == 0 and agent['status'] is None and agent['trace'] == []
        if len(observed) == 1:
            clock[0] += 181_000
            return {'choices': [{'message': {'role': 'assistant', 'content': '', 'tool_calls': [
                {'id': 'thread', 'type': 'function', 'function': {'name': 'get_counterparty_thread',
                 'arguments': json.dumps({'invoice_id': inv})}}]}}]}
        clock[0] += 2_000
        return {'choices': [{'message': {'role': 'assistant', 'content': 'STATUS: WAITING awaiting supplier'}}]}

    assert auto_agent.run_once(store, factory, llm) == 1
    assert len(observed) == 2 and observed[1]['expires_at'] > observed[0]['expires_at']
    agent = svc.list()['scenarios'][0]['agent']
    assert agent['activity'] == {'status': 'idle', 'started_at': 1_000_000, 'updated_at': clock[0],
                                 'expires_at': None, 'error': None}
    assert agent['status'] == 'WAITING' and agent['sessions'] == 1
    assert agent['trace'][0]['tool'] == 'get_counterparty_thread'
    assert auto_agent.run_once(store, factory, llm) == 0
    assert svc.list()['scenarios'][0]['agent'] == agent


def test_worker_failure_clears_running_without_overwriting_session_history(world, monkeypatch):
    from app import auto_agent
    store, oid, factory, svc = world
    scenario = svc.spawn('price_only', 'owner', seed=5)
    prior = {'sessions': 2, 'seen': 0, 'status': 'HOLD', 'model': 'previous-model',
             'lessons_at_start': 3, 'trace': [{'at': 100, 'say': 'STATUS: HOLD waiting for evidence'}]}
    with store.engine.begin() as db:
        row = db.execute(select(counterparty_scenarios).where(counterparty_scenarios.c.id == scenario['id'])).mappings().one()
        before = {**row['state'], 'agent': prior}
        db.execute(update(counterparty_scenarios).where(counterparty_scenarios.c.id == scenario['id']).values(state=before))
        # A real incoming reply makes the previous HOLD eligible for the existing resumption rule.
        svc._message(db, row, 'in', 'supplier', 'price_correction', 'A new supplier reply.')
    clock = [2_000_000]
    monkeypatch.setattr(auto_agent, 'now', lambda: clock[0])

    def llm(payload):
        agent = svc.list()['scenarios'][0]['agent']
        assert agent['activity']['status'] == 'running'
        for key in ('sessions', 'status', 'model', 'lessons_at_start', 'trace'):
            assert agent[key] == prior[key]
        clock[0] += 180_000
        raise RuntimeError('provider rejected secret-token-and-private-response')

    with pytest.raises(RuntimeError, match='secret-token-and-private-response'):
        auto_agent.run_once(store, factory, llm)
    with store.engine.connect() as db:
        state = db.execute(select(counterparty_scenarios.c.state).where(counterparty_scenarios.c.id == scenario['id'])).scalar()
    assert {key: value for key, value in state['agent'].items() if key != 'activity'} == prior
    assert {key: value for key, value in state.items() if key != 'agent'} == {key: value for key, value in before.items() if key != 'agent'}
    assert state['agent']['activity'] == {'status': 'failed', 'started_at': 2_000_000, 'updated_at': clock[0],
                                         'expires_at': None, 'error': cp.AGENT_SESSION_ERROR}
    assert svc.list()['scenarios'][0]['agent']['activity'] == state['agent']['activity']
    assert 'secret-token' not in json.dumps(state)


def test_public_activity_preserves_expiry_and_sanitizes_failure_details(world):
    store, oid, factory, svc = world
    scenario = svc.spawn('price_only', 'owner', seed=5)
    with store.engine.begin() as db:
        row = dict(db.execute(select(counterparty_scenarios).where(counterparty_scenarios.c.id == scenario['id'])).mappings().one())
    activity = {'status': 'running', 'started_at': 1, 'updated_at': 2, 'expires_at': 300_002,
                'error': None, 'private_provider_payload': 'secret-provider-body'}
    row['state']['agent'] = {'activity': activity}
    public = cp.public(row)['agent']['activity']
    # Old timestamps remain explicit so clients can distinguish expired work from a live session.
    assert public == {key: value for key, value in activity.items() if key != 'private_provider_payload'}
    activity.update(status='failed', expires_at=None, error='secret-provider-error')
    public = cp.public(row)['agent']['activity']
    assert public['error'] == cp.AGENT_SESSION_ERROR and public['expires_at'] is None
    assert 'secret-provider' not in json.dumps(public)


def test_activity_update_preserves_reply_written_just_before_heartbeat(world):
    from app import auto_agent
    store, oid, factory, svc = world
    scenario = svc.spawn('price_only', 'owner', seed=5)
    with store.engine.connect() as db:
        before = db.execute(select(counterparty_scenarios.c.state).where(counterparty_scenarios.c.id == scenario['id'])).scalar()
    incoming = {**before, 'requests': 4, 'delivered': ['CREDIT_MEMO'],
                'agent': {'sessions': 2, 'status': 'WAITING', 'trace': [{'at': 10, 'say': 'Prior session'}]}}
    heartbeat_statements, delivered = [], False

    def deliver_before_update(connection, cursor, statement, parameters, context, executemany):
        nonlocal delivered
        if delivered: return
        heartbeat_statements.append(statement)
        if statement.startswith('UPDATE counterparty_scenarios'):
            delivered = True
            # Commit a reply on a second connection immediately before the heartbeat writes.
            with store.engine.begin() as reply_db:
                reply_db.execute(update(counterparty_scenarios).where(counterparty_scenarios.c.id == scenario['id']).values(state=incoming))

    event.listen(store.engine, 'before_cursor_execute', deliver_before_update)
    try:
        auto_agent.save_activity(store, scenario['id'], 'running', 1_000)
    finally:
        event.remove(store.engine, 'before_cursor_execute', deliver_before_update)
    assert delivered and len(heartbeat_statements) == 1
    with store.engine.connect() as db:
        after = db.execute(select(counterparty_scenarios.c.state).where(counterparty_scenarios.c.id == scenario['id'])).scalar()
    assert after['agent'].pop('activity')['status'] == 'running'
    assert after == incoming


def test_activity_update_compiles_to_atomic_postgres_jsonb_patch():
    from app import auto_agent
    statements = []
    db = SimpleNamespace(dialect=postgresql.psycopg.dialect(), execute=statements.append)
    store = SimpleNamespace(engine=SimpleNamespace(begin=lambda: nullcontext(db)))
    auto_agent.save_activity(store, 'scenario-123', 'running', 1_000)
    assert len(statements) == 1
    compiled = statements[0].compile(dialect=db.dialect)
    sql, params = str(compiled), compiled.params
    assert sql.startswith('UPDATE counterparty_scenarios SET state=jsonb_set(counterparty_scenarios.state,')
    assert 'coalesce((counterparty_scenarios.state -> ' in sql and ' || CAST(' in sql
    assert 'SELECT' not in sql and params['id_1'] == 'scenario-123'
    assert 'AS TEXT[]' in sql and ['agent'] in params.values() and params['state_1'] == 'agent'
    assert {} in params.values()
    patch = next(value for value in params.values() if isinstance(value, dict) and 'activity' in value)
    assert set(patch) == {'activity'} and patch['activity']['status'] == 'running'


@pytest.mark.parametrize('initial', [
    {'requests': 3, 'delivered': ['CREDIT_MEMO']},
    {'requests': 4, 'agent': {'sessions': 2, 'status': 'WAITING', 'trace': [{'at': 10, 'say': 'Prior session'}]}},
])
def test_activity_update_executes_on_postgres_without_overwriting_state(initial, monkeypatch):
    """Opt-in runtime check; a transaction-local table prevents changes to any real scenario."""
    from app import auto_agent
    from app.database import make_engine
    dsn = os.getenv('TEST_POSTGRES_URL')
    if not dsn: pytest.skip('Set TEST_POSTGRES_URL to run the PostgreSQL activity regression')
    engine = make_engine(dsn)
    assert engine.dialect.name == 'postgresql'
    monkeypatch.setattr(auto_agent, 'now', lambda: 2_000)
    try:
        with engine.connect() as db:
            transaction = db.begin()
            try:
                # The temporary table shadows the real table only on this connection.
                db.exec_driver_sql('CREATE TEMPORARY TABLE counterparty_scenarios (id text PRIMARY KEY, state jsonb NOT NULL) ON COMMIT DROP')
                db.execute(counterparty_scenarios.insert().values(id='activity-regression', state=initial))
                store = SimpleNamespace(engine=SimpleNamespace(begin=lambda: nullcontext(db)))
                for status in ('running', 'idle', 'failed'):
                    auto_agent.save_activity(store, 'activity-regression', status, 1_000)
                    observed = db.execute(select(counterparty_scenarios.c.state).where(counterparty_scenarios.c.id == 'activity-regression')).scalar_one()
                    activity = {'status': status, 'started_at': 1_000, 'updated_at': 2_000,
                                'expires_at': 2_000 + auto_agent.ACTIVITY_TTL_MS if status == 'running' else None,
                                'error': cp.AGENT_SESSION_ERROR if status == 'failed' else None}
                    assert observed == {**initial, 'agent': {**initial.get('agent', {}), 'activity': activity}}
            finally:
                transaction.rollback()
    finally:
        engine.dispose()
