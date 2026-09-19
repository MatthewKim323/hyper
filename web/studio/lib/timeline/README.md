# Framework timeline data

`types.ts` defines the portable `schemaVersion: 1` contract. `types.ts`, `registry.ts`, and `compare.ts` are browser-safe; `discover.ts` runs only on the server. Discovery may add real Git snapshots through the same contract.

The bundled snapshot is the actual `mirror-resolve` package version `0.1.0`, committed as `ab89ccae7581629538199acabca7960890f183f1` on 2026-09-19. Its timeline label `v1` means the first recorded framework source snapshot. It is not a fabricated release series. `resolve/pyproject.toml`, `policy.py`, `fixtures/hero.py`, and `tests/test_backbone.py` substantiate its package configuration and scenario definitions. No stored execution/evaluation artifact was found, so `runs` is empty. Test source is not a passed evaluation or an agent trace.

## UI contract

- Start with `createInitialTimeline()` from `registry.ts` for independent mutable client state.
- Use `versions` for the timeline. `framework.version` is package metadata; `label` identifies the source snapshot in the timeline.
- Use `scenarios` to list source-defined cases. Always display scenario/run `mode`: `LIVE`, `RECORDED_REPLAY`, or `DEV_FIXTURE`.
- `latestCaseRun(version, caseId)` returns the latest completed/failed recording, or `null`. Cancelled/running records cannot stand in for an evaluation.
- `compareVersions(baseline, candidate, caseId)` reports framework/config changes even when recordings are missing. `comparable` plus `reasons` governs outcome/metric comparisons. Duration, token, and USD cost values remain explicitly unavailable unless provided with a source.
- `delta` is candidate minus baseline. Percent change remains unavailable for a zero/tiny baseline. No aggregate speed, savings, accuracy, success-rate, or benchmark claims are inferred.

Numerical deltas require distinct snapshot IDs, the same case/scenario/mode, and identical non-null input, policy, harness, and environment identities. The latest terminal run is selected independently for each snapshot; incompatible latest runs do not silently fall back to older favorable results.

## Persistence and import

Use `exportTimelineJson(document)` for download/local persistence and `importTimelineJson(text)` for uploaded JSON or localStorage reads. Imported data receives schema, relationship, timestamp, finite-number, URL, prototype-key, depth, and size checks. Limits are exported as `TIMELINE_LIMITS`; JSON is capped at 2 MiB. References are HTTPS URLs or repository-relative paths and must be rendered as ordinary escaped text/safe links. Imported strings must never be executed or inserted as HTML. Structural validation cannot authenticate a user-supplied recording.

`mergeTimeline(base, incoming)` adds new snapshots, evidenced scenario definitions, or recordings. Exact duplicates are deduplicated; changed snapshot/framework metadata, conflicting scenario IDs, and conflicting run IDs are rejected. Inputs remain untouched. To add a recording for the current snapshot, export the current document, add its scenario definition to `scenarios` if it is not already known, fill its `runs` array using `VersionRun`, and import that document. Each scenario needs at least one source/evidence reference, and every recording must match an included scenario's case and mode. Keep all existing definitions and snapshot metadata identical. A changed scenario definition needs a new scenario ID; changed framework configuration belongs in a new immutable snapshot. `appendTimeline` is available for strict append-only imports and rejects every snapshot ID collision.

For a real run, capture exact version/case/scenario IDs, execution mode, timestamps, terminal status, comparison context, outcome, ordered steps, evidence references and a `RUN_ARTIFACT` or `TRACE` provenance record. An unobserved metric uses `{ "status": "unavailable", "reason": "..." }`. Never encode missing metrics as zero or synthesize a run from expected test assertions.

Run the focused data tests with `bun test lib/timeline/timeline.test.ts` from `web/studio`.
