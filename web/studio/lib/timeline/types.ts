/** Portable, data-only format. JSON imports never contain executable framework code. */
export const TIMELINE_SCHEMA_VERSION = 1 as const;

export type RunMode = "LIVE" | "RECORDED_REPLAY" | "DEV_FIXTURE";
export type RunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type ConfigValue = string | number | boolean | null | string[];

export interface EvidenceReference {
  id: string;
  label: string;
  kind: "SOURCE" | "TEST_DEFINITION" | "RUN_ARTIFACT" | "TRACE" | "DOCUMENT";
  /** Repository-relative path or HTTPS URL. Never an executable or local file URL. */
  ref: string;
}

export type MetricValue =
  | { status: "available"; value: number; source: string }
  | { status: "unavailable"; reason: string };

export interface RunMetrics {
  durationMs: MetricValue;
  totalTokens: MetricValue;
  costUsd: MetricValue;
}

export interface ComparisonContext {
  /** Null means unknown, which prevents a numeric cross-version comparison. */
  inputFingerprint: string | null;
  policyFingerprint: string | null;
  harnessVersion: string | null;
  environmentFingerprint: string | null;
}

export interface ScenarioDefinition {
  id: string;
  caseId: string;
  title: string;
  summary: string;
  mode: RunMode;
  sourceRefs: EvidenceReference[];
}

export interface RunStep {
  id: string;
  ordinal: number;
  title: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  detail: string;
  evidenceIds: string[];
}

export interface VersionRun {
  id: string;
  versionId: string;
  caseId: string;
  scenarioId: string;
  mode: RunMode;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  comparisonContext: ComparisonContext;
  outcome: {
    verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
    status: string;
    summary: string;
    evidenceIds: string[];
  };
  steps: RunStep[];
  evidence: EvidenceReference[];
  metrics: RunMetrics;
  /** A real recording/export backing this run, not the scenario's source definition. */
  provenance: EvidenceReference;
}

export interface VersionSnapshot {
  id: string;
  label: string;
  title: string;
  /** Commit time for source snapshots; ISO 8601 with timezone. */
  createdAt: string;
  commit: string;
  summary: string;
  framework: {
    name: string;
    version: string;
    changes: string[];
    config: Record<string, ConfigValue>;
    sourceRefs: EvidenceReference[];
  };
  /** Known case definitions are not run results or benchmark claims. */
  scenarios: ScenarioDefinition[];
  runs: VersionRun[];
}

export interface TimelineDocument {
  schemaVersion: typeof TIMELINE_SCHEMA_VERSION;
  versions: VersionSnapshot[];
}

export type MetricKey = keyof RunMetrics;

export interface MetricComparison {
  key: MetricKey;
  label: string;
  unit: "ms" | "tokens" | "USD";
  baseline: MetricValue;
  candidate: MetricValue;
  /** Candidate minus baseline. Null means unavailable, never zero by default. */
  delta: number | null;
  percentChange: number | null;
  reason: string | null;
}

export interface VersionComparison {
  baselineVersionId: string;
  candidateVersionId: string;
  caseId: string;
  baselineRun: VersionRun | null;
  candidateRun: VersionRun | null;
  comparable: boolean;
  reasons: string[];
  metrics: MetricComparison[];
  outcomeChanged: boolean | null;
  frameworkChanges: { added: string[]; removed: string[] };
  configChanges: Array<{ key: string; baseline: ConfigValue | undefined; candidate: ConfigValue | undefined }>;
}
