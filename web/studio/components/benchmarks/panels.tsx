"use client";

// Chart panels for the Benchmarks workspace. Every panel draws only what the
// exported document contains. With nothing measured it says so; it never fills in.
import { useMemo, type ReactNode } from "react";
import {
  Bar, BarChart, BarYAxis, ChartTooltip, FunnelChart, Gauge, Grid, Line, LineChart,
  PieCenter, PieChart, PieSlice, RadarArea, RadarAxis, RadarChart, RadarGrid, RadarLabels,
  SankeyChart, SankeyLink, SankeyNode, SankeyTooltip, XAxis, YAxis,
} from "@/components/charts";
import { formatMetric, measured, systemOf } from "@/lib/benchmarks/load";
import type {
  BenchmarksDocument, Bucket, CapabilityStatus, Comparison, Outcome, Run, Suite, Trial,
} from "@/lib/benchmarks/types";

const OUTCOMES: { key: Outcome; label: string; color: string }[] = [
  { key: "pass", label: "Pass", color: "var(--status-good)" },
  { key: "correct_escalation", label: "Correct hold", color: "var(--chart-1)" },
  { key: "partial", label: "Partial", color: "var(--status-warning)" },
  { key: "waiting", label: "Still waiting", color: "var(--status-serious)" },
  { key: "fail", label: "Fail", color: "var(--status-critical)" },
  { key: "error", label: "Error", color: "#7d2a2a" },
  { key: "unsupported", label: "Unsupported", color: "var(--status-neutral)" },
  { key: "not_tested", label: "Not tested", color: "#d6cec8" },
];
const OUTCOME_BY_KEY = new Map(OUTCOMES.map((o) => [o.key, o]));

const CAP_STATUS: { key: CapabilityStatus; label: string; color: string }[] = [
  { key: "supported", label: "Supported", color: "var(--status-good)" },
  { key: "partial", label: "Partial", color: "var(--status-warning)" },
  { key: "untested", label: "Untested", color: "var(--status-neutral)" },
  { key: "unsupported", label: "Unsupported", color: "var(--status-critical)" },
  { key: "access_blocked", label: "Access blocked", color: "#7d2a2a" },
];

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "both_pass", label: "Both pass" },
  { key: "gained", label: "Gained" },
  { key: "regressed", label: "Regressed" },
  { key: "both_fail", label: "Both fail" },
  { key: "unavailable", label: "Unavailable" },
];

export function Panel({ eyebrow, title, note, children, wide }: {
  eyebrow: string; title: string; note?: string; children: ReactNode; wide?: boolean;
}) {
  return <section className={`bench-panel${wide ? " bench-panel--wide" : ""}`}>
    <span className="bench-eyebrow">{eyebrow}</span>
    <h3>{title}</h3>
    {note && <p className="bench-note">{note}</p>}
    {children}
  </section>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="bench-empty" role="status"><span aria-hidden="true">∅</span><p>{children}</p></div>;
}

function Key({ items }: { items: { label: string; color: string; value?: number }[] }) {
  return <ul className="bench-key">{items.map((i) => <li key={i.label}>
    <i style={{ background: i.color }} aria-hidden="true" />{i.label}{i.value !== undefined && <b>{i.value}</b>}
  </li>)}</ul>;
}

function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return <details className="bench-table"><summary>Table view</summary>
    <div className="bench-table__wrap"><table>
      <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  </details>;
}

export function CapabilityCoverage({ doc }: { doc: BenchmarksDocument }) {
  const total = doc.capabilities.length;
  const counts = CAP_STATUS.map((s) => ({ ...s, value: doc.capabilities.filter((c) => c.status === s.key).length }));
  const slices = counts.filter((c) => c.value > 0).map((c) => ({ label: c.label, value: c.value, color: c.color }));
  if (!total) return <Empty>No capability inventory in this document.</Empty>;
  return <div className="bench-split">
    <div className="bench-chart bench-chart--ring">
      <PieChart data={slices} size={240} innerRadius={84} padAngle={0.02} cornerRadius={4}>
        {slices.map((r, i) => <PieSlice key={r.label} index={i} />)}
        <PieCenter defaultLabel="Capabilities" />
      </PieChart>
      <Key items={counts} />
    </div>
    <div className="bench-table__wrap"><table className="bench-matrix">
      <thead><tr><th scope="col">Area</th><th scope="col">Status</th><th scope="col">Tasks</th><th scope="col">Passed</th></tr></thead>
      <tbody>{doc.capabilities.map((c) => {
        const s = CAP_STATUS.find((x) => x.key === c.status)!;
        return <tr key={c.id} title={c.note}>
          <th scope="row">{c.name}<small>{c.area}</small></th>
          <td><span className="bench-pill"><i style={{ background: s.color }} aria-hidden="true" />{s.label}</span></td>
          <td>{c.task_count}</td>
          <td>{c.passed ?? "Not measured"}</td>
        </tr>;
      })}</tbody>
    </table></div>
  </div>;
}

export function OutcomesByFamily({ suite, trials }: { suite: Suite; trials: Trial[] }) {
  const { rows, used } = useMemo(() => {
    const names = new Map(suite.families.map((f) => [f.id, f.name]));
    const byFamily = new Map<string, Record<string, number>>();
    for (const t of trials) {
      const fam = names.get(t.family_id ?? "") ?? t.family_id ?? "Unlabelled";
      const row = byFamily.get(fam) ?? {};
      row[t.outcome] = (row[t.outcome] ?? 0) + 1;
      byFamily.set(fam, row);
    }
    const present = OUTCOMES.filter((o) => trials.some((t) => t.outcome === o.key));
    return {
      used: present,
      rows: [...byFamily.entries()].map(([family, counts]) => ({
        family, ...Object.fromEntries(present.map((o) => [o.key, counts[o.key] ?? 0])),
      })),
    };
  }, [suite, trials]);
  if (!rows.length) return <Empty>No graded trials for this run.</Empty>;
  return <>
    <Key items={used} />
    <div className="bench-chart" style={{ height: Math.max(220, rows.length * 30 + 60) }}>
      <BarChart data={rows} xDataKey="family" orientation="horizontal" stacked stackGap={2} barGap={0.35}
        className="h-full" aspectRatio="auto" margin={{ left: 150, right: 16, top: 8, bottom: 28 }}>
        <Grid vertical horizontal={false} />
        {used.map((o) => <Bar key={o.key} dataKey={o.key} fill={o.color} lineCap="butt" />)}
        <BarYAxis showAllLabels />
        <ChartTooltip />
      </BarChart>
    </div>
    <TableView head={["Family", ...used.map((o) => o.label)]}
      rows={rows.map((r) => [r.family, ...used.map((o) => (r as Record<string, number | string>)[o.key] as number)])} />
  </>;
}

export function WorkFunnel({ trials }: { trials: Trial[] }) {
  const first = trials.filter((t) => t.trial_index === 0);
  if (!first.length) return <Empty>No graded trials for this run.</Empty>;
  const terminal = first.filter((t) => !["error", "not_tested", "unsupported"].includes(t.outcome));
  const rightClass = terminal.filter((t) => ["pass", "partial", "correct_escalation"].includes(t.outcome));
  const correct = rightClass.filter((t) => t.outcome !== "partial");
  const unassisted = correct.filter((t) => t.assistance.length === 0);
  const stages = [
    { label: "Tasks", value: first.length },
    { label: "Reached a disposition", value: terminal.length },
    { label: "Right disposition", value: rightClass.length },
    { label: "Evidence complete", value: correct.length },
    { label: "No investigative help", value: unassisted.length },
  ];
  return <>
    <div className="bench-chart"><FunnelChart data={stages} color="var(--chart-1)" layers={2} edges="curved"
      showPercentage showValues showLabels style={{ aspectRatio: "2.4 / 1" }} /></div>
    <TableView head={["Stage", "Tasks"]} rows={stages.map((s) => [s.label, s.value])} />
  </>;
}

const RADAR_METRICS = [
  { key: "pass_at_1", label: "pass@1" },
  { key: "pass_any_of_k", label: "Any of k" },
  { key: "pass_all_of_k", label: "All of k" },
  { key: "correct_escalation_rate", label: "Correct holds" },
  { key: "unassisted_completion", label: "Unassisted" },
  { key: "whole_task_success", label: "Whole task" },
] as const;
const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

export function ReliabilityRadar({ doc, runs }: { doc: BenchmarksDocument; runs: Run[] }) {
  // Only runs with every axis measured can be drawn. A missing axis is not a zero.
  const complete = runs.filter((r) => RADAR_METRICS.every((m) => measured(r[m.key]) !== null)).slice(-3);
  if (!complete.length) return <Empty>Needs a completed run with repeated trials, so pass@1, any-of-k and all-of-k are all measured.</Empty>;
  const data = complete.map((r, i) => ({
    label: systemOf(doc, r)?.label ?? r.system_id, color: SERIES[i],
    values: Object.fromEntries(RADAR_METRICS.map((m) => [m.key, (measured(r[m.key]) ?? 0) * 100])),
  }));
  return <>
    <Key items={data.map((d) => ({ label: d.label, color: d.color }))} />
    <div className="bench-chart bench-chart--radar">
      <RadarChart data={data} metrics={[...RADAR_METRICS]} size={340} levels={4}>
        <RadarGrid /><RadarAxis /><RadarLabels fontSize={11} offset={18} />
        {data.map((d, i) => <RadarArea key={d.label} index={i} color={d.color} showPoints />)}
      </RadarChart>
    </div>
    <TableView head={["System", ...RADAR_METRICS.map((m) => m.label)]}
      rows={complete.map((r) => [systemOf(doc, r)?.label ?? r.system_id, ...RADAR_METRICS.map((m) => formatMetric(r[m.key]))])} />
  </>;
}

export function VersionHistory({ doc, runs }: { doc: BenchmarksDocument; runs: Run[] }) {
  const points = runs.flatMap((r) => {
    const sys = systemOf(doc, r); const v = measured(r.whole_task_success);
    return sys && v !== null ? [{ date: new Date(sys.created_at), success: +(v * 100).toFixed(1), run: r, label: sys.label }] : [];
  }).sort((a, b) => +a.date - +b.date);
  if (points.length < 2) return <Empty>A history needs at least two evaluated versions on the same frozen suite. {points.length} recorded.</Empty>;
  return <>
    <div className="bench-chart" style={{ height: 260 }}>
      <LineChart data={points.map(({ date, success }) => ({ date, success }))} className="h-full" aspectRatio="auto" margin={{ left: 48, right: 28, top: 16, bottom: 32 }}>
        <Grid horizontal />
        <Line dataKey="success" stroke="var(--chart-1)" strokeWidth={2} showMarkers />
        <XAxis />
        <YAxis numTicks={5} formatValue={(v) => `${v}%`} />
        <ChartTooltip />
      </LineChart>
    </div>
    <TableView head={["Version", "Evaluated", "Whole-task success", "Interval", "n"]}
      rows={points.map((p) => {
        const m = p.run.whole_task_success;
        const ci = m.status === "measured" && m.ci_low != null && m.ci_high != null
          ? `${(m.ci_low * 100).toFixed(1)} to ${(m.ci_high * 100).toFixed(1)}%` : "Not computed";
        return [p.label, p.date.toISOString().slice(0, 10), `${p.success}%`, ci, m.status === "measured" ? m.n ?? "" : ""];
      })} />
  </>;
}

export function ComparisonFlow({ doc, comparison }: { doc: BenchmarksDocument; comparison: Comparison }) {
  const run = (id: string) => doc.runs.find((r) => r.id === id);
  const label = (id: string) => { const r = run(id); return (r && systemOf(doc, r)?.label) ?? id; };
  const tasks = comparison.tasks;
  const counts = Object.fromEntries(BUCKETS.map((b) => [b.key, tasks.filter((t) => t.bucket === b.key).length]));
  const left = OUTCOMES.filter((o) => tasks.some((t) => t.baseline === o.key));
  const right = OUTCOMES.filter((o) => tasks.some((t) => t.candidate === o.key));
  const nodes = [...left.map((o) => ({ name: `Before: ${o.label}`, outcome: o.key, category: "source" as const })), ...right.map((o) => ({ name: `After: ${o.label}`, outcome: o.key, category: "outcome" as const }))];
  const links = left.flatMap((l, i) => right.flatMap((r, j) => {
    const value = tasks.filter((t) => t.baseline === l.key && t.candidate === r.key).length;
    return value ? [{ source: i, target: left.length + j, value }] : [];
  }));
  const colorOf = (node: { outcome?: unknown }) => OUTCOME_BY_KEY.get(node.outcome as Outcome)?.color ?? "var(--status-neutral)";
  return <>
    <p className="bench-note">{label(comparison.baseline_run_id)} <span aria-hidden="true">→</span> {label(comparison.candidate_run_id)} · {comparison.kind.replaceAll("_", " ").toLowerCase()} comparison</p>
    {!comparison.comparable && <p className="bench-warning">Not a matched comparison: {comparison.reasons.join("; ")}</p>}
    <dl className="bench-buckets">{BUCKETS.map((b) => <div key={b.key} data-bucket={b.key}><dt>{b.label}</dt><dd>{counts[b.key]}</dd></div>)}</dl>
    {links.length > 0 && <div className="bench-chart">
      <SankeyChart data={{ nodes, links }} aspectRatio="16 / 7" nodeWidth={10} nodePadding={18} margin={{ left: 140, right: 140, top: 8, bottom: 8 }}>
        <SankeyLink useGradient strokeOpacity={0.35} getNodeColor={(n) => colorOf(n as { outcome?: unknown })} />
        <SankeyNode showLabels valueUnit="tasks" getNodeColor={(n) => colorOf(n as { outcome?: unknown })} />
        <SankeyTooltip />
      </SankeyChart>
    </div>}
    <ul className="bench-taskgrid" aria-label="Per-task change">{tasks.map((t) => <li key={t.task_id} data-bucket={t.bucket}
      title={`${t.task_id}: ${t.baseline} to ${t.candidate}`}><span>{t.task_id.replace(/^CASE-/, "")}</span></li>)}</ul>
    <TableView head={["Task", "Before", "After", "Change"]}
      rows={tasks.map((t) => [t.task_id, t.baseline, t.candidate, BUCKETS.find((b) => b.key === t.bucket)!.label])} />
  </>;
}

export function Scorecard({ suite, run, system }: { suite: Suite; run?: Run; system?: string }) {
  const score = run ? measured(run.native_score) : null;
  return <article className="bench-card" data-access={suite.access}>
    <header><span className="bench-eyebrow">{suite.layer} · {suite.protocol} protocol</span><h4>{suite.name}</h4></header>
    {score !== null
      ? <div className="bench-chart bench-chart--gauge"><Gauge width={200} height={200} value={score * 100} centerValue={score * 100} suffix="%" defaultLabel={suite.native_metric} totalNotches={36} activeFill="var(--chart-1)" /></div>
      : <p className="bench-card__none">{run ? formatMetric(run.native_score) : "Not run"}</p>}
    <dl>
      <div><dt>Metric</dt><dd>{suite.native_metric}</dd></div>
      <div><dt>Tasks</dt><dd>{suite.task_count ?? "Unknown"}{suite.split ? ` · ${suite.split}` : ""}</dd></div>
      <div><dt>Access</dt><dd>{suite.access}{suite.access_note ? ` · ${suite.access_note}` : ""}</dd></div>
      <div><dt>Provenance</dt><dd>{(run?.provenance ?? suite.provenance).replaceAll("_", " ")}</dd></div>
      {run && <div><dt>System</dt><dd>{system} · {run.mode.replaceAll("_", " ")}</dd></div>}
      {suite.revision && <div><dt>Revision</dt><dd><code>{suite.revision.slice(0, 12)}</code></dd></div>}
    </dl>
    {suite.restrictions.length > 0 && <details><summary>How this result may be described</summary><ul>{suite.restrictions.map((r) => <li key={r}>{r}</li>)}</ul></details>}
  </article>;
}
