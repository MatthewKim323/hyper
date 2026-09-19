import type { BenchmarksDocument, Metric, Run, SystemManifest } from "./types";

export const REAL_URL = "/benchmarks/benchmarks.json";
export const SAMPLE_URL = "/benchmarks/benchmarks.sample.json";
const MAX_BYTES = 4 * 1024 * 1024;

const LISTS = ["systems", "suites", "capabilities", "runs", "trials", "comparisons", "claims"] as const;

// Structural check only. It cannot authenticate a result file, it just refuses shapes the page cannot render.
export function parseBenchmarks(text: string): BenchmarksDocument {
  if (text.length > MAX_BYTES) throw new Error("benchmarks document is larger than 4 MiB");
  const doc = JSON.parse(text) as Record<string, unknown>;
  if (doc?.schema_version !== 1) throw new Error("unsupported benchmarks schema_version");
  if (!["LIVE", "RECORDED_REPLAY", "DEV_FIXTURE"].includes(doc.display_mode as string)) throw new Error("missing display_mode");
  for (const key of LISTS) if (!Array.isArray(doc[key])) throw new Error(`benchmarks document is missing ${key}`);
  return doc as unknown as BenchmarksDocument;
}

export async function fetchBenchmarks(url: string): Promise<BenchmarksDocument> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return parseBenchmarks(await res.text());
}

export const measured = (m: Metric | undefined): number | null => (m && m.status === "measured" ? m.value : null);

export function formatMetric(m: Metric | undefined): string {
  if (!m || m.status === "unavailable") return "Not measured";
  if (m.unit === "ratio") return `${(m.value * 100).toFixed(1)}%`;
  if (m.unit === "USD") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(m.value);
  if (m.unit === "ms") return `${(m.value / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}s`;
  return `${m.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}${m.unit && m.unit !== "count" ? ` ${m.unit}` : ""}`;
}

// Oracle smoke runs prove the grader works. They are never a subject result.
export function subjectRuns(doc: BenchmarksDocument): Run[] {
  const oracle = new Set(doc.systems.filter((s) => s.kind === "ORACLE_SMOKE").map((s) => s.id));
  return doc.runs.filter((r) => !oracle.has(r.system_id));
}

export function systemOf(doc: BenchmarksDocument, run: Run): SystemManifest | undefined {
  return doc.systems.find((s) => s.id === run.system_id);
}

// Latest completed subject run per (suite, system). Running or cancelled runs never stand in for a result.
export function latestCompleted(doc: BenchmarksDocument, suiteId: string): Run[] {
  const best = new Map<string, Run>();
  for (const run of subjectRuns(doc)) {
    if (run.suite_id !== suiteId || run.execution !== "completed") continue;
    const prev = best.get(run.system_id);
    if (!prev || (run.finished_at ?? "") > (prev.finished_at ?? "")) best.set(run.system_id, run);
  }
  const order = new Map(doc.systems.map((s) => [s.id, s.created_at]));
  return [...best.values()].sort((a, b) => (order.get(a.system_id) ?? "").localeCompare(order.get(b.system_id) ?? ""));
}
