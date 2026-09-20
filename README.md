# hyper

**An agentic system for the Office of the CFO.** It resolves accounts-payable exceptions end to end: reads the evidence, asks the supplier or the internal desk for what is missing, computes the supported payable in a deterministic engine, and routes it to a human for a hash-bound approval. It cannot move money.

Built at HackMIT 2026 by [Matthew Kim](https://github.com/MatthewKim323) and Stephen Hung.

[Whitepaper](whitepaper/main.pdf) · [Docs](https://hyper.stephenhung.me/docs) · [Knowledge graph](backend/GRAPH.md) · [What the agent has learned](backend/benchmarks/learning/LESSONS.md)

---

## The result we care about

Every exception runs twice: once by a worker that keeps lessons from its own past mistakes, once by an identical worker with no memory. Same model, same tools, same cases. On the hard tiers, where every accounting check passes and the right answer is still *hold*:

| | correct | wrong releases |
|---|---|---|
| **with memory** | **189 / 194** | **3** |
| without memory | 108 / 194 | 86 |

The control arm mostly read the warning and paid anyway. The memory arm missed each new kind of trap once, wrote itself a lesson, and did not miss it again.

Grading reads persisted engine state, never what the agent said. These are development results: we wrote the scenarios, the worker prompt and the grader, nothing is held out, and every counterparty is simulated. See [LESSONS.md](backend/benchmarks/learning/LESSONS.md) for every case and every lesson, and [BENCHMARK_TIMELINE.md](backend/BENCHMARK_TIMELINE.md) for how the series are built.

## Retrieval

Evidence search fuses BM25, `semantic_text` embeddings and a third retriever that matches knowledge-graph entity IDs: `rrf[ rerank(rrf[bm25, semantic]), graph ]`. Measured on 172 questions whose answer key is never indexed:

| Retrievers | Recall@10 | Questions only a relationship can answer |
|---|---|---|
| BM25 | 0.546 | 0.248 |
| plus embeddings (Jina v5, Elastic Serverless) | 0.533 | 0.233 |
| plus reranker | 0.663 | 0.287 |
| **plus graph** | **0.944** | **0.864** |

The embedding model barely matters here. The graph is the signal. Putting the reranker over the fused list instead of over the text retrievers costs 0.174 recall, because a cross-encoder scores wording and a document that matters because its invoice was settled by the payment in the question shares no wording with it. Details in [GRAPH.md](backend/GRAPH.md).

## How it is put together

Three layers, strictly separated.

| Layer | Owns | Where |
|---|---|---|
| Deterministic engines | Money. Three-way match, credit lifecycle, accruals, settlement reconciliation, journal posting, trial balance. Integer minor units. No model output becomes an amount. | [`resolve/`](resolve), `backend/app/accounting.py` |
| Agents | Judgment. Investigate, cite, request evidence, propose. | `backend/app/auto_agent.py`, `devin_worker.py`, `voice.py` |
| Humans | Authority. Hash-bound approval, owner-only posting and dismissal. | `backend/app/concerns.py`, `accounting_api.py` |

Around them: a knowledge graph of the company (115,645 entities, 281,698 relationships, every edge citing the row that asserts it), an adversary that generates graded exceptions across 21 families in 7 difficulty tiers, an independent evaluator (`typesafe-ai/jev`) that must approve a decision card before a human is asked anything, a voice CFO on Deepgram, and a recorder that snapshots the whole system every five minutes and regenerates the whitepaper's tables.

```
data/        Meridian Ledger Labs: 18 months of books, 39 tables, 115,348 rows, 612 documents
backend/     FastAPI, the agents and workers, the graph, retrieval, the adversary
resolve/     mirror_resolve, the deterministic AP engine
eval/        mirror_eval, the private grader over the 18 sealed fixtures
web/studio/  Next 16 and a single Three.js world the product lives inside
mcp/         read-only MCP server, 11 tools
whitepaper/  the paper, with every figure generated from the database
```

## Running it

```sh
cd backend
cp .env.example .env          # provider keys, Clerk, database
docker compose up -d          # Postgres, MinIO, Elasticsearch
uv run python -m app.data_cli init
uv run python -m app.data_cli import-demo --organization-id demo-meridian
uv run python -m app.data_cli graph --organization-id demo-meridian
../tools/dev-up.sh            # API, workers, recorder
```

```sh
cd web/studio && bun install && bun dev
```

Tests: `uv run pytest` in `backend/`, `resolve/` and `eval/`, `bun test` in `web/studio/`. 1,125 in total.

To watch the loop learn: `uv run python -m app.devin_exceptions_ctl on hyper-lab` starts the adversary, and `backend/benchmarks/learning/LESSONS.md` updates itself as cases are graded.

## Honest limits

- The self-improvement results are a development set. The people who wrote the traps also wrote the prompt and the grader. A held-out battery is the next thing that matters.
- Every supplier and internal desk is simulated. Nothing here messages a real vendor or moves real money.
- The engines cover narrow ground on purpose: whole-unit records, USD/EUR/GBP, no tax, no FX, no split deposits.
- The Elastic Agent Builder investigator is provisioned and its A2A card answers, but it has not yet run an investigation end to end.
- Benchmark figures move while the loop runs. Anything quoted here regenerates from the database.
