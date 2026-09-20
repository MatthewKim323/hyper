import type { AgentCase, AgentTask, Concern, Connection, Controller, EngineCase, PayableProposal, Scenario, SkillSummary, Source } from "@/lib/backend/types";
import type { BenchmarksDocument, Run } from "@/lib/benchmarks/types";
import type { TimelineDocument, VersionRun } from "@/lib/timeline/types";

export const RELIC_ACTIVITY_SECTIONS = ["cases", "evidence", "review", "timeline", "benchmarks", "identity"] as const;
export type RelicActivitySection = typeof RELIC_ACTIVITY_SECTIONS[number];
export type RelicActivityStatus = "idle" | "working" | "waiting" | "attention" | "complete" | "error";
export type RelicActivity = { status: RelicActivityStatus; label: string; count?: number; eventKey?: string };
export type RelicActivityMap = Record<RelicActivitySection, RelicActivity>;
export const RELIC_COMPLETION_MS = 8_000;

/** An observed read of actual services. Missing data never implies work is happening. */
export type RelicActivitySnapshot = {
  observedAt: number;
  signedIn?: boolean;
  controller?: Controller;
  cases?: AgentCase[];
  tasks?: AgentTask[];
  engineCases?: EngineCase[];
  scenarios?: Scenario[];
  proposals?: PayableProposal[];
  concerns?: Concern[];
  sources?: Source[];
  connections?: Connection[];
  skills?: SkillSummary[];
  benchmarks?: BenchmarksDocument;
  timeline?: TimelineDocument;
  errors?: Partial<Record<RelicActivitySection, string>>;
  incomplete?: Partial<Record<RelicActivitySection, boolean>>;
};

const idle = (label: string, count?: number): RelicActivity => ({ status: "idle", label, ...(count === undefined ? {} : { count }) });
const state = (status: RelicActivityStatus, label: string, ids: string[]): RelicActivity => ({ status, label, count: ids.length, eventKey: `${status}:${[...ids].sort().join("|")}` });
const quantity = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
const ids = <T extends { id: string }>(items: T[]) => items.map(item => item.id);
const pendingProposal = (proposal: PayableProposal) => proposal.status === "DRAFT" && proposal.approval?.status === "PENDING";
const decidedProposal = (proposal: PayableProposal) => proposal.status === "COMMITTED" || proposal.status === "REJECTED"
  || (proposal.status === "DRAFT" && (proposal.approval?.status === "APPROVED" || proposal.approval?.status === "REJECTED"));

/** Completion is a transition, never a permanent property of historical results. */
function completed<T>(current: T[] | undefined, previous: T[] | undefined, key: (item: T) => string, done: (item: T) => boolean): string[] {
  if (!previous || !current) return [];
  const earlier = new Map(previous.map(item => [key(item), item]));
  return current.filter(item => earlier.has(key(item)) && !done(earlier.get(key(item))!) && done(item)).map(key);
}

function caseActivity(data: RelicActivitySnapshot, previous: RelicActivitySnapshot | undefined, nowMs: number): RelicActivity {
  const tasks = data.tasks ?? [];
  const engine = data.engineCases ?? [];
  const scenarios = data.scenarios ?? [];
  const sessionFailures = scenarios.filter(item => item.agent.activity?.status === "failed");
  if (sessionFailures.length) return state("error", `${quantity(sessionFailures.length, "agent session")} failed`, ids(sessionFailures));
  const failed = tasks.filter(task => task.status === "failed");
  const errors = engine.filter(item => !!item.error);
  if (failed.length || errors.length) return state("error", `${quantity(failed.length + errors.length, "case action")} failed`, [...ids(failed), ...errors.map(item => item.case_id)]);
  if (data.controller?.enabled && (data.controller.error || data.controller.status === "blocked")) return { status: "error", label: "Agent is blocked", eventKey: `controller:${data.controller.status}:${data.controller.error ?? ""}` };
  const input = tasks.filter(task => task.status === "needs_input" || task.status === "launch_uncertain");
  const escalated = engine.filter(item => item.work_status === "ESCALATED");
  if (input.length || escalated.length) return state("attention", `${quantity(input.length + escalated.length, "case")} needs attention`, [...ids(input), ...escalated.map(item => item.case_id)]);
  if (data.controller?.enabled && data.controller.status === "launch_uncertain") return { status: "attention", label: "Agent launch needs checking", eventKey: "controller:launch_uncertain" };
  const markedRunning = scenarios.filter(item => item.agent.activity?.status === "running");
  const expired = markedRunning.filter(item => !item.agent.activity?.expires_at || item.agent.activity.expires_at <= nowMs);
  if (expired.length) return state("attention", `${quantity(expired.length, "agent session")} stopped reporting`, ids(expired));
  const sessions = markedRunning.filter(item => !!item.agent.activity?.expires_at && item.agent.activity.expires_at > nowMs);
  if (sessions.length) return state("working", `Agent working on ${quantity(sessions.length, "case")}`, sessions.map(item => `${item.id}:${item.agent.activity!.started_at}`));
  const running = tasks.filter(task => task.status === "running" || task.status === "launching");
  if (running.length) return state("working", `Working on ${quantity(running.length, "task")}`, ids(running));
  const pending = (data.proposals ?? []).filter(pendingProposal);
  if (pending.length) return state("attention", `${quantity(pending.length, "proposal")} awaiting your approval`, pending.map(item => item.proposal_id));
  const open = scenarios.filter(item => item.status === "open");
  const waiting = open.filter(item => item.agent.status === "WAITING");
  if (waiting.length) {
    const requests = waiting.map(item => [...item.agent.trace].reverse().find(step => step.tool === "request_supplier_document" || step.tool === "request_internal_confirmation")?.tool);
    const who = requests.every(tool => tool === "request_supplier_document") ? "supplier" : requests.every(tool => tool === "request_internal_confirmation") ? "procurement" : "counterparty";
    return state("waiting", `Waiting for ${who} ${waiting.length === 1 ? "reply" : "replies"}`, ids(waiting));
  }
  const held = open.filter(item => item.agent.status === "HOLD");
  if (held.length) return state("waiting", `${quantity(held.length, "case")} on hold`, ids(held));
  const proposed = open.filter(item => item.agent.status === "PROPOSED");
  if (proposed.length) return state("waiting", `Agent reported ${quantity(proposed.length, "proposal")}`, ids(proposed));
  const engineWaiting = engine.filter(item => item.work_status === "WAITING_EXTERNAL" || item.work_status === "WAITING_INTERNAL");
  if (engineWaiting.length) return state("waiting", `${quantity(engineWaiting.length, "case")} awaiting evidence`, engineWaiting.map(item => item.case_id));
  const queued = tasks.filter(task => task.status === "queued");
  if (queued.length || open.length) return state("waiting", `${quantity(queued.length || open.length, queued.length ? "task" : "case")} queued`, queued.length ? ids(queued) : ids(open));
  const done = [
    ...completed(data.tasks, previous?.tasks, item => item.id, item => item.status === "complete"),
    ...completed(data.engineCases, previous?.engineCases, item => item.case_id, item => item.work_status === "RESOLVED"),
  ];
  if (done.length) return state("complete", "Case work completed", done);
  const decisions = completed(data.proposals, previous?.proposals, item => item.proposal_id, decidedProposal);
  if (decisions.length) return state("complete", "Decision recorded", decisions);
  const graded = completed(scenarios, previous?.scenarios, item => item.id, item => item.status === "scored" && (item.outcome === "pass" || item.outcome === "correct_hold"));
  if (graded.length) return state("complete", "Scenario graded", graded);
  if (data.controller?.enabled && data.controller.status === "recovering") return { status: "waiting", label: "Agent recovering", eventKey: "controller:recovering" };
  return idle(data.controller?.enabled === false ? "Agent paused" : "No active case work", data.cases?.length);
}

function evidenceActivity(data: RelicActivitySnapshot, previous?: RelicActivitySnapshot): RelicActivity {
  const sources = (data.sources ?? []).filter(item => item.active);
  const failed = sources.filter(item => item.index_status === "failed");
  if (failed.length) return state("error", `${quantity(failed.length, "source")} failed to index`, ids(failed));
  const running = sources.filter(item => item.index_status === "running");
  if (running.length) return state("working", `Indexing ${quantity(running.length, "source")}`, ids(running));
  const pending = sources.filter(item => item.index_status === "pending");
  if (pending.length) return state("waiting", `${quantity(pending.length, "source")} queued for indexing`, ids(pending));
  const done = completed(sources, previous?.sources?.filter(item => item.active), item => `${item.id}:${item.version}`, item => item.index_status === "ready");
  if (done.length) return state("complete", `${quantity(done.length, "source")} now searchable`, done);
  return idle(sources.length ? "Sources searchable" : "No sources yet", sources.length);
}

function reviewActivity(data: RelicActivitySnapshot, previous?: RelicActivitySnapshot): RelicActivity {
  const concerns = data.concerns ?? [];
  const failed = concerns.filter(item => item.status === "failed" || item.status === "card_failed");
  if (failed.length) return state("error", `${quantity(failed.length, "review")} failed`, ids(failed));
  const waiting = concerns.filter(item => item.status === "awaiting_response" || item.status === "needs_input");
  const proposals = (data.proposals ?? []).filter(pendingProposal);
  if (waiting.length || proposals.length) return state("attention", `${quantity(waiting.length + proposals.length, "decision")} waiting on you`, [...ids(waiting), ...proposals.map(item => item.proposal_id)]);
  const running = concerns.filter(item => item.status === "generating" || item.status === "resolving");
  if (running.length) return state("working", `Preparing ${quantity(running.length, "review")}`, ids(running));
  const queued = concerns.filter(item => item.status === "queued" || item.status === "draft");
  if (queued.length) return state("waiting", `${quantity(queued.length, "review")} queued`, ids(queued));
  const decisions = completed(data.proposals, previous?.proposals, item => item.proposal_id, decidedProposal);
  if (decisions.length) return state("complete", "Decision recorded", decisions);
  const resolved = completed(concerns, previous?.concerns, item => item.id, item => item.status === "resolved");
  return resolved.length ? state("complete", "Review completed", resolved) : idle("Nothing needs your approval");
}

function realBenchmarkRuns(document?: BenchmarksDocument): Run[] {
  if (!document || document.display_mode !== "LIVE") return [];
  const subjects = new Set(document.systems.filter(item => item.kind !== "ORACLE_SMOKE").map(item => item.id));
  return document.runs.filter(item => item.mode === "LIVE" && subjects.has(item.system_id));
}

const liveTimelineRuns = (timeline?: TimelineDocument): VersionRun[] => timeline?.versions.flatMap(version => version.runs).filter(run => run.mode === "LIVE") ?? [];

function benchmarkActivity(data: RelicActivitySnapshot, previous?: RelicActivitySnapshot): RelicActivity {
  const runs = realBenchmarkRuns(data.benchmarks);
  const running = runs.filter(item => item.execution === "running");
  if (running.length) return state("working", `Running ${quantity(running.length, "evaluation")}`, ids(running));
  const queued = runs.filter(item => item.execution === "planned");
  if (queued.length) return state("waiting", `${quantity(queued.length, "evaluation")} planned`, ids(queued));
  // Earlier failed attempts remain in the run archive. Only the latest attempt for a subject/suite is actionable.
  const latest = new Map<string, Run>();
  for (const run of [...runs].sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""))) latest.set(`${run.suite_id}:${run.system_id}`, run);
  const failed = [...latest.values()].filter(item => item.execution === "failed");
  if (failed.length) return state("error", `${quantity(failed.length, "evaluation")} failed`, ids(failed));
  const done = completed(runs, previous ? realBenchmarkRuns(previous.benchmarks) : undefined, item => item.id, item => item.execution === "completed");
  return done.length ? state("complete", "Evaluation completed", done) : idle("No evaluations running");
}

function timelineActivity(data: RelicActivitySnapshot, previous?: RelicActivitySnapshot): RelicActivity {
  const runs = liveTimelineRuns(data.timeline);
  const running = runs.filter(item => item.status === "RUNNING");
  if (running.length) return state("working", `Running ${quantity(running.length, "training test")}`, ids(running));
  const latest = new Map<string, VersionRun>();
  for (const run of [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) latest.set(`${run.versionId}:${run.caseId}`, run);
  const failed = [...latest.values()].filter(item => item.status === "FAILED");
  if (failed.length) return state("error", `${quantity(failed.length, "training test")} failed`, ids(failed));
  const unavailable = (data.skills ?? []).filter(item => item.status === "quarantined" || item.status === "stale");
  if (unavailable.length) return state("attention", `${quantity(unavailable.length, "skill")} needs review`, ids(unavailable));
  const done = completed(runs, previous ? liveTimelineRuns(previous.timeline) : undefined, item => item.id, item => item.status === "COMPLETED");
  return done.length ? state("complete", "Training test completed", done) : idle("No training tests running");
}

function identityActivity(data: RelicActivitySnapshot, previous?: RelicActivitySnapshot): RelicActivity {
  const connections = data.connections ?? [];
  const failed = connections.filter(item => item.status === "error" || item.status === "authorization_failed");
  if (failed.length) return state("error", `${quantity(failed.length, "connection")} failed`, ids(failed));
  const expired = connections.filter(item => item.status === "reauth_required");
  if (expired.length) return state("attention", `${quantity(expired.length, "connection")} needs sign-in`, ids(expired));
  const consent = connections.filter(item => item.status === "authorizing");
  if (consent.length) return state("attention", `${quantity(consent.length, "connection")} awaiting your consent`, ids(consent));
  const done = completed(connections, previous?.connections, item => item.id, item => item.status === "connected");
  if (done.length) return state("complete", "Connection ready", done);
  // A connected source or a scheduled sync is not evidence that a read is in progress.
  const connected = connections.filter(item => item.status === "connected").length;
  return idle(connected ? "Connections ready" : "No connections yet", connected);
}

export function mapRelicActivity(data: RelicActivitySnapshot, previous?: RelicActivitySnapshot, nowMs = data.observedAt): RelicActivityMap {
  const prior = nowMs - data.observedAt < RELIC_COMPLETION_MS ? previous : undefined;
  const result: RelicActivityMap = {
    cases: caseActivity(data, prior, nowMs), evidence: evidenceActivity(data, prior), review: reviewActivity(data, prior),
    timeline: timelineActivity(data, prior), benchmarks: benchmarkActivity(data, prior), identity: identityActivity(data, prior),
  };
  for (const section of RELIC_ACTIVITY_SECTIONS) {
    const error = data.errors?.[section];
    if (error) result[section] = { status: "error", label: error, eventKey: `load-error:${section}:${error}` };
    else if (data.signedIn === false && ["cases", "evidence", "review", "identity"].includes(section)) result[section] = idle("Sign in for live activity");
    else if (data.incomplete?.[section] && result[section].status === "idle") result[section] = { status: "waiting", label: "More activity outside this view" };
  }
  return result;
}
