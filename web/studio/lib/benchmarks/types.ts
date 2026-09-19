// Mirror of eval/mirror_eval/schema.py (schema_version 1). Field names stay snake_case
// so the exported JSON is read as written. The page renders this document and
// computes no scores of its own.

export type Mode = "LIVE" | "RECORDED_REPLAY" | "DEV_FIXTURE";
export type Execution = "planned" | "running" | "completed" | "failed" | "cancelled";
export type Provenance =
  | "custom" | "local_public_dev" | "adapted_external" | "publisher_scored"
  | "independently_validated" | "authorized_private";
export type Outcome =
  | "pass" | "fail" | "partial" | "correct_escalation" | "waiting" | "unsupported" | "not_tested" | "error";
export type Layer = "external" | "workflow" | "crypto" | "reliability";
export type Access = "available" | "gated" | "pending" | "blocked";
export type CapabilityStatus = "supported" | "partial" | "unsupported" | "untested" | "access_blocked";
export type SystemKind = "FULL_SYSTEM" | "WEIGHTS_ONLY" | "ABLATION" | "RULES_BASELINE" | "ORACLE_SMOKE";

export type Measured = {
  status: "measured"; value: number; unit: string; n?: number | null;
  ci_low?: number | null; ci_high?: number | null; ci_method?: string | null;
};
export type Unavailable = { status: "unavailable"; reason: string };
export type Metric = Measured | Unavailable;

export type SystemManifest = {
  id: string; label: string; kind: SystemKind; created_at: string; git_commit?: string | null;
  models: Record<string, string>; adapter_hash?: string | null; prompts_version?: string | null;
  tools_version?: string | null; policy_version?: string | null; memory_enabled?: boolean | null;
  jev_enabled?: boolean | null; reviewer_enabled?: boolean | null; fallback_models: string[];
  decoding: Record<string, string | number>; notes: string;
};
export type Family = { id: string; name: string; task_count: number };
export type Suite = {
  id: string; name: string; layer: Layer; owner: string; provenance: Provenance;
  protocol: "native" | "adapted" | "custom"; access: Access; access_note: string; source_urls: string[];
  revision?: string | null; revision_checked_at?: string | null; license?: string | null;
  split?: string | null; task_count?: number | null; native_metric: string; native_metric_note: string;
  families: Family[]; restrictions: string[];
};
export type Capability = {
  id: string; area: string; name: string; status: CapabilityStatus; entry_point?: string | null;
  human_authority?: string | null; test_families: string[]; task_count: number;
  passed?: number | null; failed?: number | null; evidence_refs: string[]; note: string;
};
export type OutcomeCounts = {
  n_pass: number; n_fail: number; n_partial: number; n_correct_escalation: number;
  n_waiting: number; n_unsupported: number; n_not_tested: number; n_error: number;
};
export type Run = {
  id: string; suite_id: string; system_id: string; mode: Mode; execution: Execution; provenance: Provenance;
  started_at?: string | null; finished_at?: string | null; n_tasks: number; trials_per_task: number;
  native_score: Metric; whole_task_success: Metric; unassisted_completion: Metric;
  correct_escalation_rate: Metric; pass_at_1: Metric; pass_any_of_k: Metric; pass_all_of_k: Metric;
  outcomes: OutcomeCounts; required_approvals: Metric; investigative_assists: Metric;
  invalid_actions_attempted: Metric; invalid_actions_blocked: Metric; invalid_actions_accepted: Metric;
  cost_usd: Metric; wall_ms: Metric; tool_calls: Metric; external_messages: Metric;
  incidents: string[]; artifact_ref?: string | null; reproduce?: string | null;
};
export type Trial = {
  id: string; run_id: string; task_id: string; family_id?: string | null; trial_index: number;
  execution: Execution; outcome: Outcome; native_score: Metric;
  evidence_checks_passed?: number | null; evidence_checks_total?: number | null;
  control_failures: string[]; assistance: string[]; error_class?: string | null;
  wall_ms?: number | null; artifact_ref?: string | null;
};
export type Bucket = "both_pass" | "gained" | "regressed" | "both_fail" | "unavailable";
export type TaskDelta = { task_id: string; family_id?: string | null; baseline: Outcome; candidate: Outcome; bucket: Bucket };
export type Comparison = {
  id: string; kind: "WEIGHTS_ONLY" | "FULL_SYSTEM" | "ABLATION" | "DATA_ENGINE" | "RL";
  baseline_run_id: string; candidate_run_id: string; comparable: boolean;
  reasons: string[]; changed: string[]; tasks: TaskDelta[];
};
export type Claim = {
  id: string; claim: string; status: "supported" | "unsupported" | "untested";
  evidence_refs: string[]; demo_allowed: boolean;
};
export type BenchmarksDocument = {
  schema_version: 1; generated_at: string; generator_commit?: string | null; display_mode: Mode;
  systems: SystemManifest[]; suites: Suite[]; capabilities: Capability[]; runs: Run[];
  trials: Trial[]; comparisons: Comparison[]; claims: Claim[];
};
