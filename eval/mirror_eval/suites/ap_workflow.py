"""Agent-side loader for the 18 Meridian AP development fixtures.

This module reads data/generated/visible/cases and nothing else. Expected outcomes live in
data/generated/private and are loaded only by mirror_eval.grading.
"""
from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

SUITE_ID = "ap_workflow"
SUITE_VERSION = "meridian-ap-fixtures-v1"
SPLIT = "development_not_sealed"

# Keys that exist only in grader truth. None of them may reach a workspace.
FORBIDDEN_KEYS = frozenset({
    "invariants", "reason", "solver_must_not_read_this", "development_family",
    "counterparty_events", "allowed_sequence",
})
FORBIDDEN_KEY_PREFIXES = ("expected_",)


class LeakError(AssertionError):
    pass


@dataclass(frozen=True)
class Task:
    task_id: str
    visible_path: Path
    sha256: str
    data_root: Path


def load_suite(data_root: Path) -> list[Task]:
    cases_dir = Path(data_root) / "visible" / "cases"
    tasks = []
    for p in sorted(cases_dir.glob("CASE-*.json")):
        _assert_not_private(p, data_root)
        tasks.append(Task(task_id=p.stem, visible_path=p, data_root=Path(data_root),
                          sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
    if not tasks:
        raise FileNotFoundError(f"no visible cases under {cases_dir}")
    return tasks


def load_visible(task: Task) -> dict:
    return json.loads(task.visible_path.read_text())


def _assert_not_private(path: Path, data_root: Path) -> None:
    """Reject anything that resolves into <data_root>/private. Resolving first means a symlink
    cannot smuggle the private tree in. (A bare name check would misfire: macOS temp dirs
    live under /private.)"""
    resolved = Path(path).resolve()
    private = (Path(data_root) / "private").resolve()
    if resolved == private or private in resolved.parents:
        raise LeakError(f"refusing to touch a path under private: {path}")


def forbidden_keys_in(obj) -> list[str]:
    """Every forbidden key found anywhere in a JSON value."""
    found = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in FORBIDDEN_KEYS or k.startswith(FORBIDDEN_KEY_PREFIXES):
                found.append(k)
            found += forbidden_keys_in(v)
    elif isinstance(obj, list):
        for v in obj:
            found += forbidden_keys_in(v)
    return found


def assert_workspace_clean(workspace: Path, data_root: Path) -> None:
    for f in Path(workspace).rglob("*"):
        if f.is_symlink():
            raise LeakError(f"symlink in workspace: {f}")
        if not f.is_file():
            continue
        _assert_not_private(f, data_root)
        if f.suffix == ".json":
            bad = forbidden_keys_in(json.loads(f.read_text()))
            if bad:
                raise LeakError(f"{f.name} carries grader-only keys: {sorted(set(bad))}")


def expose_inputs(task: Task, dest_dir: Path) -> Path:
    """Copy the visible case JSON, and nothing else, into a fresh workspace."""
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    if any(dest_dir.iterdir()):
        raise LeakError(f"workspace is not fresh: {dest_dir}")
    _assert_not_private(task.visible_path, task.data_root)
    _assert_not_private(dest_dir, task.data_root)
    out = dest_dir / f"{task.task_id}.json"
    shutil.copyfile(task.visible_path, out)
    assert_workspace_clean(dest_dir, task.data_root)
    if [p.name for p in dest_dir.iterdir()] != [out.name]:
        raise LeakError("workspace holds more than the one visible case file")
    return out
