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
