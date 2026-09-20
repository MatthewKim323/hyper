import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { BenchmarksDocument, Run, SystemManifest } from "@/lib/benchmarks/types";
import { artifactHref, formatLandscapeMetric, landscapeColumns, landscapeComparison, landscapeMetric, landscapePage, landscapeValues, realLandscapeRuns } from "./benchmark-landscape";

function run(id: string, system = "framework-1", extra: Partial<Run> = {}): Run {
  return { id, system_id: system, suite_id: "ap", mode: "LIVE", execution: "completed", finished_at: id,
    n_tasks: 12, trials_per_task: 1, whole_task_success: { status: "measured", value: .8, unit: "ratio" },
    cost_usd: { status: "measured", value: 2, unit: "USD" }, wall_ms: { status: "measured", value: 120, unit: "ms" }, ...extra } as Run;
}
function doc(runs: Run[] = []): BenchmarksDocument {
  return { schema_version: 1, generated_at: "2026-09-19", display_mode: "LIVE", runs,
    systems: [{ id: "framework-1", label: "First framework", kind: "FULL_SYSTEM", created_at: "2026-09-18" }, { id: "oracle", kind: "ORACLE_SMOKE", created_at: "1970" }] as SystemManifest[],
    suites: [], trials: [], comparisons: [], capabilities: [], claims: [] };
}

test("oracle and development fixtures never become subject bars or run evidence", () => {
  const input = doc([run("live"), run("oracle", "oracle"), run("fixture", "framework-1", { mode: "DEV_FIXTURE" })]);
  assert.deepEqual(realLandscapeRuns(input).map((item) => item.id), ["live"]);
  assert.equal(landscapeColumns(input, "ap")[0].run?.id, "live");
  input.display_mode = "DEV_FIXTURE";
  assert.deepEqual(realLandscapeRuns(input), []);
  assert.deepEqual(landscapeColumns(input, "ap"), []);
});

test("latest completed measurement survives a later cancelled or running attempt", () => {
  const input = doc([run("2026-01"), run("2026-02", "framework-1", { execution: "cancelled" }), run("2026-03", "framework-1", { execution: "running" })]);
  const [column] = landscapeColumns(input, "ap");
  assert.equal(column.run?.id, "2026-01");
  assert.equal(column.latestAttempt?.execution, "running");
  assert.equal(landscapeMetric(input.runs[1], "success").status, "unavailable");
});

test("normalized sculpture keeps missing, invalid and zero measurements distinct", () => {
  const first = run("1");
  const second = run("2", "framework-2", { cost_usd: { status: "unavailable", reason: "No cost receipt." } });
  const third = run("3", "framework-3", { cost_usd: { status: "measured", value: 0, unit: "USD" } });
  const columns = landscapeColumns(doc([first, second, third]), "ap");
  assert.deepEqual(Object.fromEntries(columns.map((column, index) => [column.id, landscapeValues(columns, "cost")[index]])), { "framework-1": 1, "framework-2": null, "framework-3": 0 });
  assert.deepEqual(landscapeValues(columns, "success"), [.8, .8, .8]);
  assert.equal(landscapeMetric(run("nan", "bad", { wall_ms: { status: "measured", value: NaN, unit: "ms" } }), "latency").status, "unavailable");
  assert.equal(landscapeMetric(run("unit", "bad", { wall_ms: { status: "measured", value: 10, unit: "seconds" } }), "latency").status, "unavailable");
});

test("registered systems with no runs remain unmeasured, not zero", () => {
  const columns = landscapeColumns(doc(), "ap");
  assert.equal(columns.length, 1);
  assert.equal(columns[0].label, "First framework");
  assert.deepEqual(landscapeValues(columns, "success"), [null]);
});

test("matching suite alone does not establish a fair comparison", () => {
  const baseline = run("1");
  const candidate = run("2", "framework-2");
  const input = doc([baseline, candidate]);
  assert.equal(landscapeComparison(input, baseline, candidate).comparable, false);
  input.comparisons = [{ id: "matched", baseline_run_id: "1", candidate_run_id: "2", kind: "FULL_SYSTEM", comparable: true, reasons: [], changed: [], tasks: [] }];
  assert.equal(landscapeComparison(input, baseline, candidate).comparable, true);
  candidate.n_tasks = 13;
  assert.equal(landscapeComparison(input, baseline, candidate).comparable, false);
  input.comparisons[0].comparable = false;
  input.comparisons[0].reasons = ["Policy changed."];
  assert.ok(landscapeComparison(input, baseline, candidate).reasons.includes("Policy changed."));
});

test("artifact references become links only for navigable HTTP or same-origin paths", () => {
  assert.equal(artifactHref("eval/runs/real-run"), null);
  assert.equal(artifactHref("javascript:alert(1)"), null);
  assert.equal(artifactHref("//evil.example/"), null);
  assert.equal(artifactHref("/\\evil.example/"), null);
  assert.equal(artifactHref("https://example.com/result"), "https://example.com/result");
  assert.equal(artifactHref("/benchmarks/evidence/result.json"), "/benchmarks/evidence/result.json");
});

test("small genuine measurements do not round into fake zeros", () => {
  assert.equal(formatLandscapeMetric({ status: "measured", value: 2, unit: "ms" }), "2ms");
  assert.equal(formatLandscapeMetric({ status: "measured", value: .0004, unit: "USD" }), "$0.0004");
  assert.equal(formatLandscapeMetric({ status: "measured", value: 0, unit: "USD" }), "$0.00");
});

test("version pagination drives exactly the same seven visible sculpture slots", () => {
  const columns = Array.from({ length: 17 }, (_, index) => ({ id: `snapshot-${index}`, label: `Snapshot ${index}` }));
  const values = columns.map((_, index) => index === 10 ? null : index / 20);
  const candidatePage = landscapePage(columns, values, "snapshot-10", null);
  assert.equal(candidatePage.page, 1);
  assert.deepEqual(candidatePage.columns.map(column => column.id), columns.slice(7, 14).map(column => column.id));
  assert.deepEqual(candidatePage.values, values.slice(7, 14));
  assert.equal(candidatePage.selectedIndex, 3);
  assert.equal(candidatePage.values[3], null);
  const older = landscapePage(columns, values, "snapshot-10", 0);
  assert.equal(older.selectedIndex, -1);
  assert.equal(older.columns.length, 7);
  const newest = landscapePage(columns, values, "snapshot-10", 99);
  assert.equal(newest.page, 2);
  assert.equal(newest.columns.length, 3);
  assert.deepEqual(newest.values, values.slice(14));
  assert.equal(landscapePage([], [], undefined, 2).selectedIndex, -1);
  assert.deepEqual(landscapePage([], [], undefined, 2).values, []);
});
