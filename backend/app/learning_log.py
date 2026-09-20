"""Writes what the exception loop has learned into the repository and commits it, so the history of
the agent's mistakes and lessons is in git and not only in a database.

The lessons are rows the worker wrote after graded cases. This copies them out, next to the score
with and without memory, into backend/benchmarks/learning/. It commits only when something a reader
would care about changed (a new lesson from a mistake, a new tier, or a fresh batch of graded
cases), only its own files, and never anything else in the working tree.

    uv run --directory backend python -m app.learning_log hyper-lab [--control hyper-lab-control] [--every 1800] [--once] [--no-push]
"""
import argparse
import json
import subprocess
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

from sqlalchemy import select  # noqa: E402

from .bench_timeline import VALID_SINCE, raced  # noqa: E402
from .counterparty import TIERS, Counterparties  # noqa: E402
from .data_service import DataService  # noqa: E402
from .database import agent_lessons as lessons, counterparty_scenarios as scenarios  # noqa: E402
from .store import Store  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'backend' / 'benchmarks' / 'learning'
GOOD = ('pass', 'correct_hold')
TIER = {family: tier for tier, families in TIERS.items() for family in families}
HARD = min(t for t in TIERS if t >= 5)
WORDS = {'pass': 'paid the right amount', 'correct_hold': 'rightly held', 'fail': 'WRONG RELEASE', 'timeout': 'ran out of time'}
CAVEATS = ('Development results. The cases, the worker prompt and the grader were written by the same people, nothing is held out, '
           'and every supplier and internal desk is simulated. After a miss the worker is given an audit finding, the way a controller '
           'would explain one, and writes its own lesson from it. Cases where the sandbox never showed the worker a warning are excluded.')


def stamp(ms): return time.strftime('%Y-%m-%d %H:%M', time.localtime(ms / 1000))


def unworked(row):
    """A timeout on a case no worker ever opened is the machine (asleep, offline, workers down), not the agent."""
    return row['outcome'] == 'timeout' and not ((row.get('state') or {}).get('agent') or {}).get('sessions')


def arm(rows):
    rows = [r for r in rows if not raced(r) and not unworked(r)]
    return {'graded': len(rows), 'correct': sum(r['outcome'] in GOOD for r in rows), 'wrong_releases': sum(r['outcome'] == 'fail' for r in rows),
            'timeouts': sum(r['outcome'] == 'timeout' for r in rows)}


def snapshot(store, treatment, control):
    with store.engine.connect() as db:
        rows = [dict(r) for r in db.execute(select(scenarios).where(scenarios.c.organization_id.in_([treatment, control]), scenarios.c.status == 'scored',
                                                                    scenarios.c.created_at >= VALID_SINCE).order_by(scenarios.c.created_at)).mappings()]
        learned = [dict(r) for r in db.execute(select(lessons.c.lesson, lessons.c.created_at, lessons.c.family, scenarios.c.outcome, scenarios.c.invoice_id, scenarios.c.facts, scenarios.c.state)
                                               .select_from(lessons.join(scenarios, scenarios.c.id == lessons.c.scenario_id))
                                               .where(lessons.c.organization_id == treatment, lessons.c.created_at >= VALID_SINCE).order_by(lessons.c.created_at)).mappings()]
    side = lambda oid, hard: [r for r in rows if r['organization_id'] == oid and (TIER.get(r['family'], 0) >= HARD) == hard]
    mistakes = [l for l in learned if l['outcome'] not in GOOD and not raced({**l, 'family': l['family']}) and not unworked(l)]
    families = {}
    for r in rows:
        if TIER.get(r['family'], 0) < HARD or raced(r) or unworked(r): continue
        entry = families.setdefault(r['family'], {treatment: '', control: ''})
        entry[r['organization_id']] += {'pass': 'P', 'correct_hold': 'H', 'fail': 'X', 'timeout': 'T'}[r['outcome']]
    return {'level': Counterparties(DataService(store, treatment)).scoreboard()['level'], 'top_tier': max(TIERS),
            'hard': {'with_memory': arm(side(treatment, True)), 'without_memory': arm(side(control, True))},
            'routine': {'with_memory': arm(side(treatment, False)), 'without_memory': arm(side(control, False))},
            'families': {f: {'tier': TIER[f], 'with_memory': v[treatment], 'without_memory': v[control]} for f, v in sorted(families.items(), key=lambda kv: (TIER[kv[0]], kv[0]))},
            'lessons': len(learned),
            'mistakes': [{'at': m['created_at'], 'invoice_id': m['invoice_id'], 'family': m['family'], 'outcome': m['outcome'],
                          'finding': (m['facts'] or {}).get('postmortem'), 'lesson': m['lesson']} for m in mistakes]}


def render(snap, treatment, control):
    hard, routine = snap['hard'], snap['routine']
    row = lambda label, a: f"| {label} | {a['correct']}/{a['graded']} | {a['wrong_releases']} | {a['timeouts']} |"
    lines = ['# What the exception worker has learned', '',
             f'Written by the loop itself from `{treatment}` (works with memory) and `{control}` (the same cases and model, no memory). Adversary tier reached: {snap["level"]} of {snap["top_tier"]}.', '',
             CAVEATS, '',
             '## Hard cases: the ledger says pay, the conversation says something else', '', '| | correct | wrong releases | timeouts |', '|---|---|---|---|',
             row('with memory', hard['with_memory']), row('without memory', hard['without_memory']), '',
             '## Routine cases', '', '| | correct | wrong releases | timeouts |', '|---|---|---|---|', row('with memory', routine['with_memory']), row('without memory', routine['without_memory']), '',
             '## Each kind of trap, case by case, oldest first', '', 'P paid correctly, H rightly held, X wrong release, T ran out of time.', '', '| trap | tier | with memory | without memory |', '|---|---|---|---|']
    lines += [f"| {f} | {v['tier']} | `{v['with_memory'] or '-'}` | `{v['without_memory'] or '-'}` |" for f, v in snap['families'].items()]
    lines += ['', f'## Mistakes, and the lesson written from each ({len(snap["mistakes"])})', '']
    for m in snap['mistakes']:
        lines += [f"### {stamp(m['at'])}  {m['invoice_id']}  ({m['family']}): {WORDS[m['outcome']]}", '']
        if m['finding']: lines += [f"Audit finding: {m['finding']}", '']
        lines += [f"Lesson the worker wrote: {m['lesson']}", '']
    if not snap['mistakes']: lines += ['None yet.', '']
    return '\n'.join(lines)


def headline(snap, before):
    hard = snap['hard']
    new = len(snap['mistakes']) - len((before or {}).get('mistakes', []))
    bits = [f"tier {snap['level']}", f"hard cases {hard['with_memory']['correct']}/{hard['with_memory']['graded']} with memory against {hard['without_memory']['correct']}/{hard['without_memory']['graded']} without"]
    if new > 0: bits.append(f"{new} new lesson{'s' if new != 1 else ''} from a mistake")
    return 'learning log: ' + ', '.join(bits)


def worth_committing(snap, before):
    if not before: return True
    graded = lambda s: s['hard']['with_memory']['graded'] + s['routine']['with_memory']['graded']
    return len(snap['mistakes']) != len(before['mistakes']) or snap['level'] != before['level'] or graded(snap) - graded(before) >= 25


def git(*args): return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, timeout=120)


def publish(message, push=True):
    """Commit the log and nothing else. Other sessions work in this tree: their files are never staged here."""
    paths = [str(p.relative_to(ROOT)) for p in (OUT / 'LESSONS.md', OUT / 'snapshot.json')]
    if git('add', '--', *paths).returncode: return 'add failed'
    if not git('diff', '--cached', '--quiet', '--', *paths).returncode: return 'unchanged'
    if (done := git('commit', '-m', message, '--', *paths)).returncode: return 'commit failed: ' + done.stderr.strip()[:160]
    if not push: return 'committed'
    for _ in range(3):
        if git('pull', '--rebase', '--autostash', '-q').returncode: git('rebase', '--abort'); time.sleep(5); continue
        if not git('push', '-q').returncode: return 'pushed'
        time.sleep(5)
    return 'committed, push failed (the next run retries)'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('organization')
    parser.add_argument('--control')
    parser.add_argument('--every', type=int, default=1800)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--no-push', action='store_true')
    args = parser.parse_args()
    control, store = args.control or args.organization + '-control', Store()
    OUT.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            before = json.loads((OUT / 'snapshot.json').read_text()) if (OUT / 'snapshot.json').exists() else None
            snap = snapshot(store, args.organization, control)
            if worth_committing(snap, before):
                (OUT / 'LESSONS.md').write_text(render(snap, args.organization, control) + '\n')
                (OUT / 'snapshot.json').write_text(json.dumps(snap, indent=1) + '\n')
                print(time.strftime('%H:%M:%S'), headline(snap, before), '->', publish(headline(snap, before), not args.no_push), flush=True)
            else: print(time.strftime('%H:%M:%S'), 'nothing new worth a commit', flush=True)
        except Exception as exc: print(time.strftime('%H:%M:%S'), 'learning log:', type(exc).__name__, str(exc)[:160], flush=True)
        if args.once: break
        time.sleep(args.every)
