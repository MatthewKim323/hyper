import {
  TIMELINE_SCHEMA_VERSION,
  type TimelineDocument,
  type VersionSnapshot,
} from "./types";

export const TIMELINE_LIMITS = {
  jsonBytes: 2 * 1024 * 1024,
  versions: 128,
  scenariosPerVersion: 100,
  runsPerVersion: 200,
  stepsPerRun: 1000,
  evidencePerRun: 1000,
  totalNodes: 100000,
  depth: 16,
} as const;

export class TimelineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelineValidationError";
  }
}

function fail(path: string, message: string): never {
  throw new TimelineValidationError(`${path}: ${message}`);
}

function object(value: unknown, path: string, fields: string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "expected an object");
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (!fields.includes(key)) fail(`${path}.${key}`, "unknown field");
  }
  for (const field of fields) {
    if (!Object.hasOwn(result, field)) fail(`${path}.${field}`, "required field missing");
  }
  return result;
}

function string(value: unknown, path: string, max = 4096): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    fail(path, `expected nonempty text of at most ${max} characters`);
  }
}

function id(value: unknown, path: string): asserts value is string {
  string(value, path, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) fail(path, "invalid identifier");
}

function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `expected an array with at most ${max} entries`);
  return value;
}

function oneOf(value: unknown, path: string, values: readonly string[]) {
  if (typeof value !== "string" || !values.includes(value)) fail(path, `expected one of ${values.join(", ")}`);
}

function date(value: unknown, path: string) {
  string(value, path, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(path, "expected an ISO 8601 timestamp with timezone");
  }
  const calendarDay = value.slice(0, 10);
  if (new Date(`${calendarDay}T00:00:00Z`).toISOString().slice(0, 10) !== calendarDay) {
    fail(path, "invalid calendar date");
  }
}

function safeReference(value: unknown, path: string) {
  string(value, path, 2048);
  if (value.startsWith("https://")) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      fail(path, "invalid HTTPS URL");
    }
    if (parsed.username || parsed.password) fail(path, "reference URLs cannot contain credentials");
    return;
  }
  if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*(?:#[A-Za-z0-9_.:-]+)?$/.test(value)) {
    fail(path, "expected a repository-relative path or HTTPS URL");
  }
  if (value.split("/").some((part) => part === "." || part === "..")) fail(path, "relative traversal is not allowed");
}

function evidence(value: unknown, path: string): Record<string, unknown> {
  const entry = object(value, path, ["id", "label", "kind", "ref"]);
  id(entry.id, `${path}.id`);
  string(entry.label, `${path}.label`, 256);
  oneOf(entry.kind, `${path}.kind`, ["SOURCE", "TEST_DEFINITION", "RUN_ARTIFACT", "TRACE", "DOCUMENT"]);
  safeReference(entry.ref, `${path}.ref`);
  return entry;
}

function uniqueEntries(entries: unknown[], path: string, read: (entry: unknown, path: string) => Record<string, unknown>) {
  const ids = new Set<string>();
  entries.forEach((entry, index) => {
    const item = read(entry, `${path}[${index}]`);
    if (ids.has(item.id as string)) fail(path, `duplicate id ${item.id}`);
    ids.add(item.id as string);
  });
  return ids;
}

function references(value: unknown, path: string, known: Set<string>) {
  const seen = new Set<string>();
  list(value, path, TIMELINE_LIMITS.evidencePerRun).forEach((entry, index) => {
    id(entry, `${path}[${index}]`);
    if (!known.has(entry)) fail(`${path}[${index}]`, "unknown evidence id");
    if (seen.has(entry)) fail(path, "duplicate evidence reference");
    seen.add(entry);
  });
}

function metric(value: unknown, path: string, integer = false) {
  if (typeof value !== "object" || value === null) fail(path, "expected a metric object");
  if ((value as Record<string, unknown>).status === "available") {
    const item = object(value, path, ["status", "value", "source"]);
    if (typeof item.value !== "number" || !Number.isFinite(item.value) || item.value < 0 || item.value > Number.MAX_SAFE_INTEGER) {
      fail(`${path}.value`, "expected a finite nonnegative number within the safe range");
    }
    if (integer && !Number.isSafeInteger(item.value)) fail(`${path}.value`, "token counts must be integers");
    string(item.source, `${path}.source`, 1024);
  } else {
    const item = object(value, path, ["status", "reason"]);
    oneOf(item.status, `${path}.status`, ["unavailable"]);
    string(item.reason, `${path}.reason`, 1024);
  }
}

/** Reject cycles, accessors, prototypes and oversized trees before reading fields. */
function inspectTree(input: unknown) {
  const seen = new WeakSet<object>();
  let nodes = 0;
  function visit(value: unknown, depth: number) {
    if (++nodes > TIMELINE_LIMITS.totalNodes || depth > TIMELINE_LIMITS.depth) fail("timeline", "document is too complex");
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object") fail("timeline", "only JSON data is allowed");
    if (seen.has(value)) fail("timeline", "cyclic object references are not allowed");
    seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) fail("timeline", "only plain JSON objects are allowed");
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") fail("timeline", "symbol keys are not allowed");
      if (Array.isArray(value) && key === "length") continue;
      if (["__proto__", "constructor", "prototype"].includes(key)) fail("timeline", "unsafe object key");
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || descriptor.get || descriptor.set) fail("timeline", "only ordinary JSON fields are allowed");
      visit(descriptor.value, depth + 1);
    }
    seen.delete(value);
  }
  visit(input, 0);
}

const RUN_MODES = ["LIVE", "RECORDED_REPLAY", "DEV_FIXTURE"] as const;

/** Validates structure and references, not the authenticity of an imported recording. */
export function validateTimelineDocument(input: unknown): TimelineDocument {
  inspectTree(input);
  const document = object(input, "timeline", ["schemaVersion", "versions"]);
  if (document.schemaVersion !== TIMELINE_SCHEMA_VERSION) fail("timeline.schemaVersion", "unsupported schema version");
  const globalRunIds = new Set<string>();
  uniqueEntries(list(document.versions, "timeline.versions", TIMELINE_LIMITS.versions), "timeline.versions", (value, path) => {
    const version = object(value, path, ["id", "label", "title", "createdAt", "commit", "summary", "framework", "scenarios", "runs"]);
    id(version.id, `${path}.id`);
    string(version.label, `${path}.label`, 80);
    string(version.title, `${path}.title`, 256);
    date(version.createdAt, `${path}.createdAt`);
    if (typeof version.commit !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(version.commit)) fail(`${path}.commit`, "expected a full Git commit hash");
    string(version.summary, `${path}.summary`);
    const framework = object(version.framework, `${path}.framework`, ["name", "version", "changes", "config", "sourceRefs"]);
    string(framework.name, `${path}.framework.name`, 128);
    string(framework.version, `${path}.framework.version`, 80);
    list(framework.changes, `${path}.framework.changes`, 100).forEach((change, index) => string(change, `${path}.framework.changes[${index}]`, 2048));
    if (typeof framework.config !== "object" || framework.config === null || Array.isArray(framework.config)) fail(`${path}.framework.config`, "expected a config object");
    const configEntries = Object.entries(framework.config);
    if (configEntries.length > 100) fail(`${path}.framework.config`, "too many config fields");
    for (const [key, entry] of configEntries) {
      id(key, `${path}.framework.config key`);
      if (Array.isArray(entry)) {
        list(entry, `${path}.framework.config.${key}`, 100).forEach((item) => string(item, `${path}.framework.config.${key}`, 1024));
      } else if (entry !== null && typeof entry !== "number" && typeof entry !== "boolean") {
        string(entry, `${path}.framework.config.${key}`, 2048);
      }
    }
    uniqueEntries(list(framework.sourceRefs, `${path}.framework.sourceRefs`, 100), `${path}.framework.sourceRefs`, evidence);
    const scenarios = new Map<string, Record<string, unknown>>();
    uniqueEntries(list(version.scenarios, `${path}.scenarios`, TIMELINE_LIMITS.scenariosPerVersion), `${path}.scenarios`, (item, scenarioPath) => {
      const scenario = object(item, scenarioPath, ["id", "caseId", "title", "summary", "mode", "sourceRefs"]);
      id(scenario.id, `${scenarioPath}.id`);
      id(scenario.caseId, `${scenarioPath}.caseId`);
      string(scenario.title, `${scenarioPath}.title`, 256);
      string(scenario.summary, `${scenarioPath}.summary`);
      oneOf(scenario.mode, `${scenarioPath}.mode`, RUN_MODES);
      const sourceRefs = list(scenario.sourceRefs, `${scenarioPath}.sourceRefs`, 100);
      if (sourceRefs.length === 0) fail(`${scenarioPath}.sourceRefs`, "scenario definitions require at least one evidence reference");
      uniqueEntries(sourceRefs, `${scenarioPath}.sourceRefs`, evidence);
      scenarios.set(scenario.id as string, scenario);
      return scenario;
    });
    uniqueEntries(list(version.runs, `${path}.runs`, TIMELINE_LIMITS.runsPerVersion), `${path}.runs`, (item, runPath) => {
      const run = object(item, runPath, ["id", "versionId", "caseId", "scenarioId", "mode", "status", "startedAt", "completedAt", "comparisonContext", "outcome", "steps", "evidence", "metrics", "provenance"]);
      id(run.id, `${runPath}.id`);
      if (globalRunIds.has(run.id)) fail(`${runPath}.id`, "run ids must be globally unique");
      globalRunIds.add(run.id);
      if (run.versionId !== version.id) fail(`${runPath}.versionId`, "run belongs to a different version");
      id(run.caseId, `${runPath}.caseId`);
      id(run.scenarioId, `${runPath}.scenarioId`);
      const scenario = scenarios.get(run.scenarioId);
      if (!scenario || scenario.caseId !== run.caseId) fail(`${runPath}.scenarioId`, "scenario must exist and match the case");
      oneOf(run.mode, `${runPath}.mode`, RUN_MODES);
      if (scenario.mode !== run.mode) fail(`${runPath}.mode`, "run mode must match its scenario");
      oneOf(run.status, `${runPath}.status`, ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);
      date(run.startedAt, `${runPath}.startedAt`);
      if (run.completedAt !== null) {
        date(run.completedAt, `${runPath}.completedAt`);
        if (Date.parse(run.completedAt as string) < Date.parse(run.startedAt as string)) fail(`${runPath}.completedAt`, "completion cannot precede start");
      }
      if (run.status === "RUNNING" ? run.completedAt !== null : run.completedAt === null) fail(`${runPath}.completedAt`, "running executions must be unfinished; terminal executions need completion time");
      const context = object(run.comparisonContext, `${runPath}.comparisonContext`, ["inputFingerprint", "policyFingerprint", "harnessVersion", "environmentFingerprint"]);
      for (const [key, entry] of Object.entries(context)) {
        if (entry !== null) string(entry, `${runPath}.comparisonContext.${key}`, 256);
      }
      const knownEvidence = uniqueEntries(list(run.evidence, `${runPath}.evidence`, TIMELINE_LIMITS.evidencePerRun), `${runPath}.evidence`, evidence);
      const provenance = evidence(run.provenance, `${runPath}.provenance`);
      oneOf(provenance.kind, `${runPath}.provenance.kind`, ["RUN_ARTIFACT", "TRACE"]);
      const outcome = object(run.outcome, `${runPath}.outcome`, ["verdict", "status", "summary", "evidenceIds"]);
      oneOf(outcome.verdict, `${runPath}.outcome.verdict`, ["PASS", "FAIL", "INCONCLUSIVE"]);
      string(outcome.status, `${runPath}.outcome.status`, 128);
      string(outcome.summary, `${runPath}.outcome.summary`);
      references(outcome.evidenceIds, `${runPath}.outcome.evidenceIds`, knownEvidence);
      const ordinals = new Set<number>();
      uniqueEntries(list(run.steps, `${runPath}.steps`, TIMELINE_LIMITS.stepsPerRun), `${runPath}.steps`, (stepInput, stepPath) => {
        const step = object(stepInput, stepPath, ["id", "ordinal", "title", "status", "detail", "evidenceIds"]);
        id(step.id, `${stepPath}.id`);
        if (typeof step.ordinal !== "number" || !Number.isSafeInteger(step.ordinal) || step.ordinal < 0 || ordinals.has(step.ordinal)) fail(`${stepPath}.ordinal`, "expected a unique nonnegative integer");
        ordinals.add(step.ordinal);
        string(step.title, `${stepPath}.title`, 256);
        oneOf(step.status, `${stepPath}.status`, ["PENDING", "RUNNING", "COMPLETED", "FAILED", "SKIPPED"]);
        string(step.detail, `${stepPath}.detail`);
        references(step.evidenceIds, `${stepPath}.evidenceIds`, knownEvidence);
        return step;
      });
      const metrics = object(run.metrics, `${runPath}.metrics`, ["durationMs", "totalTokens", "costUsd"]);
      metric(metrics.durationMs, `${runPath}.metrics.durationMs`);
      metric(metrics.totalTokens, `${runPath}.metrics.totalTokens`, true);
      metric(metrics.costUsd, `${runPath}.metrics.costUsd`);
      return run;
    });
    return version;
  });
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > TIMELINE_LIMITS.jsonBytes) fail("timeline", "JSON exceeds the 2 MiB limit");
  return input as TimelineDocument;
}

export function importTimelineJson(text: string): TimelineDocument {
  if (new TextEncoder().encode(text).byteLength > TIMELINE_LIMITS.jsonBytes) fail("timeline", "JSON exceeds the 2 MiB limit");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    fail("timeline", "invalid JSON");
  }
  return validateTimelineDocument(input);
}

export function exportTimelineJson(document: TimelineDocument): string {
  validateTimelineDocument(document);
  const formatted = JSON.stringify(document, null, 2);
  // Keep every valid export importable even when whitespace would exceed the limit.
  return new TextEncoder().encode(formatted).byteLength <= TIMELINE_LIMITS.jsonBytes
    ? formatted
    : JSON.stringify(document);
}

/** Append-only: collisions fail explicitly, so importing can never rewrite a snapshot. */
export function appendTimeline(base: TimelineDocument, incoming: TimelineDocument): TimelineDocument {
  validateTimelineDocument(base);
  validateTimelineDocument(incoming);
  return importTimelineJson(JSON.stringify({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    versions: [...base.versions, ...incoming.versions],
  }));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Adds evidenced scenarios and recordings to immutable snapshots; exact duplicates are harmless. */
export function mergeTimeline(base: TimelineDocument, incoming: TimelineDocument): TimelineDocument {
  validateTimelineDocument(base);
  validateTimelineDocument(incoming);
  const versions = new Map(base.versions.map((version) => [version.id, version]));
  for (const candidate of incoming.versions) {
    const previous = versions.get(candidate.id);
    if (!previous) {
      versions.set(candidate.id, candidate);
      continue;
    }
    const { runs: previousRuns, scenarios: previousScenarios, ...previousMetadata } = previous;
    const { runs: candidateRuns, scenarios: candidateScenarios, ...candidateMetadata } = candidate;
    if (canonicalJson(previousMetadata) !== canonicalJson(candidateMetadata)) {
      fail(`version ${candidate.label} (${candidate.id})`, "snapshot metadata differs; create a new snapshot instead of rewriting history");
    }
    const scenarios = new Map(previousScenarios.map((scenario) => [scenario.id, scenario]));
    for (const scenario of candidateScenarios) {
      const known = scenarios.get(scenario.id);
      if (known && canonicalJson(known) !== canonicalJson(scenario)) fail(`scenario ${scenario.id}`, "definition conflicts with an existing scenario");
      scenarios.set(scenario.id, scenario);
    }
    const runs = new Map(previousRuns.map((run) => [run.id, run]));
    for (const run of candidateRuns) {
      const known = runs.get(run.id);
      if (known && canonicalJson(known) !== canonicalJson(run)) fail(`run ${run.id}`, "recording conflicts with an existing run");
      runs.set(run.id, run);
    }
    versions.set(previous.id, { ...previous, scenarios: [...scenarios.values()], runs: [...runs.values()] });
  }
  return importTimelineJson(JSON.stringify({ schemaVersion: TIMELINE_SCHEMA_VERSION, versions: [...versions.values()] }));
}

const BACKBONE_COMMIT = "ab89ccae7581629538199acabca7960890f183f1";

/** This is a source snapshot, not a benchmark or a claimed agent execution. */
const backboneSnapshot: VersionSnapshot = {
  id: BACKBONE_COMMIT,
  label: "v1",
  title: "Financial backbone",
  createdAt: "2026-09-19T14:25:29-04:00",
  commit: BACKBONE_COMMIT,
  summary: "First committed AP exception-resolution backbone. Source-defined synthetic case and acceptance tests are available; no recorded framework runs are bundled.",
  framework: {
    name: "mirror-resolve",
    version: "0.1.0",
    changes: [
      "Versioned records with source-based trust and deterministic three-way matching.",
      "Engine-owned case issues and verified credit memo lifecycle.",
      "Hash-bound proposals, independent review, controller approval, and atomic commit.",
      "Batch projection with a single net AP recognition and no money movement.",
    ],
    config: {
      policyVersion: "demo-policy-v1",
      currency: "USD",
      approvalThresholdCents: 2500000,
      creditsRequireApproval: true,
      trustedSources: ["ERP", "PROCUREMENT_SYSTEM", "RECEIVING_SYSTEM", "SUPPLIER_PORTAL"],
      followupAfterHours: 24,
      maxFollowups: 2,
      maxAgentTurns: 40,
      policySourceFingerprint: "git-blob:90e55dbbc7b59d1879a8637f7a6cbb79ee4f1823",
      model: null,
    },
    sourceRefs: [
      { id: "package", label: "Package metadata", kind: "SOURCE", ref: "resolve/pyproject.toml" },
      { id: "policy", label: "Default synthetic-company policy", kind: "SOURCE", ref: "resolve/src/mirror_resolve/policy.py" },
      { id: "backbone-tests", label: "Acceptance test definitions, not recorded results", kind: "TEST_DEFINITION", ref: "resolve/tests/test_backbone.py" },
    ],
  },
  scenarios: [{
    id: "incomplete-supplier-correction",
    caseId: "INV-1042",
    title: "Incomplete supplier correction",
    summary: "Synthetic invoice fixture with price and quantity discrepancies. Follow-up evidence is defined separately and is not a recorded interaction.",
    mode: "DEV_FIXTURE",
    sourceRefs: [{ id: "hero-fixture", label: "Synthetic scenario definition", kind: "SOURCE", ref: "resolve/src/mirror_resolve/fixtures/hero.py" }],
  }],
  runs: [],
};

export const initialTimeline: TimelineDocument = validateTimelineDocument({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  versions: [backboneSnapshot],
});

/** Call this before editing client state so the bundled seed remains unchanged. */
export function createInitialTimeline(): TimelineDocument {
  return importTimelineJson(JSON.stringify(initialTimeline));
}
