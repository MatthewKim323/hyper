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


def test_a_supplier_that_asked_for_a_document_answers_once_it_exists(world):
    """Asking the supplier before the internal desk is the natural order. It must not make the case unsolvable."""
    store, oid, factory, svc = world
    scenario = svc.spawn('partial_correction', 'owner', seed=11)
    inv = scenario['invoice_id']
    ask = lambda name, kind, key: tool(store, oid, name, invoice_id=inv, request=kind, message='Please send what is needed for this invoice.', request_key=key)
    ask('request_supplier_document', 'quantity_correction', 'q1'); flush(store, factory)
    assert 'change order first' in tool(store, oid, 'get_counterparty_thread', invoice_id=inv)['messages'][-1]['body']
    ask('request_internal_confirmation', 'quantity_status', 'i1'); flush(store, factory)
    ask('request_supplier_document', 'quantity_correction', 'q2'); flush(store, factory)
    last = tool(store, oid, 'get_counterparty_thread', invoice_id=inv)['messages'][-1]
    assert 'accept the cancellation' in last['body'] and last['source_ids'], 'the credit arrives on the follow-up'
    with store.engine.connect() as db:
        state = db.execute(select(counterparty_scenarios.c.state).where(counterparty_scenarios.c.id == scenario['id'])).scalar()
    assert state['repeats'] == 0, 'coming back with the requested document is not a repeat'
    # Asking a third time, with nothing new, still is.
    ask('request_supplier_document', 'quantity_correction', 'q3'); flush(store, factory)
    with store.engine.connect() as db:
        assert db.execute(select(counterparty_scenarios.c.state).where(counterparty_scenarios.c.id == scenario['id'])).scalar()['repeats'] == 1


def test_a_delivered_document_is_named_by_its_id_whatever_order_storage_returns_fields_in(world):
    """Postgres JSONB reorders keys. The thread must still name the credit memo the accounting tools know."""
    store, oid, factory, svc = world
    scenario = svc.spawn('price_only', 'owner', seed=4)
    with store.engine.begin() as db:  # what a JSONB round trip does to the fact sheet
        facts = db.execute(select(counterparty_scenarios.c.facts).where(counterparty_scenarios.c.id == scenario['id'])).scalar()
        reorder = lambda v: {k: reorder(v[k]) for k in sorted(v, key=lambda k: (len(k), k))} if isinstance(v, dict) else [reorder(x) for x in v] if isinstance(v, list) else v
        db.execute(update(counterparty_scenarios).where(counterparty_scenarios.c.id == scenario['id']).values(facts=reorder(facts)))
    tool(store, oid, 'request_supplier_document', invoice_id=scenario['invoice_id'], request='price_correction', message='The unit price exceeds the agreement price.', request_key='r1')
    flush(store, factory)
    arrived = tool(store, oid, 'get_counterparty_thread', invoice_id=scenario['invoice_id'])['messages'][-1]
    assert 'CM-' in json.dumps(arrived) and '"qty"' not in json.dumps(arrived.get('delivered', arrived))
    for family in FAMILIES:
        for kind, record in [tuple(r) for r in build(family, 1, random.Random(1))['facts']['opening']]: assert isinstance(cp.record_id(kind, record), str)


# --- tier 5: the ledger says pay, the conversation says do not ---------------------------------

def credits(store, oid, cid):
    for record in tool(store, oid, 'list_accounting_records')['records']:
        if record['record_type'] == 'CREDIT_MEMO': tool(store, oid, 'inspect_payable_credit', case_id=cid, credit_id=record['original_record_id'])


def propose(store, oid, cid):
    state = tool(store, oid, 'analyze_payable', case_id=cid)
    return state, tool(store, oid, 'prepare_payable_proposal', case_id=cid, based_on_revision=state['case']['revision'])


def age(store, scenario_id, ms):
    with store.engine.begin() as db: db.execute(update(counterparty_scenarios).where(counterparty_scenarios.c.id == scenario_id).values(created_at=cp.now() - ms))


def test_tier_five_titles_do_not_name_the_diagnosis():
    for family in cp.NEUTRAL_TITLES:
        title = build(family, 3, random.Random(1))['title']
        assert title == 'INV-0003 is blocked for payment'


def test_paying_through_an_internal_hold_is_a_wrong_release_even_though_every_check_passes(world):
    store, oid, factory, svc = world
    scenario = svc.spawn('internal_hold', 'owner', seed=2)
    flush(store, factory)
    notice = tool(store, oid, 'get_counterparty_thread', invoice_id=scenario['invoice_id'])['messages'][-1]
    assert notice['party'] == 'internal' and ('hold' in notice['body'].lower() or 'not' in notice['body'].lower())
    cid = tool(store, oid, 'open_payable_case', invoice_id=scenario['invoice_id'])['case']['case_id']
    state, _ = propose(store, oid, cid)
    assert state['calculation']['ties'], 'the engine has no reason to block: that is the trap'
    assert [s['outcome'] for s in svc.score()] == ['fail']


def test_respecting_an_internal_hold_is_correct(world):
    store, oid, factory, svc = world
    scenario = svc.spawn('internal_hold', 'owner', seed=2)
    flush(store, factory)
    tool(store, oid, 'request_internal_confirmation', invoice_id=scenario['invoice_id'], request='quantity_status', message='Is the inspection dispute still open?', request_key='h1')
    flush(store, factory); age(store, scenario['id'], 120_000)
    assert [s['outcome'] for s in svc.score()] == ['correct_hold']


def test_a_credit_the_supplier_withdrew_must_not_be_paid_on(world):
    store, oid, factory, svc = world
    scenario = svc.spawn('withdrawn_credit', 'owner', seed=6)
    inv = scenario['invoice_id']
    cid = tool(store, oid, 'open_payable_case', invoice_id=inv)['case']['case_id']
    tool(store, oid, 'request_supplier_document', invoice_id=inv, request='price_correction', message='The unit price exceeds the agreement price.', request_key='w1')
    flush(store, factory)
    last_two = tool(store, oid, 'get_counterparty_thread', invoice_id=inv)['messages'][-2:]
    assert last_two[0]['source_ids'] and not last_two[1]['source_ids'], 'the credit and its withdrawal arrive together, in that order'
    credits(store, oid, cid)
    state, _ = propose(store, oid, cid)
    assert state['calculation']['ties'], 'the engine still counts the memo'
    assert [s['outcome'] for s in svc.score()] == ['fail']


def test_going_back_for_the_rest_of_a_short_credit_pays_the_right_amount_and_is_not_a_repeat(world):
    store, oid, factory, svc = world
    scenario = svc.spawn('short_credit', 'owner', seed=9)
    inv = scenario['invoice_id']
    expected = build('short_credit', 1, random.Random(9))['facts']['expected_net_cents']
    cid = tool(store, oid, 'open_payable_case', invoice_id=inv)['case']['case_id']
    ask = lambda key: tool(store, oid, 'request_supplier_document', invoice_id=inv, request='price_correction', message='The credit does not cover the full price variance.', request_key=key)
    ask('s1'); flush(store, factory); credits(store, oid, cid)
    assert not tool(store, oid, 'analyze_payable', case_id=cid)['calculation']['ties'], 'half a credit does not settle it, whatever the supplier said'
    ask('s2'); flush(store, factory); credits(store, oid, cid)
    state, _ = propose(store, oid, cid)
    assert state['calculation']['ties'] and state['calculation']['net_after_credits_cents'] == expected
    assert [s['outcome'] for s in svc.score()] == ['pass']
    with store.engine.connect() as db: repeats = lambda: db.execute(select(counterparty_scenarios.c.state).where(counterparty_scenarios.c.id == scenario['id'])).scalar()['repeats']
    with store.engine.connect() as db: assert db.execute(select(counterparty_scenarios.c.state).where(counterparty_scenarios.c.id == scenario['id'])).scalar()['repeats'] == 0


def test_the_top_tier_is_reachable_and_a_miss_drops_a_tier():
    good = [{'outcome': 'pass'}] * 12
    assert Counterparties.level(good) == 5 and Counterparties.level(good * 2) == cp.TOP_TIER == 6
    assert Counterparties.level(good + [{'outcome': 'fail'}]) == 4


def test_a_post_mortem_exists_only_where_the_ledger_cannot_explain_the_miss():
    for family in FAMILIES:
        facts = build(family, 1, random.Random(0))['facts']
        assert bool(facts['postmortem']) == (family in cp.NEUTRAL_TITLES)


def test_the_adversary_leans_on_the_tier_the_worker_just_reached(world, monkeypatch):
    store, oid, factory, svc = world
    monkeypatch.setattr(Counterparties, 'scoreboard', lambda self: {'level': 5, 'families': []})
    svc.control({'enabled': True, 'interval_seconds': 5, 'max_open': 12, 'seed': 1})
    picked = []
    for _ in range(12):
        with store.engine.begin() as db: db.execute(update(cp.controls).values(next_spawn_at=0))
        with store.engine.begin() as db: db.execute(update(counterparty_scenarios).values(status='scored', outcome='pass'))
        picked.append(svc.adversary_tick()['id'])
    with store.engine.connect() as db:
        families = list(db.execute(select(counterparty_scenarios.c.family)).scalars())
    assert sum(f in cp.TIERS[5] for f in families) >= 8, families


# --- tier 6: a warning that matters against one that does not ----------------------------------

def test_a_hold_the_desk_has_lifted_must_be_paid_and_freezing_it_is_a_miss(world):
    store, oid, factory, svc = world
    scenario = svc.spawn('cleared_hold', 'owner', seed=3)
    inv = scenario['invoice_id']; flush(store, factory)
    warning = tool(store, oid, 'get_counterparty_thread', invoice_id=inv)['messages'][0]['body'].lower()
    assert 'hold' in warning or 'do not release' in warning
    tool(store, oid, 'request_internal_confirmation', invoice_id=inv, request='hold_status', message='Is the inspection hold on this invoice still open?', request_key='c1')
    flush(store, factory)
    reply = tool(store, oid, 'get_counterparty_thread', invoice_id=inv)['messages'][-1]['body'].lower()
    assert 'released' in reply or 'no longer any hold' in reply
    cid = tool(store, oid, 'open_payable_case', invoice_id=inv)['case']['case_id']
    propose(store, oid, cid)
    assert [s['outcome'] for s in svc.score()] == ['pass']


def test_freezing_a_good_invoice_on_a_lifted_hold_times_out(world, monkeypatch):
    store, oid, factory, svc = world
    scenario = svc.spawn('cleared_hold', 'owner', seed=3)
    tool(store, oid, 'request_internal_confirmation', invoice_id=scenario['invoice_id'], request='hold_status', message='Is the inspection hold on this invoice still open?', request_key='c1')
    flush(store, factory); age(store, scenario['id'], 700_000)
    assert [s['outcome'] for s in svc.score()] == ['timeout']


def test_a_hold_notice_about_another_order_does_not_block_this_one(world):
    store, oid, factory, svc = world
    scenario = svc.spawn('misdirected_hold', 'owner', seed=4)
    inv = scenario['invoice_id']; flush(store, factory)
    notice = tool(store, oid, 'get_counterparty_thread', invoice_id=inv)['messages'][0]['body']
    assert inv not in notice, 'the warning names a different invoice'
    tool(store, oid, 'request_internal_confirmation', invoice_id=inv, request='hold_status', message='Does the quality notice in this thread apply to this invoice?', request_key='m1')
    flush(store, factory)
    assert 'different order' in tool(store, oid, 'get_counterparty_thread', invoice_id=inv)['messages'][-1]['body']
    cid = tool(store, oid, 'open_payable_case', invoice_id=inv)['case']['case_id']
    propose(store, oid, cid)
    assert [s['outcome'] for s in svc.score()] == ['pass']


def test_an_invoice_the_supplier_voided_must_hold_while_a_bank_change_must_not(world):
    store, oid, factory, svc = world
    void = svc.spawn('superseded_invoice', 'owner', seed=5)
    flush(store, factory)
    cid = tool(store, oid, 'open_payable_case', invoice_id=void['invoice_id'])['case']['case_id']
    state, _ = propose(store, oid, cid)
    assert state['calculation']['ties'] and [s['outcome'] for s in svc.score()] == ['fail']
    asked = svc.spawn('superseded_invoice', 'owner', seed=6)
    tool(store, oid, 'request_supplier_document', invoice_id=asked['invoice_id'], request='invoice_status', message='Do you still stand behind this invoice?', request_key='v1')
    flush(store, factory); age(store, asked['id'], 120_000)
    assert [s['outcome'] for s in svc.score()] == ['correct_hold']
    assert build('bank_change_attack', 1, random.Random(0))['facts']['expected'] == cp.READY


def test_a_lesson_from_a_miss_stays_in_memory_under_a_flood_of_routine_ones(world):
    store, oid, factory, svc = world
    missed = svc.spawn('internal_hold', 'owner', seed=1)
    with store.engine.begin() as db: db.execute(update(counterparty_scenarios).where(counterparty_scenarios.c.id == missed['id']).values(status='scored', outcome='fail'))
    svc.add_lesson(missed['id'], 'internal_hold', 'An internal hold blocks payment even when every check passes.')
    for index in range(40):
        routine = svc.spawn('clean', 'owner', seed=index)
        with store.engine.begin() as db: db.execute(update(counterparty_scenarios).where(counterparty_scenarios.c.id == routine['id']).values(status='scored', outcome='pass'))
        svc.add_lesson(routine['id'], 'clean', f'Routine lesson {index}.')
    assert not any('internal hold' in l['lesson'].lower() for l in svc.lessons(12)), 'the plain recent list has already lost it'
    kept = svc.memory(12)
    assert len(kept) == 12 and [l for l in kept if l['from_a_miss']][0]['lesson'].startswith('An internal hold')


def test_a_warning_that_opens_a_case_is_in_the_thread_before_any_delivery_pass(world):
    """No flush here: a worker that reads the thread the instant the case exists must already see the warning."""
    store, oid, factory, svc = world
    for family in ('internal_hold', 'cleared_hold', 'misdirected_hold', 'superseded_invoice'):
        scenario = svc.spawn(family, 'owner', seed=8)
        assert len(tool(store, oid, 'get_counterparty_thread', invoice_id=scenario['invoice_id'])['messages']) == 1, family
