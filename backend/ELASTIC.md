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
