# Integration map

How the five parts of this repo connect today, what is actually wired, and the order to wire the rest.
Written 2026-09-19 against backend commit `8089ee0`. Backend claims are read from code, with `file:line` where it matters.

## The parts

| Part | What it is | State |
|---|---|---|
| `backend/` | FastAPI. Voice onboarding (Deepgram + Jev), Clerk auth, Postgres/S3/Elasticsearch data layer, read-only connectors (Gmail, Drive, Ramp, Plaid), concerns, json-render artifacts, Devin coordinator/worker orchestration, company activity simulator | 100 tests pass offline with fake providers. Devin, the LLM models and the storage stack have never been run live from this checkout |
| `web/studio/` | Next app. Landing, gallery, voice onboarding, atrium world, workspace sections (Overview, Cases, Evidence, Activity, Review, Timeline, Benchmarks) | Only onboarding talks to the backend. Every other section is a shell |
| `resolve/` | Deterministic AP exception engine: three-way match, engine-owned issues, credit lifecycle, hash-bound proposals, human-only approval, idempotent commit | 15 tests. Nothing imports it |
| `eval/` | Private grader over the 18 Meridian AP fixtures, statistics, suite register, export read by the Benchmarks page | 323 tests. `SUBJECT_AGENTS` is empty, so nothing has been measured |
| `data/` | Meridian synthetic company: 39 datasets, about 115k rows, 18 AP fixtures with private expected outcomes | `backend` imports `data/generated/visible` only. `private/` is never touched by the backend |

`backend`, `resolve` and `eval` are three disconnected halves of one product. The agent (Devin, via the backend tool bridge) has no AP engine to act through and no grader looking at it.

## Blocking right now

1. **Clerk is mandatory and there is no dev bypass** (`backend/app/auth.py:1`). With `CLERK_ISSUER` or `CLERK_AUTHORIZED_PARTIES` unset every authenticated route returns 503. The frontend's voice client still does an anonymous `POST /sessions` and sends a capability token on the socket. **The next backend restart breaks onboarding** until the frontend signs in with Clerk. Needed from a human: a Clerk application (issuer URL and publishable key).
2. **`AI_GATEWAY_API_KEY` is empty** in `backend/.env`. Jev readiness, concern cards, artifacts and the LLM simulator all need it. Today readiness always reports "unavailable", so onboarding can never complete.
3. **Aggregates need Postgres** (`data_service.py:168`). On the SQLite fallback everything looks fine until the first `sum`, then 422. Artifacts therefore need the compose stack. Docker is not running on this machine (OrbStack is installed, not started).
4. **Devin needs a public HTTPS URL** for `AGENT_PUBLIC_BASE_URL` (`devin_worker.py:44`). On localhost the controller goes to `blocked` with a generic message that looks like a Devin failure. A tunnel is required for any live agent run.

## What each workspace section can show with no new backend work

All routes are Clerk bearer, org scoped, reachable through the existing Next rewrite (`/api/onboarding/<path>`). **There is no SSE or WebSocket for any of this. Everything polls.**

| Section (atrium station) | Source | Notes |
|---|---|---|
| Overview | `GET /me/workspace`, `GET /agents/controller`, `GET /datasets`, `GET /connections` | Agent online/blocked banner, org context from onboarding, data coverage |
| Cases (accounts-payable) | `GET /agents/cases`, `GET /agents/tasks` | Case state is already a card: findings, unknowns, next_actions, source_ids, concern_ids, version. Empty until a Devin coordinator runs. No pagination params and no case-history route yet |
| Evidence (audit-evidence) | `GET /sources`, `GET /sources/{id}`, `POST /evidence/search`, `POST /financials/query`, `GET /artifacts/{id}` | Show `coverage_complete`. Artifact `spec` is a fixed three-node tree (`FinanceChart` line or bar, points with `kind: actual|projected`, decimal strings): render it with our bklit charts rather than the HTML route |
| Activity (wallet-identity) | `GET /simulations/{id}/events?after=`, `GET /concerns`, `GET /agents/tasks`, `GET /sources` merged by time | The durable `agent_events` outbox is **not** readable with a Clerk token, only by agents. Feed stalls on a failed simulator tick by design: show run `status` and `error` beside it |
| Review (approvals) | `GET /concerns?status=awaiting_response`, `POST /concerns/{id}/respond` | Three Jev-checked options plus custom. Handle 409 (already answered) and `card_failed` (offer regenerate). Do not expose claim or resolve: those are agent actions that happen to accept a user token |
| Timeline | `web/studio/lib/timeline` | Independent of the backend |
| Benchmarks | `eval/` export | Independent of the backend |

## Gaps that need a backend change (Stephen)

1. `GET /agents/events` for users, so Activity can show the real outbox instead of a client-side merge.
2. `limit`, `offset`, `status` on `/agents/cases` and `/agents/tasks`, and a route for `agent_case_updates` (the history is already written on every update).
3. Nothing drains the concern queue unless live Devin is configured. A responded concern sits in `queued` forever in a demo. Needs a stub claimer or a fallback resolver.
4. `POST /concerns` generates the card synchronously (up to 90 s) and returns 201 even when the card failed. Artifacts already do this right (202 plus worker).
5. Default demo import seeds org `demo-meridian` with no members. A user only lands in it if listed in `DEMO_USER_IDS` before their first ever sign-in (`store.py:33`). Easy to trip on stage: import with `--user-id` instead.
6. Small: compose publishes Elasticsearch on 19200 but the code defaults to 9200; blanket `except Exception -> 503` in `data_api.py:32` hides real errors; demo import labels non-monetary datasets as USD; app cannot boot when Postgres is down because `Store()` connects at import.

## The product gap: the agent cannot finish AP work yet

The judge's brief is completed AP exception work. What exists end to end is: ingest evidence, investigate, raise a concern, a human picks an option, an agent writes a cited resolution summary. There is no invoice hold, credit memo verification, payable proposal, approval bound to an amount, or payment-ready state in `backend/`. That is exactly what `resolve/` implements and nobody calls.

Two missing bridges:

- **Agent to engine.** Expose `resolve/` as tools on the existing bridge (`POST /agents/tools`): `open_case`, `get_case`, `inspect_credit_memo`, `calculate_supported_payable`, `propose_payable_update`, `request_review`, `request_controller_approval`. The engine already refuses self-approval, stale revisions and double allocation, so the agent gets real controls instead of prose. A concern of type "approve net payable" maps onto the engine's hash-bound approval.
- **Counterparty.** The simulator is autonomous, not reactive (`SIMULATOR_API.md:107`). It cannot answer a supplier request. `eval/` already defines the contract a counterparty must meet (`eval/mirror_eval/grading/counterparty.py`, six triggers backed by staged documents in `data/generated/private`). Making the hero moment real (first credit fixes only the price, agent notices and follows up) needs a request/response surface: `request_supplier_document` and `request_internal_confirmation` tools that deliver the staged documents through normal ingestion.

With both bridges the eval adapter is small: provision an org per trial, import the visible case, enable the coordinator, let it run against the tool bridge, export the engine's final state, grade privately. Until then `eval/` can only measure investigation quality, not finished work.

## Order of work

1. Clerk keys, then frontend sign-in, JWT on `POST /sessions` and the socket handshake, `auth.refresh` every 20 s, `GET /me/workspace` as the onboarding source of truth (replacing the browser-local flag).
2. `AI_GATEWAY_API_KEY`, then start the compose stack and `import-demo --user-id <you>`.
3. Frontend sections against real routes through the typed client in `web/studio/lib/backend/`: Review first (it is the human-authority moment and works without Devin), then Evidence, Activity, Cases.
4. Engine tools on the bridge and the reactive counterparty.
5. Eval adapter for the Devin coordinator, first real run, Benchmarks page fills in.
6. Live Devin smoke test behind a tunnel, with the ACU and session caps left at their defaults.
