"use client";

// One screen per workspace section, each reading the backend routes listed in INTEGRATION.md.
// Nothing is pushed from the server, so every screen polls and keeps its last good data.
import { useMemo, useState, type FormEvent } from "react";
import { Bar, BarChart, BarYAxis, ChartTooltip, Grid } from "@/components/charts";
import { BackendError, backend } from "@/lib/backend/client";
import type { AgentCase, AgentTask, Concern, EvidenceSearch, SimulationEvent, SourceDetail } from "@/lib/backend/types";
import { money, useBackend, when } from "./useBackend";

const go = (section: string) => window.dispatchEvent(new CustomEvent("hyper:navigate-section", { detail: { section } }));
const words = (value: string) => value.replaceAll("_", " ");

function Status({ error, empty, children }: { error: string | null; empty?: string | false | null; children?: React.ReactNode }) {
  if (error) return <p className="ws-warning" role="status">{error}</p>;
  if (empty) return <p className="ws-empty" role="status">{empty}</p>;
  return <>{children}</>;
}

/* ---------------------------------------------------------------- Review */

const SEVERITY: Record<string, string> = { critical: "var(--status-critical)", high: "var(--status-serious)", medium: "var(--status-warning)", low: "var(--status-neutral)" };

function ConcernCard({ concern, onAnswered }: { concern: Concern; onAnswered: () => void }) {
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const card = concern.card;
  const evaluation = card?.evaluation;
  const checks = Object.entries(evaluation?.answers ?? {}).filter(([, a]) => a.probability > 0);

  async function answer(choice: Parameters<typeof backend.respond>[1]) {
    setBusy(true); setNote("");
    try { await backend.respond(concern.id, choice); onAnswered(); }
    catch (reason) { setNote(reason instanceof BackendError && reason.conflict ? "Someone already answered this one." : (reason as Error).message); onAnswered(); }
    finally { setBusy(false); }
  }

  return <article className="ws-card ws-card--decision" data-pointable={`concern:${concern.id}`} data-pointable-label={concern.request.title} data-pointable-data={JSON.stringify({ severity: concern.request.severity, status: concern.status, source_ids: concern.request.source_ids })}>
    <header>
      <span className="ws-chip"><i style={{ background: SEVERITY[concern.request.severity] }} aria-hidden="true" />{concern.request.severity}</span>
      <time>{when(concern.created_at)}</time>
    </header>
    <h3>{concern.request.title}</h3>
    <p>{card?.summary ?? concern.request.description}</p>
    <ol className="ws-options">{card?.options.map((option) => <li key={option.id}>
      <button type="button" disabled={busy} onClick={() => void answer({ option_id: option.id })}>
        <strong>{option.title}</strong>
        <span>{option.action}</span>
        <small>Trade-off: {option.tradeoff}</small>
        {option.requires_approval && <em>Needs your approval again before anything outside happens</em>}
      </button>
    </li>)}</ol>
    <form className="ws-inline" onSubmit={(e: FormEvent) => { e.preventDefault(); if (custom.trim()) void answer({ option_id: "custom", custom_response: custom.trim() }); }}>
      <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={6000} placeholder="Something else: tell the agent what to do" aria-label="Custom instruction" />
      <button type="submit" disabled={busy || !custom.trim()}>Send</button>
    </form>
    {note && <p className="ws-warning">{note}</p>}
    <footer>
      <button type="button" className="ws-link" onClick={() => go("evidence")}>{concern.request.source_ids.length} evidence source{concern.request.source_ids.length === 1 ? "" : "s"}</button>
      <span>{checks.length ? `Checked by ${evaluation?.model}: ${checks.map(([k, a]) => `${k} ${(a.probability * 100).toFixed(0)}%`).join(", ")}` : evaluation?.model ?? "Not evaluated"}</span>
    </footer>
  </article>;
}

export function Review({ active }: { active: boolean }) {
  const { data, error, refresh } = useBackend(() => backend.concerns(undefined, 100), active);
  const concerns = data?.concerns ?? [];
  const waiting = concerns.filter((c) => c.status === "awaiting_response" || c.status === "needs_input");
  const failed = concerns.filter((c) => c.status === "card_failed");
  const rest = concerns.filter((c) => !waiting.includes(c) && !failed.includes(c));
  return <>
    <Heading eyebrow="Review" title={<>Decisions that need <em>your</em> authority.</>} note="The agent investigates and prepares. Anything that commits money, changes a vendor or contacts someone outside comes here first." />
    <Status error={error} empty={data && !concerns.length && "Nothing has been raised yet. Concerns appear here when an agent finds something it may not decide alone."}>
      {waiting.length > 0 && <div className="ws-stack">{waiting.map((c) => <ConcernCard key={c.id} concern={c} onAnswered={refresh} />)}</div>}
      {data && !waiting.length && concerns.length > 0 && <p className="ws-empty">Nothing is waiting on you.</p>}
      {failed.map((c) => <p key={c.id} className="ws-warning">Could not prepare options for &ldquo;{c.request.title}&rdquo;. <button type="button" className="ws-link" onClick={() => void backend.regenerateCard(c.id).finally(refresh)}>Try again</button></p>)}
      {rest.length > 0 && <section className="ws-section"><span className="ws-eyebrow">Already decided</span>
        <ul className="ws-rows">{rest.map((c) => <li key={c.id}>
          <div><strong>{c.request.title}</strong><small>{words(c.status)} · {when(c.updated_at)}</small></div>
          {c.decision && <p><b>You chose:</b> {c.decision.instruction}</p>}
          {c.resolution && <p><b>Outcome:</b> {c.resolution.summary}</p>}
        </li>)}</ul></section>}
    </Status>
  </>;
}

/* ---------------------------------------------------------------- Cases */

function CaseCard({ item, tasks }: { item: AgentCase; tasks: AgentTask[] }) {
  const list = (label: string, values: string[], tone?: string) => values.length > 0 && <div className="ws-list" data-tone={tone}><span className="ws-eyebrow">{label}</span><ul>{values.map((v) => <li key={v}>{v}</li>)}</ul></div>;
  return <article className="ws-card" data-pointable={`case:${item.id}`} data-pointable-label={`Case ${item.case_key}`} data-pointable-data={JSON.stringify({ source_ids: item.state.source_ids, concern_ids: item.state.concern_ids })}>
    <header><span className="ws-chip">{item.case_key}</span><time>Updated {item.version} time{item.version === 1 ? "" : "s"} · {when(item.updated_at)}</time></header>
    <h3>{item.title}</h3>
    <div className="ws-columns">
      {list("Established", item.state.findings)}
      {list("Still unknown", item.state.unknowns, "unknown")}
      {list("Next", item.state.next_actions)}
    </div>
    {tasks.length > 0 && <ul className="ws-rows ws-rows--tight">{tasks.map((t) => <li key={t.id}><div><strong>{t.objective}</strong><small>{words(t.status)}{t.error ? ` · ${t.error}` : ""}</small></div>{t.result && <p>{t.result.summary}</p>}</li>)}</ul>}
    <footer>
      <button type="button" className="ws-link" onClick={() => go("evidence")}>{item.state.source_ids.length} sources</button>
      {item.state.concern_ids.length > 0 && <button type="button" className="ws-link" onClick={() => go("review")}>{item.state.concern_ids.length} decision{item.state.concern_ids.length === 1 ? "" : "s"}</button>}
    </footer>
  </article>;
}

export function Cases({ active }: { active: boolean }) {
  const cases = useBackend(backend.cases, active);
  const tasks = useBackend(backend.tasks, active);
  const controller = useBackend(backend.controller, active, 8000);
  const items = cases.data?.cases ?? [];
  return <>
    <Heading eyebrow="Cases" title={<>What the agent is <em>working</em> on.</>} note="Each case is the agent's own record: what it has established, what it still does not know, and what it will do next." />
    {controller.data && <p className="ws-note">Agent {controller.data.enabled ? words(controller.data.status) : "is switched off"}{controller.data.error ? `. ${controller.data.error}` : "."}</p>}
    <Status error={cases.error} empty={cases.data && !items.length && "No cases yet. They appear once an agent starts grouping evidence."}>
      <div className="ws-stack">{items.map((item) => <CaseCard key={item.id} item={item} tasks={(tasks.data?.tasks ?? []).filter((t) => t.case_id === item.id)} />)}</div>
      {cases.data?.has_more && <p className="ws-note">Showing the first 50 cases.</p>}
    </Status>
  </>;
}

/* ---------------------------------------------------------------- Evidence */

export function Evidence({ active }: { active: boolean }) {
  const datasets = useBackend(backend.datasets, active, 15000);
  const sources = useBackend(() => backend.sources(50), active, 8000);
  const [text, setText] = useState("");
  const [result, setResult] = useState<EvidenceSearch | null>(null);
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [problem, setProblem] = useState("");
  const rows = useMemo(() => (datasets.data?.datasets ?? []).map((d) => ({ dataset: d.dataset, records: d.record_count })).sort((a, b) => b.records - a.records).slice(0, 12), [datasets.data]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setProblem("");
    try { setResult(await backend.searchEvidence(text.trim())); } catch (reason) { setProblem((reason as Error).message); }
  }
  const open = (id: string) => void backend.source(id).then(setDetail).catch((reason) => setProblem((reason as Error).message));

  return <>
    <Heading eyebrow="Evidence" title={<>Every claim traces to a <em>source</em>.</>} note="Originals are stored unchanged. Search returns the stored text with its location, never a paraphrase." />
    <form className="ws-inline ws-inline--search" onSubmit={search}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search the evidence, for example: credit memo duplicate" aria-label="Search evidence" />
      <button type="submit" disabled={!text.trim()}>Search</button>
    </form>
    {problem && <p className="ws-warning">{problem}</p>}
    {result && <section className="ws-section">
      <span className="ws-eyebrow">{result.hits.length} passage{result.hits.length === 1 ? "" : "s"} · {result.mode} search</span>
      {!result.coverage_complete && <p className="ws-warning">{result.unindexed_sources} source{result.unindexed_sources === 1 ? " is" : "s are"} not indexed yet, so this is not the whole picture.</p>}
      <ul className="ws-rows">{result.hits.map((hit) => <li key={hit.id} data-pointable={`source:${hit.source_id}`} data-pointable-label={`${hit.filename} ${hit.locator}`} data-pointable-data={JSON.stringify({ dataset: hit.dataset })}>
        <div><button type="button" className="ws-link" onClick={() => open(hit.source_id)}>{hit.filename}</button><small>{hit.locator}{hit.dataset ? ` · ${hit.dataset}` : ""}</small></div>
        <p className="ws-mono">{hit.content.slice(0, 320)}{hit.content.length > 320 ? "…" : ""}</p>
      </li>)}</ul>
    </section>}
    {detail && <section className="ws-section ws-section--detail">
      <span className="ws-eyebrow">{detail.source.filename} · version {detail.source.version} · {detail.source.sha256.slice(0, 12)}</span>
      <button type="button" className="ws-link" onClick={() => setDetail(null)}>Close</button>
      <ul className="ws-rows ws-rows--tight">{detail.chunks.map((chunk) => <li key={chunk.id}><div><small>{chunk.locator}</small></div><p className="ws-mono">{chunk.content}</p></li>)}</ul>
      {detail.has_more && <p className="ws-note">Showing the first {detail.chunks.length} passages.</p>}
    </section>}
    <div className="ws-grid">
      <section className="ws-section" data-pointable="chart:records-by-dataset" data-pointable-label="Records by dataset chart" data-pointable-data={JSON.stringify({ datasets: rows.map((r) => r.dataset) })}>
        <span className="ws-eyebrow">Records by dataset</span>
        <Status error={datasets.error} empty={datasets.data && !rows.length && "No datasets imported."}>
          {rows.length > 0 && <div className="ws-chart" style={{ height: rows.length * 26 + 40 }}>
            <BarChart data={rows} xDataKey="dataset" orientation="horizontal" className="h-full" aspectRatio="auto" barGap={0.4} margin={{ left: 130, right: 16, top: 4, bottom: 8 }}>
              <Grid vertical horizontal={false} />
              <Bar dataKey="records" fill="var(--chart-1)" lineCap={3} />
              <BarYAxis showAllLabels />
              <ChartTooltip showCrosshair={false} />
            </BarChart>
          </div>}
        </Status>
      </section>
      <section className="ws-section">
        <span className="ws-eyebrow">Sources</span>
        <Status error={sources.error} empty={sources.data && !sources.data.sources.length && "No sources yet. Upload a file or connect an account."}>
          <ul className="ws-rows ws-rows--tight">{sources.data?.sources.map((s) => <li key={s.id} data-pointable={`source:${s.id}`} data-pointable-label={s.filename} data-pointable-data={JSON.stringify({ dataset: s.dataset, records: s.record_count })}>
            <div><button type="button" className="ws-link" onClick={() => open(s.id)}>{s.filename}</button>
              <small>{s.dataset ?? "document"}{s.record_count ? ` · ${s.record_count.toLocaleString("en-US")} records` : ""} · {s.index_status === "ready" ? "searchable" : s.index_status === "failed" ? `indexing failed${s.index_error ? `: ${s.index_error}` : ""}` : "indexing"}</small></div>
          </li>)}</ul>
        </Status>
      </section>
    </div>
  </>;
}

/* ---------------------------------------------------------------- Activity */

type FeedItem = { id: string; at: number; kind: string; title: string; detail?: string; section?: string };

function simulated(event: SimulationEvent): FeedItem {
  const record = event.payload.record;
  const amount = money(record.amount_cents, record.currency);
  return { id: event.id, at: event.published_at ?? Date.parse(event.payload.occurred_at), kind: `${event.payload.source} · simulated`,
    title: words(event.payload.event_type.replace(".created", " recorded")), detail: [amount, record.vendor_id, record.invoice_number].filter(Boolean).join(" · ") || undefined, section: "evidence" };
}

export function Activity({ active }: { active: boolean }) {
  const simulations = useBackend(backend.simulations, active, 10000);
  const run = simulations.data?.simulations[0];
  const events = useBackend(() => run ? backend.simulationEvents(run.id, 0, 100) : Promise.resolve(null), active && !!run);
  const concerns = useBackend(() => backend.concerns(undefined, 100), active);
  const tasks = useBackend(backend.tasks, active);
  const feed = useMemo<FeedItem[]>(() => [
    ...(events.data?.events ?? []).filter((e) => e.status === "published").map(simulated),
    ...(concerns.data?.concerns ?? []).map((c) => ({ id: c.id, at: c.updated_at, kind: `decision · ${words(c.status)}`, title: c.request.title,
      detail: c.resolution?.summary ?? c.decision?.instruction, section: "review" })),
    ...(tasks.data?.tasks ?? []).map((t) => ({ id: t.id, at: 0, kind: `investigation · ${words(t.status)}`, title: t.objective, detail: t.result?.summary ?? t.error ?? undefined, section: "cases" })),
  ].sort((a, b) => b.at - a.at), [events.data, concerns.data, tasks.data]);
  return <>
    <Heading eyebrow="Activity" title={<>What happened, in <em>order</em>.</>} note="Company activity, decisions and investigations on one line. Simulated records are marked as simulated." />
    {run && run.status === "failed" && <p className="ws-warning">The activity simulation stopped: {run.error}. The feed will not move past the failed step until it is restarted.</p>}
    <Status error={concerns.error ?? events.error} empty={concerns.data && !feed.length && "No activity yet."}>
      <ol className="ws-feed">{feed.map((item) => <li key={item.id}>
        <time>{item.at ? when(item.at) : "queued"}</time>
        <div><small>{item.kind}</small><strong>{item.title}</strong>{item.detail && <p>{item.detail}</p>}</div>
        {item.section && <button type="button" className="ws-link" onClick={() => go(item.section!)}>Open</button>}
      </li>)}</ol>
    </Status>
  </>;
}

/* ---------------------------------------------------------------- Overview strip */

export function OverviewStrip({ active }: { active: boolean }) {
  const workspace = useBackend(backend.workspace, active, 15000);
  const concerns = useBackend(() => backend.concerns("awaiting_response", 100), active, 6000);
  const cases = useBackend(backend.cases, active, 10000);
  const controller = useBackend(backend.controller, active, 10000);
  if (!workspace.data) return workspace.error ? <aside className="ws-strip"><span>{workspace.error}</span></aside> : null;
  const waiting = concerns.data?.concerns.length ?? 0;
  return <aside className="ws-strip" aria-label="Workspace status">
    <strong>{workspace.data.organization.name}</strong>
    <button type="button" onClick={() => go("review")} data-alert={waiting > 0 || undefined}>{waiting} waiting on you</button>
    <button type="button" onClick={() => go("cases")}>{cases.data?.cases.length ?? 0} cases</button>
    <span>Agent {controller.data?.enabled ? words(controller.data.status) : "off"}</span>
  </aside>;
}

function Heading({ eyebrow, title, note }: { eyebrow: string; title: React.ReactNode; note: string }) {
  return <header className="ws-heading"><span className="ws-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{note}</p></header>;
}
