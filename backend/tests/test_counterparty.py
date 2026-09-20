"""The counterparties answer from private facts, and the engine, not the conversation, decides release."""
import json
import random
import time

import pytest
from sqlalchemy import update

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
