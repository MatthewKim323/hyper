import { strict as assert } from "node:assert";
import { test } from "node:test";
import { compareVersions, latestCaseRun } from "./compare";
import {
  appendTimeline,
  createInitialTimeline,
  exportTimelineJson,
  importTimelineJson,
  initialTimeline,
  mergeTimeline,
  TIMELINE_LIMITS,
  TimelineValidationError,
  validateTimelineDocument,
} from "./registry";
import type { TimelineDocument, VersionRun, VersionSnapshot } from "./types";

// These fabricated recordings exist only inside validation tests, never in the shipped registry.
function snapshot(id: string): VersionSnapshot {
  const version = createInitialTimeline().versions[0];
  version.id = id;
  version.label = id;
  return version;
}

function recording(versionId: string, id = `run-${versionId}`): VersionRun {
  return {
    id,
    versionId,
    caseId: "INV-1042",
    scenarioId: "incomplete-supplier-correction",
    mode: "DEV_FIXTURE",
    status: "COMPLETED",
    startedAt: "2026-09-19T19:00:00Z",
    completedAt: "2026-09-19T19:00:02Z",
    comparisonContext: {
      inputFingerprint: "test-input-sha256",
      policyFingerprint: "test-policy-sha256",
      harnessVersion: "test-harness-1",
      environmentFingerprint: "test-machine",
    },
    outcome: { verdict: "PASS", status: "RESOLVED", summary: "Test-only outcome.", evidenceIds: ["test-result"] },
    steps: [{ id: "step-1", ordinal: 0, title: "Test step", status: "COMPLETED", detail: "Test-only detail.", evidenceIds: ["test-result"] }],
    evidence: [{ id: "test-result", label: "Test result", kind: "RUN_ARTIFACT", ref: "test-artifacts/result.json" }],
    provenance: { id: "test-export", label: "Test export", kind: "RUN_ARTIFACT", ref: "test-artifacts/export.json" },
    metrics: {
      durationMs: { status: "available", value: 2000, source: "test timer" },
      totalTokens: { status: "unavailable", reason: "Test-only deterministic execution has no token observation." },
      costUsd: { status: "unavailable", reason: "No billing record exists." },
    },
  };
}

function document(...versions: VersionSnapshot[]): TimelineDocument {
  return { schemaVersion: 1, versions };
}

test("bundled snapshot is actual committed source with no fabricated runs", () => {
  assert.equal(initialTimeline.versions.length, 1);
  const version = initialTimeline.versions[0];
  assert.equal(version.commit, "ab89ccae7581629538199acabca7960890f183f1");
  assert.equal(version.framework.version, "0.1.0");
  assert.deepEqual(version.runs, []);
  assert.equal(version.scenarios[0].mode, "DEV_FIXTURE");
  assert.deepEqual(importTimelineJson(exportTimelineJson(initialTimeline)), initialTimeline);
});

test("source definitions alone cannot manufacture metric deltas or outcomes", () => {
  const result = compareVersions(snapshot("first"), snapshot("second"), "INV-1042");
  assert.equal(result.comparable, false);
  assert.equal(result.outcomeChanged, null);
  assert.equal(result.baselineRun, null);
  for (const metric of result.metrics) {
    assert.equal(metric.delta, null);
    assert.equal(metric.baseline.status, "unavailable");
  }
});

test("only aligned terminal recordings can produce measured deltas", () => {
  const first = snapshot("first");
  const second = snapshot("second");
  first.runs = [recording(first.id)];
  second.runs = [recording(second.id)];
  second.runs[0].metrics.durationMs = { status: "available", value: 1500, source: "test timer" };
  validateTimelineDocument(document(first, second));
  const result = compareVersions(first, second, "INV-1042");
  assert.equal(result.comparable, true);
  assert.equal(result.metrics[0].delta, -500);
  assert.equal(result.metrics[0].percentChange, -25);
  assert.equal(result.metrics[1].delta, null);
  assert.match(result.metrics[1].reason!, /no token observation/);
});

test("different input, policy, harness, environment, mode, or scenario prevents every delta", () => {
  const changes: Array<(run: VersionRun) => void> = [
    (run) => { run.comparisonContext.inputFingerprint = "different-input"; },
    (run) => { run.comparisonContext.policyFingerprint = "different-policy"; },
    (run) => { run.comparisonContext.harnessVersion = "different-harness"; },
    (run) => { run.comparisonContext.environmentFingerprint = "different-environment"; },
    (run) => { run.comparisonContext.policyFingerprint = null; },
    (run) => { run.mode = "LIVE"; },
    (run) => { run.scenarioId = "different-scenario"; },
  ];
  for (const change of changes) {
    const first = snapshot("first");
    const second = snapshot("second");
    first.runs = [recording(first.id)];
    second.runs = [recording(second.id)];
    change(second.runs[0]);
    const result = compareVersions(first, second, "INV-1042");
    assert.equal(result.comparable, false);
    assert.ok(result.reasons.length > 0);
    assert.ok(result.metrics.every((metric) => metric.delta === null));
    assert.equal(result.outcomeChanged, null);
  }
});

test("zero baseline is a real measured value, not a missing metric or infinite percentage", () => {
  const first = snapshot("first");
  const second = snapshot("second");
  first.runs = [recording(first.id)];
  second.runs = [recording(second.id)];
  first.runs[0].metrics.costUsd = { status: "available", value: 0, source: "test invoice" };
  second.runs[0].metrics.costUsd = { status: "available", value: 0.02, source: "test invoice" };
  const result = compareVersions(first, second, "INV-1042");
  assert.equal(result.metrics[2].delta, 0.02);
  assert.equal(result.metrics[2].percentChange, null);
  assert.match(result.metrics[2].reason!, /baseline is zero/);
});

test("run selection ignores unfinished, cancelled, and unrelated cases without mutating run order", () => {
  const version = snapshot("first");
  const completed = recording(version.id, "complete");
  const running = { ...recording(version.id, "running"), status: "RUNNING" as const, completedAt: null, startedAt: "2026-09-19T21:00:00Z" };
  const cancelled = { ...recording(version.id, "cancelled"), status: "CANCELLED" as const, startedAt: "2026-09-19T20:00:00Z", completedAt: "2026-09-19T20:00:01Z" };
  version.runs = [running, completed, cancelled];
  assert.equal(latestCaseRun(version, "INV-1042")?.id, "complete");
  assert.equal(latestCaseRun(version, "unknown"), null);
  assert.deepEqual(version.runs.map((run) => run.id), ["running", "complete", "cancelled"]);
});

test("same snapshot cannot be presented as a version comparison", () => {
  const version = snapshot("first");
  version.runs = [recording(version.id)];
  assert.equal(compareVersions(version, version, "INV-1042").comparable, false);
});

test("merge deduplicates immutable snapshots and appends real imported run records", () => {
  const base = createInitialTimeline();
  const incoming = createInitialTimeline();
  incoming.versions[0].runs.push(recording(incoming.versions[0].id));
  const merged = mergeTimeline(base, incoming);
  assert.equal(merged.versions.length, 1);
  assert.equal(merged.versions[0].runs.length, 1);
  assert.equal(base.versions[0].runs.length, 0);
  assert.deepEqual(mergeTimeline(merged, incoming), merged);
  assert.equal(mergeTimeline(merged, document(snapshot("new-version"))).versions.length, 2);
});

test("a discovered snapshot can append its first evidenced scenario and recording without changing source metadata", () => {
  const discovered = snapshot("discovered-version");
  discovered.scenarios = [];
  const imported = snapshot(discovered.id);
  imported.runs = [recording(imported.id)];
  const merged = mergeTimeline(document(discovered), document(imported));
  assert.equal(merged.versions.length, 1);
  assert.equal(merged.versions[0].scenarios.length, 1);
  assert.equal(merged.versions[0].runs[0].scenarioId, merged.versions[0].scenarios[0].id);
  assert.deepEqual(merged.versions[0].framework, discovered.framework);
  assert.equal(merged.versions[0].commit, discovered.commit);
  assert.deepEqual(discovered.scenarios, []);
  assert.deepEqual(mergeTimeline(merged, document(imported)), merged);

  const conflict = importTimelineJson(exportTimelineJson(document(imported)));
  conflict.versions[0].scenarios[0].summary = "Different scenario with an existing id.";
  assert.throws(() => mergeTimeline(merged, conflict), /conflicts with an existing scenario/);
  const unevidenced = snapshot(discovered.id);
  unevidenced.scenarios[0].sourceRefs = [];
  assert.throws(() => mergeTimeline(document(discovered), document(unevidenced)), /require at least one evidence reference/);
});

test("imports cannot rewrite old snapshot metadata or a previously saved run", () => {
  const base = createInitialTimeline();
  const changed = createInitialTimeline();
  changed.versions[0].summary = "Different source summary.";
  assert.throws(() => mergeTimeline(base, changed), /snapshot metadata differs/);
  const recorded = createInitialTimeline();
  recorded.versions[0].runs = [recording(recorded.versions[0].id)];
  const conflict = importTimelineJson(exportTimelineJson(recorded));
  conflict.versions[0].runs[0].outcome.status = "BLOCKED";
  assert.throws(() => mergeTimeline(recorded, conflict), /conflicts with an existing run/);
  assert.throws(() => appendTimeline(base, createInitialTimeline()), /duplicate id/);
});

test("validation rejects malformed JSON, wrong schema, unsafe keys, executable URLs and accessors", () => {
  assert.throws(() => importTimelineJson("{"), /invalid JSON/);
  assert.throws(() => importTimelineJson('{"schemaVersion":2,"versions":[]}'), /unsupported schema/);
  assert.throws(() => importTimelineJson('{"schemaVersion":1,"versions":[],"__proto__":{}}'), /unsafe object key/);
  const badUrl = createInitialTimeline();
  badUrl.versions[0].framework.sourceRefs[0].ref = "javascript:alert(1)";
  assert.throws(() => validateTimelineDocument(badUrl), /repository-relative path or HTTPS/);
  const accessor = { schemaVersion: 1, get versions(): never { throw new Error("must not execute"); } };
  assert.throws(() => validateTimelineDocument(accessor), /ordinary JSON fields/);
  const missing = { schemaVersion: 1, versions: [{ id: "missing" }] };
  assert.throws(() => validateTimelineDocument(missing), TimelineValidationError);
});

test("validation rejects bad metrics, unknown evidence, wrong ownership, and impossible timestamps", () => {
  const changes: Array<(run: VersionRun) => void> = [
    (run) => { run.metrics.durationMs = { status: "available", value: -1, source: "test" }; },
    (run) => { run.metrics.totalTokens = { status: "available", value: 1.5, source: "test" }; },
    (run) => { run.outcome.evidenceIds = ["does-not-exist"]; },
    (run) => { run.versionId = "different-version"; },
    (run) => { run.scenarioId = "does-not-exist"; },
    (run) => { run.completedAt = "2026-09-19T18:00:00Z"; },
    (run) => { run.completedAt = "2026-02-30T19:00:00Z"; },
    (run) => { run.completedAt = null; },
    (run) => { run.provenance.kind = "TEST_DEFINITION"; },
  ];
  for (const change of changes) {
    const version = snapshot("first");
    version.runs = [recording(version.id)];
    change(version.runs[0]);
    assert.throws(() => validateTimelineDocument(document(version)), TimelineValidationError);
  }
});

test("bounded imports reject oversized, excessively deep and cyclic data", () => {
  assert.throws(() => importTimelineJson(" ".repeat(TIMELINE_LIMITS.jsonBytes + 1)), /2 MiB/);
  let nested: unknown = {};
  for (let index = 0; index < 20; index++) nested = { nested };
  assert.throws(() => validateTimelineDocument(nested), /too complex/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => validateTimelineDocument(cyclic), /cyclic/);
});
