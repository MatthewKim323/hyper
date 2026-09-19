# Deepgram-managed onboarding

Deepgram Voice Agent API owns the complete listening → reasoning → tool-calling → speaking loop over one upstream WebSocket. FastAPI bridges browser audio, executes application tools, and stores state. Jev independently evaluates readiness through Vercel AI SDK.

The onboarding voice agent uses Deepgram-managed `gpt-4o-mini` unless explicitly overridden. It has no custom chat-completions loop or Devin session. The separate company simulator uses AI Gateway for document generation.

## Data storage and retrieval

Postgres, private S3-compatible storage, and Elasticsearch ingestion/retrieval are implemented. See [STORAGE.md](STORAGE.md) to run the stack and import the demo, and [DATA_API.md](DATA_API.md) for authenticated uploads, exact financial queries, evidence search, citations, and the agent tools.

Read-only Gmail, Google Drive, Ramp, and Plaid connectors are implemented. See [CONNECTORS.md](CONNECTORS.md) for provider setup, authorization, background sync, API routes and supported formats. Provider credentials and account consent are required; no real account is connected automatically.

## Run locally

Requires Python 3.11+, uv, Node 22+, npm, Deepgram Voice Agent access, and Vercel AI Gateway access to Jev.

```sh
cd backend
cp .env.example .env
# Set provider keys, EVALUATOR_SECRET, and Clerk values described below.
uv sync
npm ci --prefix evaluator
node --env-file=.env evaluator/server.mjs
```

In a second terminal, from `backend/`:

```sh
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. Start/resume loads the demo session; type or enable the microphone. The provider connection starts on the first typed message or microphone activation. Both modes use Deepgram. Typing is an alternative to the microphone, **not** a fallback during a Deepgram outage. Refresh and Start/resume restores saved conversation and function history. Microphone access requires localhost or HTTPS.

Optional DEEPGRAM_THINK_PROVIDER and DEEPGRAM_THINK_MODEL select a supported Deepgram-managed model. With no override, the server explicitly selects `open_ai` / `gpt-4o-mini`, a [documented Deepgram-managed model](https://developers.deepgram.com/docs/voice-agent-llm-models). Deepgram manages the LLM connection, so no separate OpenAI key is required. Credentials remain on the backend; `.env` is ignored.

The product interface runs separately from `web/studio` with `bun run dev` at http://localhost:3888. It proxies `/api/onboarding/*` to this server for both HTTP and WebSocket traffic, so the browser uses one origin. `ONBOARDING_BACKEND_URL` in the Next server environment can override the default `http://127.0.0.1:8000`; restart Next after changing it. Keep the actual frontend origin in the backend's `ALLOWED_ORIGINS` list. The example includes both localhost and 127.0.0.1 on port 3888. Never put provider keys in `NEXT_PUBLIC_*` variables or browser code. Hosting must support persistent WebSocket proxy connections.

## Login and organization persistence

Create a Clerk application and configure email or Google login in its dashboard. Set `CLERK_ISSUER` to its HTTPS Frontend API URL, `CLERK_PUBLISHABLE_KEY` to its public key, and `CLERK_AUTHORIZED_PARTIES` to the exact browser origins. Include your frontend origin in `ALLOWED_ORIGINS` too. Public keys are fetched and cached from the instance JWKS endpoint; no Clerk secret key is needed for verification.

The console at port 8000 includes Clerk sign-in and resumes the organization's latest saved conversation. The teammate's product frontend still needs to wire its Clerk login and onboarding routing to `GET /me/workspace`; its existing browser-local completion flag is not the source of truth.

Every verified user automatically receives one workspace. To share the demo workspace, put the teammates' Clerk user IDs in `DEMO_USER_IDS` **before first login**. Existing users can be added explicitly through a local administrative operation:

```python
from app.store import Store
store = Store("var/onboarding.sqlite")  # use the configured DATABASE_PATH
store.add_member("user_TEAMMATE", "org_EXISTING")
```

For this demo, each user should have one membership. If reassigning an existing user, remove their old membership administratively; multiple organizations and switching are not a product feature. Email is only a login method, never an organization identifier or proof of company membership.

Postgres (via `DATABASE_URL`) persists memberships, organization memory, onboarding completion, and session histories alongside the data layer. SQLite via `DATABASE_PATH` remains a local onboarding/test fallback. Use one API worker. Existing anonymous sessions are retained but quarantined without organization ownership; no new login can claim them. Old capability tokens no longer work. Conflicting updates from an older conversation cannot replace newer company memory.

The demo importer copies the synthetic Meridian fixture into an organization-owned dataset. Uploaded documents and financial records are supported; live connectors are not.

## Responsibilities

- `app/voice.py`: Settings handshake, audio transport, typed input injection, transcript events, interruptions, tool dispatch, function cancellation, idle keepalive, and history replay.
- `app/agent.py`: task-brief schema, bounded read-only record search, and Jev client. It does not call a conversational LLM.
- `app/main.py`: session authentication and browser WebSocket interface.
- `app/store.py` and `app/database.py`: Postgres/SQLite organization and session persistence.
- `app/data_service.py`, `app/data_api.py`, `app/data_tools.py`: scoped ingestion, SQL queries, and cited retrieval.
- `app/ingestion_worker.py`: durable Elasticsearch indexing jobs.
- `evaluator/`: Node service using pinned AI SDK 7.0.105 `experimental_evaluate` with `typesafe-ai/jev`.
- `static/`: browser development console and 16 kHz PCM AudioWorklet.

Deepgram receives these tools:

1. `list_datasets`, `query_financials`, `search_evidence`, and `get_source`: discover imported organization data, calculate exact SQL aggregates, and retrieve cited evidence.
2. `update_context`: validate the complete task brief and ask Jev to evaluate the full transcript, brief, and retrieved evidence. Return readiness to Deepgram so it can end the interview or ask a useful next question.

All tools use `defer_until_eot: true`. Work is cancelled on barge-in or Deepgram's `FunctionCallCancelled` event. Cancelled evaluations cannot commit stale readiness; each new user turn resets readiness. Browser playback is cleared on interruption. Provider audio after a detected speaking event is suppressed until the user's transcript arrives; the provider manages its own abandoned generation.

## Interface

See [API.md](API.md) for typed input, live transcript event examples, and authenticated history pagination.

- `POST /sessions` with `{"demo":true}` requires a Clerk session JWT and returns an organization-owned session; false attaches no records.
- `GET /sessions/{id}/transcript?after=0&limit=100` retrieves ordered transcript segments with the same bearer authentication.
- `GET /sessions/{id}` requires `Authorization: Bearer <token>`.
- `WS /sessions/{id}/stream`: first message `{"token":"..."}`.
- Send `{"type":"text","id":"unique-client-id","text":"..."}`, `{"type":"voice.start"}`, or `{"type":"voice.stop"}`.
- After `voice.ready`, send binary signed little-endian mono PCM, 16 kHz, preferably 80 ms chunks.
- Events: `session`, `transcript`, `reply`, `context`, `readiness`, `status`, `error`, `interrupt`, `audio`, `voice.ready`, `connection.closed`.
- Audio events contain base64 PCM at 24 kHz and a generation number; discard outdated generations and clear queued playback on `interrupt`.

Muting stops microphone input but keeps the managed conversation alive. Keepalive is sent every eight seconds while no audio is flowing. Deepgram's maximum session duration still applies; reconnect replays committed history. Generated assistant text does not prove that every word was played or heard.

## Readiness

Ready means enough context to **begin one scoped read-only investigation**. It does not grant permission for messages, posting, payments, or managing all company finances.

Jev checks goal, company, evidence, ambiguity, and readiness against the complete transcript. Each probability must reach 0.85, plus application checks for a nonempty company, objective, scope, success criteria, and next action. This development threshold is not calibrated financial assurance. Errors and oversized evaluator context fail closed without truncating the transcript. Readiness is visible in the UI and returned as a tool result to Deepgram.

## Verification and limits

```sh
uv run pytest -q
npm test --prefix evaluator
```

Automated tests simulate Deepgram protocol events and Jev responses. They cover managed settings/history, voice/text bridging, scoped tool access, cancellations, stale evaluation protection, duplicate text IDs, full-transcript evaluation, persistence, authentication, and provider errors. A credentialed local integration check verified session creation and authenticated WebSocket traffic through the product interface's same-origin proxy, followed by `voice.ready`, the real greeting transcript, nonzero 24 kHz PCM, and `audio.done`. It used no microphone or audio input; actual microphone capture still needs an interactive browser check.

Run one Uvicorn worker: voice session ownership is process-local. This is a local development backend, not a public multi-tenant service. Clerk identity, organization authorization, and durable leased ingestion/simulator/connector jobs are implemented. Public-service quotas, voice multiworker coordination, public web research, OCR, product UI integration, and execution of a ready brief in `resolve/` remain outside this version.

## References

Scheduled synthetic company activity: see [SIMULATOR_API.md](SIMULATOR_API.md) for the authenticated control API, LLM configuration and worker commands, and [the implementation plan](plans/simulator.md). Simulator jobs and ingestion jobs are durable; voice session ownership remains process-local.

- https://developers.deepgram.com/docs/configure-voice-agent
- https://developers.deepgram.com/docs/voice-agent-llm-models
- https://developers.deepgram.com/docs/voice-agent-conversation-context
- https://developers.deepgram.com/docs/voice-agent-function-call-cancelled
- https://developers.deepgram.com/docs/agent-keep-alive
- https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway

Clerk implementation references: [JWT verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification), [JavaScript login](https://clerk.com/docs/js-frontend/getting-started/quickstart).

See [CONCERNS_API.md](CONCERNS_API.md) for persistent anomaly cards, Jev evaluation, user responses, and leased agent-resolution tools.

See [ARTIFACTS_API.md](ARTIFACTS_API.md) for json-render financial charts and scenario projections, and [DEVIN_API.md](DEVIN_API.md) for persistent coordinator/worker execution.
