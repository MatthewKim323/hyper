"""Command line: python -m mirror_eval {run,selftest,export,sample,docs,compare}"""
from __future__ import annotations

import argparse
import shlex
import sys
from pathlib import Path

from . import docs, export
from .agent import SUBJECT_AGENTS, Limits
from .compare import compare_run_dirs
from .paths import DATA_ROOT, RUNS_ROOT
from .runner import SUITES, RunConfig, aggregate, execute_run


def _summary(run_dir: Path) -> None:
    run = aggregate(run_dir)
    o = run.outcomes
    print(f"run {run.id}: execution={run.execution} tasks={run.n_tasks} trials_per_task={run.trials_per_task}")
    print(f"  pass={o.n_pass} correct_escalation={o.n_correct_escalation} partial={o.n_partial} "
          f"waiting={o.n_waiting} fail={o.n_fail} error={o.n_error} not_tested={o.n_not_tested}")
    for line in run.incidents:
        print(f"  incident: {line}")
    print(f"  written to {run_dir}")


def cmd_run(a: argparse.Namespace) -> int:
    if a.suite not in SUITES:
        print(f"suite {a.suite!r} has no runner. Runnable suites: {sorted(SUITES)}", file=sys.stderr)
        return 2
    if a.agent not in SUBJECT_AGENTS:
        print(f"no subject agent named {a.agent!r} is registered. Registered: {sorted(SUBJECT_AGENTS) or 'none'}.\n"
              "Register an adapter factory in mirror_eval/agent.py (SUBJECT_AGENTS). Self-test doubles and the "
              "oracle cannot be run as subjects.", file=sys.stderr)
        return 2
    config = RunConfig(
        suite_id=a.suite, agent_name=a.agent, trials_per_task=a.trials, concurrency=a.concurrency,
        limits=Limits(wall_seconds=a.wall_seconds), spend_cap_usd=a.spend_cap_usd, seed=a.seed, mode="LIVE",
        data_root=a.data_root, runs_root=a.runs_root,
        reproduce="cd eval && uv run python -m mirror_eval " + " ".join(shlex.quote(x) for x in sys.argv[1:]))
    _summary(execute_run(config, SUBJECT_AGENTS[a.agent]()))
    return 0


def cmd_selftest(a: argparse.Namespace) -> int:
    from .grading.selftest import OracleAgent   # oracle stays out of every other code path
    config = RunConfig(suite_id="ap_workflow", agent_name="ORACLE_SMOKE", mode="DEV_FIXTURE",
                       data_root=a.data_root, runs_root=a.runs_root,
                       reproduce="cd eval && uv run python -m mirror_eval selftest")
    run_dir = execute_run(config, OracleAgent(a.data_root))
    _summary(run_dir)
    run = aggregate(run_dir)
    clean = run.outcomes.n_pass + run.outcomes.n_correct_escalation == run.n_tasks * run.trials_per_task
    print("oracle smoke: grader accepts every gold state" if clean else "oracle smoke FAILED: fix the grader before measuring anything")
    return 0 if clean else 1


def cmd_export(a: argparse.Namespace) -> int:
    print(export.export_demo(runs_root=a.runs_root))
    return 0


def cmd_sample(_: argparse.Namespace) -> int:
    print(export.make_layout_sample())
    return 0


def cmd_docs(_: argparse.Namespace) -> int:
    for p in docs.write_docs():
        print(p)
    return 0


def cmd_compare(a: argparse.Namespace) -> int:
    print(compare_run_dirs(a.runs_root / a.baseline, a.runs_root / a.candidate, a.kind,
                           a.runs_root / export.COMPARISONS_DIRNAME))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m mirror_eval")
    p.add_argument("--data-root", type=Path, default=DATA_ROOT)
    p.add_argument("--runs-root", type=Path, default=RUNS_ROOT)
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="run a registered subject agent on a suite")
    r.add_argument("--suite", required=True)
    r.add_argument("--agent", required=True)
    r.add_argument("--trials", type=int, default=1)
    r.add_argument("--concurrency", type=int, default=1)
    r.add_argument("--wall-seconds", type=float, default=600.0)
    r.add_argument("--spend-cap-usd", type=float, default=None)
    r.add_argument("--seed", type=int, default=0)
    r.set_defaults(fn=cmd_run)

    sub.add_parser("selftest", help="oracle smoke run (grader check, not a result)").set_defaults(fn=cmd_selftest)
    sub.add_parser("export", help="write export/benchmarks.json and mirror it to the web app").set_defaults(fn=cmd_export)
    sub.add_parser("sample", help="write the synthetic layout sample").set_defaults(fn=cmd_sample)
    sub.add_parser("docs", help="regenerate the generated dossier pages").set_defaults(fn=cmd_docs)

    c = sub.add_parser("compare", help="write a matched comparison between two run ids")
    c.add_argument("--baseline", required=True)
    c.add_argument("--candidate", required=True)
    c.add_argument("--kind", default="FULL_SYSTEM",
                   choices=["WEIGHTS_ONLY", "FULL_SYSTEM", "ABLATION", "DATA_ENGINE", "RL"])
    c.set_defaults(fn=cmd_compare)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    raise SystemExit(main())
