"""Delivers due counterparty replies, scores finished scenarios and lets the adversary send the next one.

    uv run --directory backend python -m app.counterparty_worker [--once]
"""
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

from sqlalchemy import select  # noqa: E402
from .counterparty import Counterparties  # noqa: E402
from .data_service import DataService  # noqa: E402
from .database import counterparty_scenarios, adversary_controls  # noqa: E402
from .store import Store  # noqa: E402


def run_once(store, data_factory=None):
    data_factory = data_factory or (lambda oid: DataService(store, oid))
    with store.engine.connect() as db:
        orgs = set(db.execute(select(counterparty_scenarios.c.organization_id).where(counterparty_scenarios.c.status == 'open')).scalars())
        orgs |= set(db.execute(select(adversary_controls.c.organization_id).where(adversary_controls.c.enabled.is_(True))).scalars())
    work = 0
    for oid in orgs:
        svc = Counterparties(data_factory(oid))
        work += svc.deliver_due() + len(svc.score()) + (1 if svc.adversary_tick() else 0)
    return work


if __name__ == '__main__':
    store = Store()
    while True:
        busy = run_once(store)
        if '--once' in sys.argv: break
        time.sleep(.5 if busy else 1.5)
