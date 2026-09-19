from __future__ import annotations

import json

import pytest

from mirror_eval.grading import ap_grader
from mirror_eval.grading.selftest import oracle_final_state, oracle_trace
from mirror_eval.paths import DATA_ROOT
from mirror_eval.suites import ap_workflow

TASKS = ap_workflow.load_suite(DATA_ROOT)
CASE_IDS = [t.task_id for t in TASKS]
TRUTH = {c: ap_grader.load_truth(DATA_ROOT, c) for c in CASE_IDS}
READY = [c for c in CASE_IDS if TRUTH[c].expects_payment_ready]
HOLD = [c for c in CASE_IDS if not TRUTH[c].expects_payment_ready]
WITH_CREDITS = [c for c in READY if TRUTH[c].applicable_credits]


def gold(case_id: str):
    task = next(t for t in TASKS if t.task_id == case_id)
    return oracle_final_state(TRUTH[case_id], json.loads(task.visible_path.read_text()))


def grade(state, case_id: str, trace=None):
    return ap_grader.grade_privately(state, trace if trace is not None else oracle_trace(state), TRUTH[case_id])


@pytest.fixture
def data_root():
    return DATA_ROOT
