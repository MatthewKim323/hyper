# Running the exception loop in production

Everything the loop needs is on `main`. None of its data is: a laptop's database does not reach Railway.
This is the order that gets production from empty to the same state, then keeps it learning on its own.

Nothing here moves money or messages a real supplier. Every counterparty is simulated and labelled so.

## 0. What is already true after deploying `main`

- The API serves the new routes: `GET /counterparty/learning` (score with and without memory, every trap case by
  case, each miss with its audit finding and lesson), `GET /benchmarks/timeline`, `GET/POST /counterparty/adversary`.
- Tables are created on first start (`Store()` upgrades additively): `agent_usage` is new.
- Retrieval uses `rrf[rerank(rrf[bm25, semantic]), graph]` (0.944 recall@10). Production sets
  `ELASTIC_RERANK_INFERENCE_ID`, so before this deploy it was running the shape that measured 0.770.

- The CFO you talk to (the orb) has `get_live_activity`: asked "what do we need to do" it briefs from the live
  loop (what waits for the owner, what was held and why, mistakes the grader caught, lessons, score and tier).
  It offers no Devin work unless `DEVIN_WORKER_ENABLED=true`: with Devin off, queuing an investigation promises
  work nothing will pick up. Leave it unset. The model worker is the only worker.
- CFO commentary: the grader's verdict with its reason, audit findings, "wrote itself a lesson", holds. Milestones
  cannot be cut off by stage updates. Spoken lines no longer open with "In the simulation"; the event still
  carries `simulated: true`, and whoever presents should say once that the counterparties are simulated.

## 1. Load the demo company (once)

Production's search index has 0 documents and the demo company has no records. From a shell with the Railway
environment (`railway run`, or a one-off service):

    uv run python -m app.data_cli import-demo

Then deploy the ingestion worker and the elastic worker (step 3), or sources stay `index_status='pending'`.

## 2. Load the loop's history (once, safe to repeat)

880 graded cases, 3,181 thread messages, 555 lessons and 7,703 narrated events from the first night, 2.6 MB,
in the image at `backend/benchmarks/history/loop-history.json.gz`:

    uv run python -m app.loop_history import benchmarks/history/loop-history.json.gz --adversary-off

Every row keeps its id and an existing row is never overwritten. `--adversary-off` means nothing starts spending
on arrival. It carries what the scoreboard, memory comparison, learning page, timeline and CFO history read. It
does not carry the accounting engine's records for those simulated invoices, so an imported case can be read and
counted, not reopened. New cases made in production are complete.

Give the people who should see the lab a membership in it, or leave it: `/counterparty/learning` and
`/benchmarks/timeline` read the lab pair for any signed-in user.

## 3. Worker services

Same image as the API, one Railway service each, `START_MODULE` set, no health check (reuse
`backend/railway.concern-worker.json`). All share the API's environment, plus what is listed.

| START_MODULE | what it does | extra environment |
|---|---|---|
| `app.ingestion_worker` | indexes uploaded sources | `ELASTIC_SKIP_ORGS=hyper-lab,hyper-lab-control,demo-meridian-control` |
| `app.elastic_worker` | evidence investigations | |
| `app.counterparty_worker` | delivers simulated replies, grades cases, runs the adversary | `COUNTERPARTY_TIMEOUT_MS=600000` |
| `app.auto_agent` | the worker that resolves the cases, and brings a held invoice to the owner as a decision | `OPENAI_API_KEY`, `AUTO_AGENT_MODEL=gpt-5.6-terra`, `DEVIN_CONTROL_PAIRS=hyper-lab:hyper-lab-control`, `AUTO_AGENT_CONCERN_ORGS=demo-meridian` |
| `app.concern_worker` + the evaluator (`node evaluator/server.mjs`) | turn a raised concern into three reviewed options the CFO reads out | `AI_GATEWAY_API_KEY`, `CONCERN_MODEL`, `EVALUATOR_URL`, `EVALUATOR_SECRET` |
| `app.devin_exceptions` | mirrors each lab case into the memory-off control company | `DEVIN_EXCEPTION_TASKS=false`, `DEVIN_CONTROL_PAIRS=hyper-lab:hyper-lab-control` |
| `app.spend_guard` | paces the adversary to a dollar cap, from metered usage in the database | `SPEND_CAP=5`, `SPEND_GUARD_ORGS=hyper-lab` (the lab only: left to the guard, the demo company gets sped up to the floor whenever spend is low, and fills with simulated documents) |

Set `AUTO_AGENT_MODEL` explicitly. The code's fallback is `gpt-6-astra`, which costs about fifty times what
`gpt-5.6-terra` does for the same cases. Measured on terra: about 6 cents a case, the guard holds the total at
the cap.

For more throughput run `app.auto_agent` as N services with `AUTO_AGENT_SHARD=0/N` ... `N-1/N`. Never run two
unsharded: there is no claim to race on, ownership is arithmetic, and two workers on one invoice double every
request to the supplier.

Not for production: `app.learning_log` commits to a git checkout (the API route replaces it), and
`tools/*.sh` are for a laptop. `app.devin_worker` (Devin instead of the model worker) needs a public
`AGENT_PUBLIC_BASE_URL` and is paused; use one worker kind per company, not both.

## 4. Turn it on

    uv run python -m app.devin_exceptions_ctl on hyper-lab --every 30 --open 6
    uv run python -m app.devin_exceptions_ctl on demo-meridian --every 300 --open 2
    uv run python -m app.devin_exceptions_ctl status hyper-lab

`demo-meridian` is the company the UI shows. Every case adds about six simulated documents to it, so keep it
slow unless someone is watching (`--every 45 --open 3` for a demo: that is what makes the CFO talk).
`off` instead of `on` stops new cases; ones in flight finish.

## 5. Check it

    uv run python -m app.devin_exceptions_ctl compare hyper-lab
    curl -H "Authorization: Bearer $TOKEN" $API/counterparty/learning

Expect the imported history at once (152/157 hard cases with memory against 82/157 without at export), then new
cases within a minute of step 4. A flat `scored` count means the counterparty worker or the model worker is not
running; `wrong_releases` climbing on the memory side means read the newest miss, it is a real one.

## What to say when quoting the numbers

One run. Simulated counterparties. The traps, the worker prompt and the grader were written by the same people,
nothing is held out. After a miss the worker is given an audit finding and writes its own lesson from it.
Cases where the sandbox misbehaved (a warning not shown in time, the machine asleep) are excluded and counted
separately. The memory-off company gets the same kinds of case at the same tier, with its own amounts.
