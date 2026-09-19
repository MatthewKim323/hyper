from __future__ import annotations

import json

import pytest

from mirror_eval.external import apex, dabstep, invoice_sandbox
from mirror_eval.external.dabstep import score_answer


@pytest.mark.parametrize("pred,gold,ok", [
    ("42", "42", True), ("42.0", "42", True), ("1,234.50", "1234.5", True), ("$1,234.50", "1234.5", True),
    ("0.1234", "0.1236", False), ("100.001", "100.002", True), ("5%", "5", True), ("5%", "0.05", False),
    ("  Netherlands ", "netherlands", True), ("NexPay", "nexpay.", True), ("Nex Pay", "NexPay", False),
    ("A, B, C", "c,b,a", True), ("[A, B]", "b, a", True), ("A, B", "A, B, C", False), ("A, A, B", "A, B, B", False),
    ("1, 2.0, 3", "3, 2, 1", True), ("", "", False), ("", "x", False), ("not applicable", "Not Applicable", True),
    ("12", "twelve", False), ("1e3", "1000", True),
])
def test_local_approximate_scorer(pred, gold, ok):
    assert score_answer(pred, gold) is ok


def test_normalize_answer():
    assert dabstep.normalize_answer('  "Hello   World." ') == "hello world"
    assert dabstep.normalize_answer(3.50) == "3.5"


def test_scorer_is_labeled_a_local_approximation():
    assert "LOCAL APPROXIMATION" in score_answer.__doc__ and "not the official" in score_answer.__doc__


def test_export_submission_writes_exactly_two_keys_and_separates_traces(tmp_path):
    answers = [{"task_id": 1, "agent_answer": 42, "reasoning_trace": "looked at fees"},
               {"task_id": "2", "agent_answer": "NL"}]
    out, traces = dabstep.export_submission(answers, tmp_path / "sub" / "answers.jsonl")
    rows = [json.loads(line) for line in out.read_text().splitlines()]
    assert rows == [{"task_id": "1", "agent_answer": "42"}, {"task_id": "2", "agent_answer": "NL"}]
    assert all(set(r) == {"task_id", "agent_answer"} for r in rows)
    assert [json.loads(line) for line in traces.read_text().splitlines()] == \
        [{"task_id": "1", "reasoning_trace": "looked at fees"}]


def test_export_submission_without_traces_and_duplicate_ids(tmp_path):
    out, traces = dabstep.export_submission([{"task_id": "a", "agent_answer": "x"}], tmp_path / "a.jsonl")
    assert traces is None and list(tmp_path.iterdir()) == [out]
    with pytest.raises(ValueError):
        dabstep.export_submission([{"task_id": "a", "agent_answer": "x"}] * 2, tmp_path / "b.jsonl")


def test_load_tasks_is_a_deliberate_manual_step():
    with pytest.raises(RuntimeError, match="downloads"):
        dabstep.load_tasks("default")


@pytest.mark.parametrize("mod", [apex, invoice_sandbox])
def test_stubs_say_what_is_pending(mod):
    with pytest.raises(NotImplementedError, match="pending"):
        mod.run()
    assert mod.visibility_contract()["must_stay_private"]
    assert mod.SETUP_COMMANDS == ()
