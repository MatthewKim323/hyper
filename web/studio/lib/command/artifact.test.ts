import { expect, test } from "bun:test";
import { formatValue, periodDate, readArtifactCard } from "./artifact";

const ready = {
  id: "art_1", status: "ready", evaluation: { elapsed_ms: 140 },
  spec: {
    root: "card",
    elements: { card: { type: "FinancialArtifactCard", props: { title: "ap_invoices: sum(amount) by month", chart: "bar", currency: "USD", unit: "major_currency", points: { $state: "/points" }, notes: { $state: "/notes" } }, children: [] } },
    state: { points: [{ period: "2026-01", value: "1200.50", kind: "actual" }, { period: "2026-02", value: "900", kind: "actual" }], notes: "Source IDs: src_a" },
  },
};

test("reads a ready chart card from spec.state", () => {
  const card = readArtifactCard(ready)!;
  expect(card.chart).toBe("bar");
  expect(card.points.map((p) => p.value)).toEqual(["1200.50", "900"]);
  expect(card.notes).toBe("Source IDs: src_a");
  expect(card.elapsedMs).toBe(140);
});

test("refuses anything that is not a ready, well-formed card", () => {
  expect(readArtifactCard({ ...ready, status: "composing" })).toBeNull();
  expect(readArtifactCard({ ...ready, spec: { ...ready.spec, state: { points: [{ period: "x", value: "12abc", kind: "actual" }] } } })).toBeNull();
  expect(readArtifactCard({ error: "Exact numeric aggregates require Postgres" })).toBeNull();
  expect(readArtifactCard(null)).toBeNull();
});

test("period and value helpers", () => {
  expect(periodDate("2026-03")?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  expect(periodDate("Q1")).toBeNull();
  expect(formatValue("1200.5", { currency: "USD", unit: "major_currency" })).toBe("$1,200.50");
  expect(formatValue("42", { currency: "", unit: "number" })).toBe("42");
});
