"""What the agent side may see. These tests are the visibility contract in executable form."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from conftest import CASE_IDS, TASKS, TRUTH

import mirror_eval
from mirror_eval.paths import DATA_ROOT
from mirror_eval.suites import ap_workflow
from mirror_eval.suites.ap_workflow import LeakError, Task

PKG = Path(mirror_eval.__file__).parent


@pytest.mark.parametrize("task", TASKS, ids=CASE_IDS)
def test_workspace_holds_only_the_visible_case(task, tmp_path):
    ws = tmp_path / "ws"
    ap_workflow.expose_inputs(task, ws)
    files = [p for p in ws.rglob("*") if p.is_file()]
    assert [p.name for p in files] == [f"{task.task_id}.json"]
    text = files[0].read_text()
    assert ap_workflow.forbidden_keys_in(json.loads(text)) == []
    # grep for private fields as JSON keys
    for key in ("expected_net_cents", "expected_disposition", "invariants", "reason", "counterparty_events",
                "development_family", "solver_must_not_read_this", "allowed_sequence"):
        assert not re.search(rf'"{key}"\s*:', text), key
    # no staged (future) document is present up front
    for doc_id in TRUTH[task.task_id].staged_doc_ids - TRUTH[task.task_id].visible_doc_ids:
        assert f'"{doc_id}"' not in text


def test_expose_refuses_private_sources_and_dirty_workspaces(tmp_path):
    private_case = DATA_ROOT / "private" / "cases" / "CASE-001.json"
    bad = Task(task_id="CASE-001", visible_path=private_case, sha256="x", data_root=DATA_ROOT)
    with pytest.raises(LeakError):
        ap_workflow.expose_inputs(bad, tmp_path / "a")
    dirty = tmp_path / "b"
    dirty.mkdir()
    (dirty / "note.txt").write_text("left over")
    with pytest.raises(LeakError):
        ap_workflow.expose_inputs(TASKS[0], dirty)


def test_symlink_to_private_is_refused(tmp_path):
    link = tmp_path / "CASE-001.json"
    link.symlink_to(DATA_ROOT / "private" / "cases" / "CASE-001.json")
    with pytest.raises(LeakError):
        ap_workflow.expose_inputs(Task("CASE-001", link, "x", DATA_ROOT), tmp_path / "ws")


def test_forbidden_key_detection_is_recursive():
    assert ap_workflow.forbidden_keys_in({"a": [{"expected_anything": 1, "b": {"invariants": []}}]}) == \
        ["expected_anything", "invariants"]


def test_private_truth_is_only_touched_inside_grading():
    """Agent-side modules never name the private tree or the truth type."""
    offenders = []
    for path in PKG.rglob("*.py"):
        rel = path.relative_to(PKG)
        if rel.parts[0] == "grading":
            continue
        text = path.read_text()
        if "PrivateTruth" in text or "private_truth" in text or re.search(r'["\']private["\']', text):
            offenders.append(str(rel))
    # ap_workflow.py names the directory only to refuse it
    assert offenders == ["suites/ap_workflow.py"]
    assert "read_text" not in (PKG / "suites" / "ap_workflow.py").read_text().split("def _assert_not_private")[1].split("def ")[0]


def test_agent_module_does_not_import_grading():
    for name in ("agent.py", "final_state.py", "suites/ap_workflow.py"):
        assert not re.search(r"^\s*(from|import)\s+\S*grading", (PKG / name).read_text(), re.M), name


def test_counterparty_gives_staged_documents_only_on_request():
    from mirror_eval.grading import ap_grader
    sim = ap_grader.open_counterparty(DATA_ROOT, "CASE-009")
    first = sim.request("request_price_correction")
    again = sim.request("redeliver_price_correction")
    assert [d["document_id"] for d in first] == [d["document_id"] for d in again] == ["CM-P-CASE-009"]
    assert ap_grader.open_counterparty(DATA_ROOT, "CASE-015").request("request_price_correction") == []
    with pytest.raises(ValueError):
        sim.request("give_me_the_answer")
    for doc in first:
        assert ap_workflow.forbidden_keys_in(doc) == []
