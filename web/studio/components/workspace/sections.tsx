"use client";

import { cfoJson, CfoApiError } from "@/lib/command/cfo-api";
import { decisionContext, decisionCommand, type DecisionConcern } from "@/lib/command/cfo-decisions";

import ActivityOrb from "@/components/ui/ActivityOrb";

// One screen per workspace section, each reading the backend routes listed in INTEGRATION.md.
// Nothing is pushed from the server, so every screen polls and keeps its last good data.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Bar, BarChart, BarYAxis, ChartTooltip, Grid } from "@/components/charts";
import { BackendError, backend } from "@/lib/backend/client";
import type { AgentCase, AgentTask, Concern, EvidenceSearch, SimulationEvent } from "@/lib/backend/types";
import { money, useBackend, when } from "./useBackend";
import Adversary from "./Adversary";
import { createSubmissionGuard } from "./submission-guard";
import { EngineCases, PayableApprovals } from "./accounting";
import { CoverageGauge } from "./charts";
import OriginalSourceDownload from "@/components/atrium/workspaces/OriginalSourceDownload";

type RelicSectionProps = { active: boolean; embedded?: boolean; onMotion?: (state: { busy?: boolean; selectedIndex?: number }) => void };

const go = (section: string) => window.dispatchEvent(new CustomEvent("hyper:navigate-section", { detail: { section } }));
const words = (value: string) => value.replaceAll("_", " ");

function Status({ error, empty, children }: { error: string | null; empty?: string | false | null; children?: React.ReactNode }) {
  if (error) return <p className="ws-warning" role="status">{error}</p>;
  if (empty) return <p className="ws-empty" role="status">{empty}</p>;
  return <>{children}</>;
}

/* ---------------------------------------------------------------- Review */

const SEVERITY: Record<string, string> = { critical: "var(--status-critical)", high: "var(--status-serious)", medium: "var(--status-warning)", low: "var(--status-neutral)" };

function ConcernCard({ concern, onAnswered, onBusy }: { concern: Concern; onAnswered: () => void; onBusy?: (id: string, busy: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const guard = useRef(createSubmissionGuard());
  const saved = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  const card = concern.card;
  const evaluation = card?.evaluation;
  const checks = Object.entries(evaluation?.answers ?? {}).filter(([, a]) => a.probability > 0);

  const retryDecision = useRef<{ signature: string; command: ReturnType<typeof decisionCommand> } | null>(null);
  async function answer(choice: Parameters<typeof backend.respond>[1]) {
    if (saved.current || (choice.option_id === "custom" && (!choice.custom_response.trim() || choice.custom_response.trim().length > 4000))) return;
    await guard.current.run(async () => {
      setBusy(true); setNote(""); onBusy?.(concern.id, true);
      try {
        const context = decisionContext(concern as DecisionConcern, 0);
        if (!context) throw new Error("Refresh this decision before choosing. Its version could not be verified.");
        const selected = choice.option_id === "custom" ? { optionId: "custom" as const, instruction: choice.custom_response } : { optionId: choice.option_id };
        const signature = JSON.stringify([context, selected]);
        const command = retryDecision.current?.signature === signature ? retryDecision.current.command : decisionCommand(context, selected, choice.option_id === "custom" ? "text" : "click", crypto.randomUUID());
        retryDecision.current = { signature, command };
        await cfoJson(`/concerns/${encodeURIComponent(concern.id)}/decisions`, { method: "POST", body: JSON.stringify(command) });
        saved.current = true; setSubmitted(true); setNote("Choice recorded. Investigation queued."); onAnswered();
      }
      catch (reason) { setNote((reason instanceof BackendError && reason.conflict) || (reason instanceof CfoApiError && reason.status === 409) ? "This decision changed. Review its current choices." : (reason as Error).message); onAnswered(); }
      finally { setBusy(false); onBusy?.(concern.id, false); }
    });
  }

  return <article className="ws-card ws-card--decision" data-pointable={`concern:${concern.id}`} data-pointable-label={concern.request.title} data-pointable-data={JSON.stringify({ severity: concern.request.severity, status: concern.status, source_ids: concern.request.source_ids })}>
    <header>
      <span className="ws-chip"><i style={{ background: SEVERITY[concern.request.severity] }} aria-hidden="true" />{concern.request.severity}</span>
      <time>{when(concern.created_at)}</time>
    </header>
    <h3>{concern.request.title}</h3>
    <p>{card?.summary ?? concern.request.description}</p>
    <ol className="ws-options">{card?.options.map((option) => <li key={option.id}>
      <button type="button" disabled={busy || submitted} onClick={() => void answer({ option_id: option.id })}>
        <strong>{option.title}</strong>
        <span>{option.action}</span>
        <small>Trade-off: {option.tradeoff}</small>
        {option.requires_approval && <em>Needs approval</em>}
      </button>
    </li>)}</ol>
    <form className="ws-inline" onSubmit={(e: FormEvent) => { e.preventDefault(); if (custom.trim()) void answer({ option_id: "custom", custom_response: custom.trim() }); }}>
      <input value={custom} onChange={(e) => setCustom(e.target.value)} disabled={busy || submitted} maxLength={4000} placeholder="Other instruction" aria-label="Custom instruction" />
      <button type="submit" disabled={busy || submitted || !custom.trim()}>Send</button>
    </form>
    {note && <p className={submitted ? "ws-note" : "ws-warning"} role="status">{note}</p>}
    <footer>
      <button type="button" className="ws-link" onClick={() => go("evidence")}>{concern.request.source_ids.length} evidence source{concern.request.source_ids.length === 1 ? "" : "s"}</button>
      <span>{checks.length ? `Checked by ${evaluation?.model}: ${checks.map(([k, a]) => `${k} ${(a.probability * 100).toFixed(0)}%`).join(", ")}` : evaluation?.model ?? "Not evaluated"}</span>
    </footer>
  </article>;
}

export function Review({ active, embedded = false, onMotion }: RelicSectionProps) {
  const { data, error, refresh } = useBackend(() => backend.concerns(undefined, 100), active);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const onBusy = useCallback((id: string, busy: boolean) => setBusyIds(previous => { const next = new Set(previous); if (busy) next.add(id); else next.delete(id); return next; }), []);
  const concerns = data?.concerns ?? [];
  const waiting = concerns.filter((c) => c.status === "awaiting_response" || c.status === "needs_input");
  const failed = concerns.filter((c) => c.status === "card_failed");
  const rest = concerns.filter((c) => !waiting.includes(c) && !failed.includes(c));
  const working = busyIds.size > 0 || concerns.some(concern => concern.status === "generating" || concern.status === "resolving");
  useEffect(() => { onMotion?.({ busy: active && working, selectedIndex }); }, [active, working, selectedIndex, onMotion]);
  return <>
    {!embedded && <Heading eyebrow="Review" title={<>Decisions that need <em>your</em> authority.</>} />}
    <PayableApprovals active={active} onBusy={onBusy} />
    {!data && !error && <p className="ws-note" role="status">Loading…</p>}
    <Status error={error} empty={data && !concerns.length && "No agent questions waiting"}>
      {waiting.length > 0 && <div className="ws-stack">{waiting.map((c, index) => <div key={c.id} onFocusCapture={() => setSelectedIndex(index)} onClickCapture={() => setSelectedIndex(index)}><ConcernCard concern={c} onAnswered={refresh} onBusy={onBusy} /></div>)}</div>}
      {data && !waiting.length && concerns.length > 0 && <p className="ws-empty">No agent questions waiting</p>}
      {failed.map((c) => <FailedConcern key={c.id} concern={c} refresh={refresh} onBusy={onBusy} />)}
      {rest.length > 0 && <section className="ws-section"><span className="ws-eyebrow">In progress and history</span>
        <ul className="ws-rows">{rest.map((c) => <li key={c.id}>
          <div><strong>{c.request.title}</strong><small>{words(c.status)} · {when(c.updated_at)}</small></div>
          {c.decision && <p><b>You chose:</b> {c.decision.instruction}</p>}
          {c.resolution && <p><b>Outcome:</b> {c.resolution.summary}</p>}
      </li>)}</ul></section>}
      {data?.has_more && <p className="ws-note">First 100 shown</p>}
    </Status>
  </>;
}

function FailedConcern({ concern, refresh, onBusy }: { concern: Concern; refresh: () => void; onBusy: (id: string, busy: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(createSubmissionGuard());
  const retry = () => guard.current.run(async () => {
    setBusy(true); setError(""); onBusy(concern.id, true);
    try { await backend.regenerateCard(concern.id); refresh(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); onBusy(concern.id, false); }
  });
  return <div className="ws-warning"><p>Could not prepare options for &ldquo;{concern.request.title}&rdquo;.</p><button type="button" className="ws-link" disabled={busy} onClick={() => void retry()}>{busy ? "Preparing…" : "Try again"}</button>{error && <p role="status">{error}</p>}</div>;
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
    {tasks.length > 0 && <ul className="ws-rows ws-rows--tight">{tasks.map((t) => <li key={t.id}><div><strong>{t.objective}</strong><small><ActivityOrb status={t.status} label={`Agent: ${words(t.status)}`} />{t.error ? ` ${t.error}` : ""}</small></div>{t.result && <p>{t.result.summary}</p>}</li>)}</ul>}
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
    <Heading eyebrow="Cases" title={<>What the agent is <em>working</em> on.</>} />
    {controller.data && <p className="ws-note">Agent {controller.data.enabled ? words(controller.data.status) : "is switched off"}{controller.data.error ? `. ${controller.data.error}` : "."}</p>}
    <EngineCases active={active} />
    <Status error={cases.error} empty={cases.data && !items.length && "No cases"}>
      <div className="ws-stack">{items.map((item) => <CaseCard key={item.id} item={item} tasks={(tasks.data?.tasks ?? []).filter((t) => t.case_id === item.id)} />)}</div>
      {cases.data?.has_more && <p className="ws-note">First 50 shown</p>}
    </Status>
  </>;
}

/* ---------------------------------------------------------------- Evidence */

export function Evidence({ active, embedded = false, onMotion }: RelicSectionProps) {
  const [offset, setOffset] = useState(0);
  const datasets = useBackend(backend.datasets, active, 15000);
  const sources = useBackend(async () => ({ offset, page: await backend.sources(30, offset) }), active, 8000);
  const [text, setText] = useState("");
  const [result, setResult] = useState<EvidenceSearch | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState("");
  const searchRequest = useRef(0);
  const searchGuard = useRef(createSubmissionGuard());
  const page = sources.data?.offset === offset ? sources.data.page : null;
  const rows = useMemo(() => (datasets.data?.datasets ?? []).map((d) => ({ dataset: d.dataset, records: d.record_count })).sort((a, b) => b.records - a.records).slice(0, 12), [datasets.data]);
  useEffect(() => () => { searchRequest.current += 1; }, [active]);
  useEffect(() => { onMotion?.({ busy: active && searching, selectedIndex }); }, [active, searching, selectedIndex, onMotion]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!active || !text.trim() || text.trim().length > 2000) return;
    await searchGuard.current.run(async () => {
      const request = ++searchRequest.current;
      setSearching(true); setProblem(""); setResult(null);
      try { const next = await backend.searchEvidence(text.trim()); if (request === searchRequest.current) setResult(next); }
      catch (reason) { if (request === searchRequest.current) setProblem((reason as Error).message); }
      finally { setSearching(false); }
    });
  }
  const open = (id: string, index: number) => { setSourceId(id); setSelectedIndex(index); };

  return <>
    {!embedded && <Heading eyebrow="Evidence" title={<>Every claim traces to a <em>source</em>.</>} />}
    <form className="ws-inline ws-inline--search" onSubmit={search}>
      <input value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Search" aria-label="Search evidence" />
      <button type="submit" disabled={searching || !text.trim()}>{searching ? "Searching…" : "Search"}</button>
    </form>
    {problem && <p className="ws-warning" role="status">{problem}</p>}
    {result && <section className="ws-section">
      <div className="ws-source-actions"><span className="ws-eyebrow">{result.hits.length} passage{result.hits.length === 1 ? "" : "s"} · {result.mode} search</span><button type="button" className="ws-link" onClick={() => setResult(null)}>Clear results</button></div>
      {!result.coverage_complete && <p className="ws-warning">{result.unindexed_sources} source{result.unindexed_sources === 1 ? "" : "s"} not indexed yet</p>}
      {!result.hits.length && <p className="ws-note">No matches</p>}
      <ul className="ws-rows">{result.hits.map((hit, index) => <li key={hit.id} data-pointable={`source:${hit.source_id}`} data-pointable-label={`${hit.filename} ${hit.locator}`} data-pointable-data={JSON.stringify({ dataset: hit.dataset })}>
        <div><button type="button" className="ws-link" aria-pressed={sourceId === hit.source_id} onClick={() => open(hit.source_id, index)}>{hit.filename}</button><small>{hit.locator}{hit.dataset ? ` · ${hit.dataset}` : ""}</small></div>
        <p className="ws-mono">{hit.content.slice(0, 320)}{hit.content.length > 320 ? "…" : ""}</p>
      </li>)}</ul>
    </section>}
    {sourceId && <SourceReader key={sourceId} sourceId={sourceId} active={active} close={() => setSourceId(null)} />}
    {page && page.sources.length > 0 && <CoverageGauge percent={(page.sources.filter(source => source.index_status === "ready").length / page.sources.length) * 100} count={page.sources.length} label="sources searchable" />}
    <div className="ws-grid">
      {!embedded && <section className="ws-section" data-pointable="chart:records-by-dataset" data-pointable-label="Records by dataset chart" data-pointable-data={JSON.stringify({ datasets: rows.map((r) => r.dataset) })}>
        <span className="ws-eyebrow">Records by dataset</span>
        <Status error={datasets.error} empty={datasets.data && !rows.length && "No datasets"}>
          {rows.length > 0 && <div className="ws-chart" style={{ height: rows.length * 26 + 40 }}>
            <BarChart data={rows} xDataKey="dataset" orientation="horizontal" className="h-full" aspectRatio="auto" barGap={0.4} margin={{ left: 130, right: 16, top: 4, bottom: 8 }}>
              <Grid vertical horizontal={false} />
              <Bar dataKey="records" fill="var(--chart-1)" lineCap={3} />
              <BarYAxis showAllLabels />
              <ChartTooltip showCrosshair={false} />
            </BarChart>
          </div>}
        </Status>
      </section>}
      <section className="ws-section ws-source-index">
        <span className="ws-eyebrow">Sources</span>
        {!page && !sources.error && <p className="ws-note" role="status">Loading…</p>}
        <Status error={sources.error} empty={page && !page.sources.length && (offset ? "No more sources" : "No sources")}>
          <ul className="ws-rows ws-rows--tight">{page?.sources.map((s, index) => <li key={s.id} data-pointable={`source:${s.id}`} data-pointable-label={s.filename} data-pointable-data={JSON.stringify({ dataset: s.dataset, records: s.record_count })}>
            <div><button type="button" className="ws-link" aria-pressed={sourceId === s.id} onClick={() => open(s.id, offset + index)}>{s.filename}</button>
              <small>{s.dataset ?? "document"}{s.record_count !== null ? ` · ${s.record_count.toLocaleString("en-US")} records` : ""} · {s.index_status === "ready" ? "searchable" : s.index_status === "failed" ? `indexing failed${s.index_error ? `: ${s.index_error}` : ""}` : "indexing"}</small></div>
          </li>)}</ul>
        </Status>
        {(offset > 0 || page?.has_more) && <div className="ws-source-actions"><button type="button" className="ws-link" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - 30)); sources.refresh(); }}>Previous sources</button><span className="ws-note">{page?.sources.length ? `${offset + 1} to ${offset + page.sources.length}` : ""}</span><button type="button" className="ws-link" disabled={!page?.has_more} onClick={() => { setOffset(page?.next_offset ?? offset + 30); sources.refresh(); }}>Next sources</button></div>}
        {sources.error && <button type="button" className="ws-link" onClick={sources.refresh}>Try again</button>}
      </section>
    </div>
  </>;
}

function SourceReader({ sourceId, active, close }: { sourceId: string; active: boolean; close: () => void }) {
  const [offset, setOffset] = useState(0);
  const source = useBackend(async () => ({ offset, detail: await backend.source(sourceId, offset, 10) }), active, 15000);
  const detail = source.data?.offset === offset ? source.data.detail : null;
  return <section className="ws-section ws-source-reader" aria-label="Selected source">
    <div className="ws-source-actions"><span className="ws-eyebrow">Source evidence</span><button type="button" className="ws-link" onClick={close}>Close source</button></div>
    {source.error && <p className="ws-warning" role="status">{source.error}</p>}
    {!detail && !source.error && <p className="ws-note" role="status">Loading…</p>}
    {detail && <>
      <h3>{detail.source.filename}</h3>
      <div className="ws-source-actions"><span className="ws-note">Version {detail.source.version} · {when(detail.source.created_at)}</span><OriginalSourceDownload sourceId={sourceId} filename={detail.source.filename} /></div>
      <ul className="ws-rows ws-rows--tight">{detail.chunks.map(chunk => <li key={chunk.id}><div><small>{chunk.locator}</small></div><p className="ws-mono">{chunk.content}</p></li>)}</ul>
      {!detail.chunks.length && <p className="ws-note">No passages</p>}
      {(offset > 0 || detail.has_more) && <div className="ws-source-actions"><button type="button" className="ws-link" disabled={!offset} onClick={() => { setOffset(Math.max(0, offset - 10)); source.refresh(); }}>Previous passages</button><button type="button" className="ws-link" disabled={!detail.has_more} onClick={() => { setOffset(detail.next_offset ?? offset + 10); source.refresh(); }}>Next passages</button></div>}
    </>}
    {source.error && <button type="button" className="ws-link" onClick={source.refresh}>Try again</button>}
  </section>;
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
    <Heading eyebrow="Activity" title={<>What happened, in <em>order</em>.</>} />
    <Adversary active={active} />
    {run && run.status === "failed" && <p className="ws-warning">Simulation stopped: {run.error}</p>}
    <Status error={concerns.error ?? events.error} empty={concerns.data && !feed.length && "No activity"}>
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

function Heading({ title }: { eyebrow: string; title: React.ReactNode }) {
  return <header className="ws-heading"><h2>{title}</h2></header>;
}
