"""Trial lifecycle: provision, run, collect, grade privately, persist, aggregate.

Nothing is dropped. A timeout, a crash, a malformed state, a cancelled or never-started
trial all become persisted trial rows and show up in the run's incidents.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from . import stats
from .agent import AgentAdapter, AgentRunResult, Limits, SandboxHandle
from .final_state import AgentTrace, CaseFinalState
from .grading import ap_grader
from .grading.ap_grader import TrialGrade
from .paths import DATA_ROOT, REPO_ROOT, RUNS_ROOT
from .schema import Measured, Metric, Mode, OutcomeCounts, Run, SystemManifest, Trial, Unavailable
from .suites import ap_workflow
from .suites.ap_workflow import Task

SUITES = {ap_workflow.SUITE_ID: ap_workflow}


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, capture_output=True,
                             text=True, timeout=5)
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


@dataclass
class RunConfig:
    suite_id: str
    agent_name: str
    trials_per_task: int = 1
    concurrency: int = 1
    limits: Limits = field(default_factory=Limits)
    spend_cap_usd: float | None = None
    seed: int = 0
    mode: Mode = "LIVE"
    data_root: Path = DATA_ROOT
    runs_root: Path = RUNS_ROOT
    task_ids: list[str] | None = None
    reproduce: str | None = None
    run_id: str | None = None


# 1. provision

def provision_trial(task: Task, run_cancel: threading.Event,
                    seed: int | None = None) -> tuple[tempfile.TemporaryDirectory, SandboxHandle]:
    """Fresh temp workspace holding only the visible case, plus the evaluator-owned counterparty."""
    tmp = tempfile.TemporaryDirectory(prefix=f"mirror-eval-{task.task_id}-")
    workspace = Path(tmp.name) / "workspace"
    ap_workflow.expose_inputs(task, workspace)
    sandbox = SandboxHandle(workspace=workspace, run_cancel=run_cancel, seed=seed,
                            counterparty=ap_grader.open_counterparty(task.data_root, task.task_id))
    return tmp, sandbox


# 2. run

def run_agent(agent: AgentAdapter, sandbox: SandboxHandle, limits: Limits) -> tuple[object, int]:
    """Run one case under a wall-clock limit. Returns (raw result, wall ms). On timeout the
    sandbox cancel flag is set and the worker thread is abandoned (daemon)."""
    box: dict = {}

    def work():
        try:
            box["result"] = agent.run_case(sandbox.workspace, sandbox, limits)
        except BaseException as e:      # an agent crash is an error trial, not a harness crash
            box["result"] = AgentRunResult(error_class=f"agent_exception:{type(e).__name__}", error_detail=str(e)[:500])

    t0 = time.monotonic()
    th = threading.Thread(target=work, daemon=True)
    th.start()
    th.join(limits.wall_seconds)
    wall_ms = int((time.monotonic() - t0) * 1000)
    if th.is_alive():
        sandbox.cancel.set()
        return AgentRunResult(error_class="timeout", error_detail=f"exceeded {limits.wall_seconds}s"), wall_ms
    return box["result"], wall_ms


# 3. collect

def collect_output_and_state(raw: object) -> AgentRunResult:
    """Validate what the adapter handed back. Anything malformed is an error, not a guess."""
    try:
        result = raw if isinstance(raw, AgentRunResult) else AgentRunResult.model_validate(raw)
        if result.final_state is not None:
            CaseFinalState.model_validate(result.final_state.model_dump())
        if result.trace is not None:
            AgentTrace.model_validate(result.trace.model_dump())
    except ValidationError as e:
        return AgentRunResult(error_class="invalid_output", error_detail=str(e)[:500])
    if result.final_state is None and result.error_class is None:
        return result.model_copy(update={"error_class": "no_final_state"})
    return result


# 4. grade

def grade_privately(data_root: Path, case_id: str, result: AgentRunResult) -> TrialGrade:
    state = None if result.error_class else result.final_state
    return ap_grader.grade_case_privately(data_root, case_id, state, result.trace)


# 5. persist

_write_lock = threading.Lock()


def persist_trial(run_dir: Path, record: dict) -> None:
    with _write_lock, open(run_dir / "trials.jsonl", "a") as f:
        f.write(json.dumps(record, sort_keys=True) + "\n")


def _write_manifest(run_dir: Path, manifest: dict) -> None:
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def _record(run_id: str, task: Task, index: int, family: str | None, *, execution: str, outcome: str,
            grade: TrialGrade | None = None, result: AgentRunResult | None = None,
            wall_ms: int | None = None, incident: str | None = None) -> dict:
    state = result.final_state if result and not result.error_class else None
    trial = Trial(
        id=f"{run_id}:{task.task_id}:{index}", run_id=run_id, task_id=task.task_id, family_id=family,
        trial_index=index, execution=execution, outcome=outcome,
        native_score=(Measured(value=1.0 if grade.success else 0.0, unit="ratio", n=1) if grade
                      else Unavailable(reason=incident or "trial did not run")),
        evidence_checks_passed=grade.evidence_checks_passed if grade else None,
        evidence_checks_total=grade.evidence_checks_total if grade else None,
        control_failures=grade.control_failures if grade else [],
        assistance=([f"investigative_assists={state.human_investigative_assists}"]
                    if state and state.human_investigative_assists else []),
        error_class=result.error_class if result else None, wall_ms=wall_ms,
        artifact_ref=f"eval/runs/{run_id}/trials.jsonl")
    return {
        "trial": trial.model_dump(),
        "grade": grade.model_dump() if grade else None,
        "metrics": {
            "cost_usd": result.cost_usd if result else None,
            "tool_calls": (result.tool_calls if result and result.tool_calls is not None
                           else (grade.tool_calls_observed if grade else None)),
            "external_messages": len(state.messages_sent) if state else None,
            "required_approvals": state.human_required_approvals if state else None,
            "investigative_assists": state.human_investigative_assists if state else None,
        },
        "incident": incident,
    }


def execute_run(config: RunConfig, agent: AgentAdapter, cancel: threading.Event | None = None) -> Path:
    suite = SUITES[config.suite_id]
    tasks = [t for t in suite.load_suite(config.data_root) if not config.task_ids or t.task_id in config.task_ids]
    system: SystemManifest = agent.manifest()
    cancel = cancel or threading.Event()
    run_id = config.run_id or f"{config.suite_id}-{system.id}-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}"
    run_dir = Path(config.runs_root) / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    manifest = {
        "run_id": run_id, "agent_name": config.agent_name, "mode": config.mode,
        "suite": {"id": suite.SUITE_ID, "version": suite.SUITE_VERSION, "split": suite.SPLIT},
        "system": system.model_dump(), "harness_commit": git_commit(),
        "data_hashes": {t.task_id: t.sha256 for t in tasks},
        "seed": config.seed, "trials_per_task": config.trials_per_task, "concurrency": config.concurrency,
        "limits": config.limits.model_dump(), "spend_cap_usd": config.spend_cap_usd,
        "grader_version": ap_grader.GRADER_VERSION, "started_at": now_iso(), "finished_at": None,
        "execution": "running", "incidents": [], "reproduce": config.reproduce,
    }
    _write_manifest(run_dir, manifest)

    spent = {"usd": 0.0, "unreported": 0, "skipped_for_cap": 0}
    lock = threading.Lock()

    def one(task: Task, index: int) -> None:
        family = ap_grader.family_of(config.data_root, task.task_id)
        with lock:
            capped = config.spend_cap_usd is not None and spent["usd"] >= config.spend_cap_usd
        if cancel.is_set() or capped:
            if capped and not cancel.is_set():
                with lock:
                    spent["skipped_for_cap"] += 1
            why = "run cancelled before this trial started" if cancel.is_set() else \
                f"spending cap of {config.spend_cap_usd} USD reached before this trial started"
            persist_trial(run_dir, _record(run_id, task, index, family, execution="cancelled",
                                           outcome="not_tested", incident=why))
            return
        tmp, sandbox = provision_trial(task, cancel, seed=config.seed + index)
        try:
            raw, wall_ms = run_agent(agent, sandbox, config.limits)
            result = collect_output_and_state(raw)
            grade = grade_privately(config.data_root, task.task_id, result)
        finally:
            tmp.cleanup()
        with lock:
            if result.cost_usd is None:
                spent["unreported"] += 1
            else:
                spent["usd"] += result.cost_usd
        incident = f"{result.error_class}: {result.error_detail or ''}".strip() if result.error_class else None
        persist_trial(run_dir, _record(run_id, task, index, family,
                                       execution="failed" if result.error_class else "completed",
                                       outcome=grade.outcome, grade=grade, result=result,
                                       wall_ms=wall_ms, incident=incident))

    jobs = [(t, i) for i in range(config.trials_per_task) for t in tasks]
    try:
        with ThreadPoolExecutor(max_workers=max(1, config.concurrency)) as pool:
            for f in [pool.submit(one, t, i) for t, i in jobs]:
                f.result()
        manifest["execution"] = "cancelled" if cancel.is_set() else "completed"
    except BaseException as e:
        manifest["execution"] = "failed"
        manifest["incidents"].append(f"harness failure: {type(e).__name__}: {e}")
        raise
    finally:
        if spent["unreported"]:
            note = f"adapter did not report cost for {spent['unreported']} trials"
            if config.spend_cap_usd is not None:
                note += ", so the spending cap could not be enforced for them"
            manifest["incidents"].append(note)
        if spent["skipped_for_cap"]:
            manifest["incidents"].append(f"spending cap reached at {spent['usd']:.4f} of {config.spend_cap_usd} USD, "
                                         f"{spent['skipped_for_cap']} trials not started")
            if manifest["execution"] == "completed":
                manifest["execution"] = "cancelled"
        manifest["finished_at"] = now_iso()
        _write_manifest(run_dir, manifest)
    return run_dir


# 6. aggregate

def load_run(run_dir: Path) -> tuple[dict, list[dict]]:
    run_dir = Path(run_dir)
    manifest = json.loads((run_dir / "manifest.json").read_text())
    path = run_dir / "trials.jsonl"
    records = [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
    return manifest, records


def _sum_or_mean(records: list[dict], key: str, unit: str, *, mean: bool, label: str) -> Metric:
    executed = [r for r in records if r["trial"]["execution"] != "cancelled"]
    have = [r["metrics"][key] for r in executed if r["metrics"].get(key) is not None]
    if not executed:
        return Unavailable(reason="no trials executed")
    if len(have) < len(executed):
        return Unavailable(reason=f"{label} known for {len(have)} of {len(executed)} executed trials")
    total = float(sum(have))
    return Measured(value=total / len(have) if mean else total, unit=unit, n=len(have))


def build_run(manifest: dict, records: list[dict], provenance: str = "custom") -> Run:
    """Pure: manifest + trial records in, schema Run out."""
    executed = [r for r in records if r["trial"]["execution"] != "cancelled"]
    families = {r["trial"]["task_id"]: r["trial"]["family_id"] for r in records}
    seed = manifest.get("seed", 0) or stats.SEED

    def by_task(rows: list[dict], ok) -> dict[str, list[bool]]:
        out: dict[str, list[bool]] = {}
        for r in rows:
            out.setdefault(r["trial"]["task_id"], []).append(bool(ok(r)))
        return out

    success = by_task(executed, lambda r: r["grade"] and r["grade"]["success"])
    resolvable = [r for r in executed if r["grade"] and r["grade"]["eligible_resolvable"]]
    holds = [r for r in executed if r["grade"] and not r["grade"]["eligible_resolvable"]]
    whole = stats.pass_at_1(success, families, seed)
    counts = OutcomeCounts()
    for r in records:
        name = "n_" + r["trial"]["outcome"]
        setattr(counts, name, getattr(counts, name) + 1)

    def grade_sum(key: str) -> Metric:
        graded = [r["grade"][key] for r in executed if r["grade"] and r["trial"]["outcome"] != "error"]
        if not graded:
            return Unavailable(reason="no trials produced a gradable final state")
        return Measured(value=float(sum(graded)), unit="count", n=len(graded))

    incidents = list(manifest.get("incidents", []))
    incidents += [f"{r['trial']['id']}: {r['incident']}" for r in records if r.get("incident")]
    return Run(
        id=manifest["run_id"], suite_id=manifest["suite"]["id"], system_id=manifest["system"]["id"],
        mode=manifest["mode"], execution=manifest["execution"], provenance=provenance,
        started_at=manifest.get("started_at"), finished_at=manifest.get("finished_at"),
        n_tasks=len(manifest["data_hashes"]), trials_per_task=manifest["trials_per_task"],
        native_score=whole, whole_task_success=whole,
        unassisted_completion=stats.pass_at_1(
            by_task(resolvable, lambda r: r["trial"]["outcome"] == "pass"
                    and not r["metrics"].get("investigative_assists")), families, seed)
        if resolvable else Unavailable(reason="no eligible resolvable tasks were executed"),
        correct_escalation_rate=stats.pass_at_1(
            by_task(holds, lambda r: r["trial"]["outcome"] == "correct_escalation"), families, seed)
        if holds else Unavailable(reason="no insufficient-evidence tasks were executed"),
        pass_at_1=whole,
        pass_any_of_k=stats.pass_any_of_k(success, families, seed),
        pass_all_of_k=stats.pass_all_of_k(success, families, seed),
        outcomes=counts,
        required_approvals=_sum_or_mean(records, "required_approvals", "count", mean=False, label="approvals"),
        investigative_assists=_sum_or_mean(records, "investigative_assists", "count", mean=False, label="assists"),
        invalid_actions_attempted=grade_sum("invalid_actions_attempted"),
        invalid_actions_blocked=grade_sum("invalid_actions_blocked"),
        invalid_actions_accepted=grade_sum("invalid_actions_accepted"),
        cost_usd=_sum_or_mean(records, "cost_usd", "USD", mean=False, label="cost"),
        wall_ms=(Measured(value=float(sum(r["trial"]["wall_ms"] for r in executed)), unit="ms", n=len(executed))
                 if executed else Unavailable(reason="no trials executed")),
        tool_calls=_sum_or_mean(records, "tool_calls", "count", mean=False, label="tool calls"),
        external_messages=_sum_or_mean(records, "external_messages", "count", mean=False, label="messages"),
        incidents=incidents, artifact_ref=f"eval/runs/{manifest['run_id']}",
        reproduce=manifest.get("reproduce"))


def aggregate(run_dir: Path) -> Run:
    manifest, records = load_run(run_dir)
    return build_run(manifest, records)
