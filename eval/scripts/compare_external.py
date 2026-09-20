import argparse
import contextlib
import io
import json
from pathlib import Path
import statistics
import time

from invoice_devin import read, write
import remaining_devin as runner
import score_remaining as scorer


BENCHMARKS = ('benchrec', 'dabstep', 'apex')


def apex_judgment(run, judge, provider):
    output = run / 'worker-output.json'
    if not judge or not output.exists():
        return None
    matches = []
    for path in (run / 'judgments').glob('*/result.json'):
        result = read(path)
        if result['judge'] != judge or result['provider'] != provider or result['output_sha256'] != scorer.sha(output):
            continue
        protocol = read(path.parent / 'protocol.json')
        safe = {key: result[key] for key in ('benchmark', 'judge', 'provider', 'passed', 'total',
                'macro_task_mean', 'perfect_tasks', 'output_sha256', 'provisional')}
        safe['protocol_sha256'] = scorer.judge_fingerprint({}, protocol)
        matches.append(safe)
    if len(matches) > 1:
        raise ValueError('Multiple judge protocols found; select one explicitly before comparison')
    return matches[0] if matches else None


def trial_summary(root, reference, name, judge=None, provider='openai'):
    run = root / name
    expected = read(reference / name / 'pilot-manifest.json')
    manifest = read(run / 'pilot-manifest.json')
    if manifest['input_sha256'] != expected['input_sha256']:
        raise ValueError('Cannot compare different input archives')
    session_path = run / 'session-latest.json'
    session = read(session_path) if session_path.exists() else {}
    result_path = run / 'result.json'
    result = read(result_path) if result_path.exists() else None
    if name == 'apex':
        result = apex_judgment(run, judge, provider)
    output_path = run / 'worker-output.json'
    completed = output_path.exists() and read(output_path).get('complete') is True
    if not completed:
        result = None
    elif result and name == 'dabstep' and result['output_sha256'] != scorer.sha(output_path):
        raise ValueError('DABstep result does not match frozen output')
    elif result and name == 'benchrec' and result['matcher_sha256'] != scorer.sha(run / 'matcher.py'):
        raise ValueError('BenchRec result does not match frozen matcher')
    return {'trial': manifest.get('trial', 1), 'variant': manifest.get('variant', 'original'),
            'run': root.name, 'status': session.get('status', 'unknown'),
            'status_detail': session.get('status_detail'), 'complete': completed,
            'acu_limit': manifest.get('acu_limit'), 'reported_acus_consumed': session.get('acus_consumed'),
            'result': result, 'grading_pending': completed and result is None}


def summarize(reference, roots, judge=None, provider='openai'):
    comparisons = {}
    for name in BENCHMARKS:
        baseline = trial_summary(reference, reference, name, judge, provider)
        trials = [trial_summary(root, reference, name, judge, provider) for root in roots]
        scored = [trial['result'] for trial in trials if trial['result'] is not None]
        entry = {'baseline': baseline, 'trials': trials, 'attempted': len(trials),
                 'completed': sum(t['complete'] for t in trials), 'scored': len(scored),
                 'unscored': len(trials) - len(scored),
                 'terminal_incomplete': sum(not t['complete'] and t['status'] in
                     ('suspended', 'failed', 'stopped', 'expired') for t in trials)}
        if scored and name == 'dabstep':
            scores = [r['correct'] / r['total'] for r in scored]
            entry['mean_accuracy_completed'] = statistics.mean(scores)
            entry['range_accuracy_completed'] = [min(scores), max(scores)]
            entry['completion_adjusted_lower_bound'] = sum(scores) / len(trials)
            entry['per_task_pass_counts'] = {
                task['task_id']: sum(next(t['passed'] for t in r['tasks'] if t['task_id'] == task['task_id']) for r in scored)
                for task in scored[0]['tasks']}
        if scored and name == 'benchrec':
            entry['metrics_completed'] = {}
            for metric in ('precision', 'recall', 'coverage', 'false_matches'):
                values = [r['metrics'][metric] for r in scored if r['metrics'][metric] is not None]
                entry['metrics_completed'][metric] = {'mean': statistics.mean(values) if values else None,
                    'min': min(values) if values else None, 'max': max(values) if values else None,
                    'defined_trials': len(values)}
        if scored and name == 'apex':
            graded = scored + ([baseline['result']] if baseline['result'] else [])
            if len({r['protocol_sha256'] for r in graded}) != 1:
                raise ValueError('Cannot compare different APEX judge protocols')
            entry['provisional'] = True
            entry['mean_macro_task_score_completed'] = statistics.mean(r['macro_task_mean'] for r in scored)
            entry['micro_criterion_rate_completed'] = sum(r['passed'] for r in scored) / sum(r['total'] for r in scored)
            entry['completion_adjusted_macro_lower_bound'] = sum(r['macro_task_mean'] for r in scored) / len(trials)
        comparisons[name] = entry
    return {'system_name': 'Hyperfinance Agent', 'kind': 'PUBLIC_DEVELOPMENT_COMPARISON', 'comparisons': comparisons,
            'limitations': ['Original baseline has one trial; candidate has three. No significance or held-out claim.',
                'Provider-managed worker model is not pinned; prompt changes are not the only possible source of variation.',
                'Repeated tasks are correlated, not additional independent test cases.',
                'APEX uses only an explicitly selected common judge protocol; model grades remain provisional, not expert adjudication.',
                'Missing results remain in the attempted denominator; zero reported usage is not a zero-cost claim.',
                'No backend tools or learned skills used in either variant.']}


def collect_and_score(reference, roots):
    failures = []
    for root in roots:
        runner.ROOT = root
        scorer.ROOT = root
        scorer.REFERENCE_ROOT = reference
        for name in BENCHMARKS:
            try:
                runner.collect(name)
                run = root / name
                if name != 'apex' and (run/'worker-output.json').exists() and not (run/'result.json').exists():
                    with contextlib.redirect_stdout(io.StringIO()):
                        getattr(scorer, name)()
            except Exception as exc:
                failures.append({'run': root.name, 'benchmark': name, 'error_type': type(exc).__name__})
    return failures


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reference-root', type=Path, required=True)
    parser.add_argument('--roots', type=Path, nargs='+', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--watch-seconds', type=int, default=0)
    parser.add_argument('--judge')
    parser.add_argument('--provider', choices=['openai', 'gateway'], default='openai')
    args = parser.parse_args()
    reference = args.reference_root.resolve()
    roots = [root.resolve() for root in args.roots]
    if len(set(roots)) != len(roots) or reference in roots:
        parser.error('Candidate roots must be distinct and exclude the baseline')
    deadline = time.monotonic() + args.watch_seconds
    while True:
        errors = collect_and_score(reference, roots) if args.watch_seconds else []
        report = summarize(reference, roots, args.judge, args.provider)
        report['collection_errors'] = errors
        write(args.output, report)
        trials = [trial for entry in report['comparisons'].values() for trial in entry['trials']]
        if not args.watch_seconds or time.monotonic() >= deadline or all(
            t['complete'] or t['status'] in ('suspended', 'failed', 'stopped', 'expired') for t in trials):
            break
        time.sleep(min(30, max(0, deadline - time.monotonic())))
    print(json.dumps({name: {k: v for k, v in result.items() if k not in ('baseline', 'trials')}
                      for name, result in report['comparisons'].items()}, indent=2))


if __name__ == '__main__':
    main()
