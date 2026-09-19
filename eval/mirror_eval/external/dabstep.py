"""DABstep adapter. Offline by default: importing this module downloads nothing.

What exists:
  export_submission   writes the answers file (task_id, agent_answer) and a separate traces file
  score_answer        LOCAL APPROXIMATION of normalized answer matching, for development only
  load_tasks          deliberate manual step, needs `uv add datasets` and network access

What this is not: the official scorer. A number from score_answer must be labeled
"local approximation" and must never be presented as a DABstep score. The publisher's
scorer decides real scores. Getting a score back from the publisher is not independent
validation, and nothing may be submitted without explicit human approval.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Iterable, Mapping

# Unverified. Confirm the dataset id, config and split names against the publisher's page
# before the first manual load, then record the revision in eval/registry/suites.json.
DATASET_ID_UNVERIFIED = "adyen/DABstep"

NUMERIC_REL_TOL = 1e-4
NUMERIC_ABS_TOL = 1e-9
_NUM = re.compile(r"^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?$")


def export_submission(answers: Iterable[Mapping], path: Path, traces_path: Path | None = None) -> tuple[Path, Path | None]:
    """Write JSONL with exactly the keys task_id and agent_answer. Reasoning traces, when
    present, go to a separate file so the answers file stays minimal."""
    path = Path(path)
    rows, traces, seen = [], [], set()
    for a in answers:
        task_id = str(a["task_id"])
        if task_id in seen:
            raise ValueError(f"duplicate task_id {task_id}")
        seen.add(task_id)
        rows.append({"task_id": task_id, "agent_answer": str(a["agent_answer"])})
        if a.get("reasoning_trace") is not None:
            traces.append({"task_id": task_id, "reasoning_trace": a["reasoning_trace"]})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    if not traces:
        return path, None
    traces_path = Path(traces_path) if traces_path else path.with_name(path.stem + ".traces.jsonl")
    traces_path.write_text("".join(json.dumps(r) + "\n" for r in traces))
    return path, traces_path


def _as_number(text: str) -> float | None:
    # Currency and percent signs are dropped, never rescaled: 5% matches 5, not 0.05.
    t = text.strip().lstrip("$").rstrip("%").strip()
    if not t or not _NUM.match(t):
        return None
    try:
        return float(t.replace(",", ""))
    except ValueError:
        return None


def normalize_answer(answer) -> str:
    """Lowercase, trim, collapse whitespace, strip surrounding quotes and a trailing period."""
    text = re.sub(r"\s+", " ", str(answer)).strip().lower()
    text = text.strip("\"'`")
    if text.endswith(".") and _as_number(text) is None:
        text = text[:-1]
    return text.strip()


def _items(text: str) -> list[str] | None:
    """Split a comma or semicolon list. A single number with thousands separators is not a list."""
    inner = text.strip()
    if inner[:1] in "[(" and inner[-1:] in "])":
        inner = inner[1:-1]
    elif _as_number(inner) is not None:
        return None
    parts = [normalize_answer(p) for p in re.split(r"[;,]", inner)]
    parts = [p for p in parts if p]
    return parts if len(parts) > 1 else None


def _scalar_match(pred: str, gold: str) -> bool:
    p, g = _as_number(pred), _as_number(gold)
    if p is not None and g is not None:
        return math.isclose(p, g, rel_tol=NUMERIC_REL_TOL, abs_tol=NUMERIC_ABS_TOL)
    if (p is None) != (g is None):
        return False            # a number never matches a string
    return pred == gold


def score_answer(pred, gold) -> bool:
    """LOCAL APPROXIMATION, not the official DABstep scorer. Conservative on purpose:
    numbers match within a relative tolerance of 1e-4, strings match exactly after case and
    whitespace normalization (no fuzzy matching), comma lists match as multisets regardless
    of order, and an empty prediction never matches."""
    p, g = normalize_answer(pred), normalize_answer(gold)
    if not p:
        return False
    p_items, g_items = _items(p), _items(g)
    if p_items is None and g_items is None:
        return _scalar_match(p, g)
    if p_items is None or g_items is None or len(p_items) != len(g_items):
        return False
    remaining = list(g_items)
    for item in p_items:
        hit = next((x for x in remaining if _scalar_match(item, x)), None)
        if hit is None:
            return False
        remaining.remove(hit)
    return True


def load_tasks(split: str, *, i_understand_this_downloads_data: bool = False):
    """Deliberate manual step. Downloads the dataset from the publisher, so it never runs in
    tests, in CI or as a side effect of anything else."""
    if not i_understand_this_downloads_data:
        raise RuntimeError("load_tasks downloads the DABstep dataset over the network. Run it by hand, "
                           "on purpose, with i_understand_this_downloads_data=True.")
    try:
        import datasets  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError("The `datasets` package is not installed. Run `uv add datasets` in eval/ first. "
                           "Loading DABstep is a deliberate manual step and is not part of the default install.") from e
    return datasets.load_dataset(DATASET_ID_UNVERIFIED, name="tasks", split=split)
