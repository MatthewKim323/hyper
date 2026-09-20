"""Benchmark timeline: how the exception loop, retrieval and the test suite move over time.

    uv run --directory backend python -m app.bench_timeline ORG [ORG ...] [--every 300] [--once]

The exception-loop series are rebuilt from graded cases on every read, so they reach back to the first case
and cannot drift from the scoreboard. Spend rate, suite results and retrieval scores cannot be rebuilt, so the
recorder appends them as they are measured, stamped with the commit. Read-only on every table it did not create.
"""
import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from statistics import median

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

from sqlalchemy import func, select  # noqa: E402

from .counterparty import Counterparties, TIERS  # noqa: E402
from .database import (agent_lessons as lessons, benchmark_points as points, counterparty_scenarios as scenarios,  # noqa: E402
                       adversary_controls, insert_ignore, learned_skills)

BACKEND = Path(__file__).resolve().parents[1]
GOOD = ('pass', 'correct_hold')
BUCKET_MS = 600_000
ROLLING = 20
# A retrieval or suite result belongs to the code that produced it: measure again only when these change.
RETRIEVAL_FILES = ('app/retrieval.py', 'app/graph.py', 'app/data_service.py', 'app/parsing.py', 'app/ingestion_worker.py')
# Things that changed what a point means. Supplied by the loop's owner; cases graded before VALID_SINCE ran against a
# sandbox that ignored legitimate follow-ups and returned unusable record IDs, so they are shown but never accumulated.
VALID_SINCE = 1789885421544
EVENTS = [
    {'at': 1789884159876, 'label': 'worker: devin to gpt-5.6-luna'},
    {'at': 1789885130249, 'label': 'sandbox fix: follow-ups answered'},
    {'at': 1789885421544, 'label': 'sandbox fix: record ids', 'valid_since': True},
    {'at': 1789885593318, 'label': 'worker: gpt-5.6-terra'},
    {'at': 1789885984942, 'label': 'memory-off twin started (hyper-lab)'},
    {'at': 1789887482298, 'label': 'tier 5 live'},
    {'at': 1789892340000, 'label': 'loop down (all workers died at once)'},
    {'at': 1789895460000, 'label': 'loop back up'},
    {'at': 1789888077210, 'label': 'adversary leans on the newest tier'},
    {'at': 1789889366247, 'label': 'tier 6 live; memory keeps lessons from misses'},
    {'at': 1789890592692, 'label': 'sandbox fix: opening warnings delivered at spawn'},
    {'at': 1789892311179, 'label': 'tier 7 live: facts with no instruction, and who may lift a hold; a worked hold with no question counts as correct'},
]
# Tiers where every engine check passes while the right answer is to hold: the only ones a wrong release can happen in.
HARD_TIERS = tuple(t for t in TIERS if t >= 5)
# Before 8b10aa6 a warning that opens the case was delivered about a second after spawn. A fast worker could read an
# empty thread and be graded wrong for ignoring a message it was never shown. Not a model mistake, so never counted.
RACE_FAMILIES = ('internal_hold', 'cleared_hold', 'misdirected_hold', 'superseded_invoice')

def raced(row):
    if row['outcome'] != 'fail' or row['family'] not in RACE_FAMILIES: return False
    first = next((t for t in (row['state'].get('agent') or {}).get('trace') or [] if t.get('tool') == 'get_counterparty_thread'), None)
    return bool(first) and 'messages": []' in str(first.get('result'))

def counted(row): return row['created_at'] >= VALID_SINCE and not raced(row)
CAVEATS = [
    'Tiers 1 to 4 name their own diagnosis in the case title and are saturated. Tier 5 is the only tier where a wrong release is possible, so it is the only accuracy series worth reading.',
    'Development series: no battery is held out from the worker prompt.',
    'Difficulty adapts to the worker, so flat accuracy at a rising level is improvement and rising accuracy at a falling level is not.',
    'Memory on and memory off are matched by family and tier, not by invoice. Simulated counterparties.',
    'Counts under 20 are shown as counts. No rate is computed from them.',
]


def now(): return int(time.time() * 1000)

def family_tier(family):
    """A case's tier is its family's. `difficulty` on the row is the adversary's level when it spawned, which is a different thing."""
    return next((tier for tier, families in TIERS.items() if family in families), None)

def git():
    def run(*args):
        try: return subprocess.run(['git', *args], cwd=BACKEND, capture_output=True, text=True, timeout=10).stdout.strip()
        except Exception: return ''
    return {'sha': run('rev-parse', '--short', 'HEAD') or None, 'dirty': bool(run('status', '--porcelain', '--untracked-files=no'))}

def rate(correct, n): return round(correct / n, 3) if n >= ROLLING else None

def summary(rows, costs=None):
    n = len(rows)
    if not n: return {'n': 0}
    spent = [costs[r['id']] for r in rows if costs and r['id'] in costs]
    agent = [r['state'].get('agent') or {} for r in rows]
    sessions = [a['sessions'] for a in agent if a.get('sessions')]
    correct = sum(r['outcome'] in GOOD for r in rows)
    return {'n': n, 'correct': correct, 'accuracy': rate(correct, n),
            'wrong_releases': sum(r['outcome'] == 'fail' for r in rows), 'timeouts': sum(r['outcome'] == 'timeout' for r in rows),
            'correct_holds': sum(r['outcome'] == 'correct_hold' for r in rows),
            'median_seconds': round(median((r['scored_at'] - r['created_at']) / 1000 for r in rows), 1),
            # A hold is graded after a fixed wait, so only released cases say how fast the worker is.
            'median_seconds_released': (lambda t: round(median(t), 1) if t else None)([(r['scored_at'] - r['created_at']) / 1000 for r in rows if r['outcome'] == 'pass']),
            'requests_per_case': round(sum(r['state'].get('requests', 0) for r in rows) / n, 2),
            'repeated_requests': sum(r['state'].get('repeats', 0) for r in rows),
            'sessions_per_case': round(sum(sessions) / len(sessions), 2) if sessions else None,
            # Only cases worked after the usage log began naming its case have a cost.
            'median_usd_per_case': round(median(c['usd'] for c in spent), 4) if spent else None,
            'median_tokens_per_case': round(median(c['tokens'] for c in spent)) if spent else None, 'costed_cases': len(spent),
            'top_tier': max((family_tier(r['family']) or 0 for r in rows), default=0)}

def case_costs():
    """{scenario id: tokens and list-price dollars}, from the worker's metered usage."""
    from .spend_guard import PRICES, USAGE
    out = {}
    if not USAGE.exists(): return out
    for line in USAGE.read_text().splitlines():
        try: row = json.loads(line)
        except ValueError: continue
        if not row.get('scenario_id'): continue
        fresh, cached, output = PRICES.get(row.get('model'), max(PRICES.values()))
        entry = out.setdefault(row['scenario_id'], {'usd': 0.0, 'tokens': 0})
        entry['usd'] += ((row['input'] - row['cached']) * fresh + row['cached'] * cached + row['output'] * output) / 1e6
        entry['tokens'] += row['input'] + row['output']
    return out

def graded(engine, org, since=0):
    with engine.connect() as db:
        return [dict(r) for r in db.execute(select(scenarios.c.id, scenarios.c.family, scenarios.c.outcome, scenarios.c.difficulty,
            scenarios.c.state, scenarios.c.created_by, scenarios.c.created_at, scenarios.c.scored_at).where(
            scenarios.c.organization_id == org, scenarios.c.status == 'scored', scenarios.c.scored_at >= since).order_by(scenarios.c.scored_at, scenarios.c.id)).mappings()]

def exception_series(rows, bucket_ms=BUCKET_MS, costs=None):
    """One point per time bucket that graded anything, each carrying the bucket, the last 20 cases and everything so far."""
    out, seen = [], []
    buckets = {}
    for r in rows: buckets.setdefault(r['scored_at'] // bucket_ms, []).append(r)
    for bucket in sorted(buckets):
        everything = buckets[bucket]; mine = [r for r in everything if not raced(r)]; seen += [r for r in mine if counted(r)]
        agent = [r['state'].get('agent') or {} for r in mine]
        tiers = {}
        for r in mine:
            t = tiers.setdefault(str(family_tier(r['family']) or 'unknown'), {'n': 0, 'correct': 0}); t['n'] += 1; t['correct'] += int(r['outcome'] in GOOD)
        out.append({'at': (bucket + 1) * bucket_ms, 'valid': all(r['created_at'] >= VALID_SINCE for r in mine),
                    'not_shown_warning': len(everything) - len(mine),
                    'bucket': summary(mine, costs), 'rolling': summary(seen[-ROLLING:], costs),
                    'adversary_level_at_spawn': max(r['difficulty'] for r in everything),
                    'cumulative': {k: v for k, v in summary(seen).items() if k in ('n', 'correct', 'accuracy', 'wrong_releases', 'timeouts')},
                    'level': Counterparties.level(seen), 'by_tier': tiers,
                    'models': sorted({a['model'] for a in agent if a.get('model')}),
                    'worker_commits': sorted({a['git_sha'] for a in agent if a.get('git_sha')}),
                    'worker_kinds': sorted({a.get('kind') or 'unknown' for a in agent}),
                    'lessons_at_start': max((a.get('lessons_at_start', 0) for a in agent), default=0)})
    return out

def memory_series(treatment, control, bucket_ms=BUCKET_MS, costs=None, tier=None):
    """Memory on against memory off on twinned cases, cumulative, so late points are the ones with enough cases to read."""
    twins = {r['created_by'][7:]: r for r in control if str(r['created_by']).startswith('mirror:')}
    # A pair is dropped whole if either arm raced: the two would no longer have faced the same case.
    paired = [(r, twins[r['id']]) for r in treatment if r['id'] in twins and counted(r) and counted(twins[r['id']])
              and (tier is None or family_tier(r['family']) in tier)]
    out, seen = [], []
    buckets = {}
    for pair in paired: buckets.setdefault(max(pair[0]['scored_at'], pair[1]['scored_at']) // bucket_ms, []).append(pair)
    for bucket in sorted(buckets):
        seen += buckets[bucket]
        on, off = summary([a for a, _ in seen], costs), summary([b for _, b in seen], costs)
        keep = ('n', 'correct', 'accuracy', 'wrong_releases', 'timeouts', 'median_seconds_released', 'requests_per_case', 'sessions_per_case', 'median_usd_per_case', 'costed_cases')
        out.append({'at': (bucket + 1) * bucket_ms, 'pairs': len(seen), 'with_memory': {k: on[k] for k in keep}, 'without_memory': {k: off[k] for k in keep}})
    return out

# ---- snapshots that cannot be rebuilt --------------------------------------------------------------

def record(engine, series, subject, metrics, context=None, bucket_ms=BUCKET_MS):
    at = now()
    with engine.begin() as db:
        insert_ignore(db, points, dict(series=series, subject=subject, bucket=at // bucket_ms, at=at, metrics=metrics, context={**git(), **(context or {})}))

def last(engine, series, subject):
    with engine.connect() as db:
        row = db.execute(select(points).where(points.c.series == series, points.c.subject == subject).order_by(points.c.sequence.desc()).limit(1)).mappings().first()
    return dict(row) if row else None

def loop_state(engine, org):
    from .spend_guard import USAGE, hourly
    with engine.connect() as db:
        learned = db.execute(select(func.count()).select_from(lessons).where(lessons.c.organization_id == org)).scalar()
        skills = dict(db.execute(select(learned_skills.c.status, func.count()).where(learned_skills.c.organization_id == org).group_by(learned_skills.c.status)).all())
        control = db.execute(select(adversary_controls.c.enabled, adversary_controls.c.interval_seconds, adversary_controls.c.spawned).where(adversary_controls.c.organization_id == org)).mappings().first()
        opened = db.execute(select(func.count()).select_from(scenarios).where(scenarios.c.organization_id == org, scenarios.c.status == 'open')).scalar()
    # The usage log is not split by organization, so the spend rate is the whole machine's.
    spend = round(hourly(USAGE.read_text().splitlines()[-4000:], now()), 3) if USAGE.exists() else None
    return {'lessons': learned, 'skills': skills, 'open_cases': opened, 'adversary': dict(control) if control else None, 'usd_per_hour_all_workers': spend}

def fingerprint(files):
    out = subprocess.run(['git', 'log', '-1', '--format=%h', '--', *files], cwd=BACKEND, capture_output=True, text=True).stdout.strip()
    return out or None

def measure_retrieval(engine):
    """Asks the benchmark questions again on the kept index. Needs a first full `python -m app.retrieval_bench` run."""
    if not (BACKEND / 'var/bench/retrieval.sqlite').exists(): return 'no kept benchmark index'
    code = fingerprint(RETRIEVAL_FILES); previous = last(engine, 'retrieval', 'meridian')
    if previous and previous['context'].get('code') == code: return 'unchanged'
    target = BACKEND / 'var/bench/latest.json'
    done = subprocess.run([sys.executable, '-m', 'app.retrieval_bench', '--reuse', '--out', str(target)], cwd=BACKEND, capture_output=True, text=True, timeout=1800)
    if done.returncode: return 'failed: ' + done.stderr[-300:]
    report = json.loads(target.read_text())
    record(engine, 'retrieval', 'meridian', {mode: {**r['all'], 'linked_recall@10': r['linked']['recall@10'], 'latency_p50_ms': r['latency_ms']['p50']}
        for mode, r in report['results'].items()}, {'code': code, 'questions': report['questions'], 'embedding': report['embedding']})
    return 'measured'

def measure_tests(engine):
    head = git()['sha']; previous = last(engine, 'tests', 'backend')
    if previous and previous['context'].get('sha') == head and not git()['dirty']: return 'unchanged'
    started = time.time()
    done = subprocess.run([sys.executable, '-m', 'pytest', '-q', '-p', 'no:cacheprovider'], cwd=BACKEND, capture_output=True, text=True, timeout=1800)
    tail = done.stdout.strip().splitlines()[-1] if done.stdout.strip() else ''
    counts = {k: int(v) for v, k in re.findall(r'(\d+) (passed|failed|skipped|errors?)', tail)}
    if not counts: return 'unreadable: ' + tail[-200:]
    record(engine, 'tests', 'backend', {'passed': counts.get('passed', 0), 'failed': counts.get('failed', 0) + counts.get('error', 0) + counts.get('errors', 0),
        'skipped': counts.get('skipped', 0), 'seconds': round(time.time() - started, 1)})
    return tail

# ---- document --------------------------------------------------------------------------------------

def document(engine, orgs, since=0, bucket_ms=BUCKET_MS):
    series, costs = [], case_costs()
    for org in orgs:
        mine = graded(engine, org, since)
        series.append({'id': 'exceptions', 'subject': org, 'role': 'memory_on', 'points': exception_series(mine, bucket_ms, costs)})
        # The twin organization is whichever one holds cases mirrored from this one. Recorded, not guessed from a name.
        ids = {r['id'] for r in mine}
        with engine.connect() as db:
            mirrors = [o for o, in db.execute(select(scenarios.c.organization_id).where(scenarios.c.created_by.like('mirror:%'),
                scenarios.c.organization_id != org).distinct()) if any(r['created_by'][7:] in ids for r in graded(engine, o, since))]
        for control in mirrors:
            other = graded(engine, control, since)
            series.append({'id': 'exceptions', 'subject': control, 'role': 'memory_off', 'twin_of': org, 'points': exception_series(other, bucket_ms, costs)})
            series.append({'id': 'memory_effect', 'subject': org, 'against': control, 'points': memory_series(mine, other, bucket_ms, costs)})
            series.append({'id': 'memory_effect_hard_tier', 'subject': org, 'against': control, 'tiers': list(HARD_TIERS),
                           'points': memory_series(mine, other, bucket_ms, costs, HARD_TIERS)})
    with engine.connect() as db:
        saved = [dict(r) for r in db.execute(select(points).where(points.c.at >= since).order_by(points.c.sequence)).mappings()]
    kept = {}
    for p in saved:
        if p['series'] == 'loop_state' and p['subject'] not in orgs: continue
        kept.setdefault((p['series'], p['subject']), []).append({'at': p['at'], **p['metrics'], 'commit': p['context']})
    series += [{'id': k[0], 'subject': k[1], 'points': v} for k, v in kept.items()]
    return {'schema_version': 1, 'display_mode': 'LIVE', 'generated_at': now(), 'bucket_ms': bucket_ms, 'rolling_cases': ROLLING,
            'commit': git(), 'valid_since': VALID_SINCE, 'events': [e for e in EVENTS if e['at'] >= since], 'series': series, 'caveats': CAVEATS}

def first_encounters(rows):
    """Per hard-tier family: how many counted cases, and which encounter numbers were missed. Learning shows as [1] and nothing after."""
    out = {}
    for r in rows:
        if family_tier(r['family']) not in HARD_TIERS or not counted(r): continue
        entry = out.setdefault(r['family'], {'cases': 0, 'missed_at': []}); entry['cases'] += 1
        if r['outcome'] == 'fail': entry['missed_at'].append(entry['cases'])
    return out

def paper(engine, doc, org):
    """whitepaper/live-results.tex: the paper's live numbers, generated so nobody retypes a figure."""
    by = {(s['id'], s['subject']): s['points'] for s in doc['series']}
    tex = lambda v: str(v).replace('_', '\\_').replace('%', '\\%').replace('&', '\\&')
    stamp = time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(doc['generated_at'] / 1000))
    lines = ['% Generated by backend/app/bench_timeline.py from graded cases. Do not edit: the next tick overwrites it.',
             f"\\newcommand{{\\liveasof}}{{{stamp}, commit \\texttt{{{doc['commit']['sha']}}}}}"]
    def arm(a): return f"{a['correct']}/{a['n']}" + (f" ({a['accuracy'] * 100:.1f}\\%)" if a.get('accuracy') is not None else '')
    def usd(a): return f"\\${a['median_usd_per_case']:.3f}" if a.get('median_usd_per_case') is not None else 'not metered'
    rows = []
    for label, key in (('Trap tiers (5+)', 'memory_effect_hard_tier'), ('All tiers', 'memory_effect')):
        pts = by.get((key, org)) or []
        if not pts: continue
        p = pts[-1]
        for name, a in (('with memory', p['with_memory']), ('without memory', p['without_memory'])):
            rows.append(f"{label} & {name} & {p['pairs']} & {arm(a)} & {a['wrong_releases']} & {a['requests_per_case']:.2f} & {a['median_seconds_released']}\\,s & {usd(a)} \\\\")
    lines += ['\\newcommand{\\livememorytable}{%', '\\begin{tabular}{@{}llrlrrrr@{}}', '\\toprule',
              '\\textbf{Cases} & \\textbf{Arm} & \\textbf{Pairs} & \\textbf{Correct} & \\textbf{Wrong releases} & \\textbf{Requests} & \\textbf{Median} & \\textbf{Cost/case} \\\\',
              '\\midrule', *rows, '\\bottomrule', '\\end{tabular}}']
    seen = first_encounters(graded(engine, org))
    lines += ['\\newcommand{\\livefamilytable}{%', '\\begin{tabular}{@{}lrl@{}}', '\\toprule',
              '\\textbf{Trap family} & \\textbf{Cases} & \\textbf{Missed on encounter} \\\\', '\\midrule',
              *[f"\\texttt{{{tex(f)}}} & {v['cases']} & {', '.join(map(str, v['missed_at'])) or 'none'} \\\\" for f, v in sorted(seen.items(), key=lambda x: -x[1]['cases'])],
              '\\bottomrule', '\\end{tabular}}']
    excluded = sum(p.get('not_shown_warning', 0) for k, pts in by.items() if k[0] == 'exceptions' for p in pts)
    lines.append(f"\\newcommand{{\\liveexcluded}}{{{excluded}}}")
    ret = (by.get(('retrieval', 'meridian')) or [None])[-1]
    if ret:
        modes = [('keyword', 'BM25'), ('hybrid', 'BM25 + ELSER'), ('keyword+graph', 'BM25 + graph'), ('hybrid+graph', 'BM25 + ELSER + graph')]
        lines += ['\\newcommand{\\liveretrievaltable}{%', '\\begin{tabular}{@{}lrrrrr@{}}', '\\toprule',
                  '\\textbf{Retrievers} & \\textbf{Recall@10} & \\textbf{Unwritten-ID recall@10} & \\textbf{MRR@10} & \\textbf{nDCG@10} & \\textbf{p50} \\\\', '\\midrule',
                  *[f"{name} & {ret[m]['recall@10']:.3f} & {ret[m]['linked_recall@10']:.3f} & {ret[m]['mrr@10']:.3f} & {ret[m]['ndcg@10']:.3f} & {ret[m]['latency_p50_ms']}\\,ms \\\\" for m, name in modes if m in ret],
                  '\\bottomrule', '\\end{tabular}}']
    tests = (by.get(('tests', 'backend')) or [None])[-1]
    if tests: lines.append(f"\\newcommand{{\\livetests}}{{{tests['passed']} passed, {tests['failed']} failed}}")
    target = BACKEND.parent / 'whitepaper/live-results.tex'
    text = '\n'.join(lines) + '\n'
    body = lambda t: '\n'.join(l for l in t.splitlines() if 'liveasof' not in l)
    # The timestamp alone is not a change: rewrite only when a number moved.
    if not target.exists() or body(target.read_text()) != body(text):
        target.write_text(text)
        import shutil
        if shutil.which('tectonic'):  # the paper's PDF follows its numbers
            subprocess.run(['tectonic', 'main.tex'], cwd=target.parent, capture_output=True, timeout=300)

def tick(engine, orgs, measure=True):
    done = {}
    for org in orgs: record(engine, 'loop_state', org, loop_state(engine, org))
    if measure:
        done['tests'] = measure_tests(engine)
        try: done['retrieval'] = measure_retrieval(engine)
        except Exception as exc: done['retrieval'] = 'failed: ' + type(exc).__name__
    out = BACKEND / 'benchmarks/timeline.json'
    out.parent.mkdir(exist_ok=True)
    doc = document(engine, orgs)
    out.write_text(json.dumps(doc, indent=1) + '\n')
    # Same document beside the web app, so the Benchmarks popup reads it without a sign-in.
    public = BACKEND.parent / 'web/studio/public/benchmarks'
    if public.is_dir(): (public / 'timeline.json').write_text(json.dumps(doc) + '\n')
    try: paper(engine, doc, orgs[0])
    except Exception as exc: done['paper'] = 'failed: ' + type(exc).__name__
    return done


if __name__ == '__main__':
    from .store import Store
    parser = argparse.ArgumentParser()
    parser.add_argument('organizations', nargs='+')
    parser.add_argument('--every', type=int, default=300)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--no-measure', action='store_true', help='Skip the test suite and the retrieval questions')
    args = parser.parse_args()
    store = Store()
    while True:
        print(json.dumps({'at': now(), **tick(store.engine, args.organizations, not args.no_measure)}), flush=True)
        if args.once: break
        time.sleep(args.every)
