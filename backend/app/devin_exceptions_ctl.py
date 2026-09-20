"""Turn the autonomous exception loop on or off for one organization, and show where it stands.

    uv run --directory backend python -m app.devin_exceptions_ctl on|off|status ORG [--every SECONDS] [--open N]

`on` enables both halves: the adversary that sends new exceptions and the Devin dispatcher that
works them. `off` stops new exceptions and new sessions; sessions already running finish.
"""
import argparse
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

from .counterparty import Counterparties  # noqa: E402
from .data_service import DataService  # noqa: E402
from .orchestrator import AgentService  # noqa: E402
from .store import Store  # noqa: E402

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['on', 'off', 'status'])
    parser.add_argument('organization')
    # Devin takes minutes per case, so the default pace is slow: a faster adversary only produces timeouts.
    parser.add_argument('--every', type=int, default=300)
    parser.add_argument('--open', type=int, default=2)
    args = parser.parse_args()
    store = Store()
    adversary, agents = Counterparties(DataService(store, args.organization)), AgentService(store, args.organization)
    if args.action != 'status':
        on = args.action == 'on'
        adversary.control({'enabled': on, **({'interval_seconds': args.every, 'max_open': args.open} if on else {})})
        agents.enable(on)
    board = adversary.scoreboard()
    print('adversary:', adversary.control())
    print('dispatcher:', {k: agents.controller().get(k) for k in ('enabled', 'status', 'launch_count', 'error')})
    print('scoreboard:', {k: board[k] for k in ('scored', 'correct', 'wrong_releases', 'level', 'lessons_learned')})
