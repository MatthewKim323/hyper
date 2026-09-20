"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { fetchBenchmarks, REAL_URL } from "@/lib/benchmarks/load";
import type { BenchmarksDocument, Metric, Run } from "@/lib/benchmarks/types";
import {
  artifactHref, formatLandscapeMetric, LANDSCAPE_METRICS, landscapeColumns, landscapeComparison, landscapeMetric, landscapePage, landscapeValues,
  realLandscapeRuns, suiteAvailability, type LandscapeColumn, type LandscapeMetric,
} from "./benchmark-landscape";
import styles from "./BenchmarkLandscape.module.css";

export type BenchmarkLandscapeMotion = { busy?: boolean; selectedIndex?: number; values?: readonly (number | null)[] };
type Props = { active: boolean; onMotion?: (state: BenchmarkLandscapeMotion) => void };

function dateLabel(date?: string | null) {
  if (!date) return "Date not recorded";
  const value = new Date(date);
  return Number.isFinite(value.valueOf()) ? value.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Date not recorded";
}

function Measurement({ metric }: { metric: Metric }) {
  return <><strong className={styles.figure}>{metric.status === "measured" ? formatLandscapeMetric(metric) : <span className={styles.unmeasured}>Not measured</span>}</strong>
    {metric.status === "measured" ? <span className={styles.measureNote}>{metric.n != null ? `${metric.n} observations` : "Sample count not recorded"}
      {metric.ci_low != null && metric.ci_high != null && Number.isFinite(metric.ci_low) && Number.isFinite(metric.ci_high)
        ? ` · ${formatLandscapeMetric({ ...metric, value: metric.ci_low })} to ${formatLandscapeMetric({ ...metric, value: metric.ci_high })}${metric.ci_method ? ` (${metric.ci_method})` : ""}` : ""}</span>
      : <span className={styles.measureNote}>{metric.reason}</span>}</>;
}

function Reference({ reference }: { reference?: string | null }) {
  if (!reference) return <span className={styles.muted}>No artifact reference recorded.</span>;
  const href = artifactHref(reference);
  return href ? <a href={href} target="_blank" rel="noreferrer">Open evidence ↗</a> : <code className={styles.reference}>{reference}</code>;
}

function VersionFigure({ label, columns, selected, run, metric, onChange, allowEmpty = false }: {
  label: string; columns: LandscapeColumn[]; selected: string; run?: Run; metric: LandscapeMetric;
  onChange: (value: string) => void; allowEmpty?: boolean;
}) {
  return <div className={styles.versionFigure}>
    <label><span className={styles.eyebrow}>{label}</span><select aria-label={`${label} framework version`} value={selected} onChange={(event) => onChange(event.target.value)}>
      {allowEmpty && <option value="">Choose a baseline</option>}
      {columns.map((column) => <option value={column.id} key={column.id}>{column.label}</option>)}
    </select></label>
    <Measurement metric={landscapeMetric(run, metric)} />
    <span className={styles.runStamp}>{run ? `${run.execution} · ${dateLabel(run.finished_at ?? run.started_at)}` : "Awaiting evaluation"}</span>
  </div>;
}

export default function BenchmarkLandscape({ active, onMotion }: Props) {
  const id = useId();
  const [doc, setDoc] = useState<BenchmarksDocument | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [suiteId, setSuiteId] = useState("");
  const [metric, setMetric] = useState<LandscapeMetric>("success");
  const [baselineId, setBaselineId] = useState("__auto");
  const [candidateId, setCandidateId] = useState("");
  const [runId, setRunId] = useState("");
  const [trialId, setTrialId] = useState("");
  const [versionPage, setVersionPage] = useState<number | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = () => fetchBenchmarks(REAL_URL).then((next) => {
      if (cancelled) return;
      if (next.display_mode === "DEV_FIXTURE") throw new Error("The published export contains development fixtures. Real results are required here.");
      setDoc(next); setError(""); setLoading(false);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : "Could not load benchmark results."); setLoading(false);
    });
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active, revision]);

  const view = useMemo(() => {
    if (!doc) return null;
    const realRuns = realLandscapeRuns(doc);
    const suite = doc.suites.find((item) => item.id === suiteId)
      ?? doc.suites.find((item) => item.id === "ap_workflow") ?? doc.suites[0];
    const columns = landscapeColumns(doc, suite?.id ?? "");
    const candidate = columns.find((item) => item.id === candidateId) ?? columns.at(-1);
    const baseline = baselineId === "" ? undefined : columns.find((item) => item.id === baselineId) ?? (columns.length > 1 ? columns.find((item) => item.id !== candidate?.id) : undefined);
    const runs = realRuns.filter((run) => run.suite_id === suite?.id).sort((a, b) => (b.finished_at ?? b.started_at ?? "").localeCompare(a.finished_at ?? a.started_at ?? ""));
    const selectedRun = runs.find((run) => run.id === runId && run.system_id === candidate?.id) ?? candidate?.run ?? candidate?.latestAttempt;
    const candidateColumns = columns.map((column) => column.id === candidate?.id ? { ...column, run: selectedRun } : column);
    const baselineRun = baseline?.run ?? baseline?.latestAttempt;
    return {
      realRuns, suite, columns: candidateColumns, candidate, baseline, baselineRun, selectedRun, runs,
      trials: doc.trials.filter((trial) => trial.run_id === selectedRun?.id),
      page: landscapePage(candidateColumns, landscapeValues(candidateColumns, metric), candidate?.id, versionPage),
      comparison: landscapeComparison(doc, baselineRun, selectedRun),
      omitted: doc.runs.length - realRuns.length,
    };
  }, [doc, suiteId, candidateId, baselineId, runId, metric, versionPage]);

  const valuesKey = JSON.stringify(view?.page.values ?? []);
  const selectedIndex = view?.page.selectedIndex ?? -1;
  const busy = active && !!view?.runs.some((run) => run.execution === "running");
  useEffect(() => {
    if (active) onMotion?.({ busy, selectedIndex, values: JSON.parse(valuesKey) as (number | null)[] });
  }, [active, busy, selectedIndex, valuesKey, onMotion]);

  const definition = LANDSCAPE_METRICS.find((item) => item.id === metric)!;
  const selectedTrial = view?.trials.find((trial) => trial.id === trialId) ?? view?.trials[0];
  const available = suiteAvailability(view?.suite);
  const copyCommand = async () => {
    const command = view?.selectedRun?.reproduce;
    if (!command) return;
    try { await navigator.clipboard.writeText(command); setCopied("Command copied."); }
    catch { setCopied("Could not copy. Select the command below to copy it."); }
  };

  return <section className={styles.landscape} aria-label="Framework performance landscape" aria-busy={loading}>
    <div className={styles.toolbar}>
      <label className={styles.suiteSelect}><span className={styles.eyebrow}>Evaluation suite</span>
        <select aria-label="Evaluation suite" value={view?.suite?.id ?? ""} disabled={!doc?.suites.length} onChange={(event) => { setSuiteId(event.target.value); setVersionPage(null); setRunId(""); setTrialId(""); setCopied(""); }}>
          {!doc?.suites.length && <option value="">{loading ? "Loading evaluations" : "No suites registered"}</option>}
          {doc?.suites.map((suite) => <option key={suite.id} value={suite.id}>{suite.name}{suite.access !== "available" ? ` · ${suite.access}` : ""}</option>)}
        </select>
      </label>
      <div className={styles.metrics} role="group" aria-label="Performance metric">{LANDSCAPE_METRICS.map((item) => <button key={item.id} type="button" aria-pressed={metric === item.id} onClick={() => setMetric(item.id)}>{item.label}</button>)}</div>
      <button className={styles.refresh} type="button" aria-label="Refresh benchmark results" disabled={loading} onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>↻</button>
    </div>
    {error && <p className={styles.notice} role="alert">{error}{doc ? " Showing the last loaded export." : ""}</p>}
    {loading && !doc && <p className={styles.empty} role="status">Reading your evaluation history…</p>}
    {view && <>
      <div className={styles.axisNote}><span>{definition.direction}</span><span>{metric === "success" ? "Absolute success rate" : "Run-level measurement · same suite"}</span></div>
      {available && <p className={styles.notice}><span className={styles.eyebrow}>{view.suite?.access ?? "Unavailable"}</span>{available}</p>}
      {view.columns.length ? <>
        <div className={styles.comparison}>
          <VersionFigure label="Baseline" columns={view.columns} selected={view.baseline?.id ?? ""} run={view.baselineRun} metric={metric} allowEmpty onChange={setBaselineId} />
          <span className={styles.compareMark} aria-hidden="true">↗</span>
          <VersionFigure label="Candidate" columns={view.columns} selected={view.candidate?.id ?? ""} run={view.selectedRun} metric={metric} onChange={(value) => { setCandidateId(value); setVersionPage(null); setRunId(""); setTrialId(""); setCopied(""); }} />
        </div>
        <div className={styles.versionStrip} role="group" aria-label="Framework versions">{view.page.columns.map((column, index) => <button type="button" key={column.id} aria-pressed={column.id === view.candidate?.id} onClick={() => { setCandidateId(column.id); setRunId(""); setTrialId(""); setCopied(""); }}>
          <span className={styles.versionOrdinal}>{String(view.page.start + index + 1).padStart(2, "0")}</span><span>{column.label}</span><small>{formatLandscapeMetric(landscapeMetric(column.run, metric))}</small>
          <span className={styles.miniTrack} aria-hidden="true"><span style={{ width: `${(view.page.values[index] ?? 0) * 100}%` }} /></span>
        </button>)}</div>
        {view.page.pageCount > 1 && <nav className={styles.pagination} aria-label="Framework version pages">
          <button type="button" disabled={view.page.page === 0} onClick={() => setVersionPage(view.page.page - 1)}>← Older versions</button>
          <span>{view.page.start + 1} to {view.page.end} of {view.columns.length}</span>
          <button type="button" disabled={view.page.page === view.page.pageCount - 1} onClick={() => setVersionPage(view.page.page + 1)}>Newer versions →</button>
        </nav>}
        {view.page.selectedIndex < 0 && view.candidate && <p className={styles.offPage}>The selected candidate is on another page. <button type="button" onClick={() => setVersionPage(null)}>Show {view.candidate.label}</button></p>}
        <div className={styles.comparability}>
          <span className={styles.eyebrow}>{view.comparison.comparable ? "Matched evaluation" : "Comparison context"}</span>
          {view.comparison.comparable ? <p>These runs have a recorded matched comparison.{view.comparison.record?.changed.length ? ` Changed: ${view.comparison.record.changed.join(", ")}.` : ""}</p>
            : view.comparison.reasons.map((reason) => <p key={reason}>{reason}</p>)}
          {view.comparison.comparable && !!view.comparison.record?.tasks.length && <div className={styles.changeCounts}>{(["gained", "regressed", "both_pass", "both_fail", "unavailable"] as const).map((bucket) => <span key={bucket}><strong>{view.comparison.record!.tasks.filter((task) => task.bucket === bucket).length}</strong>{bucket.replaceAll("_", " ")}</span>)}</div>}
        </div>
      </> : <div className={styles.empty}>
        <h3>Your first measured version starts here.</h3>
        <p>No subject framework versions have been exported yet. Completed evaluations will form the columns above, with the measurements and evidence behind each one.</p>
        {!!view.omitted && <small>{view.omitted} grader self-check or development run{view.omitted === 1 ? " is" : "s are"} excluded.</small>}
      </div>}
      {!!view.runs.length && <section className={styles.runSection} aria-labelledby={`${id}-runs`}>
        <div className={styles.sectionHeading}><h3 id={`${id}-runs`}>Recorded runs</h3><span>{view.runs.length} in this suite</span></div>
        <div className={styles.runStrip} role="group" aria-label="Select a recorded run">{view.runs.map((run) => <button type="button" key={run.id} aria-pressed={run.id === view.selectedRun?.id} onClick={() => { setCandidateId(run.system_id); setVersionPage(null); setRunId(run.id); setTrialId(""); setCopied(""); }}>
          <span className={styles.runStatus} data-state={run.execution}>{run.execution}</span>
          <strong>{doc?.systems.find((system) => system.id === run.system_id)?.label ?? run.system_id}</strong>
          <span>{dateLabel(run.finished_at ?? run.started_at)}</span><small>{run.mode.replaceAll("_", " ")} · {run.n_tasks} tasks</small>
        </button>)}</div>
      </section>}
      {view.selectedRun && <details className={styles.evidence}>
        <summary>Run evidence <span>{view.trials.length} trial{view.trials.length === 1 ? "" : "s"} <span aria-hidden="true">↗</span></span></summary>
        <div className={styles.evidenceBody}>
          <dl className={styles.provenance}><div><dt>Run</dt><dd>{view.selectedRun.id}</dd></div><div><dt>Framework commit</dt><dd>{view.candidate?.system?.git_commit || "Not recorded"}</dd></div><div><dt>Mode</dt><dd>{view.selectedRun.mode.replaceAll("_", " ")}</dd></div><div><dt>Trials per task</dt><dd>{view.selectedRun.trials_per_task}</dd></div></dl>
          {!!view.selectedRun.incidents?.length && <div className={styles.notice}><span className={styles.eyebrow}>Recorded incidents</span>{view.selectedRun.incidents.map((incident) => <p key={incident}>{incident}</p>)}</div>}
          <div className={styles.artifact}><span className={styles.eyebrow}>Run artifact</span><Reference reference={view.selectedRun.artifact_ref} /></div>
          {view.selectedRun.reproduce && <div className={styles.reproduce}><div><span className={styles.eyebrow}>Reproduce this run</span><button type="button" onClick={() => void copyCommand()}>Copy command</button></div><code>{view.selectedRun.reproduce}</code><span role="status">{copied}</span></div>}
          {selectedTrial ? <div className={styles.trialGrid}>
            <div className={styles.trialList} role="group" aria-label="Select trial evidence">{view.trials.map((trial) => <button key={trial.id} type="button" aria-pressed={selectedTrial.id === trial.id} onClick={() => setTrialId(trial.id)}><span>{trial.task_id}</span><small>Trial {trial.trial_index} · {trial.outcome.replaceAll("_", " ")}</small></button>)}</div>
            <section className={styles.trialDetail} aria-label={`Evidence for ${selectedTrial.task_id}`}>
              <span className={styles.eyebrow}>{selectedTrial.execution}</span><h4>{selectedTrial.task_id}</h4><p className={styles.outcome}>{selectedTrial.outcome.replaceAll("_", " ")}</p>
              <dl><div><dt>Evidence checks</dt><dd>{selectedTrial.evidence_checks_passed != null && selectedTrial.evidence_checks_total != null ? `${selectedTrial.evidence_checks_passed} / ${selectedTrial.evidence_checks_total}` : "Not recorded"}</dd></div><div><dt>Duration</dt><dd>{selectedTrial.wall_ms != null && Number.isFinite(selectedTrial.wall_ms) && selectedTrial.wall_ms >= 0 ? formatLandscapeMetric({ status: "measured", value: selectedTrial.wall_ms, unit: "ms" }) : "Not recorded"}</dd></div></dl>
              {!!selectedTrial.control_failures.length && <p>Control failures: {selectedTrial.control_failures.join(", ")}</p>}
              {!!selectedTrial.assistance.length && <p>Assistance: {selectedTrial.assistance.join(", ")}</p>}
              {selectedTrial.error_class && <p>Error: {selectedTrial.error_class}</p>}
              <Reference reference={selectedTrial.artifact_ref} />
            </section>
          </div> : <p className={styles.muted}>No trial evidence was included in this export.</p>}
        </div>
      </details>}
      <footer className={styles.footer}><span>{view.suite?.provenance.replaceAll("_", " ")}{view.suite?.revision ? ` · ${view.suite.revision}` : ""}</span><span>Exported {dateLabel(doc?.generated_at)}</span></footer>
    </>}
  </section>;
}
