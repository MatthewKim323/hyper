# mirror-eval

Evaluation harness for MIRROR Resolve, the AP exception-resolution agent for the fictional
client Meridian Ledger Labs. Synthetic data only. No real money, no real counterparties.

**Internal AP suite: no subject adapter is registered, so it has no agent measurements.**
The grader, runner, statistics and exporter are ready. Its oracle smoke checks the grader
and is not a result. A separate external Devin worker pilot is described below.

## Commands

All from `eval/`.

```sh
uv sync
uv run pytest -q                          # grader self-tests, stats, leak tests, runner, export
uv run python -m mirror_eval selftest     # oracle smoke into runs/, kind ORACLE_SMOKE, mode DEV_FIXTURE
uv run python -m mirror_eval export       # export/benchmarks.json + web/studio/public/benchmarks/benchmarks.json
uv run python -m mirror_eval sample       # export/benchmarks.sample.json (synthetic layout sample) + web copy
uv run python -m mirror_eval docs         # regenerate docs/CAPABILITIES, CLAIMS_TO_EVIDENCE, SOURCE_REGISTER, RESULTS
```

Once a subject agent is registered:

```sh
uv run python -m mirror_eval run --suite ap_workflow --agent <name> \
    --trials 3 --concurrency 4 --wall-seconds 600 --spend-cap-usd 25 --seed 1
uv run python -m mirror_eval compare --baseline <run_id> --candidate <run_id> --kind FULL_SYSTEM
```

`run` refuses any agent name that is not in `SUBJECT_AGENTS`. Today that is every name.
`--data-root` and `--runs-root` go before the subcommand if you need them.

## Plugging in the agent

One adapter class, one registry line. See the comment block at the bottom of
`mirror_eval/agent.py`.

1. Implement `manifest() -> SystemManifest` with the exact models, prompt, tool and policy
   versions. A run is only as reproducible as this manifest.
2. Implement `run_case(workspace, sandbox, limits) -> AgentRunResult`.
   - `workspace` holds one file, the visible case JSON. That is everything the agent may read.
   - Supplier and internal responses come only from `sandbox.counterparty.request(trigger)`.
     Trigger names are in `mirror_eval/grading/counterparty.py` (`TRIGGERS`). Silence is a valid reply.
   - Poll `sandbox.cancelled()` and stop when it is true.
   - Build `CaseFinalState` (`mirror_eval/final_state.py`) from the backend's persisted records
     after the agent stops. The grader scores that state, not what the agent says.
   - Report `cost_usd` if you want the spending cap to work. Unreported cost is listed as an incident.
3. `SUBJECT_AGENTS["your_name"] = lambda: YourAdapter(...)`.

## Layout

```
mirror_eval/
  schema.py            the contract the frontend renders (fixed)
  final_state.py       CaseFinalState + AgentTrace, the neutral snapshot a backend exports
  agent.py             AgentAdapter protocol, limits, sandbox handle, self-test doubles, SUBJECT_AGENTS (empty)
  suites/ap_workflow.py  agent-side loader, expose_inputs, leak checks (reads visible data only)
  grading/             everything that may read data/generated/private
    private_truth.py   PrivateTruth
    ap_grader.py       grade_privately, the only doors into private data
    counterparty.py    evaluator-owned counterparty simulator
    selftest.py        ORACLE: gold states from truth, for tests and ORACLE_SMOKE runs only
  stats.py             per-task rates, Wilson, family-level bootstrap, paired comparison
  runner.py            provision, run, collect, grade, persist, aggregate
  compare.py           matched comparison between two persisted runs
  registry.py          loads registry/suites.json
  capabilities.py      capability inventory and claims
  export.py            export_demo and make_layout_sample
  docs.py              generated dossier pages
  external/            dabstep (exporter + local approximate scorer), apex and invoice_sandbox stubs
registry/suites.json   suite register, fill verified revisions and licenses here
docs/                  dossier
export/                benchmarks.json (real), benchmarks.sample.json (synthetic)
runs/                  gitignored, one directory per run: manifest.json + append-only trials.jsonl
```

## Two files, do not confuse them

- `export/benchmarks.json`: the real document, `display_mode` LIVE. Empty of runs until a run exists.
  Oracle smoke runs appear with system kind `ORACLE_SMOKE` so the UI can keep them off scorecards.
- `export/benchmarks.sample.json`: synthetic, `display_mode` DEV_FIXTURE, every id starts with `SAMPLE`.
  For building the page. Never a result.

## External worker pilot

An isolated Devin **worker baseline** can now run Invoice Sandbox through
`scripts/invoice_devin.py` using the publisher's pinned fixture and native scorer.
This is separate from the internal AP `SUBJECT_AGENTS` registry, which remains empty;
it is not a full-system measurement. See [EXTERNAL_BENCHMARK_PLAN.md](docs/EXTERNAL_BENCHMARK_PLAN.md).

First external pilot result: **18/18 customer net totals within $0.01, $0.00 total absolute error**, one public Invoice Sandbox fixture, isolated Devin worker with no Hyperfinance Agent backend tools. See [the measured report and limitations](docs/INVOICE_WORKER_PILOT.md). This is not an internal AP or full-system score.

## Backend-connected preparation experiments

`python scripts/preparation.py` is a separate preparation-only harness. It does not
weaken or replace the existing payment-ready AP grader or register a fake subject in
`SUBJECT_AGENTS`. Its backend arm calls the real `app.data_tools` dispatcher, creates
real persisted AP proposals/accruals/reconciliations, and exports those records for
private grading. It does not approve, commit, post or transfer funds.

Three experiment arms:

- `baseline`: identical visible normalized records and output contract; code/shell but no backend tools.
- `backend`: organization-scoped read and preparation tools; final output must reference an artifact actually produced through that task's tool bridge.
- `backend_skills`: the same tools plus read-only access to exact owner-activated skill hashes from a dedicated training organization. Missing, changed, quarantined, retired or stale packages stop reuse. No skill saving, activation or learning during evaluation.

`preparation_fixtures.py` provides 12 explicit DEVELOPMENT cases: matched AP, price,
quantity and recipient exceptions; cutoff, reversal, already-booked and incomplete-ledger
accruals; balanced, residual, wrong-reference and duplicate settlement cases. Expected
values are separate from visible inputs. These are software/integration fixtures, not
independent held-out data or evidence of agent improvement. AP fixture attestation is
performed by the evaluator on predefined synthetic records, never on agent extractions.

### Local lifecycle (from repository root)

Use the backend environment because the adapter imports actual application services:

```sh
uv run --directory backend python ../eval/scripts/preparation.py --root ../eval/runs/NEW-PILOT init --id NEW-PILOT --trials 1 --acu-per-task 2
uv run --directory backend python ../eval/scripts/preparation.py --root ../eval/runs/NEW-PILOT serve --port 8088
```

Initialization launches nothing. The default full development matrix is 12 cases x 2
arms = 24 planned jobs, with 48 ACU of potential session caps at 2 ACU/job. Select a
smaller matched pilot with `init --tasks <task-id> ...`. `--max-active` (default 2) is
registered with the experiment. Root must be new and under ignored `eval/runs` or outside
the repository. The isolated backend uses its own SQLite database and local object
storage, not the production database or S3. Generic SQL aggregates still have the
application's PostgreSQL requirement; the three deterministic engines work in SQLite.
This is not a live Elasticsearch/connector/voice-system evaluation.

After exposing this dedicated service through an authorized HTTPS endpoint and approving
a NEW budget, run from another terminal:

```sh
uv run --directory backend python ../eval/scripts/preparation.py --root ../eval/runs/NEW-PILOT run --base-url "$EVAL_PUBLIC_BASE_URL" --authorize-total-acu 24 --window-seconds 3600
uv run --directory backend python ../eval/scripts/preparation.py --root ../eval/runs/NEW-PILOT collect
uv run --directory backend python ../eval/scripts/preparation.py --root ../eval/runs/NEW-PILOT status
uv run --directory backend python ../eval/scripts/preparation.py --root ../eval/runs/NEW-PILOT report
```

The example 24-ACU authorization intentionally cannot launch the entire default 48-ACU
matrix. All unstarted jobs remain visible. Use `launch --limit N` instead of `run` for
manual dispatch. Neither command raises session caps or retries uncertain creation.
Launch reservations count against the cumulative authorization even if creation fails;
collection can adopt a single existing session by its exact unique tag, never create a
replacement. Provider-managed Devin models are labeled honestly, not falsely pinned.
`DEVIN_API_KEY` and `DEVIN_ORG_ID` stay server-side; each worker receives only its own
`EVAL_TASK_TOKEN` through sensitive session secrets. Serve/read readiness is verified
against the exact manifest before any paid launch.

The API has three task-scoped surfaces: GET `/tasks/{id}`, POST `/tasks/{id}/tools`,
and POST `/tasks/{id}/submissions`. Every task includes the same output schema, fact
keys and issue-code vocabulary across arms. Checkpoints persist immediately in SQLite;
final results are immutable. Tool request keys are idempotent. A crash between backend
execution and result logging leaves an uncertain call for operator reconciliation, not
an automatic replay. Task deadlines revoke backend access but do not terminate a cloud
session; the provider ACU cap remains the compute bound. Unknown actual cost is never
reported as zero. Request bodies are bounded to 1 MB.

### Frozen skills and held-out inputs

`init --skill-snapshot <file> --arms baseline backend backend_skills` accepts a JSON
object with `pins` (skill ID to package SHA-256) and `training_task_ids`. Evaluation task
IDs must be disjoint. The referenced packages must already be active in a dedicated
training organization in this isolated backend, with actual execution evidence and
explicit owner review through the existing Skills service. Supply that organization
with `run --training-org <id>`. Initialization does NOT synthesize passing run reports,
auto-activate packages or pretend training occurred. Package preparation/owner approval
is a live prerequisite, not an implemented autonomous learning claim. The tests exercise
this boundary with clearly labeled synthetic lifecycle records.

Custom evaluation uses `init --dataset <visible-tasks.json> --gold <private-gold.json>`.
The visible file is a list of `TaskSpec` objects; private gold maps each task ID to
`status`, `facts`, `issues`, and `required_evidence`. Both files must cover the same task
set. `--held-out` is allowed only for supplied datasets, not generated fixtures; its
provenance is operator-declared and still needs independent review. Monetary equality
uses canonical JSON to distinguish integer values from booleans/floats. Gold, input,
prompt and code versions are pinned; code changes require a new experiment. External
benchmarks still require their native task/scorer adapters and are explicitly refused by
this preparation launcher rather than mislabeled full-system runs.

Reports preserve every planned job, distinguish unstarted/failed/timed-out/submitted
states, show completion, exact correctness, family-level bootstrap summaries and blocked
control attempts. They compare all families rather than selecting the best trial. The
report never automatically certifies broad improvement: held-out provenance, actual
cost, model control and statistical evidence still need review. No-session regression
runs are labeled `NO_AGENT_MEASUREMENTS`.

Verification:

```sh
uv run --directory eval pytest tests/test_experiments.py -q
uv run --directory backend pytest tests/test_preparation_evaluation.py -q
```
