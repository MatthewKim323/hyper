"""Filesystem layout. The harness lives in eval/, the data it reads lives in data/generated."""
from __future__ import annotations

from pathlib import Path

EVAL_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = EVAL_ROOT.parent
DATA_ROOT = REPO_ROOT / "data" / "generated"
RUNS_ROOT = EVAL_ROOT / "runs"
EXPORT_ROOT = EVAL_ROOT / "export"
DOCS_ROOT = EVAL_ROOT / "docs"
REGISTRY_FILE = EVAL_ROOT / "registry" / "suites.json"
# The one location outside eval/ that the exporter may write to.
WEB_PUBLIC_DIR = REPO_ROOT / "web" / "studio" / "public" / "benchmarks"
