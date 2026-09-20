"""Turn the autonomous exception loop on or off for one organization, and show where it stands.

    uv run --directory backend python -m app.devin_exceptions_ctl on|off|status ORG [--every SECONDS] [--open N]
    uv run --directory backend python -m app.devin_exceptions_ctl compare ORG CONTROL_ORG
    uv run --directory backend python -m app.devin_exceptions_ctl skills ORG

`on` enables both halves: the adversary that sends new exceptions and the Devin dispatcher that
works them. `off` stops new exceptions and new sessions; sessions already running finish.
"""
import argparse
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

from sqlalchemy import select  # noqa: E402

from .counterparty import Counterparties  # noqa: E402
from .database import counterparty_scenarios as scenarios, learned_skills, learned_skill_runs  # noqa: E402
from .data_service import DataService  # noqa: E402
from .orchestrator import AgentService  # noqa: E402
from .store import Store  # noqa: E402

GOOD = ('pass', 'correct_hold')


def compare(store, treatment, control):
    """Memory on against memory off, on the cases the two organizations share. Small samples stay labelled small."""
    with store.engine.connect() as db:
        rows = db.execute(select(scenarios).where(scenarios.c.organization_id.in_([treatment, control]), scenarios.c.status == 'scored')).mappings().all()
    twins = {r['created_by'][7:]: r for r in rows if r['organization_id'] == control and r['created_by'].startswith('mirror:')}
    paired = [(r, twins[r['id']]) for r in rows if r['organization_id'] == treatment and r['id'] in twins]
    print(f'paired graded cases: {len(paired)}' + ('   (too few to read anything into)' if len(paired) < 20 else ''))
    if not paired: return
    def line(label, side):
        n = len(side); seconds = sorted((r['scored_at'] - r['created_at']) / 1000 for r in side)
        print(f"  {label:<16} correct {sum(r['outcome'] in GOOD for r in side)}/{n}   wrong releases {sum(r['outcome'] == 'fail' for r in side)}   timeouts {sum(r['outcome'] == 'timeout' for r in side)}"
              f"   requests/case {sum(r['state'].get('requests', 0) for r in side) / n:.1f}   repeated {sum(r['state'].get('repeats', 0) for r in side)}   median {seconds[n // 2]:.0f}s")
    line('with memory', [a for a, _ in paired]); line('without memory', [b for _, b in paired])
    for tier in sorted({a['difficulty'] for a, _ in paired}):
        side = [(a, b) for a, b in paired if a['difficulty'] == tier]
        print(f"  tier {tier}: with {sum(a['outcome'] in GOOD for a, _ in side)}/{len(side)}   without {sum(b['outcome'] in GOOD for _, b in side)}/{len(side)}")
    print('  matched by family and tier, not by invoice: each side gets its own amounts. One run, simulated counterparties.')


def skills(store, oid):
    """Drafts waiting for an owner. Activation stays a person's attested decision; this only shows what is ready for one."""
    with store.engine.connect() as db:
        for skill in db.execute(select(learned_skills).where(learned_skills.c.organization_id == oid).order_by(learned_skills.c.created_at)).mappings():
            runs = db.execute(select(learned_skill_runs.c.id, learned_skill_runs.c.outcome).where(learned_skill_runs.c.skill_id == skill['id']).order_by(learned_skill_runs.c.sequence.desc())).all()
            ready = skill['status'] == 'draft' and runs and runs[0].outcome == 'passed'
            print(f"  {skill['status']:<11} {skill['name']} v{skill['version']}   runs {len(runs)}" + (f"   READY FOR REVIEW  skill_id={skill['id']} run_id={runs[0].id} hash={skill['package_hash']}" if ready else ''))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['on', 'off', 'status', 'compare', 'skills'])
    parser.add_argument('organization')
    parser.add_argument('control', nargs='?')
    # Devin takes minutes per case, so the default pace is slow: a faster adversary only produces timeouts.
    parser.add_argument('--every', type=int, default=300)
    parser.add_argument('--open', type=int, default=2)
    args = parser.parse_args()
    store = Store()
    if args.action == 'compare': compare(store, args.organization, args.control or args.organization + '-control'); raise SystemExit
    if args.action == 'skills': skills(store, args.organization); raise SystemExit
    adversary, agents = Counterparties(DataService(store, args.organization)), AgentService(store, args.organization)
    if args.action != 'status':
        on = args.action == 'on'
        adversary.control({'enabled': on, **({'interval_seconds': args.every, 'max_open': args.open} if on else {})})
        agents.enable(on)
    board = adversary.scoreboard()
    print('adversary:', adversary.control())
    print('dispatcher:', {k: agents.controller().get(k) for k in ('enabled', 'status', 'launch_count', 'error')})
    print('scoreboard:', {k: board[k] for k in ('scored', 'correct', 'wrong_releases', 'level', 'lessons_learned')})
