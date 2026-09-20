import importlib
import json
from pathlib import Path

import pytest


@pytest.fixture
def modules(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / 'eval/scripts'))
    return importlib.import_module('remaining_devin'), importlib.import_module('score_remaining')


def test_changed_inputs_refused_before_network(modules, tmp_path, monkeypatch):
    runner, _ = modules
    monkeypatch.setattr(runner, 'ROOT', tmp_path)
    run = tmp_path / 'dabstep'
    run.mkdir()
    (run / 'inputs.zip').write_bytes(b'changed')
    runner.write(run / 'pilot-manifest.json', {'input_sha256': 'original'})
    monkeypatch.setattr(runner, 'client', lambda: pytest.fail('network must not be reached'))
    with pytest.raises(ValueError, match='changed'):
        runner.start('dabstep')


def test_judge_cache_identity_covers_protocol_and_answer(modules):
    _, scorer = modules
    payload = {'worker_answer': '100', 'rubric': [{'id': 'a'}]}
    key = scorer.judge_fingerprint(payload, {'model': 'model-a'})
    assert key != scorer.judge_fingerprint(payload, {'model': 'model-b'})
    assert key != scorer.judge_fingerprint({**payload, 'worker_answer': '200'}, {'model': 'model-a'})
    assert key != scorer.judge_fingerprint({**payload, 'rubric': []}, {'model': 'model-a'})


def test_missing_answers_are_retained_in_denominator(modules, tmp_path):
    _, scorer = modules
    (tmp_path / 'worker-output.json').write_text(json.dumps({'complete': True, 'answers': []}))
    assert scorer.answers(tmp_path, [{'task_id': 'a'}]) == {}


def test_incomplete_outputs_are_not_scored(modules, tmp_path):
    _, scorer = modules
    (tmp_path / 'worker-output.json').write_text(json.dumps({'complete': False, 'answers': []}))
    with pytest.raises(ValueError, match='incomplete'):
        scorer.answers(tmp_path, [{'task_id': 'a'}])


def test_dabstep_summary_uses_actual_levels(modules):
    _, scorer = modules
    rows = [{'level': 'easy', 'passed': True}, {'level': 'hard', 'passed': False}]
    assert scorer.level_summary(rows) == {'easy': {'correct': 1, 'total': 1}, 'hard': {'correct': 0, 'total': 1}}


def test_prepare_keeps_answers_and_sessions_out(modules, tmp_path):
    runner, _ = modules
    source = tmp_path / 'source'
    run = source / 'dabstep'
    run.mkdir(parents=True)
    data = b'blinded archive'
    (run / 'inputs.zip').write_bytes(data)
    runner.write(run / 'pilot-manifest.json', {'input_sha256': runner.hashlib.sha256(data).hexdigest()})
    runner.write(run / 'worker-output.json', {'secret': 'not an input'})
    runner.write(run / 'session.json', {'session_id': 'old'})
    runner.prepare_trial(source, tmp_path / 'new', ['dabstep'], 'verified-v2', 1)
    target = tmp_path / 'new' / 'dabstep'
    assert sorted(p.name for p in target.iterdir()) == ['inputs.zip', 'pilot-manifest.json']
    with pytest.raises(FileExistsError):
        runner.prepare_trial(source, tmp_path / 'new', ['dabstep'], 'verified-v2', 1)


def record(side, id, amount, reference='REF12345678', currency='USD', account='one'):
    return {side + '_' + k: v for k, v in {
        'transactionType': side, 'id': id, 'allocation': id, 'amount': amount,
        'currencyCode': currency, 'account': account, 'valueDate': '2026-09-01',
        'transactionReferences': reference}.items()}


@pytest.mark.parametrize('policy', ['unique-total', 'reference-conserved'])
def test_rules_reject_duplicate_capacity_and_cross_scope(modules, policy):
    rules = importlib.import_module('benchrec_rules')
    rows = [record('A', 'a', '100'), record('B', 'b', '100'), record('B', 'c', '100')]
    assert all(not r['targetAllocation'] for r in rules.match(rows, policy))
    rows = [record('A', 'a', '100'), record('B', 'b', '100', currency='EUR')]
    assert rules.match(rows, policy) == [{'B_id': 'b', 'targetAllocation': ''}]


def test_reference_match_conserves_whole_allocation(modules):
    rules = importlib.import_module('benchrec_rules')
    rows = [record('A', 'a', '100'), record('B', 'b', '40'), record('B', 'c', '60')]
    assert rules.match(rows, 'reference-conserved') == [
        {'B_id': 'b', 'targetAllocation': 'a'}, {'B_id': 'c', 'targetAllocation': 'a'}]
    assert all(not r['targetAllocation'] for r in rules.match(rows[:-1], 'reference-conserved'))


def test_rules_abstain_on_ambiguous_allocations(modules):
    rules = importlib.import_module('benchrec_rules')
    rows = [record('A', 'a', '100'), record('A', 'other', '100'), record('B', 'b', '100')]
    for policy in ('unique-total', 'reference-conserved'):
        assert rules.match(rows, policy) == [{'B_id': 'b', 'targetAllocation': ''}]


def test_metrics_cannot_reward_abstention_as_precision(modules):
    _, scorer = modules
    gold = [{'B_id': 'b', 'targetAllocation': 'a'}, {'B_id': 'c', 'targetAllocation': ''}]
    prediction = [{'B_id': 'b', 'targetAllocation': ''}, {'B_id': 'c', 'targetAllocation': ''}]
    metrics = scorer.allocation_metrics(prediction, gold)
    assert metrics['precision'] is None
    assert metrics['recall'] == 0
    assert metrics['coverage'] == 0
    with pytest.raises(ValueError, match='every expected ID'):
        scorer.allocation_metrics(prediction[:1], gold)


def test_summary_counts_incomplete_trials_and_withholds_old_apex_judge(modules, tmp_path):
    comparison = importlib.import_module('compare_external')
    reference = tmp_path / 'reference'
    roots = [tmp_path / 'one', tmp_path / 'two', tmp_path / 'three']
    for root in [reference, *roots]:
        for name in comparison.BENCHMARKS:
            run = root / name
            run.mkdir(parents=True)
            (run / 'pilot-manifest.json').write_text(json.dumps({'input_sha256': 'same', 'trial': 1}))
    for root in (reference, roots[0]):
        run = root / 'dabstep'
        output = run / 'worker-output.json'
        output.write_text(json.dumps({'complete': True, 'answers': []}))
        (run / 'result.json').write_text(json.dumps({'correct': 1, 'total': 2,
            'tasks': [{'task_id': 'a', 'passed': True}, {'task_id': 'b', 'passed': False}],
            'output_sha256': modules[1].sha(output)}))
    (reference / 'apex/result.json').write_text(json.dumps({'passed': 89, 'total': 89}))
    report = comparison.summarize(reference, roots)
    dabstep = report['comparisons']['dabstep']
    assert (dabstep['attempted'], dabstep['scored'], dabstep['unscored']) == (3, 1, 2)
    assert dabstep['completion_adjusted_lower_bound'] == 0.5 / 3
    assert report['comparisons']['apex']['baseline']['result'] is None
    (roots[1] / 'dabstep/pilot-manifest.json').write_text(json.dumps({'input_sha256': 'different'}))
    with pytest.raises(ValueError, match='different input'):
        comparison.summarize(reference, roots)


def test_direct_judge_preserves_legacy_results_and_invalidates_cache(modules, tmp_path, monkeypatch):
    import httpx
    _, scorer = modules
    run = tmp_path / 'apex'
    (run / 'private').mkdir(parents=True)
    task = {'task_id': 'a', 'task_name': 'task', 'prompt': 'calculate',
            'rubric': [{'id': 'c', 'criterion': 'correct'}], 'gold_output': '100'}
    (run / 'private/dev.jsonl').write_text(json.dumps(task) + '\n')
    (run / 'worker-output.json').write_text(json.dumps({'complete': True, 'answers': [{'task_id': 'a', 'answer': '100'}]}))
    (run / 'result.json').write_text('{"legacy": true}')
    monkeypatch.setattr(scorer, 'ROOT', tmp_path)
    monkeypatch.setattr(scorer, 'REFERENCE_ROOT', tmp_path)
    monkeypatch.setattr(scorer, 'JUDGE', 'frontier-test')
    monkeypatch.setattr(scorer, 'PROVIDER', 'openai')
    monkeypatch.setenv('OPENAI_API_KEY', 'test-placeholder')
    calls = []
    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, **kwargs):
            calls.append((url, kwargs['json']))
            content = json.dumps({'criteria': [{'id': 'c', 'passed': True, 'answer_quote': '100', 'reason': 'matches'}]})
            return httpx.Response(200, request=httpx.Request('POST', url), json={
                'choices': [{'finish_reason': 'stop', 'message': {'content': content}}]})
    monkeypatch.setattr(httpx, 'Client', Client)
    scorer.apex()
    scorer.apex()
    assert len(calls) == 1
    assert calls[0][0] == 'https://api.openai.com/v1/chat/completions'
    assert calls[0][1]['model'] == 'frontier-test'
    monkeypatch.setattr(scorer, 'JUDGE', 'another-frontier-test')
    scorer.apex()
    assert len(calls) == 2
    assert json.loads((run / 'result.json').read_text()) == {'legacy': True}
    assert len(list((run / 'judgments').glob('*/result.json'))) == 2


def test_payment_checks_separate_fraud_count_from_volume(modules):
    from decimal import Decimal
    checks = importlib.import_module('payment_checks')
    rows = [
        {'psp_reference': 'one', 'has_fraudulent_dispute': 'True', 'eur_amount': '90', 'ip_country': 'NL'},
        {'psp_reference': 'two', 'has_fraudulent_dispute': 'False', 'eur_amount': '10', 'ip_country': 'NL'}]
    result = checks.fraud_report(rows, ['ip_country'])[0]
    assert result['count_fraud_fraction'] == Decimal('0.5')
    assert result['volume_fraud_fraction'] == Decimal('0.9')
    assert checks.assess_fine(result['volume_fraud_fraction'])['fine_risk'] is None
    with pytest.raises(ValueError, match='duplicate'):
        checks.fraud_report(rows + rows[:1], ['ip_country'])


def test_payment_month_and_rule_boundaries(modules):
    checks = importlib.import_module('payment_checks')
    assert checks.payment_month('2024', '60') == '2024-02'
    assert checks.payment_month('2023', '60') == '2023-03'
    with pytest.raises(ValueError, match='Invalid day'):
        checks.payment_month('2023', '366')
    assert checks.category_matches(None, True)
    assert not checks.category_matches(False, True)
    assert not checks.category_matches([], 'H')
    assert checks.category_matches([], 'H', empty_list_wildcard=True)
    assert checks.assess_fine('0.083', '0.083', 'explicit-policy')['fine_risk'] is False
    with pytest.raises(ValueError, match='fractions'):
        checks.assess_fine('8.3', '0.083', 'explicit-policy')


def test_apex_export_selects_requested_model_without_private_verdicts(modules, tmp_path):
    comparison = importlib.import_module('compare_external')
    run = tmp_path / 'apex'
    directory = run / 'judgments' / 'one'
    directory.mkdir(parents=True)
    output = run / 'worker-output.json'
    output.write_text(json.dumps({'complete': True, 'answers': []}))
    protocol = {'model': 'frontier-test', 'provider': 'openai'}
    result = {'benchmark': 'APEX', 'judge': 'frontier-test', 'provider': 'openai',
        'passed': 1, 'total': 2, 'macro_task_mean': 0.5, 'perfect_tasks': 0,
        'output_sha256': modules[1].sha(output), 'provisional': True,
        'tasks': [{'reason': 'PRIVATE REFERENCE'}]}
    (directory / 'result.json').write_text(json.dumps(result))
    (directory / 'protocol.json').write_text(json.dumps(protocol))
    assert comparison.apex_judgment(run, 'old-model', 'openai') is None
    safe = comparison.apex_judgment(run, 'frontier-test', 'openai')
    assert safe['passed'] == 1
    assert 'PRIVATE REFERENCE' not in json.dumps(safe)
    output.write_text(json.dumps({'complete': True, 'answers': [{'task_id': 'changed'}]}))
    assert comparison.apex_judgment(run, 'frontier-test', 'openai') is None


def test_conservation_gate_rejects_overallocation_and_partial_groups(modules):
    rules = importlib.import_module('benchrec_rules')
    rows = [record('A', 'a', '100'), record('B', 'b', '100'), record('B', 'c', '100')]
    proposed = [{'B_id': 'b', 'targetAllocation': 'a'}, {'B_id': 'c', 'targetAllocation': 'a'}]
    assert all(not r['targetAllocation'] for r in rules.conservation_filter(rows, proposed))
    rows = [record('A', 'a', '100'), record('B', 'b', '40'), record('B', 'c', '60')]
    assert rules.conservation_filter(rows, proposed) == proposed
    assert rules.conservation_filter(rows, [{**r, 'targetAllocation': '' if r['B_id'] == 'c' else 'a'} for r in proposed]) == [
        {'B_id': 'b', 'targetAllocation': ''}, {'B_id': 'c', 'targetAllocation': ''}]
    rows[-1]['B_account'] = 'different'
    assert all(not r['targetAllocation'] for r in rules.conservation_filter(rows, proposed))


def test_reference_normalization_does_not_select_one_of_multiple_guesses(modules):
    rules = importlib.import_module('benchrec_rules')
    assert rules.normalize_reference([
        {'B_id': 'one', 'targetAllocation': '["a"]'}, {'B_id': 'two', 'targetAllocation': '[]'}]) == [
        {'B_id': 'one', 'targetAllocation': 'a'}, {'B_id': 'two', 'targetAllocation': ''}]
    with pytest.raises(ValueError, match='zero or one'):
        rules.normalize_reference([{'B_id': 'one', 'targetAllocation': '["a", "b"]'}])
