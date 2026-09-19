# Dataset Build Report

## Delivered

- Fictional company: Meridian Ledger Labs, Inc.
- Period: January 2025 through June 2026; seed `20260919`.
- Canonical financial records: **115,348** across **39** tables.
- Company scope: 48 employees, 120 customers, 60 vendors.
- Monthly management statement sets: **18**.
- AP development cases: **18**, initial evidence separated from future responses and expected outcomes.
- Luna narrative authoring: **102 distinct successful `codex exec` sessions**, **612 draft documents**, **0 unresolved failed tasks**.
- Execution: Python subprocess pool, eight concurrent jobs, per-task workspace and logs. No agent-tool delegation in corpus generation.

## Verification actually performed

- Financial validator: passed, 0 errors.
- Financial/generator/fixture tests: 17 passed, including deliberate corruptions.
- Pool orchestration tests: 2 passed.
- Narrative structure, dates, source-reference membership and monetary-mention scan: passed; zero amount-review flags.
- Resume: all 102 outputs reused with unchanged session IDs; no new generation required.
- SQLite integrity check: passed.
- Both exports: every checksum verified, with no private answers, authoring packets or process logs included.

Some model responses included grounded contact names or email addresses in their reference arrays. Finalization removed those non-ID metadata values; `accepted_by` employee IDs were recognized correctly. Bodies were not rewritten, and original outputs are retained. This metadata correction is recorded per run.

## Model usage recorded for the 102 authoring sessions

- Model: `gpt-5.6-luna`.
- Input tokens reported by CLI: 1,761,053.
- Cached input tokens (included in the input figure): 1,219,328.
- Output tokens: 129,859.

These counts exclude the separate model-access probe, preliminary engine attempt and independent code-review process. No dollar-cost estimate is asserted.

## Important limits

Narratives are model-written drafts, not independently certified financial evidence. The synthetic statements are management projections under documented simplifying policies, not audited GAAP statements. Financial records and settlement records are generated from common economic events; internal reconciliation is not a test of a real bank or chain integration. The AP cases are development fixtures, not a sealed held-out benchmark. No financial agent has been evaluated on this corpus yet.

The source exports contain full historical data through June 30. Temporal evaluations need a stricter as-of filter. Directory separation is not a security boundary: an evaluated agent must run with only its exported source bundle mounted.

## Locations

- `data/generated/visible/company.sqlite`: SQL access.
- `data/generated/visible/schema.json`: tables and fields.
- `data/generated/narratives/documents.jsonl`: combined narrative ingestion stream.
- `data/generated/private/swarm-report.json`: complete model session/usage record.
- `data/exports/meridian-v1/`: structured financial source export.
- `data/exports/meridian-v1-with-drafts/`: financial source export plus labeled draft documents.
- `data/swarm/runs/packet-NNN/`: workspaces and raw logs.
