# Company knowledge graph

`app/graph.py` turns every active source into a graph of the company: who the vendors, customers and employees are, which invoice bills which order under which agreement, which payment settled it, which journal posted it, and which emails, chats and contracts talk about any of it. Evidence search uses it to find documents a keyword would never reach. Agents use it to answer "how is X connected to Y" with citations.

Postgres stays authoritative. The graph is derived, deterministic and rebuildable, exactly like the search index. No model writes to it.

## Shape

| Table | Holds |
|---|---|
| `graph_nodes` | One row per recorded entity: `id` (`vendor:VEN-002`), `type`, `key`, `label`, scalar fields, and the source row that defines it |
| `graph_edges` | Typed relationship with `method`, `confidence` and the source row that asserts it |
| `graph_aliases` | Normalized identifiers, names and contact addresses pointing at a node. `squash` aliases ignore punctuation and zero padding |
| `graph_mentions` | Which entities each evidence chunk mentions, and how that was recognized |

Every row carries `organization_id` and `source_id`. Reads join to active sources, and building a source first deletes everything any version of its `source_key` contributed, so a superseded import leaves no facts behind.

On the Meridian corpus: 39 datasets become 39 node types and 44 edge types (see `ONTOLOGY`). Run `python -m app.data_cli graph --organization-id <org>` for live counts.

## How edges are made

| Method | Confidence | Source |
|---|---|---|
| `foreign_key` | 100 | A column the ontology declares, such as `ap_invoices.po_id` |
| `id_prefix` | 95 | An untyped key typed by its prefix: `journals.source_id = AP-00062` posts an AP invoice |
| `id_lookup` | 95 | Unknown dataset (a connector, a simulator): a `*_id` value that exactly matches one known entity |
| `field_name` | 80 | Unknown dataset, no match yet, but the column is named `vendor_id` |

A target type can depend on another column (`aging.invoice_id` is AR or AP by `side`). An edge may point at an entity no record defines (a department, a remit account, an agreement that was never imported). Those come back with `recorded: false`, and `stats` counts them as `unrecorded_targets`: a dangling reference is a finding, not an error.

## How documents are linked

Text is tokenized and every run of one to six tokens is looked up in the organization's alias index, longest first. `RC-AP-00062` is a receipt and does not also count as invoice `AP-00062`.

| Method | Confidence | Meaning |
|---|---|---|
| `id_mention` | 100 | The text holds a recorded identifier |
| `alias_mention` | 90 | The text holds a name or address only one entity uses |
| `ambiguous_alias` | 60 | Several entities share that name. All are linked, none is preferred |
| `id_token` | 100 | Identifier-shaped text (`INV-9999`) that no record defines. Kept as `identifier:INV-9999` so it stays findable |

Import order matters for names: a document is linked against the entities known when it is built. `data_cli graph` rebuilds structured sources first, then documents.

## Identity is never merged

`po 62`, `PO-062` and `PO-00062` share a squash alias. `resolve_entity` returns `PO-00062` as a `similar_identifier` candidate at confidence 40 and resolves nothing. The fixtures reuse `PO-481` and `INV-1042` across unrelated companies, and the simulator sends ` inv 1001 ` as a duplicate of `INV-1001`: a silent merge would be a wrong payment.

## Traversal rules

General ledger accounts, departments and legal entities are hubs. Traversal reaches them but never passes through them, because "both were paid from the operating account" explains nothing. For search widening, any single relation that exceeds the fan-out cap (the employee who accepted every receipt) is skipped whole rather than sampled.

## Search

`search_evidence` scans the query for entities, walks two hops, and adds a third retriever to the RRF next to BM25 and `semantic_text`:

```text
entity_ids in (entities named in the query)      boost 8
entity_ids in (one hop away)                     boost 4
entity_ids in (two hops away)                    boost 1
document rather than ledger row                  boost 2
BM25 on content                                  boost 0.01   tie-break only
```

`entity_ids` is a keyword field on every chunk holding graph node IDs and bare identifiers. The organization and source filters apply to this retriever exactly as to the others. The response adds `query_entities` (what was recognized), per-hit `entities`, and `+graph` in `mode`. `documents_only: true` drops ledger rows. The Agent Builder specialist gets the same power through the `entity_evidence` ES|QL tool.

Existing indexes pick up the `entity_ids` mapping additively. Run `data_cli reindex` to populate it for sources indexed before this change.

## Tools and routes

| Tool | Route | Use |
|---|---|---|
| `resolve_entity` | `POST /graph/entity` | Name, ID or email to an entity card: fields, relationship counts, co-mentioned entities, lookalikes |
| `explore_entity_graph` | `POST /graph/explore` | Up to three hops, optional edge types, cited nodes and edges, says when truncated |
| `find_entity_path` | `POST /graph/path` | Shortest recorded path between two entities |
| `get_entity_evidence` | `POST /graph/evidence` | Chunks that mention an entity, read from SQL. Works when Elasticsearch is down |
| | `GET /graph/stats` | Node, edge and mention counts by type |

Graph results are cited samples of recorded relationships. They are not totals (`query_financials`) and not accounting authority (`list_accounting_records`).

## Benchmark

`uv run python -m app.retrieval_bench` loads Meridian into a throwaway database and its own index, asks three families of templated questions and scores the top 10 documents. The answer key is each draft document's `source_refs`, which is never indexed. Relationship questions are keyed by joining the raw JSONL exports, not by asking the graph.

Results are written to `benchmarks/retrieval.json`. `--reuse` keeps the database and index and only asks the questions again (first load takes a while: ELSER embeds one document per request).

Run of 2026-09-20, seed 20260919, local Elasticsearch 9.3.8, ELSER v2 on documents only, no reranker. Corpus: 612 documents among 115,348 ledger rows; graph of 115,348 nodes, 281,315 edges, 400,376 mentions.

| Questions | Mode | recall@5 | recall@10 | MRR@10 | nDCG@10 |
|---|---|---:|---:|---:|---:|
| Identifier the documents also hold (60) | keyword | 0.819 | 0.867 | 0.878 | 0.830 |
|  | keyword+graph | 0.976 | 0.996 | 1.000 | 0.987 |
|  | hybrid | 0.912 | 0.957 | 0.992 | 0.949 |
|  | hybrid+graph | 0.979 | 0.992 | 1.000 | 0.990 |
| Name only (52) | keyword | 0.536 | 0.515 | 0.857 | 0.559 |
|  | keyword+graph | 0.895 | 0.943 | 0.990 | 0.933 |
|  | hybrid | 0.637 | 0.587 | 0.981 | 0.671 |
|  | hybrid+graph | 0.899 | 0.960 | 0.981 | 0.944 |
| Identifier no document mentions (60) | keyword | 0.200 | 0.252 | 0.293 | 0.246 |
|  | keyword+graph | 0.597 | 0.852 | 0.853 | 0.760 |
|  | hybrid | 0.223 | 0.248 | 0.263 | 0.244 |
|  | hybrid+graph | 0.607 | 0.861 | 0.933 | 0.789 |
| All (172) | keyword | 0.517 | 0.546 | 0.668 | 0.544 |
|  | keyword+graph | 0.819 | 0.930 | 0.946 | 0.892 |
|  | hybrid | 0.589 | 0.598 | 0.734 | 0.619 |
|  | hybrid+graph | 0.825 | 0.937 | 0.971 | 0.906 |

Latency p50/p95 in ms, whole `search_evidence` call: keyword 249/484, keyword+graph 286/553, hybrid 281/491, hybrid+graph 299/486.

What it shows:

- An identifier nobody wrote down (a payment, a journal entry) is nearly unfindable by text: recall@10 0.25. One or two recorded hops take it to 0.86.
- Embeddings alone barely move name questions (0.52 to 0.59). The documents that matter cite `VEN-002`, not "Granite Legal".
- The first run fused BM25, ELSER and the entity retriever as three equal voters and hybrid+graph scored 0.735 recall@10, below keyword+graph. Two text voters were outvoting an exact match. Text is now fused first and the graph fused against the result.

What it does not show: the documents are synthetic drafts that repeat their identifiers, the questions are templated, relevance is binary and document-level. It measures entity and relationship recall. It says nothing about paraphrase, and the reranker path is still unmeasured.

## Not built

- Model-proposed links (vendor name variants, entity mismatch across legal entities). The edge schema already carries `method` and `confidence` for them; they need a review queue before they exist.
- Edges from the AP engine (`resolve` cases, issues, credits, proposals, approvals) and from counterparty threads.
- `occurred_at` versus `observed_at` on edges. Late receipts and revised invoices need both.
- A paraphrase question family. Templated questions cannot show what `semantic_text` adds.
