from app.store import Store
from app.database import counterparty_scenarios as scenarios, organizations, insert_ignore
from app import bench_timeline as bt
bt.VALID_SINCE = 0

FAMILY = {1: 'clean', 2: 'backorder', 3: 'duplicate_credit'}

def case(db, org, i, outcome, tier, at, seconds, twin=None, sessions=2):
    # difficulty is the adversary's level at spawn, deliberately not the family's tier here.
    db.execute(scenarios.insert().values(id=f'{org}-{i}', organization_id=org, family=FAMILY[tier], title='t', invoice_id=f'INV-{i}', vendor_id='V',
        facts={}, state={'requests': 2, 'repeats': 0, 'agent': {'model': 'm1', 'sessions': sessions, 'lessons_at_start': i}}, status='scored', outcome=outcome,
        difficulty=5, created_by=f'mirror:{twin}' if twin else 'adversary', created_at=at - seconds * 1000, scored_at=at))

def world(tmp_path, n=24):
    store = Store(str(tmp_path / 'db'))
    with store.engine.begin() as db:
        for org in ('lab', 'lab-control'): insert_ignore(db, organizations, dict(id=org, name=org))
        for i in range(n):
            at = 1_000_000_000 + i * 120_000
            case(db, 'lab', i, 'pass' if i != 3 else 'timeout', 1 + i // 8, at, 30)
            case(db, 'lab-control', i, 'pass', 1 + i // 8, at + 1000, 60, twin=f'lab-{i}', sessions=3)
    return store

def test_series_is_rebuilt_from_graded_cases_and_small_counts_carry_no_rate(tmp_path):
    store = world(tmp_path)
    points = bt.exception_series(bt.graded(store.engine, 'lab'))
    assert sum(p['bucket']['n'] for p in points) == 24 and [p['at'] for p in points] == sorted(p['at'] for p in points)
    assert all(p['bucket']['accuracy'] is None for p in points if p['bucket']['n'] < 20)
    final = points[-1]
    assert final['cumulative'] == {'n': 24, 'correct': 23, 'accuracy': 0.958, 'wrong_releases': 0, 'timeouts': 1}
    assert final['rolling']['n'] == 20 and final['rolling']['accuracy'] == 1.0 and final['bucket']['top_tier'] == 3
    assert final['models'] == ['m1'] and final['lessons_at_start'] == 23 and final['level'] >= 3

def test_memory_effect_pairs_twins_and_document_has_both_roles(tmp_path, monkeypatch):
    store = world(tmp_path)
    monkeypatch.setattr(bt, 'git', lambda: {'sha': 'abc1234', 'dirty': False})
    bt.record(store.engine, 'tests', 'backend', {'passed': 5, 'failed': 0, 'skipped': 0, 'seconds': 1})
    bt.record(store.engine, 'loop_state', 'someone-else', {'lessons': 9})
    doc = bt.document(store.engine, ['lab'])
    by = {(s['id'], s['subject']): s for s in doc['series']}
    assert by[('exceptions', 'lab')]['role'] == 'memory_on' and by[('exceptions', 'lab-control')]['role'] == 'memory_off'
    effect = by[('memory_effect', 'lab')]['points'][-1]
    assert effect['pairs'] == 24 and effect['with_memory']['median_seconds_released'] == 30.0 and effect['without_memory']['sessions_per_case'] == 3.0
    assert by[('tests', 'backend')]['points'][0]['commit']['sha'] == 'abc1234'
    # Another organization's loop state never rides along.
    assert ('loop_state', 'someone-else') not in by and doc['caveats']

def test_a_snapshot_is_recorded_once_per_bucket(tmp_path, monkeypatch):
    store = Store(str(tmp_path / 'db'))
    monkeypatch.setattr(bt, 'git', lambda: {'sha': 'abc1234', 'dirty': False})
    bt.record(store.engine, 'tests', 'backend', {'passed': 1}); bt.record(store.engine, 'tests', 'backend', {'passed': 2})
    assert [p['passed'] for p in bt.document(store.engine, [])['series'][0]['points']] == [1]

def test_cases_from_the_broken_sandbox_are_shown_but_never_accumulated(tmp_path, monkeypatch):
    store = world(tmp_path)
    monkeypatch.setattr(bt, 'VALID_SINCE', 1_000_000_000 + 12 * 120_000)
    points = bt.exception_series(bt.graded(store.engine, 'lab'))
    assert points[0]['valid'] is False and points[-1]['valid'] is True
    assert points[-1]['cumulative']['n'] == 11 and points[-1]['cumulative']['timeouts'] == 0

def test_hard_tier_is_its_own_paired_series(tmp_path):
    store = world(tmp_path)
    hard = bt.memory_series(bt.graded(store.engine, 'lab'), bt.graded(store.engine, 'lab-control'), tier=3)
    assert hard[-1]['pairs'] == 8
