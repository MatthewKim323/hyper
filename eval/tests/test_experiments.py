import concurrent.futures

import pytest

from mirror_eval.experiments import Experiment, Journal, TaskSpec, Conflict, BudgetExceeded, fingerprint


def spec(**kwargs):
    values = dict(id='pilot', model='fixed-model', prompt_version='p1', tools_version='t1', grader_version='g1',
                  tasks=[TaskSpec(id='one', family='accrual', visible={'documents': []})],
                  arms=['baseline', 'backend'], trials=1, wall_seconds=30, max_tool_calls=2)
    return Experiment(**(values | kwargs))


def test_manifest_is_immutable_and_every_trial_is_registered(tmp_path):
    journal = Journal(tmp_path / 'runs.sqlite', spec())
    assert len(journal.jobs()) == 2
    assert len(Journal(tmp_path / 'runs.sqlite', spec()).jobs()) == 2
    with pytest.raises(Conflict):
        Journal(tmp_path / 'runs.sqlite', spec(prompt_version='changed'))


def test_capability_scope_deadline_and_restart(tmp_path):
    clock = [100]
    path = tmp_path / 'runs.sqlite'
    journal = Journal(path, spec(), clock=lambda: clock[0])
    first, second = journal.jobs()
    token = journal.start(first['id'], {'organization_id': 'org-one'})
    assert journal.authorize(first['id'], token)['binding']['organization_id'] == 'org-one'
    with pytest.raises(PermissionError):
        journal.authorize(second['id'], token)
    assert Journal(path, spec(), clock=lambda: clock[0]).authorize(first['id'], token)
    clock[0] = 131
    with pytest.raises(BudgetExceeded):
        journal.authorize(first['id'], token)
    assert journal.job(first['id'])['state'] == 'timed_out'


def test_checkpoint_survives_and_final_is_immutable(tmp_path):
    journal = Journal(tmp_path / 'runs.sqlite', spec())
    job = journal.jobs()[0]['id']
    token = journal.start(job, {})
    journal.submit(job, token, 'checkpoint', {'progress': 'half'}, final=False)
    journal.submit(job, token, 'done', {'status': 'ready'}, final=True)
    assert journal.job(job)['output'] == {'status': 'ready'}
    assert journal.submit(job, token, 'done', {'status': 'ready'}, final=True)['state'] == 'submitted'
    with pytest.raises(Conflict):
        journal.submit(job, token, 'done', {'status': 'blocked'}, final=True)
    assert len(journal.events(job)) == 2


def test_pending_tool_call_is_not_replayed_after_crash(tmp_path):
    journal = Journal(tmp_path / 'runs.sqlite', spec())
    job = journal.jobs()[0]['id']
    token = journal.start(job, {})
    assert journal.reserve_call(job, token, 'request', 'tool', {'x': 1}) is None
    with pytest.raises(Conflict, match='uncertain'):
        journal.reserve_call(job, token, 'request', 'tool', {'x': 1})
    journal.finish_call(job, 'request', {'ok': True})
    assert journal.reserve_call(job, token, 'request', 'tool', {'x': 1}) == {'ok': True}
    with pytest.raises(Conflict):
        journal.reserve_call(job, token, 'request', 'tool', {'x': 2})
    journal.reserve_call(job, token, 'second', 'tool', {})
    with pytest.raises(BudgetExceeded):
        journal.reserve_call(job, token, 'third', 'tool', {})


def test_only_one_launch_can_claim_task(tmp_path):
    journal = Journal(tmp_path / 'runs.sqlite', spec())
    job = journal.jobs()[0]['id']
    def claim():
        try:
            journal.start(job, {})
            return True
        except Conflict:
            return False
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(lambda _: claim(), range(4))) == 1


def test_skill_arm_requires_training_separation_and_pins():
    with pytest.raises(ValueError):
        spec(arms=['backend_skills'])
    with pytest.raises(ValueError):
        spec(arms=['backend_skills'], skill_pins={'skill': 'a' * 64}, training_task_ids=['one'])
    assert fingerprint({'value': 1}) != fingerprint({'value': True})


def test_launch_reservations_are_cumulative_and_not_retried(tmp_path):
    journal = Journal(tmp_path / 'runs.sqlite', spec())
    one, two = journal.jobs()
    journal.reserve_launch(one['id'], authorized_acu=5)
    with pytest.raises(Conflict):
        journal.reserve_launch(one['id'], authorized_acu=10)
    with pytest.raises(BudgetExceeded):
        journal.reserve_launch(two['id'], authorized_acu=5)
    journal.attach_session(one['id'], 'remote-session')
    with pytest.raises(Conflict):
        journal.attach_session(one['id'], 'another-session')
    assert journal.launches()[0]['session_id'] == 'remote-session'


def test_concurrency_and_known_prelaunch_failures(tmp_path):
    journal = Journal(tmp_path / 'runs.sqlite', spec(max_active=1))
    one, two = journal.jobs()
    journal.reserve_launch(one['id'], authorized_acu=10)
    with pytest.raises(BudgetExceeded, match='Concurrent'):
        journal.reserve_launch(two['id'], authorized_acu=10)
    journal.abort_before_create(one['id'], 'prelaunch:ConnectionError')
    assert journal.job(one['id'])['state'] == 'failed'
    assert journal.launches()[0]['status'] == 'prelaunch_failed'
    with pytest.raises(Conflict):
        journal.attach_session(one['id'], 'cannot-attach')
    journal.reserve_launch(two['id'], authorized_acu=10)


def test_same_named_experiments_do_not_reuse_cloud_tags(tmp_path):
    one = Journal(tmp_path / 'one.sqlite', spec())
    two = Journal(tmp_path / 'two.sqlite', spec())
    assert {job['id'] for job in one.jobs()}.isdisjoint(job['id'] for job in two.jobs())


def test_private_grade_is_pinned_and_preserves_missing_denominator(tmp_path):
    from mirror_eval.preparation_grading import report, VERSION
    gold = {'one': {'status': 'ready_for_review', 'facts': {'amount': 1}, 'issues': [], 'required_evidence': []}}
    journal = Journal(tmp_path / 'runs.sqlite', spec(grader_version=VERSION, gold_sha256=fingerprint(gold)))
    job = next(row for row in journal.jobs() if row['arm'] == 'baseline')
    token = journal.start(job['id'], {})
    journal.submit(job['id'], token, 'done', {'origin': 'agent_submission',
        'answer': {'status': 'ready_for_review', 'facts': {'amount': True}, 'issues': [], 'evidence_keys': []}}, True)
    result = report(journal, gold)
    assert result['kind'] == 'NO_AGENT_MEASUREMENTS'
    assert result['arms']['baseline']['completed'] == 1
    assert result['arms']['baseline']['successful'] == 0
    assert result['arms']['backend']['planned'] == 1
    assert result['arms']['backend']['attempted'] == 0
    assert result['arms']['backend']['measurement_status'] == 'not_started'
    assert not result['comparisons']['backend']['broad_improvement_supported']
    with pytest.raises(ValueError, match='grading contract changed'):
        report(journal, {'one': {**gold['one'], 'facts': {'amount': True}}})
