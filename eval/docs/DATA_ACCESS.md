# Data access

## What the harness reads

| path | who reads it | why |
| --- | --- | --- |
| `data/generated/visible/cases/CASE-*.json` | `suites/ap_workflow.py` (agent side) | task inputs, sha256 recorded in each run manifest |
| `data/generated/private/cases/CASE-*.json` | `grading/private_truth.py` only | expected disposition, expected net, invariants, staged counterparty documents |
| `data/generated/private/fixture_catalog.json` | `grading/private_truth.py` only | family of each case. Only family ids and counts are published |
| `eval/registry/suites.json` | `registry.py` | suite register |
| `eval/runs/*` | `runner.py`, `export.py`, `docs.py` | persisted runs (gitignored) |

Nothing else under `data/` is read. The wider Meridian ledger (`data/generated/visible/*.jsonl`,
`company.sqlite`) is not mounted into AP workspaces today. If a subject agent needs company context,
mount an export made by `data/export.py`, never the `data/generated` tree, because the private
directory is its sibling.

## What the harness writes

- `eval/runs/<run_id>/manifest.json` and `trials.jsonl`
- `eval/export/benchmarks.json`, `eval/export/benchmarks.sample.json`
- `eval/docs/*.md` (generated pages)
- `web/studio/public/benchmarks/benchmarks.json` and `benchmarks.sample.json`, the only writes outside `eval/`

## What leaves the evaluator

The public export contains suite metadata, family ids with counts, system manifests, run aggregates and
per-trial outcomes. It does not contain expected dispositions, expected amounts, invariants, staged
documents or grader check details. Oracle smoke runs are exported as aggregates only, without trials,
because per-case oracle outcomes are the expected outcomes. Per-trial outcomes of subject runs do reveal which cases are holds once a system
gets them right. That is inherent to publishing outcomes, and one more reason these fixtures are
development data and not a sealed benchmark.

## External data

No external dataset is downloaded by anything in this package. `external/dabstep.load_tasks` needs
`uv add datasets`, network access and an explicit flag, and is a manual step. No model API is called by
the harness itself. Nothing is submitted anywhere. A DABstep submission needs explicit human approval.

## Network and secrets

The harness makes no network requests and reads no credentials. `uv sync` fetches two packages
(pydantic, pytest) and their dependencies.
