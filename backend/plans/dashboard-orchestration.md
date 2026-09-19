# Dashboard orchestration implementation plan

Outcome: the persistent world-page Deepgram assistant handles voice/text, uses direct financial tools for quick answers, and queues bounded Devin investigations for longer work. The backend owns durable tasks and dispatch; closing the page never cancels an investigation.

Implemented:
1. Persistent private conversation per user/organization, shared company context, transcript replay, bounded provider history, reconnect and orb events.
2. `start_investigation` and `get_investigation` tools plus authenticated HTTP equivalents. Atomic case/task/event creation, stable request keys, source ownership checks, paused-state protection.
3. Worker-only dispatcher by default, retaining two-worker concurrency, launch budgets, scoped tokens, ambiguous-launch reconciliation and result persistence. Legacy coordinator is explicit opt-in.
4. Stream saved investigation updates to the dashboard without impersonating the user or interrupting speech. Query tools let Deepgram explain returned evidence on follow-up.
5. Regression tests for persistence/isolation, mixed input, worker-only execution, retries, completion, pause and limits.

Deployment: configure Deepgram and Devin keys, an HTTPS callback URL, and AI Gateway models for optional cards/projections. Run one API worker plus the Devin dispatcher. Frontend integration follows WORLD_AGENT_API.md. Automatic ingestion-triggered investigations remain disabled pending a defined monitoring policy.

Live validation still required: authenticated user conversation → Deepgram tool call → real Devin task → cited result → dashboard notification → voice explanation. Fake-provider tests do not prove provider compatibility.
