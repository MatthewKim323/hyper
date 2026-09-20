"""The loop's record moves between databases whole, twice without harm, and never with a credential in it."""
import pytest
from sqlalchemy import select, update

from app import loop_history
from app.counterparty import Counterparties
from app.data_service import DataService
from app.database import adversary_controls, agent_lessons, counterparty_messages, counterparty_scenarios, workflow_events
from app.store import Store


class Objects:
    def __init__(self): self.values = {}
    def put(self, key, body, content_type): self.values[key] = body
    def read(self, key): return self.values[key]


def laptop(tmp_path):
    store = Store(str(tmp_path / 'laptop.db'))
    oid = store.workspace('alice')['id']
    svc = Counterparties(DataService(store, oid, objects=Objects()))
    done, still_open = svc.spawn('internal_hold', 'adversary', seed=1), svc.spawn('clean', 'adversary', seed=2)
    with store.engine.begin() as db: db.execute(update(counterparty_scenarios).where(counterparty_scenarios.c.id == done['id']).values(status='scored', outcome='fail', scored_at=5))
    svc.add_lesson(done['id'], 'internal_hold', 'An internal hold blocks payment even when every check passes.')
    svc.control({'enabled': True, 'interval_seconds': 30, 'max_open': 4})
    return store, oid, done, still_open


def test_a_closed_case_arrives_with_its_thread_lesson_and_narration_and_an_open_one_stays_behind(tmp_path):
    store, oid, done, still_open = laptop(tmp_path)
    path = tmp_path / 'bundle.json.gz'
    loop_history.export(store, path, [oid])
    production = Store(str(tmp_path / 'production.db'))
    first = loop_history.load(production, path, adversary_off=True)
    assert first['counterparty_scenarios'] == 1 and first['agent_lessons'] == 1 and first['counterparty_messages'] >= 1 and first['workflow_events'] >= 1
    with production.engine.connect() as db:
        assert list(db.execute(select(counterparty_scenarios.c.id)).scalars()) == [done['id']], 'the open case has no engine records over there and could never be finished'
        assert db.execute(select(agent_lessons.c.lesson)).scalar().startswith('An internal hold')
        assert db.execute(select(adversary_controls.c.enabled)).scalar() in (False, 0), 'nothing spends on arrival'
    assert Counterparties(DataService(production, oid, objects=Objects())).scoreboard()['wrong_releases'] == 1
    assert all(count == 0 for count in loop_history.load(production, path, adversary_off=True).values()), 'a second import adds nothing'


def test_a_credential_in_the_data_stops_the_export(tmp_path):
    store, oid, done, _ = laptop(tmp_path)
    with store.engine.begin() as db:
        db.execute(update(counterparty_scenarios).where(counterparty_scenarios.c.id == done['id']).values(state={'agent': {'trace': [{'result': 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789'}]}}))
    with pytest.raises(SystemExit): loop_history.export(store, tmp_path / 'leak.json.gz', [oid])
    assert not (tmp_path / 'leak.json.gz').exists()
