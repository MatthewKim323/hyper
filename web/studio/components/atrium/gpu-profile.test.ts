import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { WebGLRenderer } from "three";
import { createAtriumGpuProfile } from "./gpu-profile";

function setup(supported = true, enabled = true) {
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const queries: { available: boolean; result: number; deleted: number }[] = [];
  let active: object | null = null;
  let disjoint = false;
  let lost = false;
  let resultReads = 0;
  let ended = 0;
  const gl = {
    CURRENT_QUERY: 3, QUERY_RESULT_AVAILABLE: 4, QUERY_RESULT: 5,
    getExtension: () => supported ? extension : null,
    isContextLost: () => lost,
    getParameter: () => disjoint,
    getQuery: () => active,
    createQuery() { const query = { available: false, result: 0, deleted: 0 }; queries.push(query); return query; },
    beginQuery(_target: number, query: object) { assert.equal(active, null, "timer queries must never nest"); active = query; },
    endQuery() { assert.ok(active); active = null; ended++; },
    getQueryParameter(query: typeof queries[number], parameter: number) {
      if (parameter === this.QUERY_RESULT_AVAILABLE) return query.available;
      assert.ok(query.available, "query result must never be read before availability");
      resultReads++;
      return query.result;
    },
    deleteQuery(query: typeof queries[number]) { query.deleted++; },
  };
  const renderer = { capabilities: { isWebGL2: true }, getContext: () => gl } as unknown as WebGLRenderer;
  const profile = createAtriumGpuProfile(renderer, enabled);
  return {
    profile, queries,
    get resultReads() { return resultReads; }, get ended() { return ended; },
    set disjoint(value: boolean) { disjoint = value; },
    set lost(value: boolean) { lost = value; },
    set external(value: boolean) { active = value ? {} : null; },
  };
}

test("GPU profile polls completed phase timings without reading an unavailable query", () => {
  const h = setup();
  assert.ok(h.profile.supported);
  assert.equal(h.profile.measure("capture", () => 42), 42);
  h.profile.measure("beauty", () => {});
  const first = h.profile.poll();
  assert.equal(first.pending, 2);
  assert.equal(first.captureMs, null);
  assert.equal(h.resultReads, 0);
  h.queries[0].available = true;
  h.queries[0].result = 7350000;
  assert.equal(h.profile.poll().captureMs, 7.35);
  assert.equal(h.profile.poll().beautyMs, null);
  assert.equal(h.resultReads, 1);
  h.queries[1].available = true;
  h.queries[1].result = 4100000;
  assert.equal(h.profile.poll(), first, "poll returns a stable snapshot object");
  assert.deepEqual(first, { captureMs: 7.35, beautyMs: 4.1, bloomMs: null, toneMs: null, displayMs: null, calibrationMs: null, captureSamples: 1, beautySamples: 1, bloomSamples: 0, toneSamples: 0, displaySamples: 0, calibrationSamples: 0, pending: 0, skipped: 0 });
  h.profile.dispose();
  assert.ok(h.queries.every(query => query.deleted === 1));
});

test("timing never nests and never interferes with another timer owner", () => {
  const h = setup();
  let work = 0;
  h.profile.measure("capture", () => {
    work++;
    h.profile.measure("beauty", () => { work++; });
    h.profile.poll();
  });
  assert.equal(work, 2);
  assert.equal(h.queries.length, 1);
  assert.equal(h.ended, 1);
  h.external = true;
  h.profile.measure("beauty", () => { work++; });
  assert.equal(work, 3);
  assert.equal(h.queries.length, 1);
  assert.equal(h.ended, 1);
  assert.equal(h.profile.poll().skipped, 2);
  h.external = false;
  h.profile.dispose();
});

test("pending queries are bounded, disjoint results are discarded, and timing resumes afterward", () => {
  const h = setup();
  let calls = 0;
  for (let i = 0; i < 20; i++) h.profile.measure("capture", () => { calls++; });
  assert.equal(calls, 20);
  assert.equal(h.queries.length, 8);
  assert.equal(h.profile.poll().pending, 8);
  h.disjoint = true;
  const discarded = h.profile.poll();
  assert.equal(discarded.pending, 0);
  assert.equal(discarded.captureMs, null);
  assert.equal(h.resultReads, 0);
  assert.ok(h.queries.every(query => query.deleted === 1));
  h.profile.measure("beauty", () => { calls++; });
  assert.equal(h.queries.length, 8);
  h.disjoint = false;
  h.profile.measure("beauty", () => {});
  assert.equal(h.queries.length, 9);
  h.profile.dispose();
  assert.ok(h.queries.every(query => query.deleted === 1));
});

test("thrown render work closes its query, while disposal during work releases it only once", () => {
  const h = setup();
  assert.throws(() => h.profile.measure("capture", () => { throw new Error("render failed"); }), /render failed/);
  assert.equal(h.ended, 1);
  assert.equal(h.profile.poll().pending, 1);
  h.profile.measure("beauty", () => h.profile.dispose());
  h.profile.dispose();
  assert.equal(h.ended, 2);
  assert.ok(h.queries.every(query => query.deleted === 1));
  assert.equal(h.profile.supported, false);
  assert.equal(h.profile.measure("capture", () => "still renders"), "still renders");
});

test("disabled, unsupported, and lost contexts never stop rendering", () => {
  for (const h of [setup(false), setup(true, false)]) {
    assert.equal(h.profile.supported, false);
    assert.equal(h.profile.measure("beauty", () => 12), 12);
    assert.equal(h.profile.poll().pending, 0);
    assert.equal(h.queries.length, 0);
    h.profile.dispose();
  }
  const lost = setup();
  lost.profile.measure("capture", () => {});
  lost.lost = true;
  assert.equal(lost.profile.measure("beauty", () => "render"), "render");
  assert.equal(lost.profile.poll().pending, 0);
  assert.equal(lost.queries[0].deleted, 1);
  lost.profile.dispose();
});

test("composer scene, bloom, tone, and display samples remain separate and reset together on disjoint", () => {
  const h = setup();
  const phases = ["capture", "beauty", "bloom", "tone", "display", "calibration"] as const;
  phases.forEach(phase => h.profile.measure(phase, () => {}));
  h.queries.forEach((query, index) => { query.available = true; query.result = (index + 1) * 1e6; });
  const timing = h.profile.poll();
  phases.forEach((phase, index) => {
    assert.equal(timing[`${phase}Ms`], index + 1);
    assert.equal(timing[`${phase}Samples`], 1);
  });
  h.disjoint = true;
  h.profile.poll();
  phases.forEach(phase => {
    assert.equal(timing[`${phase}Ms`], null);
    assert.equal(timing[`${phase}Samples`], 0);
  });
  h.profile.dispose();
});

test("frame gating measures complete batches at most every 750ms and waits for all older results", () => {
  const h = setup();
  const phases = ["capture", "beauty", "bloom", "tone", "display", "calibration"] as const;
  let renders = 0;
  const frame = (time: number) => {
    h.profile.beginFrame(time);
    phases.forEach(phase => h.profile.measure(phase, () => { renders++; }));
  };
  frame(0);
  assert.equal(h.queries.length, 6);
  frame(100);
  frame(800);
  assert.equal(h.queries.length, 6, "unavailable queries prevent a partial second batch");
  h.queries.forEach((query, index) => { query.available = index < 5; query.result = index === 5 ? 2700000 : 1000000; });
  assert.equal(h.profile.poll().captureMs, null, "a batch publishes atomically after its last query completes");
  assert.equal(h.resultReads, 0);
  h.queries[5].available = true;
  const timing = h.profile.poll();
  assert.equal(timing.calibrationMs, 2.7, "empty calibration is measured rather than assumed free");
  frame(820);
  assert.equal(h.queries.length, 12);
  for (const query of h.queries.slice(6)) { query.available = true; query.result = 2000000; }
  h.profile.poll();
  assert.ok(phases.every(phase => timing[`${phase}Samples`] === 2));
  frame(1000);
  frame(1569);
  assert.equal(h.queries.length, 12);
  assert.equal(timing.calibrationMs, 2, "unmeasured frames retain the latest completed timings");
  frame(1570);
  assert.equal(h.queries.length, 18);
  assert.equal(renders, 7 * phases.length, "every frame still renders all work");
  h.profile.measure("beauty", () => {});
  assert.equal(h.queries.length, 18, "each phase is captured at most once in its measurement frame");
  h.profile.dispose();
});
