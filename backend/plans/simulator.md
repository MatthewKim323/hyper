# Scheduled company simulator

## Outcome
An authenticated organization can create a simulated company feed, start/pause its schedule, queue a manual tick, and retrieve durable events linked to original evidence and queryable records. A separate worker performs LLM calls, never the HTTP request. No real messages or payments are sent.

## Implementation plan
1. Add organization-scoped simulations and durable event tables to the existing shared schema.
2. Use an interval schedule (cron-compatible worker --once), bounded ticks and sequential leased claims. Persist generated output before ingestion; retry the same event rather than advancing after failure.
3. Generate connected purchasing, contracts, bills, receiving, supplier email, credit and bank activity. Deterministic seeded facts own amounts and IDs; an LLM authors supporting text. Include clean, price discrepancy and unresolved partial delivery scenarios. Use isolated sim_* datasets and explicit synthetic labels.
4. Reuse DataService ingestion for originals, structured queries and asynchronous Elastic indexing. Event history returns source IDs and ingestion status; indexing failure remains independently retryable.
5. Expose create/list/get/start/pause/tick/events with existing Clerk organization scope, strict inputs and no client-supplied organization IDs or provider URLs. LLM mode requires configured credentials/model; template mode is explicit for offline tests.
6. Test authorization, scheduling, bounds, overlap, failure/restart recovery, duplicate ingestion and linked financial consistency; document operating commands and API examples.

## Scope and tradeoffs
- Default LLM provider: Vercel AI Gateway Chat Completions using server-only configuration. Model must be configured, never silently substituted. One call per generated tick; bounded output and timeout.
- Interval scheduling avoids timezone/cron-expression complexity. --once can be invoked by infrastructure cron; persistent loop provides second-level demo cadence. No host-wide cron installation.
- Pause prevents subsequent claims; an in-flight tick may finish. Missed intervals coalesce instead of bursting.
- First version is an autonomous source stream, not a reactive supplier negotiation engine or Devin dispatcher. Consumers poll published event IDs and resume affected work; no claim that Devin is integrated.
- Records are synthetic observations, not authorized ledger postings. LLM prose is untrusted evidence; deterministic record fields remain authoritative for simulation arithmetic.
- No hidden answer keys are stored in the searchable corpus. This deterministic scenario generator is not an isolated adversarial benchmark: a defender with source-code access could infer scenario rules.

## Validation
Run focused simulator tests, existing backend tests, and inspect OpenAPI. Live model verification requires AI_GATEWAY_API_KEY and SIMULATOR_MODEL; report whether actually exercised.

Reference: https://vercel.com/docs/ai-gateway/openai-compat/rest-api

## Implemented and verified
- Control API, durable scheduler worker, seeded connected scenarios, AI Gateway writer, staged/idempotent publication and retrieval are implemented.
- Eight simulator tests pass, covering API isolation, worker overlap, abandoned claims, schedule/pause behavior, partial-ingestion retry, financial consistency and mocked provider request shape.
- Two live storage tests pass against Postgres, S3-compatible storage and Elasticsearch, including simulator publication, process/store restart and search.
- Live LLM calls remain unverified: AI_GATEWAY_API_KEY and SIMULATOR_MODEL are not configured in this checkout.

## September 19 expansion
- Added versioned v2 catalog with 14 case families, optional scenario selection, deterministic shuffled coverage, and variable case lengths. Existing persisted runs retain v1.
- Added source evidence for approval scope, entity identity, invoice replacement, returned payments, credit restrictions, prepaid timing, and FX. Narrative generation cannot change structured facts.
- Added all-case ingestion tests, cross-record reference checks, balanced journal checks, arithmetic and unresolved-case checks, and deterministic coverage tests.
- Still a scheduled evidence stream; reactive counterparties and isolated evaluation remain separate work.

## LLM-driven revision
- New LLM runs use v3: the model authors each event, financial facts and narrative from a creative brief plus prior run history. No seeded case selection or code-chosen amounts.
- Retained v2 only for explicitly requested offline template mode and frozen older runs for compatibility.
- Validate output shape, timestamp, integer amounts, reserved fields and known source references; never silently substitute template events.
- Persist generated event/document before ingestion; retry reuses staged bytes.
- Tests: model-chosen event types/amounts, prior-event context, linked follow-ups, invalid output rejection and ingestion retry without regeneration.
