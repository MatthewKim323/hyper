// Shapes returned by backend/ (FastAPI), read from its code at commit 8089ee0.
// Timestamps are UTC epoch milliseconds. Money aggregates are exact decimal strings, never floats.

export type Workspace = {
  user_id: string;
  organization: { id: string; name: string; context: Record<string, unknown>; context_version: number; onboarding_complete: boolean; latest_session_id: string | null };
  next_step: "onboarding" | "workspace";
};

export type Connection = {
  id: string; provider: string; label: string; status: string;
  created_at: number; last_synced_at: number | null; error: string | null;
};

export type ConcernStatus =
  | "draft" | "generating" | "card_failed" | "awaiting_response" | "queued" | "resolving" | "resolved" | "needs_input" | "failed";
export type ConcernOption = { id: "option_1" | "option_2" | "option_3"; title: string; action: string; tradeoff: string; requires_approval: boolean };
export type JevAnswer = { probability: number };
export type Concern = {
  id: string; request_key: string; status: ConcernStatus; created_at: number; updated_at: number;
  request: { title: string; description: string; severity: "low" | "medium" | "high" | "critical"; source_ids: string[] };
  card: null | {
    summary?: string; options: ConcernOption[]; custom_option?: { id: "custom"; title: string; input_required: true };
    evaluation?: { model?: string; threshold?: number; answers?: Record<"grounded" | "distinct" | "authority", JevAnswer> };
  };
  decision: null | { option_id: string; instruction: string; user_id: string; selected_at: number; previous: unknown; authority: string };
  resolution: null | { summary: string; source_ids: string[] };
};

export type ControllerStatus = "not_started" | "pending" | "running" | "recovering" | "blocked" | "launch_uncertain";
export type Controller = { enabled: boolean; status: ControllerStatus; session_id?: string | null; checkpoint?: unknown; error?: string | null; launch_count?: number };
export type AgentCase = {
  id: string; case_key: string; title: string; version: number; updated_at: number;
  state: { findings: string[]; unknowns: string[]; next_actions: string[]; source_ids: string[]; concern_ids: string[] };
};
export type AgentTaskStatus = "queued" | "launching" | "launch_uncertain" | "running" | "complete" | "needs_input" | "failed";
export type AgentTask = {
  id: string; case_id: string; objective: string; status: AgentTaskStatus; error?: string | null;
  result?: null | { outcome: string; summary: string; source_ids: string[] };
};

export type Source = {
  id: string; source_key: string; version: number; filename: string; content_type: string; sha256: string; size_bytes: number;
  dataset: string | null; currency: string | null; record_count: number | null; created_at: number; active: boolean;
  index_status: "pending" | "running" | "ready" | "failed"; index_error: string | null;
};
export type SourceDetail = { source: Source; chunks: { id: string; locator: string; content: string }[]; has_more: boolean; next_offset: number | null; download_url: string };
export type EvidenceSearch = {
  mode: "keyword" | "hybrid"; unindexed_sources: number;
  /** False means the hits are a sample of what exists, not the whole population. Always surface it. */
  coverage_complete: boolean;
  hits: { id: string; source_id: string; locator: string; content: string; filename: string; version: number; dataset: string | null; currency: string | null; score: number }[];
};
export type Dataset = { dataset: string; record_count: number; sources: { id: string; dataset: string; currency: string | null; record_count: number }[] };

export type FinancialFilter = { field: string; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in"; value: unknown };
export type FinancialQuery = {
  dataset: string; filters?: FinancialFilter[]; operation: "rows" | "count" | "sum" | "avg" | "min" | "max";
  field?: string; group_by?: string[]; limit?: number; offset?: number;
};
export type FinancialAggregate = {
  dataset: string; operation: string; field: string | null; has_more: boolean; source_ids: string[]; units: string;
  results: { currency: string | null; group: Record<string, unknown> | null; value: string; record_count: number }[];
};

export type ArtifactPoint = { period: string; value: string; kind: "actual" | "projected" };
export type Artifact = {
  id: string; request_key: string; status: "pending" | "generating" | "ready" | "failed"; error: string | null; created_at: number;
  snapshot: { source_ids?: string[] } & Record<string, unknown>;
  spec: null | { root: "root"; elements: {
    chart: { type: "FinanceChart"; props: { title: string; chart: "line" | "bar"; currency: string | null; unit: string; points: ArtifactPoint[] } };
    notes: { type: "Notes"; props: { text: string } };
  } };
  evaluation: null | { threshold?: number; answers?: Record<"grounded" | "projection", JevAnswer> };
};

export type Simulation = { id: string; status: "paused" | "running" | "stepping" | "completed" | "failed"; sequence: number; next_run_at: number | null; error: string | null; created_at: number; config: Record<string, unknown> };
export type SimulationEvent = {
  id: string; sequence: number; status: "generating" | "publishing" | "published" | "failed"; published_at: number | null; error: string | null;
  payload: { event_type: string; source: string; occurred_at: string; dataset: string; synthetic: true; record: Record<string, unknown> };
  sources: { id: string; index_status: Source["index_status"] }[];
};

/* Deterministic AP engine (backend/ACCOUNTING_API.md). Amounts are integer cents computed by code, never by a model. */
export type PayableCalculation = {
  currency: string; invoice_face_cents: number; verified_credits_total_cents: number; net_after_credits_cents: number;
  /** Received quantity at the supported price. Must equal net_after_credits_cents for `ties` to hold. */
  independently_supported_cents: number; residual_cents: number; ties: boolean;
};
export type EngineCase = {
  case_id: string; invoice_id: string; revision: number; work_status: string; authorization_status: string; payment_status: string; updated_at: string;
  calculation: PayableCalculation | null; blocking_issues: { type: string; description: string; next_action: string | null }[]; error?: string;
};
export type PayableProposal = {
  proposal_id: string; case_id: string; hash: string; status: "DRAFT" | "INVALIDATED" | "COMMITTED" | "REJECTED"; based_on_revision: number; created_by: string; created_at: string;
  payload: { invoice_id: string; currency: string; invoice_face_cents: number; net_payable_cents: number; credits: { credit_id: string; scope: string; amount_cents: number }[];
    recipient?: { vendor_id: string; remit_account_ref: string }; accounting?: { account: string; debit_cents: number; credit_cents: number }[] };
  checks: { name: string; ok: boolean; detail?: unknown }[];
  approval: null | { status: "PENDING" | "APPROVED" | "REJECTED" | "INVALIDATED"; decided_by: string | null; decided_at: string | null };
};
export type AccountingRecord = { source_id: string; row_number: number; record_type: string; original_record_id: string; doc_id: string; source_sha256: string; verified_by: string };
