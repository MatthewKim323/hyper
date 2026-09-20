from __future__ import annotations

import json
from pathlib import Path

from mirror_eval import capabilities as caps
from mirror_eval import docs, export, registry
from mirror_eval.agent import NoOpAgent
from mirror_eval.compare import build_comparison
from mirror_eval.grading import ap_grader
from mirror_eval.grading.selftest import OracleAgent
from mirror_eval.paths import DATA_ROOT, REPO_ROOT
from mirror_eval.runner import RunConfig, execute_run, load_run
from mirror_eval.schema import BenchmarksDocument

DASHES = (chr(0x2014), chr(0x2013))     # built from code points so this file stays clean itself


def test_registry_is_valid_and_honest():
    suites = {s.id: s for s in registry.load_suites()}
    assert set(suites) == {"ap_workflow", "crypto_native", "reliability", "apex_public_dev", "dabstep",
                           "finance_agent_v1", "finance_agent_v2_public", "benchrec", "invoice_sandbox",
                           "accountingbench"}
    ap = suites["ap_workflow"]
    assert ap.access == "available" and ap.task_count == 18 and ap.split == "development_not_sealed"
    assert {f.id: f.task_count for f in ap.families} == ap_grader.family_counts(DATA_ROOT)
    assert sorted(caps.AP_FAMILIES) == sorted(f.id for f in ap.families)
    assert [f.id for f in suites["crypto_native"].families] == [f"C{i:02d}" for i in range(1, 13)]
    assert all(f.task_count == 0 for f in suites["crypto_native"].families)
    for s in suites.values():
        if s.layer == "external":
            # Sources were verified read-only on 2026-09-19 (registry/source_verification.json).
            assert s.revision_checked_at and s.source_urls and s.restrictions and s.access_note
            if s.access == "available":
                assert s.revision, f"{s.id} is runnable, so it must be pinned"
    assert suites["accountingbench"].access == "blocked" and suites["accountingbench"].revision is None


def test_capabilities_and_claims_are_grounded():
    rows = caps.capabilities()
    assert len({c.area for c in rows}) == 11
    assert all(c.passed is None and c.failed is None for c in rows)
    assert not any(c.status == "supported" for c in rows)
    for ref in {r for c in rows for r in c.evidence_refs} | {r for c in caps.claims() for r in c.evidence_refs} \
            | {c.entry_point for c in rows if c.entry_point}:
        assert (REPO_ROOT / ref).exists(), ref
    assert not any(c.demo_allowed or c.status == "supported" for c in caps.claims())
    assert set(caps.CLAIM_NOTES) == {c.id for c in caps.claims()}


def test_real_export_with_no_runs_is_live_and_empty(tmp_path):
    out = export.export_demo(tmp_path / "b.json", runs_root=tmp_path / "none", mirror_to_web=False)
    doc = BenchmarksDocument.model_validate_json(out.read_text())
    assert doc.display_mode == "LIVE" and doc.runs == [] and doc.trials == [] and doc.systems == []
    assert len(doc.suites) == 10 and len(doc.claims) == 8


def test_preparation_experiments_are_not_exported_as_payment_ready_runs(tmp_path):
    from mirror_eval.experiments import Experiment, TaskSpec
    experiment = Experiment(id='prep', model='test', prompt_version='p', tools_version='t', grader_version='g',
                            tasks=[TaskSpec(id='case', family='ap', visible={})], arms=['baseline', 'backend'])
    directory = tmp_path / 'prep'
    directory.mkdir()
    (directory / 'manifest.json').write_text(experiment.model_dump_json())
    assert export.discover_runs(tmp_path) == []
    assert export.build_document(tmp_path).runs == []


def test_real_export_carries_oracle_as_oracle_and_never_leaks_truth(tmp_path):
    runs = tmp_path / "runs"
    for i in range(2):
        execute_run(RunConfig(suite_id="ap_workflow", agent_name="ORACLE_SMOKE", mode="DEV_FIXTURE",
                              runs_root=runs, run_id=f"oracle-{i}"), OracleAgent(DATA_ROOT))
    out = export.export_demo(tmp_path / "b.json", runs_root=runs, mirror_to_web=False)
    doc = BenchmarksDocument.model_validate_json(out.read_text())
    assert [r.id for r in doc.runs] == ["oracle-1"]              # latest oracle only
    assert [s.kind for s in doc.systems] == ["ORACLE_SMOKE"] and doc.runs[0].mode == "DEV_FIXTURE"
    assert doc.trials == [] and "CASE-0" not in out.read_text()   # per-case oracle outcomes are the answer key
    text = out.read_text()
    for key in ("expected_net_cents", "expected_disposition", "counterparty_events", "invariants"):
        assert f'"{key}"' not in text
    md = docs.results_md(runs)
    assert "No subject-agent runs exist" in md and "oracle-1" in md and "Grader check" in md


def test_comparison_between_persisted_runs(tmp_path):
    runs = tmp_path / "runs"
    a = execute_run(RunConfig(suite_id="ap_workflow", agent_name="a", runs_root=runs, run_id="a"), NoOpAgent())
    b = execute_run(RunConfig(suite_id="ap_workflow", agent_name="b", runs_root=runs, run_id="b"), OracleAgent(DATA_ROOT))
    c = build_comparison(load_run(a), load_run(b), "FULL_SYSTEM")
    assert {t.bucket for t in c.tasks} == {"gained"} and len(c.tasks) == 18
    assert not c.comparable and any("oracle" in r for r in c.reasons)


def test_layout_sample_is_stable_labeled_and_complete(tmp_path):
    a = export.make_layout_sample(tmp_path / "a.json", mirror_to_web=False).read_text()
    b = export.make_layout_sample(tmp_path / "b.json", mirror_to_web=False).read_text()
    assert a == b
    doc = BenchmarksDocument.model_validate_json(a)
    assert doc.display_mode == "DEV_FIXTURE" and len(doc.systems) == 5
    assert all(s.id.startswith("SAMPLE") and s.label.startswith("SAMPLE") and s.notes == export.SAMPLE_NOTE
               for s in doc.systems)
    assert [s.created_at for s in doc.systems] == sorted({s.created_at for s in doc.systems})
    assert all(r.id.startswith("SAMPLE") and r.mode == "DEV_FIXTURE" and export.SAMPLE_NOTE in r.incidents
               for r in doc.runs)
    assert all(t.id.startswith("SAMPLE") for t in doc.trials)
    assert all(export.SAMPLE_NOTE in c.note for c in doc.capabilities)
    ap_runs = [r for r in doc.runs if r.suite_id == "ap_workflow"]
    assert len(ap_runs) == 5 and {r.suite_id for r in doc.runs} == {"ap_workflow", "dabstep", "apex_public_dev"}
    for r in ap_runs:
        assert r.execution == "completed" and r.finished_at and r.trials_per_task == 3
        assert r.whole_task_success.ci_low is not None and r.whole_task_success.ci_high is not None
        assert len([t for t in doc.trials if t.run_id == r.id]) == 54
    (cmp,) = doc.comparisons
    assert cmp.kind == "FULL_SYSTEM" and {t.bucket for t in cmp.tasks} == \
        {"both_pass", "gained", "regressed", "both_fail", "unavailable"}
    trial_keys = {(t.run_id, t.task_id, t.family_id) for t in doc.trials}
    for row in cmp.tasks:
        assert (cmp.baseline_run_id, row.task_id, row.family_id) in trial_keys
        assert (cmp.candidate_run_id, row.task_id, row.family_id) in trial_keys
    units = {"ratio", "USD", "ms", "count"}
    for r in doc.runs:
        for name, m in r:
            if getattr(m, "status", None) == "measured":
                assert m.unit in units, (name, m.unit)
    assert "CASE-0" not in a                                     # no real task ids, so no truth can leak


def test_generated_docs_match_objects_and_have_no_dashes(tmp_path):
    written = docs.write_docs(tmp_path)
    assert {p.name for p in written} == {"CAPABILITIES.md", "CLAIMS_TO_EVIDENCE.md", "SOURCE_REGISTER.md", "RESULTS.md"}
    assert all(c.id in (tmp_path / "CAPABILITIES.md").read_text() for c in caps.capabilities())
    assert "pending" in (tmp_path / "SOURCE_REGISTER.md").read_text()


def test_no_em_or_en_dashes_anywhere_in_eval():
    root = Path(__file__).resolve().parent.parent
    bad = []
    for p in root.rglob("*"):
        if p.is_file() and p.suffix in {".py", ".md", ".json", ".toml"} and ".venv" not in p.parts and "runs" not in p.parts:
            if any(d in p.read_text(errors="ignore") for d in DASHES):
                bad.append(str(p.relative_to(root)))
    assert bad == []
