import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIN_CASES_FOR_RATE, outcome, shapeLoopTimeline, type ArmTotals, type LoopTimeline } from "./loop-timeline";

const sample: LoopTimeline = JSON.parse(readFileSync(join(import.meta.dir, "../../../../backend/benchmarks/timeline.json"), "utf8"));
const arm = (n: number, correct: number): ArmTotals => ({ n, correct, accuracy: n ? correct / n : null, wrong_releases: 0, timeouts: 0, median_seconds_released: null, requests_per_case: null, sessions_per_case: null, median_usd_per_case: null, costed_cases: 0 });

test("a rate is never shown for fewer than twenty cases", () => {
  expect(outcome(arm(5, 5))).toBe("5/5");
  expect(outcome(arm(MIN_CASES_FOR_RATE - 1, 19))).toBe("19/19");
  expect(outcome(arm(40, 30))).toBe("75%");
  expect(outcome({ ...arm(40, 30), accuracy: null })).toBe("30/40");
  expect(outcome(undefined)).toBe("0");
});

test("the committed sample shapes into a view without inventing figures", () => {
  const view = shapeLoopTimeline(sample)!;
  expect(view).not.toBeNull();
  const hard = sample.series.find(s => s.id === "memory_effect_hard_tier" && s.subject === view.subject);
  const last = hard?.points[hard.points.length - 1] as { pairs: number; with_memory: ArmTotals } | undefined;
  if (last) {
    expect(view.pairs).toBe(last.pairs);
    expect(view.hardTier.with).toBe(outcome(last.with_memory));
    if (last.with_memory.n < MIN_CASES_FOR_RATE) expect(view.hardTier.with.includes("%")).toBe(false);
  }
  for (const point of view.speed) { expect(point.date instanceof Date).toBe(true); expect(Number.isFinite(point.with) && Number.isFinite(point.without)).toBe(true); }
});

test("invalid sandbox points are dropped and an empty document shows nothing", () => {
  const doc: LoopTimeline = { ...sample, series: sample.series.map(s => s.id === "exceptions" ? { ...s, points: s.points.map(p => ({ ...p, valid: false })) } : s) };
  expect(shapeLoopTimeline(doc)!.speed).toEqual([]);
  expect(shapeLoopTimeline({ ...sample, series: [] })).toBeNull();
});
