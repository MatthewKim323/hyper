"""Assemble the BenchmarksDocument the frontend renders.

export_demo         the real document. display_mode LIVE even with zero runs: an honest
                    empty document is still real.
make_layout_sample  a synthetic document for building the UI. display_mode DEV_FIXTURE,
                    every id and label starts with SAMPLE. It is never a result.
"""
from __future__ import annotations

import json
import random
import shutil
from pathlib import Path

from . import capabilities as caps
from . import registry
from .compare import build_comparison
from .paths import EXPORT_ROOT, RUNS_ROOT, WEB_PUBLIC_DIR
from .runner import build_run, git_commit, load_run, now_iso
from .schema import (BenchmarksDocument, Capability, Claim, Comparison, Family, Measured, OutcomeCounts, Run,
                     SystemManifest, Trial, Unavailable)

COMPARISONS_DIRNAME = "comparisons"


def _write(doc: BenchmarksDocument, out_path: Path, web_name: str | None) -> Path:
    """Validate by round trip, write, and mirror the one file into the web app's public dir."""
    payload = json.dumps(doc.model_dump(), indent=2) + "\n"
    BenchmarksDocument.model_validate_json(payload)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(payload)
    if web_name:
        WEB_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(out_path, WEB_PUBLIC_DIR / web_name)
    return out_path


def discover_runs(runs_root: Path = RUNS_ROOT) -> list[tuple[dict, list[dict]]]:
    """Every persisted run, oldest first. Of the oracle smoke runs only the latest per suite is
    kept: they are repeated grader checks, not a history worth charting."""
    runs_root = Path(runs_root)
    if not runs_root.exists():
        return []
    loaded = [load_run(d) for d in sorted(runs_root.iterdir())
              if d.name != COMPARISONS_DIRNAME and (d / "manifest.json").exists()]
    loaded.sort(key=lambda mr: mr[0].get("started_at") or "")
    latest_oracle: dict[str, str] = {}
    for m, _ in loaded:
        if m["system"]["kind"] == "ORACLE_SMOKE":
            latest_oracle[m["suite"]["id"]] = m["run_id"]
    return [(m, r) for m, r in loaded
            if m["system"]["kind"] != "ORACLE_SMOKE" or latest_oracle[m["suite"]["id"]] == m["run_id"]]


def build_document(runs_root: Path = RUNS_ROOT) -> BenchmarksDocument:
    suites = registry.load_suites()
    provenance = {s.id: s.provenance for s in suites}
    systems: dict[str, SystemManifest] = {}
    runs, trials = [], []
    for manifest, records in discover_runs(runs_root):
        system = SystemManifest.model_validate(manifest["system"])
        systems.setdefault(system.id, system)
        runs.append(build_run(manifest, records, provenance.get(manifest["suite"]["id"], "custom")))
        # Oracle trials are left out: per-case oracle outcomes are the expected outcomes, and
        # those stay private. The oracle run's aggregate counts are enough for a grader check.
        if system.kind != "ORACLE_SMOKE":
            trials += [Trial.model_validate(r["trial"]) for r in records]
    comparisons = []
    cdir = Path(runs_root) / COMPARISONS_DIRNAME
    if cdir.exists():
        comparisons = [Comparison.model_validate_json(p.read_text()) for p in sorted(cdir.glob("*.json"))]
    return BenchmarksDocument(generated_at=now_iso(), generator_commit=git_commit(), display_mode="LIVE",
                              systems=list(systems.values()), suites=suites, capabilities=caps.capabilities(),
                              runs=runs, trials=trials, comparisons=comparisons, claims=caps.claims())


def export_demo(out_path: Path = EXPORT_ROOT / "benchmarks.json", runs_root: Path = RUNS_ROOT,
                mirror_to_web: bool = True) -> Path:
    return _write(build_document(runs_root), out_path, "benchmarks.json" if mirror_to_web else None)


# Layout sample. Synthetic on purpose, stable under a fixed seed, and loud about what it is.

SAMPLE_NOTE = "layout sample, not a result"
SAMPLE_SEED = 20260919
SAMPLE_GENERATED_AT = "2026-01-01T00:00:00Z"
_SAMPLE_TASKS = [f"SAMPLE-TASK-{i:02d}" for i in range(1, 19)]
_SAMPLE_FAMILIES = [f"SAMPLE-family-{c}" for c in "abcdef"]
_SAMPLE_HOLD_TASKS = set(_SAMPLE_TASKS[12:])           # last two families are hold-type tasks
_SAMPLE_SYSTEMS = [                                     # (id, label, kind, created_at, success probability)
    ("SAMPLE-rules-baseline", "SAMPLE rules baseline", "RULES_BASELINE", "2026-01-05T09:00:00Z", 0.30),
    ("SAMPLE-full-v1", "SAMPLE full system v1", "FULL_SYSTEM", "2026-01-12T09:00:00Z", 0.50),
    ("SAMPLE-full-v2", "SAMPLE full system v2", "FULL_SYSTEM", "2026-01-19T09:00:00Z", 0.62),
    ("SAMPLE-full-v3", "SAMPLE full system v3 checkpoint", "FULL_SYSTEM", "2026-01-26T09:00:00Z", 0.74),
    ("SAMPLE-full-v4", "SAMPLE full system v4 checkpoint", "FULL_SYSTEM", "2026-02-02T09:00:00Z", 0.86),
]
# Forced rows so the v1 vs v2 comparison shows every bucket: (task index, v1 outcomes, v2 outcomes).
_FORCED = {0: ("ok", "ok"), 1: ("bad", "ok"), 2: ("ok", "bad"), 3: ("bad", "bad"), 4: ("error", "ok")}


def _sample_family(task_id: str) -> str:
    return _SAMPLE_FAMILIES[_SAMPLE_TASKS.index(task_id) // 3]


def _sample_record(run_id: str, task_id: str, index: int, kind: str, rng: random.Random) -> dict:
    hold = task_id in _SAMPLE_HOLD_TASKS
    outcome = {"ok": "correct_escalation" if hold else "pass", "error": "error",
               "bad": rng.choice(["fail", "fail", "partial"] + ([] if hold else ["waiting"]))}[kind]
    ok, err = kind == "ok", kind == "error"
    blocked = rng.choice([0, 0, 1])
    trial = Trial(id=f"{run_id}:{task_id}:{index}", run_id=run_id, task_id=task_id,
                  family_id=_sample_family(task_id), trial_index=index,
                  execution="failed" if err else "completed", outcome=outcome,
                  native_score=Measured(value=1.0 if ok else 0.0, unit="ratio", n=1),
                  evidence_checks_passed=None if err else (3 if ok else rng.choice([1, 2])),
                  evidence_checks_total=None if err else 3,
                  control_failures=["approval_current"] if outcome == "fail" and rng.random() < 0.3 else [],
                  error_class="timeout" if err else None, wall_ms=rng.randint(20_000, 90_000))
    return {
        "trial": trial.model_dump(),
        "grade": {"success": ok, "eligible_resolvable": not hold, "invalid_actions_attempted": blocked,
                  "invalid_actions_blocked": blocked, "invalid_actions_accepted": 0},
        "metrics": {"cost_usd": round(rng.uniform(0.05, 0.40), 4), "tool_calls": rng.randint(6, 30),
                    "external_messages": rng.randint(0, 3), "required_approvals": 0 if hold or not ok else 1,
                    "investigative_assists": 1 if rng.random() < 0.08 else 0},
        "incident": f"timeout ({SAMPLE_NOTE})" if err else None,
    }


def _sample_ap_run(system_id: str, created_at: str, p: float, rng: random.Random) -> tuple[dict, list[dict]]:
    run_id = f"SAMPLE-run-ap_workflow-{system_id.removeprefix('SAMPLE-')}"
    forced_col = {"SAMPLE-full-v1": 0, "SAMPLE-full-v2": 1}.get(system_id)
    records = []
    for t_index, task_id in enumerate(_SAMPLE_TASKS):
        for k in range(3):
            kind = "ok" if rng.random() < p else "bad"
            if forced_col is not None and t_index in _FORCED:
                kind = _FORCED[t_index][forced_col]
                kind = "ok" if kind == "error" and k > 0 else kind      # one errored trial is enough
            records.append(_sample_record(run_id, task_id, k, kind, rng))
    day = created_at[:10]
    manifest = {"run_id": run_id, "mode": "DEV_FIXTURE", "execution": "completed",
                "suite": {"id": "ap_workflow", "version": "SAMPLE", "split": "SAMPLE"},
                "system": {"id": system_id, "kind": "FULL_SYSTEM"},
                "data_hashes": {t: "SAMPLE" for t in _SAMPLE_TASKS}, "trials_per_task": 3, "seed": SAMPLE_SEED,
                "limits": {}, "grader_version": "SAMPLE", "started_at": f"{day}T10:00:00Z",
                "finished_at": f"{day}T10:42:00Z", "incidents": [SAMPLE_NOTE],
                "reproduce": "uv run python -m mirror_eval sample"}
    return manifest, records


def _sample_external_run(suite_id: str, system_id: str, created_at: str, score: float, n: int) -> Run:
    na = Unavailable(reason=f"{SAMPLE_NOTE}: metric not modeled for this suite")
    day = created_at[:10]
    return Run(id=f"SAMPLE-run-{suite_id}-{system_id.removeprefix('SAMPLE-')}", suite_id=suite_id,
               system_id=system_id, mode="DEV_FIXTURE", execution="completed", provenance="adapted_external",
               started_at=f"{day}T12:00:00Z", finished_at=f"{day}T13:30:00Z", n_tasks=n, trials_per_task=1,
               native_score=Measured(value=score, unit="ratio", n=n), whole_task_success=Measured(value=score, unit="ratio", n=n),
               unassisted_completion=na, correct_escalation_rate=na,
               pass_at_1=Measured(value=score, unit="ratio", n=n), pass_any_of_k=na, pass_all_of_k=na,
               outcomes=OutcomeCounts(n_pass=round(score * n), n_fail=n - round(score * n)),
               required_approvals=na, investigative_assists=na, invalid_actions_attempted=na,
               invalid_actions_blocked=na, invalid_actions_accepted=na,
               cost_usd=Measured(value=round(n * 0.11, 2), unit="USD", n=n),
               wall_ms=Measured(value=float(n * 41_000), unit="ms", n=n), tool_calls=na, external_messages=na,
               incidents=[SAMPLE_NOTE], reproduce="uv run python -m mirror_eval sample")


def build_layout_sample() -> BenchmarksDocument:
    rng = random.Random(SAMPLE_SEED)
    systems = [SystemManifest(id=i, label=label, kind=kind, created_at=created, git_commit="SAMPLE",
                              models={"investigator": "SAMPLE-model", "reviewer": "SAMPLE-model"},
                              prompts_version="SAMPLE", tools_version="SAMPLE", policy_version="SAMPLE",
                              memory_enabled=kind == "FULL_SYSTEM", reviewer_enabled=kind == "FULL_SYSTEM",
                              notes=SAMPLE_NOTE)
               for i, label, kind, created, _ in _SAMPLE_SYSTEMS]
    suites = []
    for s in registry.load_suites():
        update = {"access_note": SAMPLE_NOTE, "native_metric_note": SAMPLE_NOTE}
        if s.id == "ap_workflow":
            update["families"] = [Family(id=f, name=f"SAMPLE family {f[-1]}", task_count=3) for f in _SAMPLE_FAMILIES]
        suites.append(s.model_copy(update=update))

    runs, trials, loaded = [], [], {}
    for system_id, _, _, created, p in _SAMPLE_SYSTEMS:
        manifest, records = _sample_ap_run(system_id, created, p, rng)
        loaded[system_id] = (manifest, records)
        runs.append(build_run(manifest, records).model_copy(update={"artifact_ref": None}))
        trials += [Trial.model_validate(r["trial"]) for r in records]
    for suite_id, n, scores in (("dabstep", 450, (0.18, 0.31, 0.37)), ("apex_public_dev", 60, (0.12, 0.27, 0.33))):
        for (system_id, _, _, created, _), score in zip(_SAMPLE_SYSTEMS[:3], scores):
            runs.append(_sample_external_run(suite_id, system_id, created, score, n))

    base, cand = loaded["SAMPLE-full-v1"], loaded["SAMPLE-full-v2"]
    for m in (base[0], cand[0]):
        m["system"] = {"id": m["system"]["id"], "kind": "FULL_SYSTEM", "prompts_version": m["system"]["id"]}
    comparison = build_comparison(base, cand, "FULL_SYSTEM").model_copy(update={
        "id": "SAMPLE-comparison-v1-vs-v2", "reasons": [SAMPLE_NOTE, "same synthetic tasks, trials and limits"]})
    missing = {"both_pass", "gained", "regressed", "both_fail", "unavailable"} - {t.bucket for t in comparison.tasks}
    if missing:
        raise AssertionError(f"layout sample lost buckets: {missing}")

    capabilities, claims = [], []
    for c in caps.capabilities():
        passed = rng.randint(1, 6)
        capabilities.append(Capability(
            id=f"SAMPLE-{c.id}", area=c.area, name="SAMPLE " + c.name,
            status=rng.choice(["supported", "partial", "untested", "unsupported"]),
            test_families=_SAMPLE_FAMILIES[:2], task_count=6, passed=passed, failed=6 - passed, note=SAMPLE_NOTE))
    for c in caps.claims():
        status = rng.choice(["supported", "untested", "unsupported"])
        claims.append(Claim(id=f"SAMPLE-{c.id}", claim="SAMPLE " + c.claim.replace(caps.ENGINE_LEVEL, ""),
                            status=status, evidence_refs=[comparison.id] if status == "supported" else [],
                            demo_allowed=status == "supported"))
    return BenchmarksDocument(generated_at=SAMPLE_GENERATED_AT, generator_commit="SAMPLE", display_mode="DEV_FIXTURE",
                              systems=systems, suites=suites, capabilities=capabilities, runs=runs, trials=trials,
                              comparisons=[comparison], claims=claims)


def make_layout_sample(out_path: Path = EXPORT_ROOT / "benchmarks.sample.json", mirror_to_web: bool = True) -> Path:
    return _write(build_layout_sample(), out_path, "benchmarks.sample.json" if mirror_to_web else None)
