# Scheduled Simulator API

A separate worker produces simulated business activity at a configurable interval. Each tick writes a structured record and a supporting source document through the existing ingestion pipeline. HTTP requests only queue work. This is a simulated source stream, not a live Ramp/Gmail/Plaid connector, ledger posting service, or Devin integration.

## Run

Configure the existing database, private S3 bucket and Elasticsearch as described in STORAGE.md. Set `AI_GATEWAY_API_KEY` and `SIMULATOR_MODEL` (an exact AI Gateway model identifier) in `backend/.env` for LLM mode. The server freezes the configured model when creating a run. There is no automatic template fallback.

From the repository root, keep these processes running:

```sh
uv run --directory backend uvicorn app.main:app --host 127.0.0.1 --port 8000
uv run --directory backend python -m app.simulator_worker
uv run --directory backend python -m app.ingestion_worker
```

Alternatively an infrastructure cron can invoke `uv run --directory backend python -m app.simulator_worker --once`: it claims at most one due tick and exits. Continuous mode polls every two seconds when idle and supports demo intervals below a minute. No system cron is installed by this feature. Scheduling is durable in SQL, independent of API process lifetime. If the worker is stopped, accepted runs stay queued until it starts.

LLM requests use Vercel AI Gateway's [Chat Completions REST API](https://vercel.com/docs/ai-gateway/openai-compat/rest-api), a 90-second HTTP timeout and a 3,000-token output ceiling for new LLM-driven runs (legacy narrative-only runs retain 60 seconds / 600 tokens). One request is made per newly generated tick. Failed requests pause the run in `failed`; an explicit start/tick retries. Crash recovery can repeat a model call if the process died before saving its output, but it does not create a second logical event.

## Authentication

Every route uses the existing Clerk bearer token and derives organization scope from membership. Clients cannot supply an organization ID, provider credentials, URL, or arbitrary model. Access to another organization's run returns 404. Existing workspace members can control shared demo runs, matching the current data API permissions.

## Routes

| Method | Path | Behavior |
|---|---|---|
| POST | `/simulations` | Create paused run; returns 201 |
| GET | `/simulations?limit=50&offset=0` | Paginated runs |
| GET | `/simulations/{id}` | Config, state, completed sequence, next due time, safe error |
| POST | `/simulations/{id}/start` | Start/resume automatic generation; returns 202 |
| POST | `/simulations/{id}/pause` | Stop future claims; an in-flight tick may finish |
| POST | `/simulations/{id}/tick` | Queue one tick while paused/failed; returns 202 |
| GET | `/simulations/{id}/events?after=0&limit=50` | Ordered events, source IDs and index statuses |

Create body:

```json
{
  "name": "Meridian live demo",
  "company_name": "Meridian",
  "mode": "llm",
  "interval_seconds": 30,
  "max_ticks": 140,
  "brief": "A crypto infrastructure company: invent complex supplier disputes, settlement issues, ordinary activity and misleading evidence. Continue unresolved stories over time.",
  "start_time": "2026-09-01T00:00:00Z",
  "business_step_seconds": 3600
}
```

`mode: "template"` is an explicit offline option requiring no model credentials. Bounds: interval 10–86400 seconds, max_ticks 1–1000, business step 60–86400 seconds. `start_time` must include a timezone. Extra input properties are rejected. Missing LLM configuration returns 409. Manual ticks during a running schedule or active lease return 409. Completed runs cannot resume; create a new run instead.

States: `paused → stepping → paused`, `paused → running → completed`; errors enter `failed`. A manual tick at the maximum also completes. Missed intervals coalesce; restarting does not unleash a backlog of LLM calls. A five-minute lease permits abandoned work to resume and prevents ordinary overlapping workers from claiming the same tick. Pause preserves an active lease and does not cancel an HTTP request already in progress.

## Event contract and retrieval

Each event exposes an ID, sequence, status, attempt count, creation/publication timestamps, payload and source IDs. Payload contains `synthetic`, `source`, `event_type`, `source_record_id`, `source_version`, `occurred_at`, `dataset`, and a structured `record`. Timestamps on run/event rows are UTC Unix milliseconds; business timestamps in records are ISO 8601. Amounts are integer cents in the record’s explicit currency (USD or EUR); receipt quantities are units. FX rates are decimal strings. Records distinguish `occurred_at` from `observed_at` for delayed evidence. In new LLM runs, the model authors the amounts, relationships, event type and source document together. Code validates schema, reserved fields, timestamps, integer minor units and known cross-record references. This does not guarantee factual or accounting consistency of generated evidence.

Source families: `drive`, `procurement`, `ramp`, `gmail`, `plaid`, `accounting`.

## LLM-driven generation (default)

New `mode: "llm"` runs use generator version 3. Each tick asks the configured model to decide the next business event AND write its source document. There is no seeded plot, fixed event order, mandatory scenario catalog, or code-chosen amount. The `brief` field (1–6,000 characters) guides company context and desired complexity; optional `scenarios` values are creative suggestions, not exhaustive choices. `seed` has no effect in this mode.

The prompt contains the last 40 structured records and a compact identity/amount/status index of older records from this run only. It does not read unrelated organization data or defender-agent actions. Earlier details not in that index may be forgotten. The model can interleave cases, introduce new anomalies and carry unresolved situations forward. It is instructed to mix ordinary activity with anomalies and not reveal future outcomes; semantic compliance is not independently verified.

Invalid model output pauses the run in `failed`, with no template fallback; resume retries generation. Once valid event/document bytes are staged, publication retries reuse them. A crash before staging can repeat a model call. This is durable history, not deterministic scenario selection.

Existing persisted runs retain their recorded generator version. Restart API and simulator worker processes, then create a new LLM run to use this change. LLM mode requires both configured credentials and a model supporting JSON-object output through AI Gateway.

## Offline template scenario selection

For `mode: "template"` (generator version 2), optionally include `"scenarios": ["duplicate_invoice", "bank_change"]` in the create body. Omit it to use the entire catalog. Invalid names and empty lists return 422. The API schema lists accepted names. A seeded shuffled deck visits every selected case before repeating. Cases have different lengths; `max_ticks` counts **documents**, not complete cases, and can stop mid-case. 140 ticks cover at least one complete default deck (with additional cases). Repeated cases vary quantities, prices and vendors. Events within each case remain sequential, not interleaved.

| Scenario | Evidence and challenge |
|---|---|
| `clean` | Matching contract, receipt, controller approval and settlement; avoid false positives |
| `price_and_quantity` | Inflated unit price plus short delivery; pricing credit leaves delivery unresolved |
| `duplicate_invoice` | Different source IDs and invoice formatting for the same obligation; resend email and one payment |
| `revised_invoice` | Discounted replacement invoice plus a stale statement counting both versions |
| `split_approval` | Two $6,000 purchases for one project; each below a $10,000 aggregate approval threshold, manager approvals only |
| `bank_change` | Urgent unverified bank-change request, verified old account, independent-verification policy, amount-only approval |
| `partial_payment` | Full scheduled remittance but only partial bank settlement and an outstanding statement balance |
| `payment_reversal` | Posted payment and clearing journal followed by bank return; obligation remains outstanding |
| `misapplied_credit` | Draft proposal deducts a credit explicitly restricted to another invoice |
| `late_receipt` | Receiving evidence arrives late, then confirms full acceptance; a legitimate timing gap |
| `fx_settlement` | EUR obligation, USD settlement and explicit fee/rate explain the apparent amount mismatch |
| `prepaid_expense` | Annual future service is posted entirely to current expense despite explicit monthly recognition terms |
| `tax_mismatch` | Revised invoice charges tax despite an accepted exemption under an explicit fictional contract rule |
| `wrong_entity` | Invoice names a different subsidiary than the purchasing contract and receipt |

Case names and expected decisions are not attached to source records or passed to the narrative LLM. Scenario selection remains visible in simulation control configuration; do not expose the control API or generator source to a defender when conducting a blinded evaluation. This catalog applies to offline template mode. LLM mode is not restricted to these families.

Published means both originals and relational records are saved, **not** that search indexing finished. `sources[].index_status` exposes that distinction. Use the existing ingestion worker and `/sources/{id}/reindex` for indexing recovery.

- Query structured records with `/financials/query` and datasets `sim_contract`, `sim_purchase_order`, `sim_bill`, `sim_goods_receipt`, `sim_message`, `sim_vendor_credit`, `sim_bank_transaction`; additional datasets include `sim_policy`, `sim_approval`, `sim_statement`, `sim_remittance`, `sim_vendor_profile`, `sim_journal_entry`, `sim_payment_proposal`, and `sim_tax_document`.
- Find supporting passages with `/evidence/search` after indexing.
- Open exact evidence with `/sources/{id}` or `/sources/{id}/download`.
- Link records by purchase_order_id, invoice_id and contract_id. Record IDs include the run ID, preventing collisions across runs.
- Poll events using `next_after`. An unpublished or failed event does **not** advance the cursor, so its eventual publication cannot be skipped. Consumers deduplicate by event ID and only dispatch investigations for `published` events. Polling itself does not acknowledge or start agents.

Output is staged before ingestion. Retries reuse the exact staged bytes and stable source keys, including after a crash between the record and document writes. Generation/ingestion errors are sanitized. Each source is prominently synthetic; sim_* datasets remain separate from other records. Semantic search can still return synthetic documents to the same organization's agents by design.

## Limits

This first version creates autonomous activity rather than responding to agent emails. LLM-authored records and narratives are synthetic, unverified evidence; format validation is not an accounting grader. It does not post journal entries, approve bills, send email or make payments. Future adapters can add supplier responses and real connectors through the same ingestion path. This simulator is not an isolated benchmark with an independent hidden answer key.

## Validation

```sh
uv run --directory backend pytest tests/test_simulator.py -q
RUN_DATA_INTEGRATION=1 uv run --directory backend pytest tests/test_data_integration.py -q
```

The simulator unit suite uses a mocked provider and local SQLite; the opt-in integration suite exercises real Postgres, S3 and Elasticsearch in an isolated test schema. Neither test claims a live LLM call was made.
