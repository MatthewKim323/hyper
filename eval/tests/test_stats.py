from __future__ import annotations

import pytest

from mirror_eval import stats
from mirror_eval.schema import Measured, Unavailable


def test_per_task_rates_hand_computed():
    results = {"a": [True, True, True], "b": [True, False, False], "c": [False, False, False], "d": [True, True, False]}
    p1 = stats.pass_at_1(results)
    assert p1.value == pytest.approx((1 + 1 / 3 + 0 + 2 / 3) / 4) and p1.n == 4 and p1.unit == "ratio"
    assert stats.pass_any_of_k(results).value == pytest.approx(3 / 4)
    assert stats.pass_all_of_k(results).value == pytest.approx(1 / 4)


def test_all_of_three_is_not_the_aggregate_cubed():
    # two tasks: one always passes, one never does. pass@1 = 0.5, so 0.5 ** 3 = 0.125,
    # but exactly half the tasks pass all three trials.
    results = {"steady": [True, True, True], "broken": [False, False, False]}
    p1, all3 = stats.pass_at_1(results), stats.pass_all_of_k(results)
    assert p1.value == 0.5 and all3.value == 0.5
    assert all3.value != pytest.approx(p1.value ** 3)


def test_empty_is_unavailable():
    for fn in (stats.pass_at_1, stats.pass_any_of_k, stats.pass_all_of_k):
        assert isinstance(fn({}), Unavailable)
        assert isinstance(fn({"a": []}), Unavailable)
    assert isinstance(stats.proportion(0, 0), Unavailable)
    assert isinstance(stats.paired_bootstrap_diff({}, {}), Unavailable)
    assert stats.wilson_interval(0, 0) is None


def test_wilson_known_values():
    lo, hi = stats.wilson_interval(8, 10)
    assert lo == pytest.approx(0.4902, abs=1e-3) and hi == pytest.approx(0.9433, abs=1e-3)
    lo, hi = stats.wilson_interval(0, 10)
    assert lo == pytest.approx(0.0, abs=1e-12) and hi == pytest.approx(0.2775, abs=1e-3)
    lo, hi = stats.wilson_interval(10, 10)
    assert hi == pytest.approx(1.0, abs=1e-12) and lo == pytest.approx(0.7225, abs=1e-3)


def test_cluster_bootstrap_is_seeded_bounded_and_wider_than_task_level():
    values = {f"t{i}": (1.0 if i < 6 else 0.0) for i in range(12)}
    fams = {f"t{i}": ("good" if i < 6 else "bad") for i in range(12)}     # outcomes move with the family
    a = stats.cluster_bootstrap_ci(values, fams, seed=7)
    assert a == stats.cluster_bootstrap_ci(values, fams, seed=7)
    assert a == (0.0, 1.0)                                                 # two clusters: could draw either twice
    lo, hi = stats.cluster_bootstrap_ci(values, None, seed=7)              # treating tasks as independent
    assert 0.0 < lo < 0.5 < hi < 1.0
    assert stats.cluster_bootstrap_ci({}, None) is None


def test_degenerate_interval():
    m = stats.pass_at_1({"a": [True], "b": [True]})
    assert isinstance(m, Measured) and (m.value, m.ci_low, m.ci_high) == (1.0, 1.0, 1.0)


def test_paired_buckets_all_five():
    base = {"t1": "pass", "t2": "fail", "t3": "correct_escalation", "t4": "partial", "t5": "error", "t6": "pass"}
    cand = {"t1": "pass", "t2": "pass", "t3": "fail", "t4": "waiting", "t5": "pass"}
    rows = {r.task_id: r for r in stats.paired_buckets(base, cand, {"t1": "f"})}
    assert [rows[t].bucket for t in ("t1", "t2", "t3", "t4", "t5", "t6")] == \
        ["both_pass", "gained", "regressed", "both_fail", "unavailable", "unavailable"]
    assert rows["t6"].candidate == "not_tested" and rows["t1"].family_id == "f"


def test_paired_bootstrap_diff():
    base = {"a": 0.0, "b": 0.0, "c": 1.0, "only_base": 1.0}
    cand = {"a": 1.0, "b": 1.0, "c": 1.0, "only_cand": 0.0}
    d = stats.paired_bootstrap_diff(base, cand, seed=3)
    assert d.value == pytest.approx(2 / 3) and d.n == 3
    assert 0.0 <= d.ci_low <= d.value <= d.ci_high <= 1.0
    same = stats.paired_bootstrap_diff(base, base)
    assert (same.value, same.ci_low, same.ci_high) == (0.0, 0.0, 0.0)
