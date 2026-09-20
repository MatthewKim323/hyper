# Benchmark timeline

`uv run --directory backend python -m app.bench_timeline hyper-lab demo-meridian --every 300`

Runs beside the exception loop. Writes `benchmarks/timeline.json` and serves `GET /benchmarks/timeline?since=`. Read-only on every table it did not create.

| Series | Source | Rebuilt or recorded |
|---|---|---|
| `exceptions` per organization | graded `counterparty_scenarios` | Rebuilt on every read, back to the first case |
| `memory_effect`, `memory_effect_hard_tier` | twinned cases (`created_by = mirror:<id>`) | Rebuilt, cumulative |
| `loop_state` | lessons, skills, adversary control, metered spend | Recorded every tick |
| `tests` | `pytest -q` | Recorded when HEAD changes |
| `retrieval` | `retrieval_bench --reuse` | Recorded when retrieval code changes |

Each point per bucket (10 minutes) carries the bucket itself, the last 20 cases and everything so far, plus the adversary level, per-tier counts, the worker's model, commit and kind, and median dollars and tokens per case where the usage log names the case.

## Reading it

- Accuracy is `null` under 20 cases. Counts are always there.
- Cases created before `VALID_SINCE` ran against a sandbox with two bugs. They are drawn `valid: false` and never enter rolling, cumulative or paired numbers.
- `EVENTS` marks what changed the meaning of a point: a model switch, a sandbox fix, a new tier. Append to it whenever that happens.
- A case's tier is its family's (`counterparty.TIERS`). `difficulty` on the row is the adversary's level when the case spawned, reported as `adversary_level_at_spawn`. Tiers 1 to 4 name their own diagnosis and are saturated. Tier 5 is the only place a wrong release can happen, so `memory_effect_hard_tier` is the accuracy series to read. The other series that can move are adversary level, seconds, requests, sessions and dollars per case.
- Nothing is held out from the worker prompt. Every series is a development series.
