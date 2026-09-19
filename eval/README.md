# mirror-eval

Evaluation harness for MIRROR Resolve, the AP exception-resolution agent for the fictional
client Meridian Ledger Labs. Synthetic data only. No real money, no real counterparties.

**State today: no subject agent exists, so no agent has been measured.** The grader, runner,
statistics, exporter and docs are ready. The only run you can make is the oracle smoke, which
checks the grader and is not a result.

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
