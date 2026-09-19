# Financial Artifacts

`POST /artifacts` queues a saved financial chart/projection and returns **202** immediately. `GET /artifacts/{id}` returns `pending`, `generating`, `ready` or `failed`; ready rows include a json-render spec, the exact query snapshot, source IDs and Jev evaluation. `GET /artifacts/{id}/html` returns a standalone HTML/SVG artifact rendered through `@json-render/react`, with an exact-value table and assumptions. All routes require Clerk organization authentication. To embed, fetch HTML with the user's bearer token and use a sandboxed iframe `srcdoc`; use the validated `spec` plus the matching catalog/registry for React integration. A plain iframe URL cannot attach the bearer header.

Agent tools: `create_financial_artifact`, `get_financial_artifact`. Both are available through Deepgram and `/agents/tools` to scoped Devin agents.

```json
{
  "request_key": "revenue-q4-scenario-v1",
  "prompt": "Chart monthly gross revenue and illustrate a cautious three-month growth scenario.",
  "query": {
    "dataset": "monthly_financials",
    "operation": "sum",
    "field": "revenue",
    "group_by": ["month"],
    "limit": 200
  },
  "unit": "major_currency",
  "projection_months": 3
}
```

Use existing dataset/field names discovered through `list_datasets`. Queries aggregate the full matching population in Postgres. They must group by exactly one field; truncated groups or multiple currencies are rejected. Use filters to select a single currency via available source fields/datasets. Monetary series require a currency on the imported source. Explicit units are `major_currency`, `minor_currency`, or `number`; there is no implicit cents conversion. Chart/table labels preserve the declared units.

Set `projection_months: 0` for historical charts (line or bar, selected by the model). Projections require monthly `YYYY-MM` groups and currently support one hypothetical constant monthly growth rate between -100% and +100%, at most 24 months. This is a scenario calculator, not a statistical forecast or a full cash-flow model. The model selects and explains its assumption. Decimal arithmetic computes all projected values from the last observation; notes show the rate, formula and uncertainty. Actuals cannot be overwritten by model output. Date gaps remain gaps; no observations are silently imputed.

The generation model drafts title, chart style, narrative and assumptions. Jev evaluates the complete artifact for grounded interpretation and projection disclosure. It does not generate free-form graphs itself and is not proof of accounting correctness. Only a passing artifact becomes ready. The json-render catalog permits a static Stack, FinanceChart and Notes; no generated scripts or actions. Display geometry uses JavaScript numbers, while the table/spec preserve exact decimal strings.

## Run

Configure `ARTIFACT_MODEL`, `AI_GATEWAY_API_KEY` and `EVALUATOR_SECRET` in the evaluator process. Configure matching `EVALUATOR_SECRET` and optional `EVALUATOR_URL` in FastAPI/worker. Install evaluator dependencies with `npm ci --prefix backend/evaluator`, then run the existing evaluator plus:

```sh
uv run --directory backend python -m app.artifact_worker
```

Worker supports `--once`. Generation leases recover after four minutes. Evaluator errors or rejected artifacts become `failed`; submit a new request key to regenerate. Reusing an existing key returns its saved snapshot/status, and changing its request returns 422. Output is stored in Postgres. Source originals remain in object storage. End-to-end provider latency has not been measured; 202 acceptance is quick, readiness waits for generation and Jev.

Catalog and renderer: `backend/evaluator/artifacts.mjs`. Framework reference: https://github.com/vercel-labs/json-render
