"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { compareVersions, latestCaseRun } from "@/lib/timeline/compare";
import { createInitialTimeline, exportTimelineJson, importTimelineJson, mergeTimeline, TIMELINE_LIMITS } from "@/lib/timeline/registry";
import type { EvidenceReference, MetricComparison, MetricValue, TimelineDocument, VersionRun, VersionSnapshot } from "@/lib/timeline/types";
import { LearnedSkills } from "@/components/workspace/skills";
import styles from "./TrainingTimeline.module.css";

type Props = { active: boolean; onMotion?: (state: { busy?: boolean; selectedIndex?: number; values?: readonly (number | null)[] }) => void };
const STORAGE_KEY = "hyper.framework-timeline.v1";
const REPOSITORY = "https://github.com/MatthewKim323/hyper.";
const TRAINING_CUBE_SLOTS = 7;
const words = (value: string) => value.replaceAll("_", " ");
const dateLabel = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function measurement(value: MetricValue, unit: MetricComparison["unit"]) {
  if (value.status === "unavailable") return "Not recorded";
  if (unit === "USD") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value.value);
  if (unit === "ms") return `${(value.value / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })}s`;
  return value.value.toLocaleString("en-US");
}

function difference(row: MetricComparison) {
  if (row.delta === null) return "Unavailable";
  const value = row.unit === "ms" ? `${(row.delta / 1000).toFixed(2)}s` : `${row.unit === "USD" ? "$" : ""}${row.delta.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  return `${row.delta > 0 ? "+" : ""}${value}${row.percentChange === null ? "" : ` (${row.percentChange > 0 ? "+" : ""}${row.percentChange.toFixed(1)}%)`}`;
}

function References({ items }: { items: EvidenceReference[] }) {
  return <ul className={styles.references}>{items.map((item, index) => <li key={`${item.id}:${index}`}><span>{item.label}</span><code>{item.ref}</code></li>)}</ul>;
}

function RunDetail({ version, run }: { version: VersionSnapshot; run: VersionRun | null }) {
  return <article className={styles.run}>
    <span className={styles.eyebrow}>{version.label} / {run ? words(run.mode) : "Recorded run"}</span>
    <h3>{run ? run.outcome.status : "No completed recording"}</h3>
    {run && <p className={styles.note}>{run.outcome.summary}</p>}
    {run && <>
      <div className={styles.runStamp}><span>{words(run.status)} · {words(run.outcome.verdict)}</span><time dateTime={run.startedAt}>{dateLabel(run.startedAt)}</time></div>
      <dl className={styles.measurements}>{([
        ["Duration", run.metrics.durationMs, "ms"], ["Tokens", run.metrics.totalTokens, "tokens"], ["Cost", run.metrics.costUsd, "USD"],
      ] as const).map(([label, metric, unit]) => <div key={label}><dt>{label}</dt><dd>{measurement(metric, unit)}</dd><small>{metric.status === "available" ? metric.source : metric.reason}</small></div>)}</dl>
      {run.steps.length > 0 ? <ol className={styles.steps}>{run.steps.map(step => <li key={step.id}><span>{String(step.ordinal).padStart(2, "0")}</span><div><strong>{step.title}</strong><small>{words(step.status)}</small><p>{step.detail}</p>{step.evidenceIds.length > 0 && <small>Evidence: {step.evidenceIds.join(", ")}</small>}</div></li>)}</ol> : <p className={styles.note}>No steps</p>}
      <details className={styles.details}><summary>Evidence and recording</summary><References items={[run.provenance, ...run.evidence]} /></details>
    </>}
  </article>;
}

export default function TrainingTimeline({ active, onMotion }: Props) {
  const [timeline, setTimeline] = useState<TimelineDocument>(createInitialTimeline);
  const timelineRef = useRef(timeline);
  const restored = useRef(false);
  const persistenceReady = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [selectedCase, setSelectedCase] = useState("");
  const [selectedRun, setSelectedRun] = useState("");
  const [view, setView] = useState<"snapshot" | "compare">("snapshot");

  const updateTimeline = useCallback((next: TimelineDocument) => {
    timelineRef.current = next;
    setTimeline(next);
    if (!persistenceReady.current) return;
    try { localStorage.setItem(STORAGE_KEY, exportTimelineJson(next)); }
    catch { setError("Could not save the timeline."); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    async function load() {
      if (!restored.current) {
        restored.current = true;
        try {
          const saved = localStorage.getItem(STORAGE_KEY);
          const next = saved ? mergeTimeline(createInitialTimeline(), importTimelineJson(saved)) : timelineRef.current;
          persistenceReady.current = true;
          updateTimeline(next);
        } catch {
          setError("Saved timeline could not be read.");
        }
      }
      try {
        const response = await fetch("/api/timeline", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Repository refresh unavailable.");
        const incoming = importTimelineJson(await response.text());
        if (controller.signal.aborted) return;
        const count = incoming.versions.filter(version => !timelineRef.current.versions.some(known => known.id === version.id)).length;
        updateTimeline(mergeTimeline(timelineRef.current, incoming));
        setMessage(response.headers.get("X-Timeline-Notice") ?? (revision ? count ? `${count} new source snapshot${count === 1 ? "" : "s"} added.` : "Up to date" : ""));
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load source history.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [active, revision, updateTimeline]);

  const versions = useMemo(() => [...timeline.versions].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), [timeline]);
  const selected = versions.find(version => version.id === selectedId) ?? versions.at(-1);
  const baseline = versions.find(version => version.id === baselineId && version.id !== selected?.id) ?? versions.find(version => version.id !== selected?.id);
  const caseVersions = view === "compare" ? [selected, baseline] : [selected];
  const caseIds = Array.from(new Set(caseVersions.flatMap(version => version ? [...version.scenarios.map(item => item.caseId), ...version.runs.map(item => item.caseId)] : [])));
  const caseId = caseIds.includes(selectedCase) ? selectedCase : caseIds[0] ?? "";
  const caseRuns = selected?.runs.filter(run => run.caseId === caseId).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)) ?? [];
  const recorded = caseRuns.find(run => run.id === selectedRun) ?? (selected ? latestCaseRun(selected, caseId) : null) ?? caseRuns[0] ?? null;
  const comparison = selected && baseline ? compareVersions(baseline, selected, caseId) : null;
  const busy = active && !!selected?.runs.some(run => run.status === "RUNNING");
  const snapshotIndex = versions.findIndex(version => version.id === selected?.id);
  const selectedIndex = snapshotIndex < 0 ? -1 : snapshotIndex % TRAINING_CUBE_SLOTS;
  useEffect(() => { if (active) onMotion?.({ busy, selectedIndex }); }, [active, busy, selectedIndex, onMotion]);

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true); setError(""); setMessage("");
    try {
      if (file.size > TIMELINE_LIMITS.jsonBytes) throw new Error("File must be under 2 MB.");
      const incoming = importTimelineJson(await file.text());
      if (!mounted.current) return;
      const merged = mergeTimeline(timelineRef.current, incoming);
      persistenceReady.current = true;
      updateTimeline(merged);
      setSelectedId(incoming.versions.at(-1)?.id ?? "");
      setSelectedRun("");
      setMessage("Timeline imported");
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not import this timeline.");
    } finally { if (mounted.current) setImporting(false); }
  }

  function exportFile() {
    const url = URL.createObjectURL(new Blob([exportTimelineJson(timelineRef.current)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "hyper-framework-timeline.json"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className={styles.timeline} aria-label="Training arena timeline" aria-busy={loading || importing}>
    {/* What the agent has learned for this organization, above how the framework itself evolved. */}
    <div className="workspace-embedded"><LearnedSkills active={active} /></div>
    <div className={styles.toolbar}>
      <label className={styles.snapshotSelect}><span className={styles.eyebrow}>Framework snapshot</span><select aria-label="Framework snapshot" value={selected?.id ?? ""} disabled={!versions.length} onChange={event => { setSelectedId(event.target.value); setSelectedRun(""); }}>
        {!versions.length && <option value="">No snapshots</option>}{versions.map(version => <option key={version.id} value={version.id}>{version.label} · {version.title}</option>)}
      </select></label>
      <div className={styles.tools}><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("hyper:navigate-section", { detail: { section: "activity" } }))}>Activity ↗</button><button type="button" disabled={loading} onClick={() => { setLoading(true); setError(""); setMessage(""); setRevision(value => value + 1); }}>{loading ? "Refreshing…" : "Refresh"}</button><button type="button" disabled={importing || loading} onClick={() => fileInput.current?.click()}>{importing ? "Importing…" : "Import"}</button><button type="button" onClick={exportFile}>Export ↗</button></div>
      <input ref={fileInput} type="file" accept=".json,application/json" onChange={importFile} aria-label="Import framework timeline JSON" hidden />
    </div>
    {error && <p className={styles.notice} role="alert">{error}</p>}
    {message && <p className={styles.note} role="status">{message}</p>}
    {selected ? <>
      <div className={styles.detailBar}><div className={styles.views} role="group" aria-label="Timeline view"><button type="button" aria-pressed={view === "snapshot"} onClick={() => setView("snapshot")}>Snapshot</button><button type="button" aria-pressed={view === "compare"} onClick={() => setView("compare")}>Compare versions</button></div><span>{versions.length} source snapshot{versions.length === 1 ? "" : "s"}</span></div>
      {view === "snapshot" ? <>
        <div className={styles.snapshot}>
          <article className={styles.source}><span className={styles.eyebrow}>{selected.framework.name} / {selected.framework.version}</span><h3>{selected.title}</h3><p className={styles.note}>{selected.summary}</p><div className={styles.provenance}><a href={`${REPOSITORY}/commit/${selected.commit}`} target="_blank" rel="noreferrer">{selected.commit.slice(0, 7)} ↗</a><time dateTime={selected.createdAt}>{dateLabel(selected.createdAt)}</time></div><ul className={styles.changes}>{selected.framework.changes.map((change, index) => <li key={index}>{change}</li>)}</ul><details className={styles.details}><summary>Snapshot sources</summary>{selected.framework.sourceRefs.length ? <References items={selected.framework.sourceRefs} /> : <p className={styles.note}>No sources</p>}</details><details className={styles.details}><summary>Recorded configuration</summary><dl className={styles.config}>{Object.entries(selected.framework.config).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value === null ? "Not supplied" : JSON.stringify(value)}</dd></div>)}</dl></details></article>
          <aside className={styles.recordingSummary}><span className={styles.eyebrow}>Recorded runs</span><strong>{String(selected.runs.length).padStart(2, "0")}</strong><h4>{selected.runs.length ? "Recorded activity" : "No recorded runs"}</h4></aside>
        </div>
        {caseIds.length > 0 && <section className={styles.caseSection}><label className={styles.field}><span className={styles.eyebrow}>Case</span><select aria-label="Recorded case" value={caseId} onChange={event => { setSelectedCase(event.target.value); setSelectedRun(""); }}>{caseIds.map(id => <option key={id} value={id}>{id}</option>)}</select></label>{selected.scenarios.filter(scenario => scenario.caseId === caseId).map(scenario => <details className={styles.details} key={scenario.id}><summary>{scenario.title} <span className={styles.sourceMode}>{words(scenario.mode)} · source definition</span></summary><p className={styles.note}>{scenario.summary}</p><References items={scenario.sourceRefs} /></details>)}{caseRuns.length > 0 && <><label className={styles.field}><span className={styles.eyebrow}>Recording</span><select aria-label="Case recording" value={recorded?.id ?? ""} onChange={event => setSelectedRun(event.target.value)}>{caseRuns.map(run => <option key={run.id} value={run.id}>{words(run.mode)} · {words(run.status)} · {run.id}</option>)}</select></label><RunDetail version={selected} run={recorded} /></>}{!caseRuns.length && <p className={styles.note}>No recordings</p>}</section>}
      </> : !baseline || !comparison ? <div className={styles.empty}><h3>Only one snapshot</h3></div> : <>
        <div className={styles.compareControls}><label className={styles.field}><span className={styles.eyebrow}>Baseline</span><select aria-label="Baseline snapshot" value={baseline.id} onChange={event => setBaselineId(event.target.value)}>{versions.filter(version => version.id !== selected.id).map(version => <option key={version.id} value={version.id}>{version.label} · {version.title}</option>)}</select></label><label className={styles.field}><span className={styles.eyebrow}>Case</span><select aria-label="Comparison case" value={caseId} disabled={!caseIds.length} onChange={event => setSelectedCase(event.target.value)}>{caseIds.length ? caseIds.map(id => <option key={id} value={id}>{id}</option>) : <option value="">No cases recorded</option>}</select></label></div>
        <section className={styles.frameworkDiff}><span className={styles.eyebrow}>{baseline.label} → {selected.label}</span><h3>Framework changes</h3><div className={styles.diffColumns}><div><h4>Added in {selected.label}</h4>{comparison.frameworkChanges.added.length ? <ul className={styles.changes}>{comparison.frameworkChanges.added.map((change, index) => <li key={index}>{change}</li>)}</ul> : <p className={styles.note}>None</p>}</div>{comparison.frameworkChanges.removed.length > 0 && <div><h4>Present only in {baseline.label}</h4><ul className={styles.changes}>{comparison.frameworkChanges.removed.map((change, index) => <li key={index}>{change}</li>)}</ul></div>}</div>{comparison.configChanges.length > 0 && <details className={styles.details}><summary>Configuration differences ({comparison.configChanges.length})</summary><dl className={styles.config}>{comparison.configChanges.map(change => <div key={change.key}><dt>{change.key}</dt><dd>{JSON.stringify(change.baseline) ?? "Not set"} → {JSON.stringify(change.candidate) ?? "Not set"}</dd></div>)}</dl></details>}</section>
        {!comparison.baselineRun && !comparison.candidateRun ? <div className={styles.empty}><h3>No recorded comparison</h3></div> : <>{!comparison.comparable && <p className={styles.notice}>{comparison.reasons.join(" ")}</p>}<div className={styles.tableScroll}><table className={styles.metrics}><thead><tr><th>Metric</th><th>{baseline.label}</th><th>{selected.label}</th><th>Difference</th></tr></thead><tbody>{comparison.metrics.map(row => <tr key={row.key}><th>{row.label}</th><td title={row.baseline.status === "unavailable" ? row.baseline.reason : row.baseline.source}>{measurement(row.baseline, row.unit)}</td><td title={row.candidate.status === "unavailable" ? row.candidate.reason : row.candidate.source}>{measurement(row.candidate, row.unit)}</td><td title={row.reason ?? undefined}>{difference(row)}</td></tr>)}</tbody></table></div><div className={styles.runs}><RunDetail version={baseline} run={comparison.baselineRun} /><RunDetail version={selected} run={comparison.candidateRun} /></div></>}
      </>}
      <footer className={styles.footer}><span>Source history · {selected.label}</span></footer>
    </> : <div className={styles.empty}><h3>No snapshots</h3></div>}
  </section>;
}
