import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import delete, select, update
from app import concern_worker
from app.concerns import Conflict, DecisionChoice, DecisionCommand
from app.database import concern_decisions, concern_jobs, memberships, sources
from app.decision_intent import handle_user_decision, validate_context
from test_concerns import flow
from test_simulator import setup


def command(row, key='command-1', option='option_1', text=None):
    return DecisionCommand(commandId=key, concernId=row['id'],
        expectedDecisionRevision=row['decision_revision'], cardRevision=row['card_revision'],
        cardHash=row['card_hash'] or '', input='text' if option == 'custom' else 'click',
        choice=DecisionChoice(optionId=option, instruction=text))


def context(row):
    return {'concernId': row['id'], 'cardRevision': row['card_revision'], 'cardHash': row['card_hash'],
            'expectedDecisionRevision': row['decision_revision'], 'contextGeneration': 1}


def test_decision_retry_is_one_job_and_changed_payload_conflicts(flow):
    store, svc, _, args, _, _ = flow
    row = svc.raise_concern(args)
    cmd = command(row)
    first = svc.accept(cmd, 'alice')
    again = svc.accept(cmd, 'alice')
    assert first['decision_id'] == again['decision_id']
    assert first['job_id'] == again['job_id']
    with store.engine.connect() as db:
        assert len(db.execute(select(concern_decisions)).all()) == 1
        assert len(db.execute(select(concern_jobs)).all()) == 1
    with pytest.raises(Conflict):
        svc.accept(command(row, option='option_2'), 'alice')


def test_concurrent_commands_accept_exactly_one(flow):
    store, svc, _, args, _, _ = flow
    row = svc.raise_concern(args)
    def choose(number):
        try:
            return svc.accept(command(row, key=f'choice-{number}'), 'alice')
        except Conflict:
            return None
    with ThreadPoolExecutor(2) as pool:
        assert sum(bool(result) for result in pool.map(choose, range(2))) == 1
    with store.engine.connect() as db:
        assert len(db.execute(select(concern_jobs)).all()) == 1


def test_stale_card_and_changed_evidence_cannot_submit(flow):
    store, svc, _, args, _, _ = flow
    row = svc.raise_concern(args)
    current = svc.generate(row['id'])
    assert current['card_revision'] == row['card_revision'] + 1
    with pytest.raises(Conflict):
        svc.accept(command(row), 'alice')
    with store.engine.begin() as db:
        db.execute(update(sources).where(sources.c.id == args.source_ids[0]).values(active=False))
    with pytest.raises(Conflict):
        svc.accept(command(current), 'alice')


def test_unauthorized_member_cannot_select_or_forge_completion(flow):
    store, svc, _, args, _, _ = flow
    row = svc.raise_concern(args)
    with pytest.raises(PermissionError):
        svc.accept(command(row), 'bob')
    accepted = svc.accept(command(row), 'alice')
    with pytest.raises(PermissionError):
        svc.claim(row['id'])
    with store.engine.begin() as db:
        db.execute(delete(memberships).where(memberships.c.user_id == 'alice'))
    assert concern_worker.claim(store) is None
    assert svc.job(row['id'], accepted['job_id'])['status'] == 'failed'


def test_custom_input_works_when_jev_is_unavailable(flow, monkeypatch):
    _, svc, _, args, _, _ = flow
    import httpx
    class Failed:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, *args, **kwargs): raise httpx.ConnectError('unavailable')
    monkeypatch.setattr(httpx, 'Client', lambda **kw: Failed())
    row = svc.raise_concern(args)
    assert row['status'] == 'card_failed'
    accepted = svc.accept(command(row, option='custom', text='Compare the contract first.'), 'alice')
    assert accepted['status'] == 'queued'
    assert accepted['concern']['decision']['instruction'] == 'Compare the contract first.'


@pytest.mark.parametrize('text', ['what would option two do?', 'can you explain option one', 'tell me about option two'])
def test_voice_questions_never_submit(flow, text):
    _, svc, _, args, _, _ = flow
    row = svc.raise_concern(args)
    assert handle_user_decision(svc, text, 'turn-1', context(row), 'alice') is None
    assert svc.get(row['id'])['status'] == 'awaiting_response'


@pytest.mark.parametrize('text', ['do not do option two', 'choose option one or option two'])
def test_ambiguous_or_negative_voice_does_not_submit(flow, text):
    _, svc, _, args, _, _ = flow
    row = svc.raise_concern(args)
    assert handle_user_decision(svc, text, 'turn-1', context(row), 'alice')['status'] == 'clarify'
    assert svc.get(row['id'])['status'] == 'awaiting_response'


def test_pinned_voice_choice_is_idempotent_and_typed_channel_preserved(flow):
    _, svc, _, args, _, _ = flow
    row = svc.raise_concern(args)
    first = handle_user_decision(svc, 'go with option two', 'turn-2', context(row), 'alice')
    again = handle_user_decision(svc, 'go with option two', 'turn-2', context(row), 'alice')
    assert first['job_id'] == again['job_id']
    assert first['concern']['decision']['option_id'] == 'option_2'
    assert validate_context(context(row)) == context(row)
    with pytest.raises(ValueError):
        validate_context({**context(row), 'contextGeneration': True})


def test_custom_turn_preserves_restrictions(flow):
    _, svc, _, args, _, _ = flow
    row = svc.raise_concern(args)
    receipt = handle_user_decision(svc, 'please compare the contract but do not contact the supplier',
                                  'turn-3', context(row), 'alice', input_channel='text')
    decision = receipt['concern']['decision']
    assert decision['input'] == 'text'
    assert 'do not contact' in decision['instruction']


def queued(flow):
    store, svc, _, args, _, factory = flow
    row = svc.raise_concern(args)
    receipt = svc.accept(command(row), 'alice')
    return store, svc, row, receipt, args, factory


def test_worker_records_actual_receipt_and_cited_completion(flow):
    store, svc, row, accepted, args, factory = queued(flow)
    call_count = 0
    def llm(payload):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            name, values = 'get_source', {'source_id': args.source_ids[0]}
        else:
            result = json.loads(payload['messages'][-1]['content'])
            name, values = 'report_resolution', {'outcome': 'completed', 'summary': 'Reviewed the current document.',
                'source_ids': args.source_ids, 'receipt_ids': [result['receipt_id']]}
        return {'choices': [{'message': {'role': 'assistant', 'tool_calls': [
            {'id': f'call-{call_count}', 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(values)}}]}}]}
    def execute(oid, name, values):
        assert name == 'get_source'
        return {'source': {'id': args.source_ids[0]}, 'chunks': [{'content': 'Invoice amount is 120 dollars.'}]}
    assert concern_worker.run_once(store, llm=llm, execute_tool=execute, data_factory=factory)
    job = svc.job(row['id'], accepted['job_id'])
    assert job['status'] == 'completed'
    assert len(job['operations']) == 1
    assert job['operations'][0]['status'] == 'completed'
    assert job['result']['payment_executed'] is False
    assert svc.get(row['id'])['status'] == 'resolved'


def test_completion_rejects_missing_receipts_and_invented_sources(flow):
    store, svc, row, _, args, _ = queued(flow)
    job = concern_worker.claim(store)
    with pytest.raises(ValueError, match='receipts'):
        concern_worker.complete(store, job, {'outcome': 'completed', 'summary': 'Done', 'source_ids': args.source_ids}, svc)
    with pytest.raises(ValueError, match='not observed'):
        concern_worker.complete(store, job, {'outcome': 'completed', 'summary': 'Done', 'source_ids': ['fake']}, svc)
    assert svc.get(row['id'])['status'] == 'resolving'


def test_completion_cannot_attach_unread_evidence_to_a_metadata_receipt(flow):
    from app.workflow import WorkflowService
    store, svc, row, accepted, args, _ = queued(flow)
    job = concern_worker.claim(store)
    receipt = concern_worker.operation(store, job, 'list_datasets', {},
        lambda *a: {'datasets': [{'name': 'invoices', 'row_count': 1}]})
    with pytest.raises(ValueError, match='must have been read'):
        concern_worker.complete(store, job, {'outcome': 'completed', 'summary': 'Invoice reviewed.',
            'source_ids': args.source_ids, 'receipt_ids': [receipt['receipt_id']]}, svc)
    assert svc.job(row['id'], accepted['job_id'])['status'] == 'running'
    assert svc.get(row['id'])['status'] == 'resolving'
    assert not any(event['kind'] == 'execution.completed' for event in WorkflowService(store, svc.oid).feed()['events'])


@pytest.mark.parametrize('cite_context', [False, True])
def test_failed_report_commits_failure_and_its_exact_journal_sentence(flow, cite_context):
    from app.workflow import WorkflowService
    store, svc, row, accepted, args, _ = queued(flow)
    job = concern_worker.claim(store)
    source_ids = args.source_ids if cite_context else []
    result = concern_worker.complete(store, job, {'outcome': 'failed',
        'summary': 'The investigation could not be completed.', 'source_ids': source_ids}, svc)
    assert result['outcome'] == 'failed'
    assert result['payment_executed'] is False and result['posting_executed'] is False
    assert svc.job(row['id'], accepted['job_id'])['status'] == 'failed'
    assert svc.get(row['id'])['status'] == 'failed'
    last = WorkflowService(store, svc.oid).feed()['events'][-1]
    assert last['kind'] == 'execution.failed' and last['facts']['sourceIds'] == source_ids
    assert last['actor']['id'] == 'astra'
    assert last['narration']['text'] == 'The financial worker could not finish the investigation. The saved task needs attention.'


def test_expired_executor_cannot_execute_or_finish(flow):
    store, svc, row, _, args, _ = queued(flow)
    old = concern_worker.claim(store)
    with store.engine.begin() as db:
        db.execute(update(concern_jobs).where(concern_jobs.c.id == old['id']).values(lease_until=0))
    new = concern_worker.claim(store)
    assert new['claim_token'] != old['claim_token']
    with pytest.raises(Conflict):
        concern_worker.operation(store, old, 'get_source', {'source_id': args.source_ids[0]}, lambda *a: pytest.fail('stale operation executed'))
    with pytest.raises(Conflict):
        concern_worker.complete(store, old, {'outcome': 'needs_input', 'summary': 'Need more'}, svc)


def test_repeated_operation_uses_saved_receipt_and_forbids_payment(flow):
    store, svc, _, _, args, _ = queued(flow)
    job = concern_worker.claim(store)
    calls = []
    def execute(*values):
        calls.append(values)
        return {'source_ids': args.source_ids}
    first = concern_worker.operation(store, job, 'get_source', {'source_id': args.source_ids[0]}, execute)
    again = concern_worker.operation(store, job, 'get_source', {'source_id': args.source_ids[0]}, execute)
    assert first['receipt_id'] == again['receipt_id'] and again['replayed']
    assert len(calls) == 1
    assert 'error' in concern_worker.operation(store, job, 'pay_invoice', {}, execute)
    assert len(calls) == 1


def test_needs_input_generates_new_reviewed_choices(flow):
    store, svc, row, _, args, _ = queued(flow)
    job = concern_worker.claim(store)
    concern_worker.complete(store, job, {'outcome': 'needs_input', 'summary': 'The receipt is missing.', 'source_ids': args.source_ids}, svc)
    current = svc.get(row['id'])
    assert current['status'] == 'awaiting_response'
    assert current['card_revision'] == 2
    assert current['card_hash'] != row['card_hash']
    assert len(current['card']['options']) == 3
    with pytest.raises(Conflict):
        svc.accept(command(row, key='old-context'), 'alice')


def test_uncertain_mutation_is_not_repeated(flow):
    store, svc, _, _, _, _ = queued(flow)
    job = concern_worker.claim(store)
    # Simulate a persisted dispatch intent whose result was lost during a crash.
    args = {'invoice_id': 'INV-1'}
    body = json.dumps({'name': 'open_payable_case', 'args': args}, sort_keys=True, separators=(',', ':'))
    import hashlib
    operation_id = 'op_' + hashlib.sha256((job['decision_id'] + ':' + body).encode()).hexdigest()[:40]
    with store.engine.begin() as db:
        db.execute(update(concern_jobs).where(concern_jobs.c.id == job['id']).values(operations=[
            {'id': operation_id, 'tool': 'open_payable_case', 'status': 'started', 'mutating': True}]))
    result = concern_worker.operation(store, job, 'open_payable_case', args, lambda *a: pytest.fail('uncertain mutation retried'))
    assert 'unconfirmed' in result['error']


def test_receipt_evidence_version_must_still_match(flow):
    store, svc, row, _, args, _ = queued(flow)
    job = concern_worker.claim(store)
    receipt = concern_worker.operation(store, job, 'get_source', {'source_id': args.source_ids[0]},
                                       lambda *a: {'source_ids': args.source_ids})
    with store.engine.begin() as db:
        db.execute(update(sources).where(sources.c.id == args.source_ids[0]).values(sha256='changed'))
    with pytest.raises(ValueError, match='Evidence changed'):
        concern_worker.complete(store, job, {'outcome': 'completed', 'summary': 'Done',
                                'source_ids': args.source_ids, 'receipt_ids': [receipt['receipt_id']]}, svc)


def test_options_use_exact_stored_title_for_caption_and_speech(flow):
    import hashlib
    _, svc, _, args, _, _ = flow
    row = svc.raise_concern(args)
    assert len(row['decision_cues']) == 3
    for index, cue in enumerate(row['decision_cues'], 1):
        option = next(o for o in row['card']['options'] if o['id'] == f'option_{index}')
        assert cue['text'].endswith(option['title'])
        assert cue['textHash'] == hashlib.sha256(cue['text'].encode()).hexdigest()
        assert cue['event_id'] == f"concern:{row['id']}:{row['card_revision']}:option_{index}"
    svc.accept(command(row), 'alice')
    assert svc.get(row['id'])['decision_cues'] == []


def test_postgres_command_race_and_fenced_mutation(monkeypatch):
    """Opt-in only, against an explicitly supplied isolated test cluster."""
    import os
    import uuid
    import httpx
    from app.store import Store
    from app.data_service import DataService
    from app.concerns import ConcernService, RaiseConcern
    from test_simulator import Objects
    url = os.getenv('TEST_CONCERN_POSTGRES_URL')
    if not url:
        pytest.skip('Set TEST_CONCERN_POSTGRES_URL to an isolated test cluster')
    store = Store(url)
    user = 'concern_test_' + uuid.uuid4().hex
    oid = store.workspace(user)['id']
    data = DataService(store, oid, objects=Objects())
    sid = data.ingest('test.txt', b'TEST_FIXTURE verified invoice evidence.')['id']
    real = httpx.Client
    def evaluator(request):
        return httpx.Response(200, json={'approved': True, 'card': {'summary': 'Review evidence', 'options': [
            {'id': f'option_{i}', 'title': f'Investigate {i}', 'action': f'Inspect evidence {i}',
             'tradeoff': 'Read only', 'requires_approval': False} for i in range(1, 4)]}})
    monkeypatch.setattr(httpx, 'Client', lambda **kw: real(transport=httpx.MockTransport(evaluator)))
    svc = ConcernService(data)
    row = svc.raise_concern(RaiseConcern(request_key='pg-test', title='Review evidence', description='Check it', source_ids=[sid]))
    def choose(index):
        try:
            return svc.accept(command(row, key='concurrent-' + str(index)), user)
        except Conflict:
            return None
    with ThreadPoolExecutor(2) as pool:
        accepted = [r for r in pool.map(choose, range(2)) if r]
    assert len(accepted) == 1
    job = concern_worker.claim(store)
    assert job['id'] == accepted[0]['job_id']
    def mutate(*args):
        # Mirrors a bounded domain write on its own connection while the job row is fenced.
        with store.engine.begin() as db:
            db.execute(update(sources).where(sources.c.id == sid).values(index_status='ready'))
        return {'source_ids': [sid]}
    receipt = concern_worker.operation(store, job, 'open_payable_case', {'invoice_id': 'TEST_FIXTURE'}, mutate)
    assert receipt['receipt_id']
    result = concern_worker.complete(store, job, {'outcome': 'completed', 'summary': 'TEST_FIXTURE completed',
                                     'source_ids': [sid], 'receipt_ids': [receipt['receipt_id']]}, svc)
    assert result['outcome'] == 'completed'
    store.engine.dispose()
