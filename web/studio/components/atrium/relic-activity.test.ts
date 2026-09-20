import { describe, expect, it } from "bun:test";
import type { AgentTask, Concern, Connection, PayableProposal, Scenario, Source } from "@/lib/backend/types";
import type { BenchmarksDocument, Run } from "@/lib/benchmarks/types";
import { createInitialTimeline } from "@/lib/timeline/registry";
import type { VersionRun } from "@/lib/timeline/types";
import { mapRelicActivity, RELIC_COMPLETION_MS, type RelicActivitySnapshot } from "./relic-activity";

const at = 1_000_000;
const snapshot = (data: Partial<RelicActivitySnapshot> = {}): RelicActivitySnapshot => ({ observedAt: at, ...data });
const task = (status: AgentTask["status"], id = "task-1"): AgentTask => ({ id, case_id: "case-1", objective: "Inspect source", status });
const source = (index_status: Source["index_status"], active = true): Source => ({ id: "source-1", source_key: "invoice", version: 1, filename: "Invoice", content_type: "text/plain", sha256: "sha", size_bytes: 1, dataset: null, currency: null, record_count: null, created_at: 0, active, index_status, index_error: null });
const scenario = (status: Scenario["agent"]["status"], tool?: string): Scenario => ({ id: "scenario-1", title: "Invoice price", invoice_id: "invoice-1", status: "open", outcome: null, difficulty: 1, created_by: "owner", created_at: 0, scored_at: null, requests: 1, repeated_requests: 0, agent: { sessions: 1, status, model: null, lessons_at_start: null, trace: tool ? [{ at, tool }] : [] } });
const proposal = (status: PayableProposal["status"] = "DRAFT", approval: NonNullable<PayableProposal["approval"]>["status"] = "PENDING"): PayableProposal => ({ proposal_id: "proposal-1", case_id: "case-1", hash: "sha", status, based_on_revision: 1, created_by: "agent", created_at: "2026-09-19T12:00:00Z", payload: { invoice_id: "invoice-1", currency: "USD", invoice_face_cents: 100, net_payable_cents: 100, credits: [] }, checks: [], approval: { status: approval, decided_by: null, decided_at: null } });
const concern = (status: Concern["status"]): Concern => ({ id: "concern-1", request_key: "request-1", status, created_at: 0, updated_at: at, request: { title: "Review", description: "Review evidence", severity: "low", source_ids: [] }, card: null, decision: null, resolution: null });
const connection = (status: Connection["status"]): Connection => ({ id: "connection-1", provider: "gmail", label: "Mailbox", status, created_at: 0, last_synced_at: at - 10, next_sync_at: at + 10, error: null });
const unavailable = { status: "unavailable", reason: "No result" } as const;
const run = (execution: Run["execution"], mode: Run["mode"] = "LIVE"): Run => ({
  id: "run-1", suite_id: "ap", system_id: "subject", mode, execution, provenance: "custom", started_at: "2026-09-19T12:00:00Z", n_tasks: 1, trials_per_task: 1,
  native_score: unavailable, whole_task_success: unavailable, unassisted_completion: unavailable, correct_escalation_rate: unavailable, pass_at_1: unavailable, pass_any_of_k: unavailable, pass_all_of_k: unavailable,
  outcomes: { n_pass: 0, n_fail: 0, n_partial: 0, n_correct_escalation: 0, n_waiting: 0, n_unsupported: 0, n_not_tested: 0, n_error: 0 },
  required_approvals: unavailable, investigative_assists: unavailable, invalid_actions_attempted: unavailable, invalid_actions_blocked: unavailable, invalid_actions_accepted: unavailable, cost_usd: unavailable, wall_ms: unavailable, tool_calls: unavailable, external_messages: unavailable, incidents: [],
});
const benchmark = (runs: Run[], kind: "FULL_SYSTEM" | "ORACLE_SMOKE" = "FULL_SYSTEM"): BenchmarksDocument => ({ schema_version: 1, generated_at: "2026-09-19T12:00:00Z", display_mode: "LIVE", systems: [{ id: "subject", label: "Subject", kind, created_at: "2026-09-19T00:00:00Z", models: {}, fallback_models: [], decoding: {}, notes: "" }], suites: [], capabilities: [], runs, trials: [], comparisons: [], claims: [] });
const trainingRun = (status: VersionRun["status"], mode: VersionRun["mode"] = "LIVE"): VersionRun => ({
  id: "training-1", versionId: "version-1", caseId: "case-1", scenarioId: "scenario-1", mode, status,
  startedAt: "2026-09-19T12:00:00Z", completedAt: status === "RUNNING" ? null : "2026-09-19T12:01:00Z",
  comparisonContext: { inputFingerprint: null, policyFingerprint: null, harnessVersion: null, environmentFingerprint: null },
  outcome: { verdict: "INCONCLUSIVE", status, summary: "", evidenceIds: [] }, steps: [], evidence: [],
  metrics: { durationMs: unavailable, totalTokens: unavailable, costUsd: unavailable },
  provenance: { id: "recording-1", label: "Recording", kind: "RUN_ARTIFACT", ref: "runs/recording-1.json" },
});

describe("relic live activity", () => {
  it("does not claim work just because the controller is running or enabled", () => {
    expect(mapRelicActivity(snapshot({ controller: { enabled: true, status: "running" } })).cases.status).toBe("idle");
    expect(mapRelicActivity(snapshot({ tasks: [task("queued")] })).cases.status).toBe("waiting");
    expect(mapRelicActivity(snapshot({ tasks: [task("running")] })).cases.status).toBe("working");
  });

  it("shows persisted provider activity before its previous WAITING result", () => {
    const active = scenario("WAITING", "request_supplier_document");
    active.agent.activity = { status: "running", started_at: at - 10, updated_at: at - 10, expires_at: at + 300_000 };
    const data = snapshot({ scenarios: [active] });
    expect(mapRelicActivity(data).cases.status).toBe("working");
    expect(mapRelicActivity(data, undefined, at + 300_000).cases).toMatchObject({ status: "attention", label: "1 agent session stopped reporting" });
    expect(mapRelicActivity({ ...data, scenarios: [{ ...active, agent: { ...active.agent, activity: { ...active.agent.activity, status: "failed", expires_at: null } } }] }).cases.status).toBe("error");
  });

  it("separates supplier and procurement waits from owner approval", () => {
    expect(mapRelicActivity(snapshot({ scenarios: [scenario("WAITING", "request_supplier_document")] })).cases).toMatchObject({ status: "waiting", label: "Waiting for supplier reply" });
    expect(mapRelicActivity(snapshot({ scenarios: [scenario("WAITING", "request_internal_confirmation")] })).cases.label).toBe("Waiting for procurement reply");
    expect(mapRelicActivity(snapshot({ proposals: [proposal()] })).review).toMatchObject({ status: "attention", label: "1 decision waiting on you" });
    expect(mapRelicActivity(snapshot({ scenarios: [scenario("HOLD")] })).cases.status).toBe("waiting");
  });

  it("does not treat a superseded, rejected or already approved proposal as awaiting owner", () => {
    for (const item of [proposal("INVALIDATED"), proposal("REJECTED", "REJECTED"), proposal("DRAFT", "APPROVED")]) {
      expect(mapRelicActivity(snapshot({ proposals: [item] })).review.status).toBe("idle");
    }
  });

  it("pulses the actual DRAFT/PENDING to DRAFT/APPROVED decision without claiming settlement", () => {
    const before = snapshot({ proposals: [proposal("DRAFT", "PENDING")] });
    const after = snapshot({ proposals: [proposal("DRAFT", "APPROVED")] });
    const activity = mapRelicActivity(after, before);
    expect(activity.review).toMatchObject({ status: "complete", label: "Decision recorded" });
    expect(activity.cases).toMatchObject({ status: "complete", label: "Decision recorded" });
    expect(mapRelicActivity(after).review.status).toBe("idle");
    expect(mapRelicActivity(after).cases.status).toBe("idle");
    expect(mapRelicActivity(after, after).review.status).toBe("idle");
    expect(mapRelicActivity(after, before, at + RELIC_COMPLETION_MS).review.status).toBe("idle");
    expect(mapRelicActivity(snapshot({ proposals: [proposal("DRAFT", "REJECTED")] }), before).review).toMatchObject({ status: "complete", label: "Decision recorded" });
    expect(mapRelicActivity({ ...after, tasks: [task("running")] }, before).cases.status).toBe("working");
  });

  it("pulses observed successful scenario grading only when no other work remains", () => {
    const before = snapshot({ scenarios: [scenario("HOLD")] });
    const after = snapshot({ scenarios: [{ ...scenario("HOLD"), status: "scored", outcome: "correct_hold", scored_at: at }] });
    expect(mapRelicActivity(after, before).cases).toMatchObject({ status: "complete", label: "Scenario graded" });
    expect(mapRelicActivity(after).cases.status).toBe("idle");
    expect(mapRelicActivity({ ...after, tasks: [task("running")] }, before).cases.status).toBe("working");
  });

  it("surfaces task and card failures and uncertain launches", () => {
    expect(mapRelicActivity(snapshot({ tasks: [task("failed")] })).cases.status).toBe("error");
    expect(mapRelicActivity(snapshot({ tasks: [task("launch_uncertain")] })).cases.status).toBe("attention");
    expect(mapRelicActivity(snapshot({ concerns: [concern("card_failed")] })).review.status).toBe("error");
    expect(mapRelicActivity(snapshot({ concerns: [concern("generating")] })).review.status).toBe("working");
    expect(mapRelicActivity(snapshot({ concerns: [concern("needs_input")] })).review.status).toBe("attention");
  });

  it("distinguishes queued indexing, actual indexing and failure, excluding retired sources", () => {
    expect(mapRelicActivity(snapshot({ sources: [source("pending")] })).evidence.status).toBe("waiting");
    expect(mapRelicActivity(snapshot({ sources: [source("running")] })).evidence.status).toBe("working");
    expect(mapRelicActivity(snapshot({ sources: [source("failed")] })).evidence.status).toBe("error");
    expect(mapRelicActivity(snapshot({ sources: [source("failed", false)] })).evidence.status).toBe("idle");
  });

  it("only pulses completion after an observed transition and expires it", () => {
    const before = snapshot({ sources: [source("running")] });
    const after = snapshot({ sources: [source("ready")] });
    expect(mapRelicActivity(after).evidence.status).toBe("idle");
    expect(mapRelicActivity(after, before).evidence.status).toBe("complete");
    expect(mapRelicActivity(after, after).evidence.status).toBe("idle");
    expect(mapRelicActivity(after, before, at + RELIC_COMPLETION_MS).evidence.status).toBe("idle");
    expect(mapRelicActivity(snapshot({ tasks: [task("complete")] }), snapshot({ tasks: [task("running")] })).cases.status).toBe("complete");
  });

  it("does not manufacture a completion when an item vanishes from the page", () => {
    expect(mapRelicActivity(snapshot({ tasks: [] }), snapshot({ tasks: [task("running")] })).cases.status).toBe("idle");
    expect(mapRelicActivity(snapshot({ sources: [{ ...source("ready"), version: 2 }] }), snapshot({ sources: [source("running")] })).evidence.status).toBe("idle");
  });

  it("only animates live subject evaluation jobs, excluding replay, fixtures and oracle smoke", () => {
    expect(mapRelicActivity(snapshot({ benchmarks: benchmark([run("running")]) })).benchmarks.status).toBe("working");
    for (const mode of ["RECORDED_REPLAY", "DEV_FIXTURE"] as const) expect(mapRelicActivity(snapshot({ benchmarks: benchmark([run("running", mode)]) })).benchmarks.status).toBe("idle");
    expect(mapRelicActivity(snapshot({ benchmarks: benchmark([run("running")], "ORACLE_SMOKE") })).benchmarks.status).toBe("idle");
    expect(mapRelicActivity(snapshot({ benchmarks: { ...benchmark([run("running")]), display_mode: "RECORDED_REPLAY" } })).benchmarks.status).toBe("idle");
    expect(mapRelicActivity(snapshot({ benchmarks: benchmark([run("planned")]) })).benchmarks.status).toBe("waiting");
  });

  it("shows failed evaluations until a newer attempt supersedes them", () => {
    const failed = run("failed");
    expect(mapRelicActivity(snapshot({ benchmarks: benchmark([failed]) })).benchmarks.status).toBe("error");
    const newer = { ...run("completed"), id: "run-2", started_at: "2026-09-19T13:00:00Z" };
    expect(mapRelicActivity(snapshot({ benchmarks: benchmark([failed, newer]) })).benchmarks.status).toBe("idle");
  });

  it("maps training runs independently of source snapshots and archived replay", () => {
    const timeline = createInitialTimeline();
    expect(timeline.versions.length).toBeGreaterThan(0);
    timeline.versions[0].runs = [trainingRun("RUNNING", "RECORDED_REPLAY")];
    expect(mapRelicActivity(snapshot({ timeline })).timeline.status).toBe("idle");
    timeline.versions[0].runs = [trainingRun("RUNNING")];
    expect(mapRelicActivity(snapshot({ timeline })).timeline.status).toBe("working");
    timeline.versions[0].runs = [trainingRun("FAILED")];
    expect(mapRelicActivity(snapshot({ timeline })).timeline.status).toBe("error");
    timeline.versions[0].runs = [trainingRun("CANCELLED")];
    expect(mapRelicActivity(snapshot({ timeline })).timeline.status).toBe("idle");
  });

  it("never calls a scheduled sync active and distinguishes identity consent and failure", () => {
    expect(mapRelicActivity(snapshot({ connections: [connection("connected")] })).identity.status).toBe("idle");
    expect(mapRelicActivity(snapshot({ connections: [connection("authorizing")] })).identity.status).toBe("attention");
    expect(mapRelicActivity(snapshot({ connections: [connection("reauth_required")] })).identity.status).toBe("attention");
    expect(mapRelicActivity(snapshot({ connections: [connection("error")] })).identity.status).toBe("error");
  });

  it("replaces stale working data with a visible load error", () => {
    const activities = mapRelicActivity(snapshot({ tasks: [task("running")], errors: { cases: "Live activity unavailable" } }));
    expect(activities.cases).toMatchObject({ status: "error", label: "Live activity unavailable" });
    expect(activities.evidence.status).toBe("idle");
  });

  it("keeps truncated lists and signed-out state from implying everything is idle", () => {
    expect(mapRelicActivity(snapshot({ incomplete: { cases: true } })).cases).toMatchObject({ status: "waiting", label: "More activity outside this view" });
    expect(mapRelicActivity(snapshot({ signedIn: false, tasks: [task("running")] })).cases).toMatchObject({ status: "idle", label: "Sign in for live activity" });
  });

  it("keeps event identity stable when the backend list order changes", () => {
    const first = mapRelicActivity(snapshot({ tasks: [task("running", "b"), task("running", "a")] })).cases;
    const second = mapRelicActivity(snapshot({ tasks: [task("running", "a"), task("running", "b")] })).cases;
    expect(first.eventKey).toBe(second.eventKey);
  });
});
