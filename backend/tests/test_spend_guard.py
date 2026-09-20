"""The spend guard prices metered usage and paces the adversary toward the cap."""
import json
from app.spend_guard import hourly, next_interval


def line(at, model='gpt-5.6-terra', fresh=100_000, cached=0, out=0):
    return json.dumps({'at': at, 'model': model, 'input': fresh + cached, 'cached': cached, 'output': out})


def test_usage_is_priced_at_list_rates_over_the_window():
    now = 10_000_000
    lines = [line(now - 1000, fresh=1_000_000), line(now - 1000, fresh=0, cached=1_000_000), line(now - 1000, fresh=0, out=1_000_000), line(now - 700_000, fresh=9_000_000), 'not json']
    assert round(hourly(lines, now), 2) == round((2 + 0.2 + 12) * 6, 2), 'ten minutes scaled to an hour, old lines ignored'


def test_an_unknown_model_is_priced_as_the_dearest():
    assert hourly([line(999, model='something-new', fresh=1_000_000)], 1000) == 10 * 6


def test_the_interval_moves_toward_the_cap_and_stays_in_bounds():
    assert next_interval(80, 34, 5) > 300, 'far over the cap: exceptions get much rarer'
    assert 40 < next_interval(80, 3, 5) < 80, 'under the cap: a little faster, not a lurch'
    assert next_interval(80, 0, 5) == 80, 'no usage yet: leave it alone'
    assert next_interval(21, 0.01, 5) == 20 and next_interval(3000, 500, 5) == 3600


def test_the_guard_reads_usage_from_the_database_so_it_works_from_another_machine(tmp_path):
    import time
    from app.database import agent_usage
    from app.spend_guard import hourly_from_database
    from app.store import Store
    store, now = Store(str(tmp_path / 'usage.db')), int(time.time() * 1000)
    with store.engine.begin() as db:
        db.execute(agent_usage.insert().values(id='a', model='gpt-5.6-terra', input_tokens=1_000_000, cached_tokens=0, output_tokens=0, at=now - 1000))
        db.execute(agent_usage.insert().values(id='b', model='gpt-5.6-terra', input_tokens=9_000_000, cached_tokens=0, output_tokens=0, at=now - 3_600_000))
    assert round(hourly_from_database(store.engine, now), 2) == 12.0, 'two dollars in ten minutes is twelve an hour; the old row is outside the window'
