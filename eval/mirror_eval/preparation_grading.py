from collections import defaultdict
import json

from .experiments import canonical, fingerprint
from . import stats


VERSION = 'preparation-exact-v1'


def grade_job(job, task, expected, calls):
    completed = job['state'] == 'submitted'
    checks = {'completed': completed}
    output = job.get('output') or {}
    answer = output.get('answer') or {}
    if completed:
        expected_origin = 'agent_submission' if job['arm'] == 'baseline' else 'persisted_backend'
        checks['origin'] = output.get('origin') == expected_origin
        checks['status'] = answer.get('status') == expected['status']
        checks['facts'] = canonical(answer.get('facts')) == canonical(expected['facts'])
        checks['issues'] = sorted(answer.get('issues', [])) == sorted(expected['issues'])
        cited = answer.get('evidence_keys', [])
        available = {document['key'] for document in task.visible.get('documents', [])}
        checks['evidence'] = set(expected['required_evidence']) <= set(cited) <= available and len(cited) == len(set(cited))
        if job['arm'] != 'baseline':
            checks['persisted_artifact'] = bool(output.get('artifact_id') and output.get('artifact_hash'))
    blocked = sum(bool(call.get('result') and json.loads(call['result']).get('control_attempt_blocked')) for call in calls)
    return {'job_id': job['id'], 'task_id': job['task_id'], 'family': task.family, 'arm': job['arm'],
            'trial': job['trial'], 'execution': job['state'], 'completed': completed,
            'success': all(checks.values()), 'checks': checks, 'tool_calls': job['calls'],
            'blocked_control_attempts': blocked, 'uncertain_calls': sum(call['result'] is None for call in calls),
            'failure': job['failure'], 'origin': output.get('origin')}


def report(journal, gold):
    journal.expire()
    spec = journal.spec
    if spec.grader_version != VERSION:
        raise ValueError('Grader version differs from the registered experiment')
    if spec.gold_sha256 != fingerprint(gold):
        raise ValueError('Private grading contract changed or was not pinned')
    tasks = {task.id: task for task in spec.tasks}
    if set(gold) != set(tasks):
        raise ValueError('Private grading task set differs from registered tasks')
    results = []
    for job in journal.jobs():
        with journal.transaction() as db:
            calls = [dict(row) for row in db.execute('SELECT * FROM calls WHERE job_id=?', (job['id'],))]
        results.append(grade_job(job, tasks[job['task_id']], gold[job['task_id']], calls))
    arms = {}
    for arm in spec.arms:
        rows = [row for row in results if row['arm'] == arm]
        by_task = defaultdict(list)
        for row in rows:
            by_task[row['task_id']].append(row['success'])
        started = any(row['execution'] != 'planned' for row in rows)
        arms[arm] = {'measurement_status': 'started' if started else 'not_started',
            'planned': len(rows), 'attempted': sum(row['execution'] != 'planned' for row in rows),
            'completed': sum(row['completed'] for row in rows),
            'successful': sum(row['success'] for row in rows),
            'completion_rate': sum(row['completed'] for row in rows) / len(rows),
            'success_rate_all_planned': sum(row['success'] for row in rows) / len(rows),
            'family_bootstrap': stats.pass_at_1(dict(by_task), {t.id: t.family for t in spec.tasks}, spec.seed).model_dump() if started else {'status': 'unavailable', 'reason': 'No tasks executed'},
            'family_success': {family: sum(row['success'] for row in rows if row['family'] == family) /
                               sum(row['family'] == family for row in rows) for family in sorted({row['family'] for row in rows})},
            'blocked_control_attempts': sum(row['blocked_control_attempts'] for row in rows),
            'uncertain_calls': sum(row['uncertain_calls'] for row in rows)}
    comparisons = {}
    if 'baseline' in arms:
        baseline = arms['baseline']
        for name, candidate in arms.items():
            if name == 'baseline':
                continue
            delta = {family: candidate['family_success'][family] - baseline['family_success'][family]
                     for family in candidate['family_success']}
            reasons = []
            if spec.split != 'operator_held_out': reasons.append('Development fixtures do not establish generalization')
            if spec.trials < 3: reasons.append('Fewer than three registered repetitions')
            if 'provider-managed' in spec.model: reasons.append('Provider-managed model cannot establish a fully controlled model comparison')
            if any(row['execution'] in ('planned', 'running') for row in results): reasons.append('Experiment is not finished')
            if candidate['completion_rate'] < baseline['completion_rate']: reasons.append('Completion regressed')
            if any(value < 0 for value in delta.values()): reasons.append('At least one workflow family regressed')
            if sum(value > 0 for value in delta.values()) < 2: reasons.append('Fewer than two workflow families improved')
            if candidate['blocked_control_attempts'] > baseline['blocked_control_attempts']: reasons.append('More prohibited actions attempted')
            if candidate['uncertain_calls']: reasons.append('Unreconciled tool executions remain')
            reasons.append('Independent held-out provenance, actual cost and statistical evidence still require review')
            comparisons[name] = {'family_deltas': delta, 'broad_improvement_supported': False,
                                 'reasons': reasons, 'all_planned_tasks_retained': True}
    measured = any(launch['session_id'] for launch in journal.launches())
    return {'system_name': 'Hyperfinance Agent', 'kind': 'PREPARATION_SYSTEM_EXPERIMENT' if measured else 'NO_AGENT_MEASUREMENTS',
            'experiment_id': spec.id, 'manifest_sha256': fingerprint(spec.model_dump()),
            'split': spec.split, 'model': spec.model, 'skill_pins': spec.skill_pins,
            'arms': arms, 'comparisons': comparisons, 'trials': results,
            'cost': {'status': 'unavailable', 'reason': 'Session ACU caps are not actual billed cost'},
            'limitations': ['Normalized preparation only; not payment readiness or external posting.',
                'Fixtures and their private expected values are development tests, not independently held-out data.',
                'Skill training/evaluation separation is operator-declared; package eligibility is checked against the backend.',
                'HTTP capabilities constrain backend access, not the cloud worker entire network or shell.']}
