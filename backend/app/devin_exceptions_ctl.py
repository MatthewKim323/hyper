"""Turn the autonomous exception loop on or off for one organization, and show where it stands.

    uv run --directory backend python -m app.devin_exceptions_ctl on|off|status ORG [--every SECONDS] [--open N]
    uv run --directory backend python -m app.devin_exceptions_ctl compare ORG [CONTROL_ORG] [--since EPOCH_MS]
    uv run --directory backend python -m app.devin_exceptions_ctl skills ORG
    uv run --directory backend python -m app.devin_exceptions_ctl moved NEW_BASE_URL

`on` starts the adversary that sends new exceptions, creating the organization if it is new (a lab
organization keeps the high-volume sandbox out of the demo company's evidence). With --devin it also
enables the Devin dispatcher; without it, whichever worker is running picks the cases up.
`off` stops new exceptions and new Devin sessions; sessions already running finish.
"""
import argparse
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

from sqlalchemy import select  # noqa: E402

from .counterparty import Counterparties  # noqa: E402
from .database import counterparty_scenarios as scenarios, insert_ignore, learned_skills, learned_skill_runs, organizations  # noqa: E402
from .data_service import DataService  # noqa: E402
from .orchestrator import AgentService  # noqa: E402
from .store import Store  # noqa: E402

GOOD = ('pass', 'correct_hold')


def compare(store, treatment, control, since=0):
    """Memory on against memory off, on the cases the two organizations share. Small samples stay labelled small."""
    with store.engine.connect() as db:
        rows = db.execute(select(scenarios).where(scenarios.c.organization_id.in_([treatment, control]), scenarios.c.status == 'scored', scenarios.c.created_at >= since)).mappings().all()
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


def moved(store, base):
    """The tunnel address changes on every restart. Sessions in flight still hold the old one, so tell them."""
    from .database import agent_tasks
    from .devin_worker import Devin
    if not base.startswith('https://'): raise SystemExit('the new address must be https')
    provider = Devin()
    with store.engine.connect() as db:
        rows = db.execute(select(agent_tasks.c.session_id).where(agent_tasks.c.status == 'running', agent_tasks.c.session_id.isnot(None))).scalars().all()
    for sid in rows:
        try:
            provider.message(sid, f'The application API moved. Use {base} as the base URL for every request from now on, with the same APP_AGENT_TOKEN. '
                                  'The old address no longer answers. Reread saved state first (get_case, get_counterparty_thread), then continue your task; do not repeat requests you already made.')
            print('  told', sid)
        except Exception as exc: print('  could not reach', sid, type(exc).__name__)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['on', 'off', 'status', 'compare', 'skills', 'moved'])
    parser.add_argument('organization')
    parser.add_argument('control', nargs='?')
    # Devin takes minutes per case, so the default pace is slow: a faster adversary only produces timeouts.
    parser.add_argument('--every', type=int, default=300)
    parser.add_argument('--open', type=int, default=2)
    # compare: only cases created at or after this epoch-millisecond mark, e.g. when the worker or model changed.
    parser.add_argument('--since', type=int, default=0)
    parser.add_argument('--devin', action='store_true', help='also switch the Devin dispatcher')
    args = parser.parse_args()
    store = Store()
    if args.action == 'compare': compare(store, args.organization, args.control or args.organization + '-control', args.since); raise SystemExit
    if args.action == 'skills': skills(store, args.organization); raise SystemExit
    if args.action == 'moved': moved(store, args.organization); raise SystemExit
    adversary, agents = Counterparties(DataService(store, args.organization)), AgentService(store, args.organization)
    if args.action != 'status':
        on = args.action == 'on'
        with store.engine.begin() as db: insert_ignore(db, organizations, dict(id=args.organization, name='Sandbox lab'))
        adversary.control({'enabled': on, **({'interval_seconds': args.every, 'max_open': args.open} if on else {})})
        if args.devin or not on: agents.enable(on)
    board = adversary.scoreboard()
    print('adversary:', adversary.control())
    print('dispatcher:', {k: agents.controller().get(k) for k in ('enabled', 'status', 'launch_count', 'error')})
    print('scoreboard:', {k: board[k] for k in ('scored', 'correct', 'wrong_releases', 'level', 'lessons_learned')})
