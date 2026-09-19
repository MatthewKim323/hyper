"""The suite register. eval/registry/suites.json is the source of truth so a human can fill in
verified revisions, licenses and access notes without touching code. Every entry is validated
against schema.Suite on load."""
from __future__ import annotations

import json
from pathlib import Path

from .paths import REGISTRY_FILE
from .schema import Suite

PENDING = "pending source verification"


def load_suites(path: Path = REGISTRY_FILE) -> list[Suite]:
    suites = [Suite.model_validate(row) for row in json.loads(Path(path).read_text())]
    ids = [s.id for s in suites]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate suite id in the register")
    return suites


def get_suite(suite_id: str, path: Path = REGISTRY_FILE) -> Suite:
    for s in load_suites(path):
        if s.id == suite_id:
            return s
    raise KeyError(suite_id)
