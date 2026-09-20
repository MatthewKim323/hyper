import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { boardRows, PUBLIC_ROWS, resultsFor } from "./board";
import { EVOLUTION_SOURCE } from "./evolution";
import { shapeLoopTimeline, type LoopTimeline } from "./loop-timeline";

const source = readFileSync(join(import.meta.dir, "../../../..", EVOLUTION_SOURCE), "utf8").replace(/\s+/g, " ");

test("every public headline figure is in the source document", () => {
  for (const bar of PUBLIC_ROWS.flatMap(row => row.bars)) expect(source.includes(bar.text)).toBe(true);
  for (const row of PUBLIC_ROWS) expect(resultsFor(row.match!).length).toBeGreaterThan(0);
});

test("bars are shares of one and ours comes first", () => {
  for (const bar of PUBLIC_ROWS.flatMap(row => row.bars)) { expect(bar.share).toBeGreaterThan(0); expect(bar.share).toBeLessThanOrEqual(1); }
  expect(PUBLIC_ROWS.find(row => row.id === "benchrec")!.bars.map(bar => bar.label)).toEqual(["Found", "Reference"]);
});

test("live rows come from the recorded timeline and lead the board", () => {
  const doc = JSON.parse(readFileSync(join(import.meta.dir, "../../../../backend/benchmarks/timeline.json"), "utf8")) as LoopTimeline;
  const rows = boardRows(shapeLoopTimeline(doc));
  expect(rows.slice(0, 2).map(row => row.id)).toEqual(["loop", "retrieval"]);
  // The question count is read from the recorded run, never typed in.
  const asked = Object.values((doc.series.find(item => item.id === "retrieval")!.points.at(-1) as unknown as { commit: { questions: Record<string, number> } }).commit.questions).reduce((a, b) => a + b, 0);
  expect(rows.find(row => row.id === "retrieval")!.source).toBe(`Meridian · ${asked} questions`);
  expect(rows.find(row => row.id === "retrieval")!.bars[0].share).toBeGreaterThan(rows.find(row => row.id === "retrieval")!.bars[1].share!);
  expect(boardRows(null).map(row => row.id)).toEqual(["invoices", "benchrec", "dabstep", "apex", "suite", "story"]);
});

test("every bar is a share of one and every percentage is a real percentage", () => {
  const view = shapeLoopTimeline(JSON.parse(readFileSync(join(import.meta.dir, "../../../../backend/benchmarks/timeline.json"), "utf8")) as LoopTimeline);
  expect(boardRows(view).some(row => row.id === "retrieval")).toBe(true);
  for (const row of boardRows(view)) for (const bar of row.bars) {
    if (bar.share !== null) { expect(bar.share).toBeGreaterThanOrEqual(0); expect(bar.share).toBeLessThanOrEqual(1); }
    const shown = bar.text.match(/^(\d+(?:\.\d+)?)%$/);
    if (shown) expect(Number(shown[1])).toBeLessThanOrEqual(100);
  }
});
