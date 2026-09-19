"""Matched comparison between two persisted runs. A comparison that is not matched is still
written, with comparable=false and the reasons, so nobody can quietly chart it."""
from __future__ import annotations

import json
from pathlib import Path

from . import stats
from .runner import load_run
from .schema import Comparison

# Worst first. A task's outcome over k trials is its worst trial, so "pass" means all k passed.
_SEVERITY = ["error", "not_tested", "unsupported", "fail", "partial", "waiting", "correct_escalation", "pass"]
_MATCH_KEYS = ("suite", "data_hashes", "trials_per_task", "limits", "grader_version")


def task_outcomes(records: list[dict]) -> dict[str, str]:
    by_task: dict[str, list[str]] = {}
    for r in records:
        by_task.setdefault(r["trial"]["task_id"], []).append(r["trial"]["outcome"])
    return {t: min(v, key=_SEVERITY.index) for t, v in by_task.items()}


def build_comparison(baseline: tuple[dict, list[dict]], candidate: tuple[dict, list[dict]], kind: str) -> Comparison:
    (bm, br), (cm, cr) = baseline, candidate
    reasons, comparable = [], True
    for key in _MATCH_KEYS:
        same = bm.get(key) == cm.get(key)
        comparable &= same
        reasons.append(f"{key}: {'same' if same else 'DIFFERENT'}")
    for label, m in (("baseline", bm), ("candidate", cm)):
        if m.get("execution") != "completed":
            comparable = False
            reasons.append(f"{label} run execution is {m.get('execution')}")
        if m["system"]["kind"] == "ORACLE_SMOKE":
            comparable = False
            reasons.append(f"{label} is an oracle smoke run, which is a grader check and not a system")
    changed = sorted(k for k in set(bm["system"]) | set(cm["system"])
                     if k not in ("id", "label", "created_at", "notes") and bm["system"].get(k) != cm["system"].get(k))
    families = {r["trial"]["task_id"]: r["trial"]["family_id"] for r in br + cr}
    rows = stats.paired_buckets(task_outcomes(br), task_outcomes(cr), families)
    n_unavailable = sum(1 for r in rows if r.bucket == "unavailable")
    if n_unavailable:
        reasons.append(f"{n_unavailable} tasks unavailable (missing, errored or not tested on one side)")
    return Comparison(id=f"{bm['run_id']}__vs__{cm['run_id']}", kind=kind, baseline_run_id=bm["run_id"],
                      candidate_run_id=cm["run_id"], comparable=comparable, reasons=reasons,
                      changed=changed, tasks=rows)


def compare_run_dirs(baseline_dir: Path, candidate_dir: Path, kind: str, out_dir: Path) -> Path:
    comparison = build_comparison(load_run(baseline_dir), load_run(candidate_dir), kind)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{comparison.id}.json"
    out.write_text(json.dumps(comparison.model_dump(), indent=2) + "\n")
    return out
