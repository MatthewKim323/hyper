import type { BenchmarksDocument, Comparison, Metric, Run, Suite, SystemManifest } from "@/lib/benchmarks/types";

export type LandscapeMetric = "success" | "latency" | "cost";
export const LANDSCAPE_METRICS: { id: LandscapeMetric; label: string; field: "whole_task_success" | "wall_ms" | "cost_usd"; unit: string; direction: string }[] = [
  { id: "success", label: "Success", field: "whole_task_success", unit: "ratio", direction: "Higher is better" },
  { id: "latency", label: "Latency", field: "wall_ms", unit: "ms", direction: "Lower is better" },
  { id: "cost", label: "Cost", field: "cost_usd", unit: "USD", direction: "Lower is better" },
];
export type LandscapeColumn = { id: string; label: string; system?: SystemManifest; run?: Run; latestAttempt?: Run };

const timestamp = (run?: Run) => run?.finished_at ?? run?.started_at ?? "";
const latest = (runs: Run[]) => [...runs].sort((a, b) => timestamp(b).localeCompare(timestamp(a)) || b.id.localeCompare(a.id))[0];

export function realLandscapeRuns(doc: BenchmarksDocument): Run[] {
  if (doc.display_mode === "DEV_FIXTURE") return [];
  const oracles = new Set(doc.systems.filter((system) => system.kind === "ORACLE_SMOKE").map((system) => system.id));
  return doc.runs.filter((run) => run.mode !== "DEV_FIXTURE" && !oracles.has(run.system_id));
}

export function landscapeColumns(doc: BenchmarksDocument, suiteId: string): LandscapeColumn[] {
  if (doc.display_mode === "DEV_FIXTURE") return [];
  const runs = realLandscapeRuns(doc).filter((run) => run.suite_id === suiteId);
  const systems = doc.systems.filter((system) => system.kind !== "ORACLE_SMOKE");
  const ids = [...new Set([...systems.map((system) => system.id), ...runs.map((run) => run.system_id)])];
  return ids.map((id) => {
    const system = systems.find((item) => item.id === id);
    const ownRuns = runs.filter((run) => run.system_id === id);
    return { id, label: system?.label ?? id, system, run: latest(ownRuns.filter((run) => run.execution === "completed")), latestAttempt: latest(ownRuns) };
  }).sort((a, b) => (a.system?.created_at ?? timestamp(a.run ?? a.latestAttempt)).localeCompare(b.system?.created_at ?? timestamp(b.run ?? b.latestAttempt)) || a.id.localeCompare(b.id));
}

export function landscapeMetric(run: Run | undefined, metric: LandscapeMetric): Metric {
  if (!run) return { status: "unavailable", reason: "No completed run recorded for this version and suite." };
  if (run.execution !== "completed") return { status: "unavailable", reason: `This run is ${run.execution}. Its measurements are not a completed result.` };
  const definition = LANDSCAPE_METRICS.find((item) => item.id === metric)!;
  const value = run[definition.field];
  if (!value || value.status !== "measured") return value ?? { status: "unavailable", reason: "This measurement was not recorded." };
  if (!Number.isFinite(value.value) || value.value < 0 || value.unit !== definition.unit || (metric === "success" && value.value > 1)) {
    return { status: "unavailable", reason: "The recorded value or unit is not valid for this metric." };
  }
  return value;
}

// Success has an absolute 0 to 1 axis. Time and cost share the largest measured value
// in this suite; missing values remain null and never turn into an invented zero.
export function landscapeValues(columns: LandscapeColumn[], metric: LandscapeMetric): (number | null)[] {
  const values = columns.map((column) => landscapeMetric(column.run, metric)).map((value) => value.status === "measured" ? value.value : null);
  const max = metric === "success" ? 1 : Math.max(0, ...values.filter((value): value is number => value !== null));
  return values.map((value) => value === null ? null : max === 0 ? 0 : value / max);
}

export type LandscapeComparison = { comparable: boolean; reasons: string[]; record?: Comparison };
export function landscapeComparison(doc: BenchmarksDocument, baseline?: Run, candidate?: Run): LandscapeComparison {
  if (!baseline || !candidate) return { comparable: false, reasons: ["Choose two versions with completed runs to compare."] };
  if (baseline.id === candidate.id) return { comparable: false, reasons: ["Choose two different runs."] };
  const reasons: string[] = [];
  if (baseline.execution !== "completed" || candidate.execution !== "completed") reasons.push("Both runs must be completed.");
  if (baseline.mode === "DEV_FIXTURE" || candidate.mode === "DEV_FIXTURE") reasons.push("Development fixtures are not framework results.");
  if (baseline.suite_id !== candidate.suite_id) reasons.push("These runs used different suites.");
  if (baseline.mode !== candidate.mode) reasons.push("These runs used different execution modes.");
  if (baseline.n_tasks !== candidate.n_tasks || baseline.trials_per_task !== candidate.trials_per_task) reasons.push("The task or trial counts differ.");
  const record = doc.comparisons.find((comparison) => comparison.baseline_run_id === baseline.id && comparison.candidate_run_id === candidate.id);
  if (!record) reasons.push("No matched comparison has been exported for these runs. Values are shown individually.");
  else if (!record.comparable) reasons.push(...(record.reasons.length ? record.reasons : ["The evaluator marked these runs as not comparable."]));
  return { comparable: reasons.length === 0, reasons, record };
}

export function suiteAvailability(suite?: Suite): string | null {
  if (!suite) return "No evaluation suite has been registered.";
  if (suite.access === "available") return null;
  return suite.access_note || `This suite is ${suite.access}.`;
}

export function artifactHref(reference: string): string | null {
  if (reference.startsWith("/") && !reference.startsWith("//") && !reference.includes("\\")) return reference;
  try {
    const url = new URL(reference);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function formatLandscapeMetric(metric: Metric): string {
  if (metric.status !== "measured") return "Not measured";
  const value = metric.value;
  if (metric.unit === "ratio") return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  if (metric.unit === "USD") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < .01 ? 6 : 2 }).format(value);
  if (metric.unit === "ms") return value < 1000
    ? `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}ms`
    : `${(value / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })}s`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${metric.unit}`.trim();
}

export const LANDSCAPE_PAGE_SIZE = 7;

/** The UI strip and the seven physical cube slots always use the same window. */
export function landscapePage(columns: LandscapeColumn[], values: readonly (number | null)[], candidateId: string | undefined, requestedPage: number | null) {
  const candidateIndex = columns.findIndex(column => column.id === candidateId);
  const pageCount = Math.max(1, Math.ceil(columns.length / LANDSCAPE_PAGE_SIZE));
  const requested = requestedPage === null ? Math.floor(Math.max(0, candidateIndex) / LANDSCAPE_PAGE_SIZE) : requestedPage;
  const page = Math.max(0, Math.min(pageCount - 1, Number.isFinite(requested) ? Math.trunc(requested) : 0));
  const start = page * LANDSCAPE_PAGE_SIZE;
  const end = Math.min(columns.length, start + LANDSCAPE_PAGE_SIZE);
  return {
    page, pageCount, start, end,
    columns: columns.slice(start, end),
    values: values.slice(start, end),
    selectedIndex: candidateIndex >= start && candidateIndex < end ? candidateIndex - start : -1,
  };
}
