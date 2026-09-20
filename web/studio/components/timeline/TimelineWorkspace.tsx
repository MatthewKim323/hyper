"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { WORLD_PATH } from "@/lib/engine/router/routes";
import { useOwnsScreen } from "@/lib/engine/router/navigation";
import VersionCarousel from "./VersionCarousel";
import { initialTimeline, importTimelineJson, exportTimelineJson, mergeTimeline, TIMELINE_LIMITS } from "@/lib/timeline/registry";
import { compareVersions, latestCaseRun } from "@/lib/timeline/compare";
import type { TimelineDocument, VersionRun, VersionSnapshot, MetricValue } from "@/lib/timeline/types";

const STORAGE_KEY = "hyper.framework-timeline.v1";
const REPOSITORY = "https://github.com/MatthewKim323/hyper.";

function metric(value: MetricValue, unit: string) {
  if (value.status === "unavailable") return "Not recorded";
  if (unit === "USD") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value.value);
  if (unit === "ms") return `${(value.value / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })}s`;
  return value.value.toLocaleString("en-US");
}

function RunDetail({ version, run }: { version: VersionSnapshot; run: VersionRun | null }) {
  return <article className="timeline-run">
    <span className="timeline-eyebrow">{version.label} / {run?.mode.replaceAll("_", " ") ?? "Source snapshot"}</span>
    <h3>{run?.outcome.status ?? "No recorded run"}</h3>
    <p>{run?.outcome.summary ?? "Import a recorded run for this case to inspect its outcome, steps, and evidence."}</p>
    {run && <>
      <p className="timeline-muted">{run.status} · {run.outcome.verdict}</p>
      <ol className="timeline-steps">{run.steps.map(step => <li key={step.id}>
        <span>{String(step.ordinal).padStart(2, "0")}</span>
        <div><strong>{step.title}</strong><small>{step.status}</small><p>{step.detail}</p>
          {step.evidenceIds.length > 0 && <small>Evidence: {step.evidenceIds.join(", ")}</small>}
        </div>
      </li>)}</ol>
      <details><summary>Evidence and recording</summary>
        <ul>{[run.provenance, ...run.evidence].map((item, index) => <li key={`${item.id}-${index}`}><strong>{item.label}</strong><code>{item.ref}</code></li>)}</ul>
      </details>
    </>}
  </article>;
}

export default function TimelineWorkspace() {
  // The settled route, so a scene is not torn down while its own exit transition runs.
  const onWorld = useOwnsScreen(WORLD_PATH);
  const [active, setActive] = useState(false);
  const [document, setDocument] = useState<TimelineDocument>(initialTimeline);
  const documentRef = useRef<TimelineDocument>(initialTimeline);
  const persistenceReady = useRef(true);
  const [selectedId, setSelectedId] = useState(initialTimeline.versions[0]?.id ?? "");
  const [baselineId, setBaselineId] = useState(initialTimeline.versions[0]?.id ?? "");
  const [selectedCase, setSelectedCase] = useState("");
  const [view, setView] = useState<"snapshot" | "compare">("snapshot");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const visible = active && onWorld;
  const versions = document.versions;
  const selected = versions.find(version => version.id === selectedId) ?? versions[0];
  const baseline = versions.find(version => version.id === baselineId) ?? versions[0];
  const caseIds = Array.from(new Set([...(selected?.scenarios ?? []).map(s => s.caseId), ...(baseline?.scenarios ?? []).map(s => s.caseId), ...(selected?.runs ?? []).map(r => r.caseId), ...(baseline?.runs ?? []).map(r => r.caseId)]));
  const caseId = caseIds.includes(selectedCase) ? selectedCase : caseIds[0] ?? "";
  const comparison = selected && baseline ? compareVersions(baseline, selected, caseId) : null;
  const recorded = selected ? latestCaseRun(selected, caseId) : null;

  function updateDocument(next: TimelineDocument) {
    documentRef.current = next;
    setDocument(next);
  }

  useEffect(() => {
    const handleSection = (event: Event) => {
      const next = (event as CustomEvent<{ section: string }>).detail?.section;
      setActive(next === "timeline");
    };
    window.addEventListener("hyper:section-change", handleSection);
    async function restore() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) updateDocument(mergeTimeline(initialTimeline, importTimelineJson(saved)));
      } catch {
        persistenceReady.current = false;
        setError("Saved timeline could not be read. The repository snapshot is still available.");
      }
      setLoaded(true);
    }
    void restore();
    return () => window.removeEventListener("hyper:section-change", handleSection);
  }, []);

  useEffect(() => {
    if (!loaded || !persistenceReady.current) return;
    try { localStorage.setItem(STORAGE_KEY, exportTimelineJson(document)); }
    catch {
      // Report a failure in the external persistence system after attempting synchronization.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("This browser could not save the timeline. Export it to keep your records.");
    }
  }, [document, loaded]);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    fetch("/api/timeline", { signal: controller.signal, cache: "no-store" })
      .then(response => { if (!response.ok) throw new Error(); return response.text(); })
      .then(text => {
        const incoming = importTimelineJson(text);
        const previous = documentRef.current;
        const unseen = incoming.versions.filter(version => !previous.versions.some(existing => existing.id === version.id));
        if (unseen.length) updateDocument(mergeTimeline(previous, { schemaVersion: 1, versions: unseen }));
      })
      .catch(reason => { if (reason?.name !== "AbortError") setMessage("Repository refresh unavailable. Showing saved snapshots."); });
    return () => controller.abort();
  }, [visible]);

  async function refresh() {
    setRefreshing(true); setError("");
    try {
      const response = await fetch("/api/timeline", { cache: "no-store" });
      if (!response.ok) throw new Error("Repository refresh is unavailable.");
      const fallbackNotice = response.headers.get("X-Timeline-Notice");
      const incoming = importTimelineJson(await response.text());
      const previous = documentRef.current;
      const unseen = incoming.versions.filter(version => !previous.versions.some(existing => existing.id === version.id));
      if (unseen.length) updateDocument(mergeTimeline(previous, { schemaVersion: 1, versions: unseen }));
      setMessage(fallbackNotice ?? (unseen.length ? `${unseen.length} new framework snapshot${unseen.length === 1 ? "" : "s"} added.` : "Up to date with the available framework history."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not refresh snapshots."); }
    finally { setRefreshing(false); }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      if (file.size > TIMELINE_LIMITS.jsonBytes) throw new Error("Choose a timeline JSON file smaller than 2 MB.");
      const incoming = importTimelineJson(await file.text());
      const merged = mergeTimeline(documentRef.current, incoming);
      persistenceReady.current = true;
      updateDocument(merged);
      setSelectedId(incoming.versions.at(-1)?.id ?? selectedId);
      setMessage("Timeline imported and saved in this browser.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import this timeline."); }
  }

  function exportFile() {
    const blob = new Blob([exportTimelineJson(document)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url; link.download = "hyper-framework-timeline.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!visible || !selected || !baseline) return null;

  return <section className="timeline-workspace" aria-label="Framework timeline" onWheel={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
    <div className="timeline-content">
      <header className="timeline-heading">
        <div><span className="timeline-eyebrow">Framework evolution / {String(versions.length).padStart(2, "0")} snapshots</span><h2>The framework, <em>over time.</em></h2></div>
        <div className="timeline-tools">
          <button type="button" onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button>
          <button type="button" onClick={() => fileInput.current?.click()}>Import</button>
          <button type="button" onClick={exportFile}>Export ↗</button>
          <input ref={fileInput} type="file" accept=".json,application/json" onChange={importFile} aria-label="Import framework timeline JSON" hidden />
        </div>
      </header>
      {error && <p className="timeline-notice timeline-notice--error" role="alert">{error}</p>}
      {message && <p className="timeline-notice" role="status">{message}</p>}
      <VersionCarousel cards={versions.map(version => ({ id: version.id, label: version.label, title: version.title, summary: version.summary, status: version.runs.length ? `${version.runs.length} recorded runs` : "Source snapshot" }))} selectedId={selected.id} onSelect={setSelectedId} />

      <div className="timeline-detail-bar">
        <div className="timeline-segmented" role="group" aria-label="Timeline view">
          <button type="button" aria-pressed={view === "snapshot"} onClick={() => setView("snapshot")}>Snapshot</button>
          <button type="button" aria-pressed={view === "compare"} onClick={() => setView("compare")}>Compare versions</button>
        </div>
        <label className="timeline-jump">Jump to<select aria-label="Jump to framework version" value={selected.id} onChange={event => setSelectedId(event.target.value)}>{versions.map(version => <option key={version.id} value={version.id}>{version.label} · {version.title}</option>)}</select></label>
        <a href={`${REPOSITORY}/commit/${selected.commit}`} target="_blank" rel="noopener noreferrer">{selected.commit.slice(0, 7)} ↗</a>
        <time dateTime={selected.createdAt}>{new Date(selected.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</time>
      </div>

      {view === "snapshot" ? <div className="timeline-snapshot-grid">
        <div><span className="timeline-eyebrow">{selected.framework.name} / {selected.framework.version}</span><h3>{selected.title}</h3><p>{selected.summary}</p>
          <ul className="timeline-changes">{selected.framework.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>
          <details><summary>Snapshot sources</summary><ul>{selected.framework.sourceRefs.map(ref => <li key={ref.id}><strong>{ref.label}</strong><code>{ref.ref}</code></li>)}</ul></details>
        </div>
        <div className="timeline-recording-summary"><span className="timeline-eyebrow">Recorded performance</span><strong>{selected.runs.length.toString().padStart(2, "0")}</strong><p>{selected.runs.length ? "Recorded runs available for inspection." : "No recorded runs attached yet."}</p><small>{selected.runs.length ? "Choose a case below to inspect what happened." : "This is a real code snapshot. Performance appears when a recorded run is attached."}</small>
          {caseIds.length > 0 && <label className="timeline-field">Case<select value={caseId} onChange={event => setSelectedCase(event.target.value)}>{caseIds.map(id => <option key={id} value={id}>{id}</option>)}</select></label>}
          {!recorded && selected.scenarios.find(scenario => scenario.caseId === caseId) && <small>{selected.scenarios.find(scenario => scenario.caseId === caseId)?.mode.replaceAll("_", " ")} · source definition</small>}
        </div>
        {recorded && <RunDetail version={selected} run={recorded} />}
      </div> : versions.length < 2 ? <div className="timeline-empty"><span className="timeline-eyebrow">The first chapter</span><h3>One real snapshot, so far.</h3><p>New framework commits join this timeline when you refresh. Add recorded runs to compare how versions handle the same case.</p></div> : <div className="timeline-comparison">
        <div className="timeline-comparison-controls">
          <label className="timeline-field">Baseline<select value={baseline.id} onChange={event => setBaselineId(event.target.value)}>{versions.map(version => <option key={version.id} value={version.id}>{version.label} · {version.title}</option>)}</select></label>
          <label className="timeline-field">Candidate<select value={selected.id} onChange={event => setSelectedId(event.target.value)}>{versions.map(version => <option key={version.id} value={version.id}>{version.label} · {version.title}</option>)}</select></label>
          <label className="timeline-field">Case<select value={caseId} onChange={event => setSelectedCase(event.target.value)} disabled={!caseIds.length}>{caseIds.length ? caseIds.map(id => <option key={id} value={id}>{id}</option>) : <option value="">No cases recorded</option>}</select></label>
        </div>
        {baseline.id === selected.id ? <p className="timeline-notice">Choose two different versions to compare.</p> : <>
          <div className="timeline-framework-diff"><h3>Framework changes</h3><div><span>Added in {selected.label}</span><ul>{comparison?.frameworkChanges.added.map((change, index) => <li key={index}>{change}</li>)}</ul>{comparison?.frameworkChanges.added.length === 0 && <p>No added change notes.</p>}</div>
            {comparison && comparison.frameworkChanges.removed.length > 0 && <div><span>Present only in {baseline.label}</span><ul>{comparison.frameworkChanges.removed.map((change, index) => <li key={index}>{change}</li>)}</ul></div>}
            {comparison && comparison.configChanges.length > 0 && <details><summary>Configuration differences ({comparison.configChanges.length})</summary><ul>{comparison.configChanges.map(change => <li key={change.key}><strong>{change.key}</strong><code>{JSON.stringify(change.baseline) ?? "Not set"} → {JSON.stringify(change.candidate) ?? "Not set"}</code></li>)}</ul></details>}
          </div>
          {comparison ? <>
            {!comparison.comparable && <p className="timeline-notice">{comparison.reasons.join(" ")}</p>}
            <div className="timeline-table-wrap"><table><thead><tr><th>Metric</th><th>{baseline.label}</th><th>{selected.label}</th><th>Difference</th></tr></thead><tbody>{comparison.metrics.map(row => <tr key={row.key}><th>{row.label}</th><td title={row.baseline.status === "unavailable" ? row.baseline.reason : undefined}>{metric(row.baseline, row.unit)}</td><td title={row.candidate.status === "unavailable" ? row.candidate.reason : undefined}>{metric(row.candidate, row.unit)}</td><td title={row.reason ?? undefined}>{row.delta === null ? "Unavailable" : `${row.delta > 0 ? "+" : ""}${row.unit === "ms" ? (row.delta / 1000).toFixed(2) + "s" : row.delta.toLocaleString("en-US", { maximumFractionDigits: 4 })}${row.percentChange === null ? "" : ` (${row.percentChange > 0 ? "+" : ""}${row.percentChange.toFixed(1)}%)`}`}</td></tr>)}</tbody></table></div>
            <div className="timeline-runs"><RunDetail version={baseline} run={comparison.baselineRun} /><RunDetail version={selected} run={comparison.candidateRun} /></div>
          </> : <p className="timeline-notice">Attach recorded runs for the same case to compare outcomes and performance.</p>}
        </>}
      </div>}
    </div>
  </section>;
}
