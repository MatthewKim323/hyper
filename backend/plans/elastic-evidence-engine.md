# Elastic Financial Evidence Engine

Status: implementation underway. The retrieval upgrade, durable investigation API/worker, scoped Agent Builder definitions, and Workflow provisioning are implemented; see ../ELASTIC.md. Cloud credentials are not configured, so Serverless/Jina/Agent Builder execution remains unverified. Structured activity indexing, automatic case merging, and retrieval benchmarking remain planned.

## Outcome

Turn a new invoice, payment, email, or contract amendment into an evidence-backed financial concern. Reconstruct relevant historical practice, retrieve contradictory evidence, explain the unresolved exposure, and offer the user actionable choices through the existing concern system.

The demo should show a case changing as new evidence arrives: a credit note resolves a price discrepancy, but a missing delivery approval remains unresolved. Every conclusion links to original evidence. Historical patterns are policy hypotheses until explicitly accepted, not automatic authorization.

## Existing foundation

`app/retrieval.py` already supports keyword search, optional `semantic_text`, reciprocal rank fusion (RRF), organization/source filters, and selective embedding of prose. `DataService.search_evidence` checks retrieved chunks against authorized SQL sources. Reuse this foundation.

Postgres holds application state, exact financial records, concerns, and agent events. Object storage holds original documents. Existing connector and simulator ingestion paths should converge on the same indexing and event contract. Devin already has coordinator/worker infrastructure; it should delegate investigation instead of running a competing search pipeline.

## Architecture

```text
Connectors / LLM simulator
          |
     Existing ingestion
       /          \
Postgres + S3   Elastic Cloud Serverless
                    |
            Indexed-event workflow
                    |
      Structured candidates + Jina retrieval
                    |
       Agent Builder evidence specialist
                    |
        Validated concern proposal
                    |
        Existing Jev decision cards
                    |
         User decision -> Devin task
```

FastAPI owns authorization, durable event delivery, evidence validation, and financial mutations. Elastic Workflows owns the bounded investigation sequence. Agent Builder reasons over retrieved evidence. Devin handles broader case coordination and follow-up execution. Avoid multiple independent loops processing the same event.

## Storage and retrieval

Use three small index families with versioned mappings and aliases:

1. **Evidence:** document chunks from invoices, contracts, email, approvals, and credit notes. Include organization, source ID/version, chunk ID, original locator, document type, content hash, occurred/observed timestamps, current/superseded state, and linked vendor/invoice/PO identifiers.
2. **Activity:** structured transaction projections used for candidate matching and ES|QL analysis. Include stable record IDs, currency, amount in explicit minor units where appropriate, dates, account/vendor IDs, related documents, and status. Preserve raw exact values in Postgres; never sum mixed currencies or use floating-point search results as posting authority.
3. **Case memory:** prior resolutions and policy hypotheses with supporting and contradicting evidence IDs, effective dates, scope, approval status, and version. Separate observed practice from approved policy.

Entity links should carry extraction provenance and uncertainty. An LLM suggesting that two vendor names are equivalent must not silently merge their financial identities.

Use Jina embeddings through Elastic Inference Service (EIS), initially on prose in `semantic_text`. The current documentation lists `jina-embeddings-v5-text-small`; verify the endpoint exists in the actual Serverless project before configuring it. Prefer managed inference over our own embedding worker or ML nodes. If unavailable, configure a supported Jina model through Elastic's JinaAI inference integration.

Search exact identifiers and natural language separately, combine BM25 and semantic candidates with RRF, then rerank a bounded candidate set with Jina. Current documentation lists `.jina-reranker-v3.5`; probe availability before provisioning. Keep IDs, amounts, dates, and currencies in typed fields. Do not embed every ledger row or introduce a separate vector database.

Start with text extraction and source locators. Multimodal PDF retrieval is a later experiment, not a prerequisite for the demo.

## Agent Builder tools

Create one financial evidence specialist with a restricted tool set:

- `search_evidence`: hybrid retrieval with citations and retrieval coverage.
- `get_case_timeline`: invoice, payment, amendment, approval, and credit events in chronological order.
- `find_discrepancy_candidates`: parameterized ES|QL queries for duplicate candidates, unmatched activity, or inconsistent amounts/statuses. These identify candidates, not final accounting judgments.
- `get_prior_decisions`: comparable historical cases, including contrary precedents.
- `propose_concern`: invoke a controlled workflow/backend bridge; never permit arbitrary ledger writes.

Use an index-search tool for broad evidence discovery and parameterized ES|QL tools for repeatable structured questions. If built-in search cannot express the required reranking pipeline, expose the existing backend retrieval function through a narrowly scoped adapter. Do not assume the current HTTP tool bridge is already an MCP server.

Return a schema-validated investigation containing source event ID, case version, observations, unresolved issues, evidence IDs, policy hypotheses, uncertainty, and a proposed concern. Backend validation checks evidence ownership, source availability/version, exact amounts, and duplicate proposals before saving anything.

## Workflow and delivery

On successful indexing, deliver a durable event carrying organization, source/version, and event ID. The consumer invokes a supported Workflow trigger/execution API after confirming the project's available API and privileges. Do not depend on undocumented Kibana internal routes.

The Workflow fetches related records, calls the specialist through `ai.agent` with structured output, then submits a proposal to an authenticated backend endpoint. Persist workflow run IDs and enforce an idempotency key based on organization, source version, and investigation type. Handle retries and late documents without producing duplicate cards. Update an existing case when its underlying evidence changes.

Use bounded concurrency, timeouts, retry limits, and inference budgets. An ingestion backlog should remain inspectable and retryable. Do not launch a fresh Devin session for every transaction.

## Tenant isolation and authority

An organization parameter in the prompt is not access control. Agent Builder accesses Elastic directly, so the existing SQL post-filter alone is insufficient. For a single-company demo, use explicit company index allowlists and restricted credentials. Before supporting multiple companies, enforce index-level isolation or verified document-level security for every search and tool invocation. Test with deliberately similar records belonging to a second organization.

Use separate Elasticsearch and Kibana endpoints/credentials with minimum privileges. Keep secrets server-side. Workflow tool confirmation settings supplement but do not replace backend approval checks. Treat retrieved emails and documents as evidence, never executable instructions.

## Implementation sequence

1. Provision or connect an Elastic Cloud Serverless project. Verify inference endpoints, Agent Builder API access, Workflows availability, subscription, and privileges. Record capability checks without exposing secrets.
2. Extend evidence metadata and index the structured activity projection. Reindex a bounded demo corpus into versioned indexes; switch aliases after coverage checks.
3. Add configurable Jina reranking to existing hybrid retrieval. Preserve source authorization and citation contracts.
4. Provision the specialist and tools through supported APIs, with checked-in definitions. Call it from the backend through the Kibana Agent Builder API.
5. Connect one indexed-event Workflow to the existing concerns/Jev flow. Add deduplication, retry handling, case version checks, and user-decision handoff to Devin.
6. Run the evolving-evidence demo and publish retrieval/evidence metrics.

## Acceptance and demo evidence

Build a small held-out set of 20–30 investigations with known supporting and contradicting documents. Compare keyword search, Jina hybrid search, and hybrid plus reranking on evidence recall, top-result precision, citation validity, latency, and inference cost. Set performance targets after measuring the corpus; do not invent winning percentages.

Required behavior: cross-source evidence retrieval; visible citations; correct handling of amended/superseded documents; policy hypotheses distinguished from approved rules; one concern per underlying event/case; partial resolution when new evidence arrives; no cross-organization leakage; no unauthorized postings.

Show judges the workflow execution, actual Jina inference configuration, Agent Builder tool calls, and before/after retrieval results alongside the user-facing case. This demonstrates substantive use of the four track criteria.

## Primary references

- [Jina models and Elastic deployment options](https://www.elastic.co/docs/explore-analyze/machine-learning/nlp/ml-nlp-jina)
- [semantic_text setup](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text-setup-configuration)
- [Semantic reranking](https://www.elastic.co/docs/solutions/search/ranking/semantic-reranking)
- [Agent Builder ES|QL tools](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/tools/esql-tools)
- [Agents and Workflows integration](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/agents-and-workflows)
- [Workflows setup and privileges](https://www.elastic.co/docs/explore-analyze/workflows/get-started/setup)
- [Agent Builder permissions](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/permissions)
- [Agent Builder Kibana APIs](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/kibana-api)

Research date: 2026-09-19. Model and feature availability must be checked against the selected project; local Elasticsearch compatibility does not establish Serverless capability.
