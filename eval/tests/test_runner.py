from __future__ import annotations

import json
import threading
import time

import pytest
from conftest import CASE_IDS, TRUTH

from mirror_eval import agent as agent_mod
from mirror_eval.__main__ import main
from mirror_eval.agent import AgentRunResult, ClaimsDoneAgent, Limits, NoOpAgent
from mirror_eval.grading.selftest import OracleAgent
from mirror_eval.paths import DATA_ROOT
from mirror_eval.runner import RunConfig, aggregate, execute_run, load_run
from mirror_eval.schema import Measured, Run, Unavailable


def _config(tmp_path, **kw):
    return RunConfig(suite_id="ap_workflow", agent_name="test", runs_root=tmp_path / "runs", **kw)


def test_subject_registry_is_empty_and_cli_refuses_unknown_agents(tmp_path, capsys):
    assert agent_mod.SUBJECT_AGENTS == {}
    for name in ("resolve_v1", "NoOpAgent", "oracle", "ORACLE_SMOKE"):
        assert main(["--runs-root", str(tmp_path), "run", "--suite", "ap_workflow", "--agent", name]) == 2
    assert "no subject agent" in capsys.readouterr().err
    assert not any(tmp_path.iterdir())


def test_oracle_smoke_end_to_end(tmp_path):
    run_dir = execute_run(_config(tmp_path, trials_per_task=2, concurrency=4, mode="DEV_FIXTURE"), OracleAgent(DATA_ROOT))
    manifest, records = load_run(run_dir)
    assert len(records) == 36 and manifest["execution"] == "completed"
    assert manifest["system"]["kind"] == "ORACLE_SMOKE" and manifest["mode"] == "DEV_FIXTURE"
    assert sorted(manifest["data_hashes"]) == CASE_IDS and all(len(h) == 64 for h in manifest["data_hashes"].values())
    for key in ("suite", "system", "seed", "limits", "grader_version", "started_at", "finished_at", "reproduce"):
        assert key in manifest
    run = aggregate(run_dir)
    assert isinstance(run, Run) and run.whole_task_success.value == 1.0 and run.pass_all_of_k.value == 1.0
    assert run.whole_task_success.unit == "ratio" and run.whole_task_success.ci_low is not None
    assert (run.outcomes.n_pass, run.outcomes.n_correct_escalation) == (22, 14)
    assert run.unassisted_completion.n == 11 and run.correct_escalation_rate.n == 7
    assert run.wall_ms.unit == "ms" and run.tool_calls.unit == "count" and run.invalid_actions_accepted.value == 0
    # the oracle reports no cost: say so, do not invent a zero
    assert isinstance(run.cost_usd, Unavailable)
    assert any("did not report cost" in i for i in run.incidents)


def test_selftest_doubles_fail_through_the_whole_pipeline(tmp_path):
    run = aggregate(execute_run(_config(tmp_path, run_id="noop"), NoOpAgent()))
    assert run.outcomes.n_fail == 18 and run.whole_task_success.value == 0.0
    guess = TRUTH["CASE-002"].expected_net_cents
    run = aggregate(execute_run(_config(tmp_path, run_id="claims", task_ids=["CASE-002"]), ClaimsDoneAgent(guess)))
    assert run.outcomes.n_fail == 1 and run.n_tasks == 1


class _Flaky:
    """Crashes on one case, hangs on another, returns junk on a third, reports cost on the rest."""

    def manifest(self):
        return NoOpAgent().manifest()

    def run_case(self, workspace, sandbox, limits):
        case_id = agent_mod.read_case_id(workspace)
        if case_id == "CASE-001":
            raise RuntimeError("boom")
        if case_id == "CASE-002":
            while not sandbox.cancelled():
                time.sleep(0.01)
            return AgentRunResult()
        if case_id == "CASE-003":
            return {"final_state": {"case_id": case_id, "disposition": "DONE_TRUST_ME"}}
        if case_id == "CASE-004":
            return AgentRunResult()
        return AgentRunResult(final_state=NoOpAgent().run_case(workspace, sandbox, limits).final_state, cost_usd=0.25)


def test_errors_and_timeouts_are_kept_as_error_trials(tmp_path):
    cfg = _config(tmp_path, limits=Limits(wall_seconds=0.3), concurrency=3,
                  task_ids=["CASE-001", "CASE-002", "CASE-003", "CASE-004", "CASE-005"])
    run_dir = execute_run(cfg, _Flaky())
    _, records = load_run(run_dir)
    by = {r["trial"]["task_id"]: r["trial"] for r in records}
    assert by["CASE-001"]["error_class"] == "agent_exception:RuntimeError"
    assert by["CASE-002"]["error_class"] == "timeout"
    assert by["CASE-003"]["error_class"] == "invalid_output"
    assert by["CASE-004"]["error_class"] == "no_final_state"
    assert all(by[c]["outcome"] == "error" and by[c]["execution"] == "failed" for c in ("CASE-001", "CASE-002", "CASE-003", "CASE-004"))
    run = aggregate(run_dir)
    assert run.outcomes.n_error == 4 and run.outcomes.n_fail == 1 and len(records) == 5
    assert run.pass_at_1.n == 5 and run.pass_at_1.value == 0.0        # errors count against the rate
    assert len([i for i in run.incidents if "timeout" in i or "boom" in i or "invalid_output" in i]) == 3
    assert isinstance(run.cost_usd, Unavailable)


class _Costly(NoOpAgent):
    def run_case(self, workspace, sandbox, limits):
        return super().run_case(workspace, sandbox, limits).model_copy(update={"cost_usd": 1.0})


def test_spending_cap_stops_new_trials_and_records_them(tmp_path):
    run_dir = execute_run(_config(tmp_path, spend_cap_usd=3.0), _Costly())
    manifest, records = load_run(run_dir)
    ran = [r for r in records if r["trial"]["execution"] != "cancelled"]
    skipped = [r for r in records if r["trial"]["execution"] == "cancelled"]
    assert len(ran) == 3 and len(skipped) == 15 and manifest["execution"] == "cancelled"
    assert all(r["trial"]["outcome"] == "not_tested" for r in skipped)
    run = aggregate(run_dir)
    assert isinstance(run.cost_usd, Measured) and run.cost_usd.value == 3.0 and run.cost_usd.unit == "USD"
    assert run.outcomes.n_not_tested == 15 and any("spending cap" in i for i in run.incidents)
    assert run.pass_at_1.n == 3


def test_cancellation_is_recorded(tmp_path):
    cancel = threading.Event()
    cancel.set()
    run_dir = execute_run(_config(tmp_path), NoOpAgent(), cancel=cancel)
    manifest, records = load_run(run_dir)
    assert manifest["execution"] == "cancelled" and len(records) == 18
    assert isinstance(aggregate(run_dir).pass_at_1, Unavailable)


def test_trials_file_is_append_only_jsonl(tmp_path):
    run_dir = execute_run(_config(tmp_path, task_ids=["CASE-001"]), NoOpAgent())
    lines = (run_dir / "trials.jsonl").read_text().splitlines()
    assert len(lines) == 1 and json.loads(lines[0])["trial"]["task_id"] == "CASE-001"
    with pytest.raises(FileExistsError):
        execute_run(_config(tmp_path, run_id=run_dir.name), NoOpAgent())
