# Persistent Devin Finance Orchestrator

Status: backend implementation delivered; live Devin validation pending credentials/connectivity. September 19, 2026.

See ../DEVIN_API.md for the implemented API, worker, configuration, limits and deviations. Service credentials are stored as hashes on controller/task records rather than a separate credentials table. HTTP tool dispatch is implemented; the MCP facade and live account smoke test are deferred. Pause revokes app access but does not terminate provider VMs.

## Decision

Use one resumable Devin coordinator session per application organization, backed by durable application state and a small always-running dispatcher. Devin decides what work to do and delegates bounded investigations to other Devin sessions. The dispatcher delivers events, creates/resumes sessions, records results and enforces limits; it does not implement a replacement LLM reasoning loop.

“Always on” means available and automatically resumed when work arrives. Do not keep a model reasoning or polling an empty queue. A provider session is replaceable; the company’s memory is in Postgres, object storage and Elasticsearch.

## Verified provider capabilities

- Devin v3 organization APIs manage sessions using service credentials and permissions. Prefer v3 over legacy v1/v2.
- Create Session accepts `resumable` (default true, preserving VM state), `max_acu_limit`, playbooks, session secrets, tags and structured output schemas.
- Messaging a suspended session resumes it. Status detail distinguishes working, waiting for user/approval, finished, inactivity and usage-related suspension. An API message is not a guarantee that quota or credit constraints are solved.
- Managed Devins provide native coordinator/child sessions on isolated VMs, progress monitoring and child controls. UseDevinExpert permission is required.
- Dynamic Workflows provide recorded/resumable script orchestration. Useful later for broad batch close work, unnecessary for the initial one-coordinator/two-worker demo. Enterprise enablement and workflow approval settings matter.
- Custom MCP supports Streamable HTTP with authentication. Cloud sessions need a reachable HTTPS endpoint; localhost on the developer laptop is not reachable by default.

## Application architecture

1. Connector/simulator ingestion commits an `agent_event` alongside the durable source/job state. User concern responses and worker completion also append events in their transaction. Dispatcher initially polls Postgres; no Kafka/Redis requirement.
2. Dispatcher batches events per organization and case, obtains the single coordinator delivery lease, then sends event IDs and concise summaries to the current coordinator. Full evidence is fetched through tools. Persist attempt, delivery and acknowledgment separately.
3. Coordinator reads organization context and current cases, decides whether to investigate, updates a case, or delegates. A sleeping coordinator receives a message; terminal/unrecoverable sessions are replaced from saved case state and a checkpoint. Explicit user pauses and exhausted budgets must not be auto-bypassed.
4. Coordinator calls `delegate_task(case_id, objective, evidence_ids, success_criteria)`. Backend atomically registers the task, allocates a bounded credential and creates a worker Devin session. Track app-level parent/task/session links. Initially use backend-mediated session creation for enforceable quotas and credential isolation; do not assume this sets Devin’s native parent_session_id. Native managed children are an optional follow-up once child credential propagation and controls are verified live.
5. Worker searches evidence, queries structured records and runs calculations in its Devin environment. It writes findings/proposed actions with citations, then reports completion or a blocker. Coordinator reconciles results and raises concerns through existing Jev-reviewed cards.
6. User chooses a card response. Existing concern decision is saved, an event wakes the coordinator, and it delegates/resumes the relevant investigation. External financial actions remain separately authorized.
7. Frontend reads durable task/case/activity status. “Running,” “waiting for you,” “blocked,” and “resolved” must come from saved state, not generated claims or a provider session simply stopping.

## Data and tools

Add tables:
- `agent_controllers`: organization, active provider session, generation, checkpoint, paused state and delivery lease.
- `agent_events`: organization, event type/source version, case, deduplication key, payload, delivery and acknowledgment state.
- `agent_tasks`: organization, case, objective, parent task/session, assigned provider session, status, attempt, lease and output.
- `agent_attempts`: create/message requests, provider IDs, timestamps, errors and usage for recovery.
- `agent_credentials`: hashed credential identity, organization, role, task scope, expiration and revocation.
- `cases` and append-only `case_updates`: source links, findings, unknowns, actions, concern links and version. A concern is a user escalation; not every case needs one.

Expose authenticated application tools via one shared dispatcher, usable from an HTTP client and a thin MCP facade:
- Existing list_datasets/query_financials/search_evidence/get_source.
- Existing raise_concern/list_concerns/get_concern/claim_concern/resolve_concern.
- New list_events/ack_events/get_case/update_case/delegate_task/get_task/report_task_result/checkpoint.
- Add scoped lease renewal for long investigations; current concern claim expires after 15 minutes with no renewal.

Service authentication is distinct from Clerk browser identity. Bind organization server-side; never trust organization supplied in arguments. Worker credentials can access permitted organization evidence and their assigned case/task, but cannot impersonate user card responses, change simulation controls, create arbitrary sessions or access other organizations. Retain provider API credentials only on the backend. Prefer per-session secrets for scoped app credentials. Confirm actual MCP credential isolation in a live spike; do not share a tenant-wide token across unrelated customer organizations.

## Reliability and cost

- Start with one coordinator and at most two concurrent workers per demo organization. Enforce task/delegation depth, per-session ACU and organization-wide usage budgets in application code. Threshold values depend on a live trial, not assumed pricing.
- Event delivery is at least once. Task creation, acknowledgments, case writes and completion require idempotency keys/version checks.
- Provider-create timeouts are ambiguous: persist an attempt key and session tag before launch, reconcile existing sessions before retrying; never blindly create a second paid worker. Confirm whether provider supports a stronger idempotency mechanism before relying on one.
- Poll provider status with backoff, not an unverified webhook assumption. Inbound automation webhook triggers are not necessarily outbound session lifecycle notifications.
- Session stopped/finished is not business-task completion. Validate task outputs and source scope; surface unsupported completion as needing review.
- Automatic recovery can retry bounded transient errors. Quota exhaustion and authorization gates become explicit blocked states, not endless wake-ups.
- Checkpoints store findings, unresolved questions, current task IDs and source references. A new coordinator starts from those plus database state, not a giant replayed transcript.
- Wait for required ingestion/index status or allow direct source reads; do not interpret an unindexed document as missing business evidence.

## Build order and acceptance

1. Connectivity spike: authenticate v3, create a resumable session with low explicit ACU budget, read one organization-owned source through service auth, pause/resume, and receive structured output. Confirm actual account permissions and session latency.
2. Durable coordinator: event outbox, dispatcher, session mapping, checkpoints, restart recovery and status API. Use existing Postgres.
3. Delegation: task tools, bounded worker sessions, results, leases/renewal, scoped credentials and duplicate-launch recovery.
4. End-to-end concern loop: simulated invoice → investigation → cited concern → Jev-reviewed three options/custom → user response → resumed worker → evidence-backed result.
5. Recovery tests: replay event, API restart, worker timeout, stale claim, cross-tenant request, provider quota suspension and malformed result. No duplicate task or lost user choice.

Done when a live generated event reaches Devin, Devin investigates using our APIs, the app renders a concern, a user response resumes work, and backend restart preserves the entire case. Do not claim live behavior until the credentialed spike passes.

## Sources

- https://docs.devin.ai/api-reference/overview
- https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions
- https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions-messages
- https://docs.devin.ai/work-with-devin/advanced-capabilities
- https://docs.devin.ai/work-with-devin/dynamic-workflows
- https://docs.devin.ai/work-with-devin/mcp
