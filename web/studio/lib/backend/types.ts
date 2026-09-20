// Shapes returned by backend/ (FastAPI), read from its code at commit 8089ee0.
// Timestamps are UTC epoch milliseconds. Money aggregates are exact decimal strings, never floats.

export type Workspace = {
  user_id: string;
  organization: { id: string; name: string; context: Record<string, unknown>; context_version: number; onboarding_complete: boolean; latest_session_id: string | null };
  next_step: "onboarding" | "workspace";
};

export type ConnectorProvider = "gmail" | "drive" | "ramp" | "plaid";
export type ConnectionStatus = "authorizing" | "connected" | "authorization_failed" | "error" | "reauth_required" | "disconnected";
export type Connection = {
  id: string; provider: ConnectorProvider | string; label: string; status: ConnectionStatus | string;
  created_at: number; last_synced_at: number | null; next_sync_at?: number | null; failures?: number; error: string | null;
};
/** `configured` is false when the server has no credentials for that provider, so connecting cannot work yet. */
export type ProviderInfo = { id: ConnectorProvider | string; configured: boolean; auth: string; imports: string[]; environment?: string };
export type ConnectionItem = { item_id: string; filename: string | null; status: string; error: string | null; updated_at: number; source_ids: string[] };

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
/** The ingestion job behind one source. `status` mirrors the worker's own lifecycle. */
export type SourceStatus = {
  id: string; source_id: string; status: "pending" | "running" | "ready" | "failed";
  attempts: number; lease_until: number; error: string | null; created_at: number;
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

/* Learned skills (backend/SKILLS_API.md). Agents draft and report runs; only an owner activates or retires. */
export type SkillStatus = "draft" | "active" | "retired" | "quarantined" | "stale";
export type SkillSummary = { id: string; name: string; version: number; description: string; status: SkillStatus; package_hash: string; created_at: number | string; activated_by: string | null; evidence_current: boolean };
export type SkillRun = { run_id: string; outcome: "passed" | "failed" | "needs_input"; summary: string | null; checks: string[]; duration_ms: number | null; created_at: number | string; evidence_current: boolean; verification: "self_reported" };
export type SkillDetail = SkillSummary & { reported_runs: Partial<Record<SkillRun["outcome"], number>>; latest_run: SkillRun | null; skill_md: string; resources: string[]; research_urls: string[] };
export const SKILL_ATTESTATION = "I independently reviewed the tests, accounting assumptions, and evidence for this skill version";

// Sandbox counterparties and the adversary (backend/app/counterparty.py). The private fact sheet never appears here.
export type ExceptionFamily = "clean" | "price_only" | "partial_correction" | "valid_amendment" | "backorder" | "disputed_cancellation"
  | "claim_without_memo" | "silent_supplier" | "duplicate_credit" | "bank_change_attack"
  | "internal_hold" | "withdrawn_credit" | "short_credit" | "cleared_hold" | "misdirected_hold" | "superseded_invoice"
  | "already_paid" | "goods_returned" | "spoofed_release" | "internal_release" | "unrelated_wire";
export type AgentStep = { at: number; tool?: string; args?: string; result?: string; say?: string };
export type AgentActivity = {
  status: "running" | "idle" | "failed";
  started_at: number | null; updated_at: number; expires_at: number | null; error?: string | null;
};
export type Scenario = {
  id: string; title: string; invoice_id: string; status: "open" | "scored"; outcome: "pass" | "fail" | "correct_hold" | "timeout" | null;
  difficulty: number; created_by: string; created_at: number; scored_at: number | null; requests: number; repeated_requests: number; family?: ExceptionFamily;
  agent: { sessions: number; status: "WAITING" | "PROPOSED" | "HOLD" | null; model: string | null; lessons_at_start: number | null; trace: AgentStep[]; activity?: AgentActivity | null };
};
export type AdversaryState = {
  control: { enabled: boolean; interval_seconds: number; max_open: number; spawned: number };
  scoreboard: { scored: number; correct: number; wrong_releases: number; repeated_requests: number; lessons_learned: number; level: number;
    families: { family: ExceptionFamily; attempts: number; correct: number }[]; history: { at: number; family: ExceptionFamily; outcome: string; difficulty: number }[] };
  lessons: { lesson: string; created_at: number }[];
};
