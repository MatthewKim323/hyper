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
    hard = bt.memory_series(bt.graded(store.engine, 'lab'), bt.graded(store.engine, 'lab-control'), tier=(3,))
    assert hard[-1]['pairs'] == 8

def test_a_wrong_release_on_a_warning_never_shown_is_not_counted(tmp_path):
    store = world(tmp_path, n=2)
    empty = {'tool': 'get_counterparty_thread', 'result': '{"invoice_id": "INV-9", "messages": []}'}
    seen = {'tool': 'get_counterparty_thread', 'result': '{"invoice_id": "INV-9", "messages": [{"body": "do not pay"}]}'}
    with store.engine.begin() as db:
        for i, (org, trace) in enumerate([('lab', [empty, seen]), ('lab', [seen]), ('lab-control', [seen])]):
            db.execute(scenarios.insert().values(id=f'trap-{i}', organization_id=org, family='internal_hold', title='t', invoice_id=f'INV-9{i}', vendor_id='V', facts={},
                state={'requests': 0, 'agent': {'trace': trace}}, status='scored', outcome='fail', difficulty=5,
                created_by='mirror:trap-0' if org == 'lab-control' else 'adversary', created_at=2_000_000_000, scored_at=2_000_030_000))
    rows = bt.graded(store.engine, 'lab')
    assert [bt.raced(r) for r in rows if r['id'].startswith('trap')] == [True, False]
    point = bt.exception_series(rows)[-1]
    assert point['not_shown_warning'] == 1 and point['bucket']['wrong_releases'] == 1 and point['by_tier'] == {'5': {'n': 1, 'correct': 0}}
    # trap-0 raced, so its pair is dropped even though the twin was shown the warning.
    assert bt.memory_series(rows, bt.graded(store.engine, 'lab-control'), tier=bt.HARD_TIERS) == []

def test_a_timeout_the_machine_caused_is_not_the_agents(tmp_path, monkeypatch):
    store = world(tmp_path, n=2)
    monkeypatch.setattr(bt, 'DOWN_WINDOWS', [(3_000_000_000, 3_000_600_000)])
    with store.engine.begin() as db:
        for i, (created, agent) in enumerate([(2_000_000_000, {}), (3_000_100_000, {'sessions': 1}), (2_000_000_000, {'sessions': 2})]):
            db.execute(scenarios.insert().values(id=f'late-{i}', organization_id='lab', family='clean', title='t', invoice_id=f'INV-7{i}', vendor_id='V', facts={},
                state={'requests': 0, 'agent': agent}, status='scored', outcome='timeout', difficulty=1, created_by='adversary', created_at=created, scored_at=created + 600_000))
    rows = {r['id']: r for r in bt.graded(store.engine, 'lab')}
    # Never opened, dealt while down, and a real one the worker had and lost.
    assert [bt.machine_timeout(rows[f'late-{i}']) for i in range(3)] == [True, True, False]
    assert bt.exception_series(list(rows.values()))[-1]['cumulative']['timeouts'] == 1  # only the one a worker really had and lost
