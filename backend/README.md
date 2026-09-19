# Deepgram-managed onboarding

Deepgram Voice Agent API owns the complete listening → reasoning → tool-calling → speaking loop over one upstream WebSocket. FastAPI bridges browser audio, executes application tools, and stores state. Jev independently evaluates readiness through Vercel AI SDK.

There is no custom chat-completions loop, separate LLM API key, Devin session, or agent framework in this version. Deepgram's managed default LLM is used unless explicitly overridden.

## Run locally

Requires Python 3.11+, uv, Node 22+, npm, Deepgram Voice Agent access, and Vercel AI Gateway access to Jev.

```sh
cd backend
cp .env.example .env
# Set DEEPGRAM_API_KEY, AI_GATEWAY_API_KEY, and EVALUATOR_SECRET.
uv sync
npm ci --prefix evaluator
node --env-file=.env evaluator/server.mjs
```

In a second terminal, from `backend/`:

```sh
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. Start/resume loads the demo session; type or enable the microphone. The provider connection starts on the first typed message or microphone activation. Both modes use Deepgram. Typing is an alternative to the microphone, **not** a fallback during a Deepgram outage. Refresh and Start/resume restores saved conversation and function history. Microphone access requires localhost or HTTPS.

Optional DEEPGRAM_THINK_PROVIDER and DEEPGRAM_THINK_MODEL select a supported Deepgram-managed model. Leave blank to use the managed default. This may change with Deepgram's configuration. Credentials remain on the backend; `.env` is ignored.

## Responsibilities

- `app/voice.py`: Settings handshake, audio transport, typed input injection, transcript events, interruptions, tool dispatch, function cancellation, idle keepalive, and history replay.
- `app/agent.py`: task-brief schema, bounded read-only record search, and Jev client. It does not call a conversational LLM.
- `app/main.py`: session authentication and browser WebSocket interface.
- `app/store.py`: SQLite session storage.
- `evaluator/`: Node service using pinned AI SDK 7.0.105 `experimental_evaluate` with `typesafe-ai/jev`.
- `static/`: browser development console and 16 kHz PCM AudioWorklet.

Deepgram receives two tools:

1. `search_records` (demo sessions only): search top-level visible financial JSONL records. Private fixture answers and draft narratives are excluded. Company metadata is supplied as initial evidence.
2. `update_context`: validate the complete task brief and ask Jev to evaluate the full transcript, brief, and retrieved evidence. Return readiness to Deepgram so it can end the interview or ask a useful next question.

Both tools use `defer_until_eot: true`. Work is cancelled on barge-in or Deepgram's `FunctionCallCancelled` event. Cancelled evaluations cannot commit stale readiness; each new user turn resets readiness. Browser playback is cleared on interruption. Provider audio after a detected speaking event is suppressed until the user's transcript arrives; the provider manages its own abandoned generation.

## Interface

See [API.md](API.md) for typed input, live transcript event examples, and authenticated history pagination.

- `POST /sessions` with `{"demo":true}` returns a session and bearer capability token; false attaches no records.
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

Automated tests simulate Deepgram protocol events and Jev responses. They cover managed settings/history, voice/text bridging, scoped tool access, cancellations, stale evaluation protection, duplicate text IDs, full-transcript evaluation, persistence, authentication, and provider errors. Live provider/microphone behavior remains unverified without credentials.

Run one Uvicorn worker: session ownership is process-local. This is a local development backend, not a public multi-tenant service. Production identity, quotas, multiworker coordination, and durable background jobs are not implemented. Nor are public web research, arbitrary uploads, live connectors, product UI integration, or execution of a ready brief in `resolve/`.

## References

- https://developers.deepgram.com/docs/configure-voice-agent
- https://developers.deepgram.com/docs/voice-agent-llm-models
- https://developers.deepgram.com/docs/voice-agent-conversation-context
- https://developers.deepgram.com/docs/voice-agent-function-call-cancelled
- https://developers.deepgram.com/docs/agent-keep-alive
- https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway
