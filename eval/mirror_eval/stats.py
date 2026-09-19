"""Statistics for repeated trials. Standard library only.

Every rate is computed per task first and then averaged across tasks. success-on-all-k is
the share of tasks whose k trials all succeeded. It is never pass@1 raised to the k.

Units (the frontend relies on these): rates are unit "ratio" in 0..1, money is "USD",
time is "ms", counts are "count".
"""
from __future__ import annotations

import math
import random
from typing import Mapping, Sequence

from .schema import Measured, Metric, Outcome, TaskDelta, Unavailable

Results = Mapping[str, Sequence[bool]]          # task id -> one bool per trial
Families = Mapping[str, str | None]             # task id -> family id

N_BOOT = 2000
SEED = 20260919
CI_METHOD = "family-level bootstrap, 95%"
_NO_TRIALS = "no graded trials"


def _mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs)


def _task_pass_rate(trials: Sequence[bool]) -> float:
    return _mean([1.0 if t else 0.0 for t in trials])


def _task_any(trials: Sequence[bool]) -> float:
    return 1.0 if any(trials) else 0.0


def _task_all(trials: Sequence[bool]) -> float:
    return 1.0 if all(trials) else 0.0


def wilson_interval(successes: int, n: int, z: float = 1.959964) -> tuple[float, float] | None:
    if n <= 0:
        return None
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def _percentile(sorted_xs: Sequence[float], q: float) -> float:
    pos = q * (len(sorted_xs) - 1)
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_xs[lo] + (sorted_xs[hi] - sorted_xs[lo]) * (pos - lo)


def cluster_bootstrap_ci(task_values: Mapping[str, float], families: Families | None = None,
                         seed: int = SEED, n_boot: int = N_BOOT) -> tuple[float, float] | None:
    """Resample whole families with replacement. Tasks inside a family share a failure mode,
    so treating them as independent draws would make the interval too narrow. A task with no
    family is its own cluster."""
    if not task_values:
        return None
    clusters: dict[str, list[float]] = {}
    for task, v in task_values.items():
        clusters.setdefault((families or {}).get(task) or f"task:{task}", []).append(v)
    keys = sorted(clusters)
    rng = random.Random(seed)
    means = []
    for _ in range(n_boot):
        drawn = [v for _ in keys for v in clusters[rng.choice(keys)]]
        means.append(_mean(drawn))
    means.sort()
    return _percentile(means, 0.025), _percentile(means, 0.975)


def _rate(results: Results, per_task, families: Families | None, seed: int) -> Metric:
    graded = {t: list(v) for t, v in results.items() if len(v) > 0}
    if not graded:
        return Unavailable(reason=_NO_TRIALS)
    values = {t: per_task(v) for t, v in graded.items()}
    ci = cluster_bootstrap_ci(values, families, seed)
    return Measured(value=_mean(list(values.values())), unit="ratio", n=len(values),
                    ci_low=ci[0], ci_high=ci[1], ci_method=CI_METHOD)


def pass_at_1(results: Results, families: Families | None = None, seed: int = SEED) -> Metric:
    """Mean over tasks of the task's own trial pass rate."""
    return _rate(results, _task_pass_rate, families, seed)


def pass_any_of_k(results: Results, families: Families | None = None, seed: int = SEED) -> Metric:
    return _rate(results, _task_any, families, seed)


def pass_all_of_k(results: Results, families: Families | None = None, seed: int = SEED) -> Metric:
    return _rate(results, _task_all, families, seed)


def proportion(successes: int, n: int, unit: str = "ratio") -> Metric:
    """A plain proportion with a Wilson interval, for subsets too small to bootstrap by family."""
    ci = wilson_interval(successes, n)
    if ci is None:
        return Unavailable(reason=_NO_TRIALS)
    return Measured(value=successes / n, unit=unit, n=n, ci_low=ci[0], ci_high=ci[1], ci_method="Wilson, 95%")


# paired comparison

_NO_SIGNAL: set[Outcome] = {"error", "not_tested", "unsupported"}
_SUCCESS: set[Outcome] = {"pass", "correct_escalation"}


def bucket(baseline: Outcome | None, candidate: Outcome | None) -> str:
    if baseline is None or candidate is None or baseline in _NO_SIGNAL or candidate in _NO_SIGNAL:
        return "unavailable"
    b, c = baseline in _SUCCESS, candidate in _SUCCESS
    return {(True, True): "both_pass", (False, True): "gained",
            (True, False): "regressed", (False, False): "both_fail"}[(b, c)]


def paired_buckets(baseline: Mapping[str, Outcome], candidate: Mapping[str, Outcome],
                   families: Families | None = None) -> list[TaskDelta]:
    """One row per task seen on either side. A task missing on one side, or one that errored,
    is unavailable: it says nothing about which system is better."""
    rows = []
    for task in sorted(set(baseline) | set(candidate)):
        b, c = baseline.get(task), candidate.get(task)
        rows.append(TaskDelta(task_id=task, family_id=(families or {}).get(task),
                              baseline=b or "not_tested", candidate=c or "not_tested", bucket=bucket(b, c)))
    return rows


def paired_bootstrap_diff(baseline: Mapping[str, float], candidate: Mapping[str, float],
                          families: Families | None = None, seed: int = SEED,
                          n_boot: int = N_BOOT) -> Metric:
    """Candidate minus baseline on per-task success rates, over tasks both systems ran.
    The same resampled families are used for both sides, so task difficulty cancels."""
    shared = sorted(set(baseline) & set(candidate))
    if not shared:
        return Unavailable(reason="no tasks were run by both systems")
    diffs = {t: candidate[t] - baseline[t] for t in shared}
    ci = cluster_bootstrap_ci(diffs, families, seed, n_boot)
    return Measured(value=_mean(list(diffs.values())), unit="ratio", n=len(shared),
                    ci_low=ci[0], ci_high=ci[1], ci_method="paired " + CI_METHOD)
