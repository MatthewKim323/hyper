import type {
  ComparisonContext,
  MetricComparison,
  MetricKey,
  MetricValue,
  VersionComparison,
  VersionRun,
  VersionSnapshot,
} from "./types";

const METRICS: Array<{ key: MetricKey; label: string; unit: MetricComparison["unit"] }> = [
  { key: "durationMs", label: "Duration", unit: "ms" },
  { key: "totalTokens", label: "Tokens", unit: "tokens" },
  { key: "costUsd", label: "Cost", unit: "USD" },
];

const CONTEXT_FIELDS: Array<{ key: keyof ComparisonContext; label: string }> = [
  { key: "inputFingerprint", label: "scenario input" },
  { key: "policyFingerprint", label: "policy" },
  { key: "harnessVersion", label: "evaluation harness" },
  { key: "environmentFingerprint", label: "execution environment" },
];

/** Latest terminal recording by start time. Running/cancelled executions are not evaluations. */
export function latestCaseRun(version: VersionSnapshot, caseId: string): VersionRun | null {
  const recorded = version.runs.filter((run) => run.caseId === caseId && (run.status === "COMPLETED" || run.status === "FAILED"));
  return recorded.sort((a, b) => {
    return Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id);
  })[0] ?? null;
}

function unavailable(reason: string): MetricValue {
  return { status: "unavailable", reason };
}

/**
 * Compare actual recordings for one case. A fixture definition alone is never a run.
 * Deltas are candidate minus baseline, without inferring performance or money movement.
 */
export function compareVersions(baseline: VersionSnapshot, candidate: VersionSnapshot, caseId: string): VersionComparison {
  const baselineRun = latestCaseRun(baseline, caseId);
  const candidateRun = latestCaseRun(candidate, caseId);
  const reasons: string[] = [];
  if (baseline.id === candidate.id) reasons.push("Choose two different framework snapshots.");
  if (!baselineRun) reasons.push(`No completed recording for ${caseId} in ${baseline.label}.`);
  if (!candidateRun) reasons.push(`No completed recording for ${caseId} in ${candidate.label}.`);
  if (baselineRun && candidateRun) {
    if (baselineRun.scenarioId !== candidateRun.scenarioId) reasons.push("Scenario definitions differ.");
    if (baselineRun.mode !== candidateRun.mode) reasons.push("Execution modes differ; live, replay, and development fixture runs are not interchangeable.");
    for (const { key, label } of CONTEXT_FIELDS) {
      const first = baselineRun.comparisonContext[key];
      const second = candidateRun.comparisonContext[key];
      if (!first || !second) reasons.push(`Comparable ${label} information is unavailable.`);
      else if (first !== second) reasons.push(`The ${label} differs between recordings.`);
    }
  }
  const comparable = reasons.length === 0;
  const metrics: MetricComparison[] = METRICS.map(({ key, label, unit }) => {
    const first = baselineRun?.metrics[key] ?? unavailable("No completed recording for the baseline snapshot.");
    const second = candidateRun?.metrics[key] ?? unavailable("No completed recording for the candidate snapshot.");
    const result: MetricComparison = { key, label, unit, baseline: first, candidate: second, delta: null, percentChange: null, reason: null };
    if (!comparable) result.reason = reasons.join(" ");
    else if (first.status === "unavailable" || second.status === "unavailable") {
      result.reason = [
        first.status === "unavailable" ? `Baseline: ${first.reason}` : null,
        second.status === "unavailable" ? `Candidate: ${second.reason}` : null,
      ].filter(Boolean).join(" ");
    } else {
      result.delta = second.value - first.value;
      const percentage = first.value === 0 ? null : (result.delta / first.value) * 100;
      result.percentChange = percentage !== null && Number.isFinite(percentage) ? percentage : null;
      if (result.percentChange === null) result.reason = "Percentage change is unavailable because the baseline is zero or too small.";
    }
    return result;
  });
  const baselineChanges = new Set(baseline.framework.changes);
  const candidateChanges = new Set(candidate.framework.changes);
  const configKeys = [...new Set([...Object.keys(baseline.framework.config), ...Object.keys(candidate.framework.config)])].sort();
  return {
    baselineVersionId: baseline.id,
    candidateVersionId: candidate.id,
    caseId,
    baselineRun,
    candidateRun,
    comparable,
    reasons,
    metrics,
    outcomeChanged: comparable && baselineRun && candidateRun
      ? baselineRun.outcome.verdict !== candidateRun.outcome.verdict || baselineRun.outcome.status !== candidateRun.outcome.status
      : null,
    frameworkChanges: {
      added: [...candidateChanges].filter((change) => !baselineChanges.has(change)),
      removed: [...baselineChanges].filter((change) => !candidateChanges.has(change)),
    },
    configChanges: configKeys
      .filter((key) => JSON.stringify(baseline.framework.config[key]) !== JSON.stringify(candidate.framework.config[key]))
      .map((key) => ({ key, baseline: baseline.framework.config[key], candidate: candidate.framework.config[key] })),
  };
}
