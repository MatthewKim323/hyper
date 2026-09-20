#!/usr/bin/env node
// Hyper MCP server: read-only accounts-payable investigation from any MCP client.
//
// This is a thin client over the product's own HTTP API, deliberately. Every route it calls
// already exists, is organization-scoped by the caller's token, and refuses anything that
// would move money or change a record. There is no second authorization path to keep in
// step with the first, and nothing here can grant more than the token already has.
//
// Authority: read only. Posting to the ledger, approving a payable, verifying a record and
// sending a message are owner actions in the product and are not exposed here at all.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API = (process.env.HYPER_API_URL ?? "https://api-production-0bd10.up.railway.app").replace(/\/$/, "");
const TOKEN = process.env.HYPER_TOKEN;

if (!TOKEN) {
  console.error(
    "HYPER_TOKEN is not set.\n\n" +
    "Sign in at https://hyper.stephenhung.me, open the workspace, and copy the token from\n" +
    "Access -> Agent access. Then set HYPER_TOKEN in your MCP client configuration.",
  );
  process.exit(1);
}

/** One place that talks to the API, so every tool reports failures the same way. */
async function call(path, { method = "GET", body, query } = {}) {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    // A network failure is not the model's fault and is not retryable by rewording.
    return { error: `Could not reach Hyper at ${API}: ${error.message}` };
  }
  const text = await response.text();
  if (response.status === 401) {
    return { error: "Hyper rejected the token. It may have expired — copy a fresh one from Access → Agent access." };
  }
  if (!response.ok) {
    return { error: `Hyper returned ${response.status}: ${text.slice(0, 400)}` };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { error: "Hyper returned a response that was not JSON." };
  }
}

const str = (description) => ({ type: "string", description });
const int = (description) => ({ type: "integer", description });

// Only read paths. Each maps to a route that already enforces organization scope server side.
const TOOLS = [
  {
    name: "hyper_list_datasets",
    description:
      "List the financial datasets loaded into this workspace, with row counts and currencies. " +
      "Call this first: it tells you what evidence actually exists before you ask about it.",
    inputSchema: { type: "object", properties: {} },
    run: () => call("/datasets"),
  },
  {
    name: "hyper_query_financials",
    description:
      "Run an exact query over a dataset's complete population — the way to get a number you can " +
      "quote. Supports rows, count and sum. Never compute a total from search results instead; " +
      "those are samples. Currencies are preserved and never converted.",
    inputSchema: {
      type: "object",
      properties: {
        dataset: str("Dataset name from hyper_list_datasets."),
        operation: { type: "string", enum: ["rows", "count", "sum"], description: "Defaults to rows." },
        field: str("Numeric field to sum. Required when operation is sum."),
        filters: {
          type: "array",
          description: 'Filters as {field, op, value}. op is one of eq, ne, lt, lte, gt, gte.',
          items: {
            type: "object",
            properties: { field: str("Field name"), op: str("Comparison"), value: str("Value as a string") },
            required: ["field", "value"],
          },
        },
        limit: int("Maximum rows to return (default 50)."),
      },
      required: ["dataset"],
    },
    run: (args) => call("/financials/query", { method: "POST", body: args }),
  },
  {
    name: "hyper_search_evidence",
    description:
      "Search source documents for relevant passages, widened by the knowledge graph. Returns cited " +
      "extracts with source IDs, and a coverage_complete flag — check it before concluding that " +
      "evidence is absent. These are samples, not a complete population.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("What to look for, in plain language."),
        documents_only: { type: "boolean", description: "Correspondence and contracts only, no ledger rows." },
        limit: int("Maximum hits (default 10)."),
      },
      required: ["query"],
    },
    run: (args) => call("/evidence/search", { method: "POST", body: args }),
  },
  {
    name: "hyper_get_source",
    description: "Read the original extracted content of one source document, with row and page citations.",
    inputSchema: {
      type: "object",
      properties: {
        source_id: str("Source ID from a search result or dataset listing."),
        offset: int("Chunk offset for paging."),
        limit: int("Chunks to return (default 10)."),
      },
      required: ["source_id"],
    },
    run: ({ source_id, ...query }) => call(`/sources/${encodeURIComponent(source_id)}`, { query }),
  },
  {
    name: "hyper_list_payable_cases",
    description:
      "List accounts-payable cases with recomputed supported amounts, residual, and any open blocking " +
      "issues. The amounts come from the deterministic engine, not from a model.",
    inputSchema: { type: "object", properties: { limit: int("Maximum cases (default 50).") } },
    run: (query) => call("/accounting/cases", { query }),
  },
  {
    name: "hyper_analyze_payable",
    description:
      "Analyze one payable case: three-way match against its purchase order and goods receipt, verified " +
      "credits, the supported net amount, and every issue blocking payment, each citing its evidence.",
    inputSchema: {
      type: "object",
      properties: { case_id: str("Case ID from hyper_list_payable_cases.") },
      required: ["case_id"],
    },
    run: ({ case_id }) => call(`/accounting/cases/${encodeURIComponent(case_id)}`),
  },
  {
    name: "hyper_ap_aging",
    description:
      "Bucket unresolved accounts-payable residual by age (0-30, 31-60, 61-90, 90+) per currency as of a " +
      "date. Exact recomputation from owner-verified records; unreadable invoices are reported, not dropped.",
    inputSchema: { type: "object", properties: { as_of: str("ISO date, e.g. 2026-09-30. Defaults to today.") } },
    run: (query) => call("/accounting/records", { query }),
  },
  {
    name: "hyper_list_anomalies",
    description:
      "List evidence-backed anomaly findings: outliers detected across owner-verified records, with the " +
      "evidence that supports each one and its current status.",
    inputSchema: {
      type: "object",
      properties: {
        status: str("Filter by status, e.g. open."),
        kind: str("Filter by anomaly kind."),
        limit: int("Maximum findings (default 50)."),
      },
    },
    run: (query) => call("/accounting/anomalies/findings", { query }),
  },
  {
    name: "hyper_list_proposals",
    description:
      "List payable proposals with their current validation checks and approval standing. A proposal is " +
      "bound to a hash of the evidence it was built from, so a changed record invalidates it.",
    inputSchema: { type: "object", properties: { limit: int("Maximum proposals (default 50).") } },
    run: (query) => call("/accounting/proposals", { query }),
  },
  {
    name: "hyper_trial_balance",
    description:
      "Per-account debit, credit and net totals across posted journal entries for one currency through a " +
      "date, plus a debit-equals-credit check.",
    inputSchema: {
      type: "object",
      properties: { through: str("ISO date."), currency: str("Three-letter code, e.g. USD.") },
      required: ["through", "currency"],
    },
    run: (query) => call("/accounting/journals/trial-balance", { query }),
  },
  {
    name: "hyper_workspace",
    description: "Who you are connected as, and which organization's data these tools read.",
    inputSchema: { type: "object", properties: {} },
    run: () => call("/me/workspace"),
  },
];

const server = new Server(
  { name: "hyper", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool) return { isError: true, content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }] };
  const result = await tool.run(request.params.arguments ?? {});
  // Surface API failures as tool errors so the model can react, rather than as prose it might
  // mistake for data.
  const isError = Boolean(result && result.error);
  return { isError, content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

await server.connect(new StdioServerTransport());
