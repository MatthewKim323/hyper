import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BENCHMARK_EVOLUTION, EVOLUTION_SOURCE, EVOLUTION_STANDING } from "./evolution";

// The page may only show figures that are in the source document. If someone edits a number in one
// place and not the other, this fails.
const source = readFileSync(join(import.meta.dir, "../../../..", EVOLUTION_SOURCE), "utf8").replace(/\s+/g, " ");
const figures = (text: string) => text.match(/\d+(?:\.\d+)?%|\d+\/\d+|\$\d+(?:\.\d+)?|\b0\.\d{3}\b/g) ?? [];

test("every figure shown in the timeline appears in the source document", () => {
  const shown = BENCHMARK_EVOLUTION.flatMap(phase => [...(phase.results ?? []).map(r => r.result), ...(phase.notes ?? []), phase.verdict ?? "", phase.summary]).flatMap(figures);
  expect(shown.length).toBeGreaterThan(20);
  for (const figure of shown) expect(source.includes(figure)).toBe(true);
  for (const figure of EVOLUTION_STANDING.flatMap(row => figures(row.status))) expect(source.includes(figure)).toBe(true);
});

test("phases are ordered and the negative result is kept", () => {
  expect(BENCHMARK_EVOLUTION.map(phase => phase.phase)).toEqual([1, 2, 3, 4, 5]);
  expect(BENCHMARK_EVOLUTION.find(phase => phase.id === "prompting")?.state).toBe("negative");
  expect(EVOLUTION_STANDING.some(row => row.state === "unsupported")).toBe(true);
});
