"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { WORLD_PATH } from "@/lib/engine/router/routes";
import { REAL_URL, SAMPLE_URL, fetchBenchmarks, formatMetric, latestCompleted, subjectRuns, systemOf } from "@/lib/benchmarks/load";
import type { BenchmarksDocument, Layer } from "@/lib/benchmarks/types";
import {
  CapabilityCoverage, ComparisonFlow, Empty, OutcomesByFamily, Panel, ReliabilityRadar, Scorecard, VersionHistory, WorkFunnel,
} from "./panels";

const WORKFLOW_SUITE = "ap_workflow";
const LAYERS: { key: Layer; label: string }[] = [
  { key: "external", label: "External financial evaluations" },
  { key: "workflow", label: "Client workflow" },
  { key: "crypto", label: "Crypto-native interpretation" },
  { key: "reliability", label: "Reliability and learning" },
];

export default function BenchmarksWorkspace() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [sample, setSample] = useState(false);
  const [doc, setDoc] = useState<BenchmarksDocument | null>(null);
  const [error, setError] = useState("");
  const [systemId, setSystemId] = useState("");
  // The layout sample is a development aid. It is only reachable outside production or with ?benchSample=1.
  const [sampleAllowed] = useState(() => process.env.NODE_ENV !== "production"
    || (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("benchSample")));
  const visible = active && pathname === WORLD_PATH;

  useEffect(() => {
    const onSection = (event: Event) => setActive((event as CustomEvent<{ section: string }>).detail?.section === "benchmarks");
    window.addEventListener("hyper:section-change", onSection);
    return () => window.removeEventListener("hyper:section-change", onSection);
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetchBenchmarks(sample ? SAMPLE_URL : REAL_URL)
      .then((next) => { if (!cancelled) { setError(""); setDoc(next); setSystemId(""); } })
      .catch((reason) => { if (!cancelled) { setDoc(null); setError(reason instanceof Error ? reason.message : "Could not load results."); } });
    return () => { cancelled = true; };
  }, [visible, sample]);

  const view = useMemo(() => {
    if (!doc) return null;
    const runs = subjectRuns(doc);
    const workflowRuns = latestCompleted(doc, WORKFLOW_SUITE);
    const selected = workflowRuns.find((r) => r.system_id === systemId) ?? workflowRuns.at(-1);
    return {
      runs, workflowRuns, selected,
      suite: doc.suites.find((s) => s.id === WORKFLOW_SUITE),
      trials: selected ? doc.trials.filter((t) => t.run_id === selected.id) : [],
      oracleRuns: doc.runs.length - runs.length,
      tasksGraded: runs.filter((r) => r.execution === "completed").reduce((n, r) => n + r.n_tasks, 0),
    };
  }, [doc, systemId]);

  if (!visible) return null;
  const isSample = doc?.display_mode === "DEV_FIXTURE";

  return <main className="bench" aria-label="Benchmarks" data-sample={isSample || undefined}>
    <div className="bench-content">
      <header className="bench-heading">
        <div>
          <span className="bench-eyebrow">Benchmarks · {doc ? doc.display_mode.replaceAll("_", " ") : "loading"}</span>
          <h2>What was <em>measured</em>, and what was not.</h2>
        </div>
        {sampleAllowed && <button type="button" aria-pressed={sample} onClick={() => setSample((s) => !s)}>
          {sample ? "Show real results" : "Preview layout sample"}
        </button>}
      </header>

      {isSample && <p className="bench-sample-banner" role="note">
        Layout sample. Every number on this page is synthetic placeholder data for designing the view. None of it is a result.
      </p>}
      {error && <p className="bench-warning">{error}. Run <code>uv run python -m mirror_eval export</code> in <code>eval/</code>.</p>}

      {doc && view && <>
        <dl className="bench-stats">
          <div><dt>Subject-agent runs</dt><dd>{view.runs.length}</dd><small>{view.oracleRuns} grader self-check run{view.oracleRuns === 1 ? "" : "s"} kept separate</small></div>
          <div><dt>Tasks graded</dt><dd>{view.tasksGraded}</dd><small>on persisted state, not on the agent&apos;s say-so</small></div>
          <div><dt>Suites registered</dt><dd>{doc.suites.length}</dd><small>{doc.suites.filter((s) => s.access === "available").length} runnable today</small></div>
          <div><dt>Capabilities supported</dt><dd>{doc.capabilities.filter((c) => c.status === "supported").length}<span> / {doc.capabilities.length}</span></dd><small>partial and untested shown below</small></div>
        </dl>

        <Panel wide eyebrow="Coverage" title="Capability inventory" note="Built from the code that exists, not from the roadmap. Hover a row for the note behind its status.">
          <CapabilityCoverage doc={doc} />
        </Panel>

        <div className="bench-detailbar">
          <span className="bench-eyebrow">Client workflow suite{view.suite?.split ? ` · ${view.suite.split.replaceAll("_", " ")}` : ""}</span>
          {view.workflowRuns.length > 0 && <label>System
            <select value={view.selected?.system_id ?? ""} onChange={(e) => setSystemId(e.target.value)}>
              {view.workflowRuns.map((r) => <option key={r.id} value={r.system_id}>{systemOf(doc, r)?.label ?? r.system_id}</option>)}
            </select>
          </label>}
          {view.selected && <span className="bench-muted">{view.selected.mode.replaceAll("_", " ")} · whole-task {formatMetric(view.selected.whole_task_success)} · required approvals {formatMetric(view.selected.required_approvals)} · investigative assists {formatMetric(view.selected.investigative_assists)}</span>}
        </div>

        {view.suite && view.selected ? <div className="bench-grid">
          <Panel eyebrow="Finished work" title="Where the tasks ended up" note="First attempt per task. A correct hold is a task where the evidence could not support payment and the agent kept it blocked with an owner and next action.">
            <WorkFunnel trials={view.trials} />
          </Panel>
          <Panel eyebrow="By exception family" title="Outcome per family">
            <OutcomesByFamily suite={view.suite} trials={view.trials} />
          </Panel>
          <Panel eyebrow="Repeated trials" title="Reliability profile" note="All-of-k is computed per task, never by raising the average to a power. Up to three systems.">
            <ReliabilityRadar doc={doc} runs={view.workflowRuns} />
          </Panel>
          <Panel eyebrow="Same frozen suite" title="Across evaluated versions">
            <VersionHistory doc={doc} runs={view.workflowRuns} />
          </Panel>
        </div> : <Panel wide eyebrow="Client workflow suite" title="No subject-agent run recorded">
          <Empty>The {view.suite?.task_count ?? 0} AP exception fixtures and their private grader are ready. These panels fill from <code>eval/runs</code> once an agent is registered and run. Nothing is shown until then.</Empty>
        </Panel>}

        <Panel wide eyebrow="Matched comparisons" title="What changed between two systems" note="Same initial records, policies and counterparty configuration. Transcripts are allowed to differ.">
          {doc.comparisons.length ? doc.comparisons.map((c) => <ComparisonFlow key={c.id} doc={doc} comparison={c} />)
            : <Empty>No comparison recorded. One needs two completed runs on the same suite and manifest-identical surroundings.</Empty>}
        </Panel>

        {LAYERS.map((layer) => {
          const suites = doc.suites.filter((s) => s.layer === layer.key && s.id !== WORKFLOW_SUITE);
          if (!suites.length) return null;
          return <section key={layer.key} className="bench-layer">
            <span className="bench-eyebrow">{layer.label}</span>
            <p className="bench-note">Each suite keeps its own metric and scale. Scores from different suites are never averaged or drawn on one axis.</p>
            <div className="bench-cards">{suites.map((s) => {
              const run = latestCompleted(doc, s.id).at(-1);
              return <Scorecard key={s.id} suite={s} run={run} system={run ? systemOf(doc, run)?.label : undefined} />;
            })}</div>
          </section>;
        })}

        <Panel wide eyebrow="Claims to evidence" title="What the demo is allowed to say">
          <div className="bench-table__wrap"><table className="bench-matrix">
            <thead><tr><th scope="col">Claim</th><th scope="col">Status</th><th scope="col">In demo</th><th scope="col">Evidence</th></tr></thead>
            <tbody>{doc.claims.map((c) => <tr key={c.id}>
              <th scope="row">{c.claim}</th><td>{c.status}</td><td>{c.demo_allowed ? "Yes" : "No"}</td>
              <td>{c.evidence_refs.length ? c.evidence_refs.map((r) => <code key={r}>{r}</code>) : "None yet"}</td>
            </tr>)}</tbody>
          </table></div>
        </Panel>

        <footer className="bench-footer">
          Generated {new Date(doc.generated_at).toLocaleString("en-US")}{doc.generator_commit ? ` from ${doc.generator_commit.slice(0, 7)}` : ""}. Charts by bklit-ui (MIT).
        </footer>
      </>}
    </div>
  </main>;
}
