import { expect, test } from "bun:test";
import { OneEuro } from "./one-euro";

// The controller's tuning. A still hand's landmarks wander by roughly 0.35% of the frame,
// and the pointing box maps half the frame to the full screen width.
const MIN_CUTOFF = 0.25;
const BETA = 0.4;
const NOISE = 0.0035;
const WIDTH = 1512;
const DT = 1 / 30;

/** Deterministic gaussian, so the numbers below are reproducible. */
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    const a = (s >>> 8) / 0xffffff;
    s = (s * 1664525 + 1013904223) >>> 0;
    const b = (s >>> 8) / 0xffffff;
    return Math.sqrt(-2 * Math.log(a || 1e-9)) * Math.cos(2 * Math.PI * b);
  };
}

function restShake(minCutoff: number, beta: number) {
  const rand = noise(7);
  const filter = new OneEuro(minCutoff, beta, 1);
  const out: number[] = [];
  for (let i = 0; i < 600; i++) out.push(filter.filter(0.5 + rand() * NOISE, DT) * WIDTH);
  const tail = out.slice(100);
  const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
  return Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
}

/** Worst-case gap between the hand and the cursor during a fast sweep. */
function flickLag(minCutoff: number, beta: number) {
  const filter = new OneEuro(minCutoff, beta, 1);
  for (let i = 0; i < 40; i++) filter.filter(0.3, DT);
  let worst = 0;
  for (let i = 0; i < 30; i++) {
    const value = 0.3 + Math.min(0.4, 1.6 * i * DT);
    worst = Math.max(worst, Math.abs(value - filter.filter(value, DT)) * WIDTH);
  }
  return worst;
}

test("a still hand holds the cursor within about a pixel", () => {
  // This is the jitter the user actually sees. Guard the budget, not the exact number.
  expect(restShake(MIN_CUTOFF, BETA)).toBeLessThan(1.2);
});

test("the tuning beats a higher cutoff on jitter AND on lag", () => {
  // The previous pair. A low minCutoff with a high beta smooths a still hand harder while
  // opening up sooner when it moves, so neither axis is traded away.
  const wasShake = restShake(0.55, 0.07);
  const wasLag = flickLag(0.55, 0.07);
  expect(restShake(MIN_CUTOFF, BETA)).toBeLessThan(wasShake);
  expect(flickLag(MIN_CUTOFF, BETA)).toBeLessThan(wasLag);
});

test("a fast hand is not smoothed into lag", () => {
  expect(flickLag(MIN_CUTOFF, BETA)).toBeLessThan(260);
});

test("the filter passes the first sample through and survives a zero dt", () => {
  const filter = new OneEuro(MIN_CUTOFF, BETA, 1);
  expect(filter.filter(0.42, DT)).toBe(0.42);
  expect(filter.filter(0.5, 0)).toBe(0.5);
});
