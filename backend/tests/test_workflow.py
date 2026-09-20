"""Workflow facts must survive replay without claiming uncommitted financial work."""
import hashlib
import os
import sqlite3
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from app import auth, workflow
from app.database import (workflow_events, workflow_stream_heads, cfo_narrations,
                          organizations, memberships, make_engine)
from app.store import Store
from test_counterparty import world, tool
from test_simulator import setup
from test_elastic import flow


@pytest.fixture
def journal(tmp_path):
    store = Store(str(tmp_path / 'journal.db'))
    oid = store.workspace('alice')['id']
    return store, oid, workflow.WorkflowService(store, oid)


def append(db, oid, key, **kwargs):
    return workflow.emit(db, oid, key, 'work.started', workflow_id='invoice:INV-1',
                         facts={'invoiceId': 'INV-1'}, **kwargs)


def test_domain_rollback_and_idempotency_leave_no_sequence_holes(journal):
    store, oid, svc = journal
    with pytest.raises(RuntimeError):
        with store.engine.begin() as db:
            append(db, oid, 'rolled-back')
            raise RuntimeError('domain write failed')
    assert svc.feed()['events'] == []
    with store.engine.begin() as db:
        first = append(db, oid, 'first')
    with store.engine.begin() as db:
        assert append(db, oid, 'first') == first
        second = append(db, oid, 'second')
    assert [e['sequence'] for e in svc.feed()['events']] == [1, 2]
    assert second['sequence'] == 2
    assert first['narration']['textHash'] == hashlib.sha256(first['narration']['text'].encode()).hexdigest()
    with store.engine.connect() as db:
        assert len(db.execute(select(cfo_narrations)).all()) == 2


def test_closed_fact_vocabulary_and_truthful_templates(journal):
    store, oid, _ = journal
    for facts in ({'expected_net_cents': 100}, {'rawArguments': 'secret'}, {'invoiceId': 1}):
        with pytest.raises(ValueError), store.engine.begin() as db:
            workflow.emit(db, oid, 'bad', 'work.started', workflow_id='x', facts=facts)
    with store.engine.begin() as db:
        queued = workflow.emit(db, oid, 'q', 'handoff.queued', workflow_id='task:1', recipient='devin')
        accepted = workflow.emit(db, oid, 'a', 'handoff.accepted', workflow_id='task:1', recipient='devin')
        decision = workflow.emit(db, oid, 'd', 'approval.recorded', workflow_id='invoice:1',
            facts={'invoiceId': 'INV-1', 'proposalId': 'p1', 'proposalHash': 'h', 'decision': 'APPROVED'}, simulated=True)
    assert 'not accepted' in queued['narration']['text']
    assert 'Devin accepted' in accepted['narration']['text']
    # The disclosure is a flag on the event, not a prefix repeated in every spoken sentence.
    assert decision['simulated'] is True and not decision['narration']['text'].startswith('In the simulation')
    assert 'paid' not in decision['narration']['text'] and 'sent' not in decision['narration']['text']
    assert 'approved' in decision['narration']['text']


def test_cursors_snapshot_boundary_gap_and_tenant_isolation(journal):
    store, oid, svc = journal
    other = store.workspace('bob')['id']
    with store.engine.begin() as db:
        first = append(db, oid, 'first')
        append(db, other, 'private')
    snapshot = svc.snapshot()
    with store.engine.begin() as db:
        append(db, oid, 'second')
        append(db, oid, 'third')
    page = svc.feed(snapshot['next_after'], 1)
    assert snapshot['historical'] and snapshot['watermark'] == 1
    assert [e['eventKey'] for e in page['events']] == ['second'] and page['has_more']
    assert svc.feed(page['next_after'])['events'][0]['eventKey'] == 'third'
    history = svc.history(limit=1)
    assert history['historical'] and history['events'][0]['eventKey'] == 'third'
    assert svc.history(before=history['next_before'])['events'][-1]['eventKey'] == 'second'
    with pytest.raises(LookupError):
        workflow.get_event(store.engine, other, first['id'])
    assert svc.feed(900)['gap']
    with store.engine.begin() as db:
        db.execute(delete(cfo_narrations).where(cfo_narrations.c.event_id == first['id']))
        db.execute(delete(workflow_events).where(workflow_events.c.id == first['id']))
    assert svc.feed(0)['gap']


def test_expiry_and_supersession_are_rechecked(journal, monkeypatch):
    store, oid, _ = journal
    monkeypatch.setattr(workflow, 'now', lambda: 1000)
    with store.engine.begin() as db:
        first = append(db, oid, 'first')
    assert workflow.relevance(store.engine, oid, first['id'])['relevant']
    with store.engine.begin() as db:
        second = append(db, oid, 'second')
    assert workflow.relevance(store.engine, oid, first['id'])['reason'] == 'superseded'
    monkeypatch.setattr(workflow, 'now', lambda: 16_000)
    assert workflow.relevance(store.engine, oid, second['id'])['reason'] == 'expired'


def test_authorized_feed_does_not_accept_client_workspace(journal, monkeypatch):
    from app import main, workflow_api
    store, oid, _ = journal
    with store.engine.begin() as db:
        append(db, oid, 'private')
    monkeypatch.setattr(main, 'store', store)
    app = FastAPI()
    app.include_router(workflow_api.router)
    app.dependency_overrides[auth.current_user] = lambda: auth.Identity('bob', 9999999999)
    client = TestClient(app)
    assert client.get('/workflow/events', params={'organization_id': oid}).json()['events'] == []
    app.dependency_overrides[auth.current_user] = lambda: auth.Identity('alice', 9999999999)
    assert client.get('/workflow/events').json()['events'][0]['eventKey'] == 'private'
    with store.engine.begin() as db:
        db.execute(delete(memberships).where(memberships.c.user_id == 'alice'))
    assert client.get('/workflow/snapshot').status_code == 403
    app.dependency_overrides.clear()
    assert client.get('/workflow/events').status_code == 401


def test_real_ap_start_precedes_model_and_failure_is_recorded(world):
    from app import auto_agent
    store, oid, factory, counterparty = world
    counterparty.spawn('clean', 'owner', seed=1)
    svc = workflow.WorkflowService(store, oid)
    def failed_model(_):
        assert svc.feed()['events'][-1]['kind'] == 'work.started'
        raise TimeoutError('provider unavailable')
    with pytest.raises(TimeoutError):
        auto_agent.run_once(store, factory, llm=failed_model)
    kinds = [e['kind'] for e in svc.feed()['events']]
    assert kinds == ['invoice.received', 'work.started', 'work.failed']
    assert all(e['simulated'] for e in svc.feed()['events'])


def test_additive_concern_migration_preserves_old_rows_and_is_repeatable(tmp_path):
    from app.database import concerns, initialize
    path = str(tmp_path / 'legacy.db')
    with sqlite3.connect(path) as db:
        db.execute('''CREATE TABLE concerns (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
            request_key TEXT NOT NULL, request JSON NOT NULL, status TEXT NOT NULL, card JSON,
            decision JSON, resolution JSON, claim_token TEXT, lease_until BIGINT NOT NULL DEFAULT 0,
            created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)''')
        db.execute("INSERT INTO concerns (id,organization_id,request_key,request,status,created_at,updated_at) VALUES ('old','org','old','{}','awaiting_response',1,1)")
    store = Store(path)
    initialize(store.engine)
    with store.engine.connect() as db:
        old = db.execute(select(concerns).where(concerns.c.id == 'old')).mappings().one()
    assert old['status'] == 'awaiting_response'
    assert old['card_revision'] == 0 and old['decision_revision'] == 0
    assert old['evidence_snapshot'] == [] and old['latest_job_id'] is None


def test_real_proposal_approval_and_staleness(world):
    from app.accounting import Accounting, Approval
    store, oid, _, counterparty = world
    scenario = counterparty.spawn('clean', 'owner', seed=1)
    svc = Accounting(store, oid)
    case = svc.execute('open_payable_case', {'invoice_id': scenario['invoice_id']})['case']
    result = svc.execute('prepare_payable_proposal', {'case_id': case['case_id'], 'based_on_revision': case['revision']})
    event = workflow.WorkflowService(store, oid).feed()['events'][-1]
    assert event['kind'] == 'proposal.prepared'
    assert workflow.relevance(store.engine, oid, event['id'])['relevant']
    prop = result['proposal']
    svc.approve(Approval(proposal_id=prop['proposal_id'], proposal_hash=prop['hash'], decision='APPROVED'), 'alice')
    assert workflow.relevance(store.engine, oid, event['id'])['reason'] == 'superseded'
    latest = workflow.WorkflowService(store, oid).feed()['events'][-1]
    assert latest['kind'] == 'approval.recorded' and latest['facts']['decision'] == 'APPROVED'
    assert svc.list_proposals()['proposals'][0]['status'] == 'DRAFT'
    assert svc.list_proposals()['proposals'][0]['approval']['status'] == 'APPROVED'


def test_devin_actual_dispatch_is_distinct_from_queued_and_unknown(setup, monkeypatch):
    from app.orchestrator import AgentService, PutCase, Delegate, Report
    from app.devin_worker import run_once
    from test_orchestrator import Provider, due
    store, a, _, _, _ = setup
    monkeypatch.setenv('AGENT_PUBLIC_BASE_URL', 'https://example.test')
    monkeypatch.setenv('DEVIN_COORDINATOR_ENABLED', 'false')
    svc = AgentService(store, a.oid)
    svc.enable(True)
    case = svc.put_case(PutCase(case_key='invoice', title='Review invoice', expected_version=0, state={}))
    task = svc.delegate(Delegate(case_id=case['id'], request_key='once', objective='Review the evidence'))
    provider = Provider()
    provider.timeout = True
    journal = workflow.WorkflowService(store, a.oid)
    assert [e['kind'] for e in journal.feed()['events']] == ['handoff.queued']
    run_once(store, provider)
    assert [e['kind'] for e in journal.feed()['events']] == ['handoff.queued', 'dispatch.unknown']
    due(store, a.oid)
    run_once(store, provider)
    assert len(provider.created) == 1, 'uncertain dispatch reconciles the existing provider session'
    assert journal.feed()['events'][-1]['kind'] == 'handoff.accepted'
    assert journal.feed()['events'][-1]['recipient']['id'] == 'devin'
    svc.report(Report(task_id=task['id'], outcome='needs_input', summary='The source is missing.'))
    assert journal.feed()['events'][-1]['kind'] == 'execution.needs_input'


@pytest.mark.parametrize('uncertain', [False, True])
def test_elastic_journal_uses_provider_acceptance_not_queue_as_started(flow, uncertain):
    from app.elastic_investigations import Investigate, run_once
    store, svc, _, factory, cloud, sid, _ = flow
    row = svc.create(Investigate(source_id=sid, request_key='journal-test'))
    journal = workflow.WorkflowService(store, svc.oid)
    assert [e['kind'] for e in journal.feed()['events']] == ['handoff.queued']
    cloud.fail = uncertain
    run_once(store, factory, cloud)
    last = journal.feed()['events'][-1]
    assert last['kind'] == ('dispatch.unknown' if uncertain else 'handoff.accepted')
    assert last['facts']['investigationId'] == row['id']
    assert 'credential' not in str(journal.feed())


@pytest.fixture
def postgres_journal():
    dsn = os.getenv('TEST_POSTGRES_URL')
    if not dsn:
        pytest.skip('Set TEST_POSTGRES_URL for committed-order PostgreSQL concurrency checks')
    base = make_engine(dsn)
    assert base.dialect.name == 'postgresql'
    schema = 'test_workflow_' + uuid.uuid4().hex
    with base.begin() as db:
        db.exec_driver_sql(f'CREATE SCHEMA {schema}')
    engine = base.execution_options(schema_translate_map={None: schema})
    tables = [organizations, workflow_stream_heads, workflow_events, cfo_narrations]
    try:
        for table in tables:
            table.create(engine)
        with engine.begin() as db:
            db.execute(organizations.insert().values(id='test-org', name='Workflow test'))
        yield engine, workflow.WorkflowService(SimpleNamespace(engine=engine), 'test-org')
    finally:
        for table in reversed(tables):
            table.drop(engine)
        with base.begin() as db:
            db.exec_driver_sql(f'DROP SCHEMA {schema}')
        base.dispose()


@pytest.mark.parametrize('rollback_first', [False, True])
def test_postgres_commit_order_never_skips_concurrent_event(postgres_journal, rollback_first):
    engine, svc = postgres_journal
    first_written, release, second_attempt = threading.Event(), threading.Event(), threading.Event()
    def first():
        with engine.connect() as db:
            tx = db.begin()
            append(db, 'test-org', 'first')
            first_written.set()
            assert release.wait(5)
            tx.rollback() if rollback_first else tx.commit()
    def second():
        assert first_written.wait(5)
        second_attempt.set()
        with engine.begin() as db:
            append(db, 'test-org', 'second')
    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = pool.submit(first), pool.submit(second)
        try:
            assert second_attempt.wait(5)
            snapshot = svc.snapshot()
            assert snapshot['watermark'] == 0 and snapshot['history'] == []
            assert not b.done(), 'later allocation must wait until earlier domain commit'
        finally:
            release.set()
        a.result(timeout=5)
        b.result(timeout=5)
    replay = svc.feed(snapshot['next_after'])
    assert [e['eventKey'] for e in replay['events']] == (['second'] if rollback_first else ['first', 'second'])
    assert [e['sequence'] for e in replay['events']] == list(range(1, len(replay['events']) + 1))


def test_postgres_lazy_stream_does_not_reverse_accounting_lock_order(postgres_journal):
    engine, svc = postgres_journal
    with engine.begin() as accounting:
        accounting.execute(select(organizations.c.id).where(organizations.c.id == 'test-org').with_for_update())
        def worker_event():
            with engine.begin() as db:
                return append(db, 'test-org', 'worker')
        with ThreadPoolExecutor(max_workers=1) as pool:
            event = pool.submit(worker_event).result(timeout=3)
        assert event['sequence'] == 1
        append(accounting, 'test-org', 'accounting')
    assert [e['sequence'] for e in svc.feed()['events']] == [1, 2]


# --- the CFO says what the grader found, why, and that a lesson was written ---------------------

def spoken(store, oid):
    with store.engine.connect() as db:
        return [n['text'] for n in db.execute(select(cfo_narrations.c.narration).where(cfo_narrations.c.organization_id == oid).order_by(cfo_narrations.c.id)).scalars()]


def test_a_wrong_release_is_narrated_as_an_audit_finding_with_its_reason(world):
    from test_counterparty import flush, propose
    store, oid, factory, svc = world
    scenario = svc.spawn('goods_returned', 'owner', seed=5)
    cid = tool(store, oid, 'open_payable_case', invoice_id=scenario['invoice_id'])['case']['case_id']
    propose(store, oid, cid)
    assert [s['outcome'] for s in svc.score()] == ['fail']
    finding = next(t for t in spoken(store, oid) if 'Audit finding' in t)
    assert scenario['invoice_id'] in finding and 'should have been held' in finding and 'sending the whole delivery back' in finding
    assert finding.startswith('Audit finding') and len(finding) <= 240
    with store.engine.connect() as db:
        event = next(e for e in db.execute(select(workflow_events.c.event)).scalars() if e['kind'] == 'audit.finding')
    assert event['state'] == 'failed' and event['narration']['priority'] == 3 and event['facts'] == {'invoiceId': scenario['invoice_id'], 'outcome': 'fail', 'trap': 'goods_returned'}


def test_a_correct_hold_is_narrated_with_why_holding_was_right(world):
    from test_counterparty import flush, age
    store, oid, factory, svc = world
    scenario = svc.spawn('spoofed_release', 'owner', seed=2)
    tool(store, oid, 'request_internal_confirmation', invoice_id=scenario['invoice_id'], request='hold_status', message='Is the inspection hold on this invoice still in force?', request_key='h1')
    flush(store, factory); age(store, scenario['id'], 120_000)
    assert [s['outcome'] for s in svc.score()] == ['correct_hold']
    line = next(t for t in spoken(store, oid) if 'on hold was right' in t)
    assert 'Only the supplier claimed the hold was lifted' in line and len(line) <= 240


def test_the_kind_of_case_is_a_closed_list_and_every_sentence_fits_one_utterance():
    with pytest.raises(ValueError):
        workflow.Facts.model_validate({'invoiceId': 'INV-1', 'outcome': 'paid_anyway'})
    for trap in workflow.WHY:
        for kind, outcome in (('case.graded', 'pass'), ('case.graded', 'correct_hold'), ('audit.finding', 'fail'), ('audit.finding', 'timeout')):
            text = workflow.sentence({'kind': kind, 'facts': {'invoiceId': 'INV-0167', 'outcome': outcome, 'trap': trap}, 'actor': {'kind': 'engine', 'id': 'engine'}, 'simulated': True})
            assert len(text) <= 240, (trap, outcome, len(text))
    from app.counterparty import FAMILIES
    assert set(workflow.WHY) <= set(FAMILIES)


def test_an_unknown_kind_of_case_is_refused(world):
    store, oid, factory, svc = world
    with store.engine.begin() as db, pytest.raises(ValueError):
        workflow.emit(db, oid, 'k1', 'case.graded', workflow_id='invoice:INV-1', actor='engine', facts={'invoiceId': 'INV-1', 'outcome': 'pass', 'trap': 'whatever the model says'}, simulated=True)


def test_an_invoice_number_that_opens_a_sentence_keeps_its_capitals():
    say = lambda kind, **facts: workflow.sentence({'kind': kind, 'facts': facts, 'actor': {'kind': 'engine', 'id': 'engine'}, 'simulated': True})
    assert say('invoice.received', invoiceId='INV-0057').startswith('INV-0057 arrived')
    assert say('work.started', invoiceId='INV-0057').startswith('Accounts payable has started')


def test_stage_chatter_cannot_cut_off_a_milestone_and_milestones_are_spoken_first(world):
    store, oid, factory, svc = world
    say = lambda key, kind, **facts: workflow.emit(db, oid, key, kind, workflow_id='invoice:INV-9', facts={'invoiceId': 'INV-9', **facts}, simulated=True)['narration']
    with store.engine.begin() as db:
        asked = say('a', 'evidence.requested', party='supplier', requestCategory='price_correction')
        stage = say('b', 'work.stage', stage='checks')
        later = say('c', 'work.stage', stage='credit')
        held = say('d', 'work.held')
        graded = say('e', 'case.graded', outcome='correct_hold', trap='goods_returned')
    assert stage['supersessionKey'] == later['supersessionKey'], 'stages still replace each other'
    assert len({asked['supersessionKey'], held['supersessionKey'], graded['supersessionKey'], stage['supersessionKey']}) == 4, 'a stage shares a key with no milestone, so it cannot interrupt one'
    assert min(asked['priority'], held['priority'], graded['priority']) > stage['priority']
    assert graded['expiresAt'] - graded['createdAt'] > stage['expiresAt'] - stage['createdAt'], 'a verdict waits its turn, a stale stage is dropped'
