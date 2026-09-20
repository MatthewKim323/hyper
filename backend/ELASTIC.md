# Elastic Evidence Investigations

The upgrade adds configurable Jina reranking to existing hybrid retrieval, source lineage metadata, a persistent investigation queue, organization-bound Agent Builder tool definitions, and an Elastic Workflow that returns findings to the existing Jev concern-card pipeline.

It does not post accounting entries. Financial arithmetic remains in the existing exact-query API. The first cloud deployment is explicitly bound to one application organization; other organizations cannot launch its investigator.

## Flow

1. A source finishes ingestion and becomes searchable.
2. An authenticated user/agent queues an investigation, or the worker consumes `source.indexed` events when automatic investigation is enabled.
3. The backend retrieves a bounded, authorized evidence bundle using BM25 + semantic RRF + optional Jina reranking. It adds trigger-document excerpts and prior concern context.
4. An Elastic Workflow invokes a custom Agent Builder investigator. Its two bounded ES|QL tools search related evidence and source-version history; the organization constraint is fixed in each tool definition, not supplied by the model.
5. The Workflow calls the backend with structured findings. The backend validates chunk ownership, current source status, bundle membership, and retrieval coverage.
6. The worker creates a concern for findings that need action. Existing Jev evaluation generates response choices. User-selected work follows the existing Devin flow.

Each investigation has a stable request key, persisted status, execution ID, evidence snapshot, and result. A completed investigation can reference a concern whose card generation failed: inspect the concern status before displaying choices. Historical policy statements are labeled unapproved hypotheses.

## Configuration

Use `backend/.env` or deployment environment variables; never commit credentials.

- `ELASTICSEARCH_URL`: Serverless Elasticsearch endpoint.
- `ELASTICSEARCH_API_KEY`: key with the required index/inference privileges.
- `ELASTICSEARCH_INDEX`: versioned evidence index or a single-index alias.
- `ELASTIC_INFERENCE_ID`: verified Jina embedding endpoint; current docs list `.jina-embeddings-v5-text-small`.
- `ELASTIC_RERANK_INFERENCE_ID`: verified reranker endpoint; current docs list `.jina-reranker-v3.5`.
- `ELASTIC_KIBANA_URL`, `ELASTIC_KIBANA_API_KEY`: HTTPS Kibana endpoint and restricted service key.
- `ELASTIC_KIBANA_SPACE`: optional space ID.
- `ELASTIC_AGENT_ORGANIZATION_ID`: organization from `/me/workspace`.
- `ELASTIC_CALLBACK_SECRET`: random secret of at least 32 characters.
- `ELASTIC_CALLBACK_CONNECTOR_ID`: configured Kibana HTTP connector described below.
- `ELASTIC_WORKFLOW_ID`: returned by provisioning.
- `ELASTIC_AUTO_INVESTIGATE`: `false` by default; `true` consumes indexed-source events, including existing unprocessed events.
- `ELASTIC_MAX_ACTIVE_INVESTIGATIONS`: defaults to 2. Unknown dispatches count against the limit.

Changing embedding models requires a new index and reindexing. Metadata mappings can be added to an existing index, but historical documents only acquire those fields when reindexed. Jina model availability varies by project/version. A local ELSER endpoint does not establish Jina or Serverless availability.

## Provision

From `backend/`:

```sh
uv run python -m app.elastic_setup check
uv run python -m app.elastic_setup definitions > /tmp/hyper-elastic-definitions.json
uv run python -m app.elastic_setup provision
uv run python -m app.elastic_worker
```

Before provisioning, create a Kibana HTTP connector with the public backend HTTPS base URL and an encrypted `Authorization: Bearer <ELASTIC_CALLBACK_SECRET>` header. Set its ID in the environment. Secrets are not embedded in generated Workflow definitions or event inputs.

`definitions` emits reviewable tools, agent, and Workflow configuration without making cloud changes. Provisioning uses documented Agent Builder and Workflows APIs and updates stable IDs on reruns. The Workflow definition is serialized as JSON, which is valid YAML 1.2. The default input layout targets current Serverless/Stack 9.5+; use `--legacy-inputs` for Stack 9.4. The cloud validates the definition when creating/updating it. No internal Kibana APIs are used.

Use a dedicated space and least-privilege credentials. Do not add unrestricted platform search/ES|QL tools to this agent. The fixed query scopes protect the shipped tools, but space access alone is not index authorization. For multiple organizations, provision separate scoped definitions and credentials; this implementation intentionally rejects other organization IDs.

## Production

Railway, `production` environment. The evidence index is configured on every service that
reaches retrieval, directly or through `data_service`: `api`, `ingestion-worker`,
`counterparty-worker`, `artifact-worker`. A worker that indexes without these set writes to
`http://127.0.0.1:9200`, which does not exist in the container.

| Variable | Value |
| --- | --- |
| `ELASTICSEARCH_URL` | the Serverless project endpoint |
| `ELASTICSEARCH_API_KEY` | project API key |
| `ELASTICSEARCH_INDEX` | `hyper-evidence-v1` |
| `ELASTIC_INFERENCE_ID` | `.jina-embeddings-v5-text-small` |
| `ELASTIC_RERANK_INFERENCE_ID` | `.jina-reranker-v3.5` |

Both inference endpoints are preconfigured by Serverless; nothing needs provisioning to use
them. Retrieval reports its own mode at construction, which is the cheapest way to tell what a
deployment is actually doing: `keyword` means `ELASTIC_INFERENCE_ID` never arrived, and the
index is being searched by BM25 alone.

`ensure_index` refuses to reuse an index whose `semantic` mapping names a different model,
because the stored vectors would not be comparable to the ones a query produces. Changing
either model means a new `ELASTICSEARCH_INDEX` and a reindex — cheap only while the index is
empty. The guard raises rather than silently degrading, so a mismatch surfaces as a failed
ingestion job, not as quietly wrong search results.

Object storage is configured separately (`backend/STORAGE.md`). Search and ingestion both
depend on it: the worker reads the uploaded file from the bucket before it indexes anything, so
Elasticsearch alone does not make uploads work.

### Agent Builder

The investigator agent is provisioned on the same Serverless project over A2A, which needs no
Kibana callback connector:

```sh
uv run python -m app.elastic_setup provision --transport a2a
```

| Variable | Value |
| --- | --- |
| `ELASTIC_KIBANA_URL` | the project's `.kb.` host, not the `.es.` one |
| `ELASTIC_KIBANA_API_KEY` | same project key as Elasticsearch |
| `ELASTIC_AGENT_ORGANIZATION_ID` | `demo-meridian` |
| `ELASTIC_A2A_AGENT_ID` | the `agent_id` that `provision` prints |

Each ES|QL tool has the organization ID compiled into its query, so an agent provisioned for
one organization cannot read another's evidence even if asked to. Provisioning for a second
organization means a second agent with its own scoped tools; `definitions` rejects any other
organization ID outright.

`check` reports every dependency in one call and is the fastest way to tell whether a
deployment can actually run an investigation.

## API

All investigation create/list/read/retry/refresh routes use the existing user organization authentication. The callback uses its separate server credential.

```http
POST /elastic/investigations
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "request_key": "invoice-review-42",
  "source_id": "src_...",
  "question": "Does this invoice agree with the contract and approval history?"
}
```

- `GET /elastic/investigations?limit=50`: recent saved investigations.
- `GET /elastic/investigations/{id}`: status, result, execution ID, and concern ID.
- `POST /elastic/investigations/{id}/refresh`: check a running cloud execution; confirmed failure/cancellation becomes retryable.
- `POST /elastic/investigations/{id}/retry`: retry confirmed `failed` runs only. Saved findings are republished without another model run.
- `POST /elastic/investigations/{id}/result`: trusted Workflow callback accepting the `Finding` schema; not a user decision endpoint.

Agent tools: `investigate_financial_evidence` and `get_evidence_investigation` are exposed alongside existing data tools. API creation returns 202 and a persisted pending investigation; the worker must be running.

Typical states: `pending -> dispatching -> running -> reviewed -> publishing -> complete`.

An ambiguous launch timeout or interrupted dispatch becomes `dispatch_unknown`, not an automatic duplicate launch. Inspect Elastic execution history before administrative reconciliation. The callback can still complete a run in this state. The worker polls running executions every 30 seconds (or use `refresh`); confirmed failed executions can use `retry`; failed Jev cards use the existing concern-card retry route. External Workflow execution continues independently of the local worker process.

## Verification and limits

Tests cover tenant isolation, callback authentication, forged/stale citations, incomplete coverage, duplicate callbacks and requests, early callbacks, ambiguous launches, active-run bounds, ingestion event consumption, and retrieval filter preservation. Provider responses are mocked for cloud contracts until credentials are supplied.

The current investigator uses a bounded evidence sample, not a certified full-ledger audit. Tools can discover historical evidence outside that sample, but such evidence cannot support a final decision until an investigation includes it. `no_concern` means no supported concern in the reviewed scope, not proof of absence. Source-version changes invalidate stale findings.

This increment does not yet include a normalized transaction-analysis index, automatically merged cross-source cases, or a measured retrieval benchmark. Those remain follow-up work from the architecture plan. No benchmark improvement is claimed without measurements.

References: [Jina models](https://www.elastic.co/docs/explore-analyze/machine-learning/nlp/ml-nlp-jina), [reranking](https://www.elastic.co/docs/solutions/search/ranking/semantic-reranking), [Agent Builder APIs](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/kibana-api), [AI Workflow steps](https://www.elastic.co/docs/explore-analyze/workflows/steps/ai-steps), [Workflow run API](https://www.elastic.co/docs/api/doc/kibana/operation/operation-post-workflows-workflow-id-run).

## A2A specialist delegation

The preferred setup now uses Elastic Agent Builder's native A2A JSON-RPC endpoint. Existing workflow deployments remain supported. Set:

```dotenv
ELASTIC_AGENT_TRANSPORT=a2a
ELASTIC_A2A_AGENT_ID=hyper-finance-<organization-hash>
ELASTIC_KIBANA_URL=https://your-project.kb.region.cloud.es.io
ELASTIC_KIBANA_API_KEY=<server-side-read-only-agent-key>
ELASTIC_AGENT_ORGANIZATION_ID=<application-organization-id>
```

Optional `ELASTIC_KIBANA_SPACE` applies to both discovery and execution. No Workflow ID, public callback tunnel, callback connector or callback secret is needed for A2A. Without an explicit transport, a configured A2A agent ID selects A2A; otherwise legacy workflow selection is retained.

Provision the read-only tools and specialist agent using an appropriately privileged setup credential (then use a restricted runtime credential):

```sh
uv run --directory backend python -m app.elastic_setup definitions --transport a2a
uv run --directory backend python -m app.elastic_setup provision --transport a2a
uv run --directory backend python -m app.elastic_setup check
uv run --directory backend python -m app.elastic_worker
```

The generated tools use concrete index names and server-fixed organization filters. Organization IDs are not model-controlled tool parameters. Do not replace these with broad built-in index exploration/search tools using a cross-company credential. Provision Elasticsearch/Kibana permissions for the target company's resources; a prompt is not a tenancy boundary. This deployment remains explicitly bound to one application organization. Multi-organization provisioning requires separate credential/agent mappings.

### Existing API, upgraded transport

Dashboard/Devin agents call `investigate_financial_evidence` with source_id, question, request_key. HTTP clients use `POST /elastic/investigations` (202), then `GET /elastic/investigations/{id}`. The API queues durable work; the background worker discovers the configured Agent Card and calls `message/send`. The configured Kibana origin is fixed: URLs returned by the card are never followed.

Elastic currently documents synchronous A2A completion and no streaming. The adapter supports JSON-RPC Agent Cards reporting protocolVersion 0.2.x or 0.3.x, direct agent messages, and completed task artifacts/status output. It requests a strict JSON Finding. It does not invent task-polling support or treat nonterminal task output as completion. An unsupported protocol fails before dispatch; 1.0 requires an explicit adapter upgrade.

The worker accepts a finding only after schema checks and independent validation that every cited chunk belongs to this organization and remains active/indexed. A2A can cite additional current evidence found through its scoped tools; these source records are hydrated into the saved context. Legacy workflow callbacks retain their original supplied-bundle-only citation restriction.

Responses expose source/chunk/locator citations, transport, search_scope, unresolved questions and retrieval_coverage_complete. That coverage flag concerns the retrieval/indexing inputs, not proof of an exhaustive audit. Search-scope descriptions are agent-reported. A finding never approves a payment, posts a journal, or changes company policy. Exact accounting totals still come from Postgres-backed tools.

### Failure and retry behavior

Stable investigation IDs identify JSON-RPC messages; they are not assumed to guarantee provider-side deduplication. Timeouts, malformed post-dispatch output and interrupted launches become dispatch_unknown and are never automatically resent. Inspect the remote run before reconciling an ambiguous dispatch. Reviewed findings still pass the existing publication freshness checks and concern creation flow. Capacity limits and leases apply to both transports; a five-minute dispatch lease exceeds the bounded discovery and execution request timeouts.

### Validation and live prerequisites

Mock-transport tests cover Agent Card discovery, JSON-RPC correlation, authentication, completed results, malformed/nonterminal results, timeout non-replay, source hydration, and organization isolation. Legacy workflow tests remain enabled. Local .env currently lacks Kibana URL/key, application organization binding and A2A agent ID, so live Elastic execution has not been verified.

Sources: [Elastic A2A server](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/a2a-server), [A2A 0.3 specification](https://a2a-protocol.org/v0.3.0/specification/).

## Knowledge graph and retrieval benchmark

Evidence search is widened by the company knowledge graph and measured on the Meridian corpus. See [GRAPH.md](GRAPH.md): recall@10 0.598 for hybrid, 0.937 for hybrid plus graph.
