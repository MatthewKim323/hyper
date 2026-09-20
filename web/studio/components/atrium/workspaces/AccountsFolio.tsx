"use client";

import ActivityOrb from "@/components/ui/ActivityOrb";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { backend } from "@/lib/backend/client";
import { getBackendToken, openSignIn } from "@/lib/backend/auth";
import type { AgentCase, AgentTask, Concern } from "@/lib/backend/types";
import { useAuth, useBackend } from "@/components/workspace/useBackend";
import { eligibleInvoiceDatasets, fieldText, invoiceAmount, invoiceLines, isSyntheticRecord, preferredInvoiceDataset, readInvoicePage, sourceWork, valueText, type InvoiceAmount, type InvoiceRow } from "./accounts-data";
import { EngineCases, PayablesVolume } from "@/components/workspace/accounting";
import styles from "./AccountsFolio.module.css";

type MotionState = { busy?: boolean; selectedIndex?: number; values?: readonly (number | null)[] };
type Props = { active: boolean; onMotion?: (state: MotionState) => void };
const PAGE_SIZE = 30;
const words = (text: string) => text.replaceAll("_", " ");

function Amount({ amount }: { amount: InvoiceAmount | null }) {
  return amount ? <><span>{amount.value}</span><small>{[amount.currency ?? "Currency unspecified", amount.units].filter(Boolean).join(" · ")}</small></> : <><span>Not supplied</span><small>Invoice amount</small></>;
}

function SourceDownload({ sourceId, filename }: { sourceId: string; filename: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function download() {
    setBusy(true); setError(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const token = await getBackendToken();
      if (!token) throw new Error("Sign in again.");
      const response = await fetch(`/api/onboarding/sources/${encodeURIComponent(sourceId)}/download`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error("Download failed. Try again.");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      if (!controller.signal.aborted) setError((reason as Error).message);
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <div><button className={styles.textButton} type="button" disabled={busy} onClick={() => void download()}>{busy ? "Preparing…" : "Download original ↗"}</button>{error && <p className={styles.warning} role="status">{error}</p>}</div>;
}

function SourcePages({ sourceId, active }: { sourceId: string; active: boolean }) {
  const [offset, setOffset] = useState(0);
  const source = useBackend(async () => ({ offset, detail: await backend.source(sourceId, offset, 10) }), active, 15000);
  const detail = source.data?.offset === offset ? source.data.detail : null;
  return <details className={styles.sourcePages}>
    <summary>Source evidence</summary>
    {source.error && <p className={styles.warning} role="status">{source.error}</p>}
    {!detail && !source.error && <p className={styles.note}>Loading…</p>}
    {detail && <>
      <div className={styles.sourceMeta}><span>{detail.source.filename} · v{detail.source.version}</span><SourceDownload key={sourceId} sourceId={sourceId} filename={detail.source.filename} /></div>
      {detail.chunks.map(chunk => <section className={styles.passage} key={chunk.id}><span>{chunk.locator}</span><pre>{chunk.content}</pre></section>)}
      <div className={styles.pagination}><button type="button" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - 10)); source.refresh(); }}>Previous passages</button><button type="button" disabled={!detail.has_more} onClick={() => { setOffset(detail.next_offset ?? offset + 10); source.refresh(); }}>Next passages</button></div>
    </>}
  </details>;
}

function InvoicePaper({ row, active }: { row: InvoiceRow; active: boolean }) {
  const record = row.payload;
  const lines = invoiceLines(record);
  const amount = invoiceAmount(record, row.currency);
  const number = fieldText(record, "invoice_number", "invoice_id", "id") ?? row.record_id;
  const vendor = fieldText(record, "vendor_name", "vendor_display_name", "supplier_name", "vendor_id") ?? "Vendor not supplied";
  const status = fieldText(record, "status", "state");
  return <article className={styles.paper} aria-label={`Invoice ${number}`} data-pointable={`invoice:${row.source_id}:${row.record_id}`} data-pointable-label={`Invoice ${number}`} data-pointable-data={JSON.stringify({ source_id: row.source_id, row: row.row_number, record_id: row.record_id })}>
    <header className={styles.paperHeader}>
      <div><h3>{vendor}</h3><p>{number}</p></div>
      <div className={styles.amount}><Amount amount={amount} /></div>
    </header>
    <div className={styles.identity}>
      <div><span>Invoice date</span><strong>{fieldText(record, "invoice_date", "date", "issue_date") ?? "Not supplied"}</strong></div>
      <div><span>Due date</span><strong>{fieldText(record, "due_date", "payment_due_date") ?? "Not supplied"}</strong></div>
      <div><span>Recorded status</span><strong>{status ? words(status) : "Unknown"}</strong></div>
    </div>
    {isSyntheticRecord(record) && <p className={styles.simulated}>Simulated source record</p>}
    {fieldText(record, "description", "memo") && <p className={styles.description}>{fieldText(record, "description", "memo")}</p>}
    <section className={styles.lineItems} aria-label="Extracted line items">
      {lines.length ? <div className={styles.tableScroll}><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>{lines.map((line, index) => {
        const lineAmount = invoiceAmount(line, row.currency);
        const unitPrice = invoiceAmount(line, row.currency, ["unit_price_cents", "unit_price_minor", "unit_price"]);
        return <tr key={index}><td>{fieldText(line, "description", "name", "item", "product_name", "sku") ?? `Line ${index + 1}`}</td><td>{valueText(line.quantity) ?? "Not supplied"}</td><td>{unitPrice ? <Amount amount={unitPrice} /> : "Not supplied"}</td><td>{lineAmount ? <Amount amount={lineAmount} /> : "Not supplied"}</td></tr>;
      })}</tbody></table></div> : <p className={styles.note}>No line items</p>}
    </section>
    <div className={styles.paperTotal}><span>Gross invoice amount</span><div><Amount amount={amount} /></div></div>
    <details className={styles.fields}><summary>All recorded fields</summary><dl>{Object.entries(record).map(([key, value]) => <div key={key}><dt>{words(key)}</dt><dd>{value === null ? "Not supplied" : typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></details>
    <SourcePages key={row.source_id} sourceId={row.source_id} active={active} />
    <footer className={styles.paperFooter}><span>Source {row.source_id}</span><span>Row {row.row_number}</span></footer>
  </article>;
}

function AgentNotes({ row, cases, tasks, concerns, errors, partial, loading }: { row: InvoiceRow; cases: AgentCase[]; tasks: AgentTask[]; concerns: Concern[]; errors: (string | null)[]; partial: boolean; loading: boolean }) {
  const work = sourceWork(row.source_id, cases, tasks, concerns);
  const waiting = work.concerns.filter(concern => ["awaiting_response", "needs_input"].includes(concern.status));
  const unknowns = work.cases.flatMap(item => item.state.unknowns.map(text => ({ id: item.id, text })));
  const actions = work.cases.flatMap(item => item.state.next_actions.map(text => ({ id: item.id, text })));
  const uniqueErrors = [...new Set(errors.filter(Boolean))];
  return <aside className={styles.agentNotes} aria-label="Agent notes">
    <h3>What needs attention</h3>
    {uniqueErrors.map(error => <p className={styles.warning} key={error} role="status">{error}</p>)}
    {loading && <p className={styles.note} role="status">Loading…</p>}
    {partial && <p className={styles.note}>Partial results</p>}
    {waiting.length > 0 && <section className={styles.noteSection}><h4>Waiting on you</h4>{waiting.map(concern => <div key={concern.id}><strong>{concern.request.title}</strong><p>{concern.card?.summary ?? concern.request.description}</p><button type="button" className={styles.textButton} onClick={() => window.dispatchEvent(new CustomEvent("hyper:navigate-section", { detail: { section: "review" } }))}>Review decision ↗</button></div>)}</section>}
    {!loading && <section className={styles.noteSection}><h4>Still unknown</h4>{unknowns.length ? <ul>{unknowns.map((item, index) => <li key={`${item.id}:${index}`}>{item.text}</li>)}</ul> : <p className={styles.note}>None recorded</p>}</section>}
    {!loading && <section className={styles.noteSection}><h4>The agent&apos;s next step</h4>{actions.length ? <ul>{actions.map((item, index) => <li key={`${item.id}:${index}`}>{item.text}</li>)}</ul> : <p className={styles.note}>None recorded</p>}</section>}
    {work.tasks.length > 0 && <section className={styles.noteSection}><h4>Investigation activity</h4>{work.tasks.map(task => <div key={task.id}><strong>{task.objective}</strong><span className={styles.taskStatus}><ActivityOrb status={task.status} label={`Investigation: ${words(task.status)}`} /></span>{(task.result?.summary || task.error) && <p>{task.result?.summary ?? task.error}</p>}</div>)}</section>}
  </aside>;
}

function FolioPages({ dataset, active, onMotion }: Props & { dataset: string }) {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const page = useBackend(async () => ({ offset, result: readInvoicePage(await backend.aggregate({ dataset, operation: "rows", limit: PAGE_SIZE, offset })) }), active, 8000);
  const cases = useBackend(backend.cases, active, 8000);
  const tasks = useBackend(backend.tasks, active, 5000);
  const concerns = useBackend(() => backend.concerns(undefined, 100), active, 8000);
  const data = page.data?.offset === offset ? page.data.result : null;
  const items = useMemo(() => (data?.rows ?? []).filter(row => !filter.trim() || [row.record_id, ...Object.values(row.payload).filter(value => typeof value === "string")].join(" ").toLowerCase().includes(filter.toLowerCase().trim())), [data, filter]);
  const key = (row: InvoiceRow) => `${row.source_id}:${row.record_id}`;
  const row = items.find(item => key(item) === selected) ?? items[0];
  const selectedIndex = row ? data?.rows.findIndex(item => key(item) === key(row)) ?? 0 : 0;
  const busy = row ? sourceWork(row.source_id, cases.data?.cases ?? [], tasks.data?.tasks ?? [], concerns.data?.concerns ?? []).busy : false;
  useEffect(() => { onMotion?.({ busy, selectedIndex }); }, [onMotion, busy, selectedIndex]);
  useEffect(() => () => { onMotion?.({ busy: false, selectedIndex: 0 }); }, [onMotion]);
  const filterId = useId();
  if (page.error && !data) return <div className={styles.empty}><p role="status">{page.error}</p><button type="button" onClick={page.refresh}>Try again</button></div>;
  if (!data) return <div className={styles.loading} role="status"><ActivityOrb status="loading" label="Loading invoices" /><span>Loading…</span></div>;
  if (!data.rows.length) return <div className={styles.empty}><h3>No invoices</h3><button type="button" onClick={page.refresh}>Check again</button></div>;
  return <>
    {page.error && <p className={styles.warning} role="status">{page.error}</p>}
    <div className={styles.folio}>
      <aside className={styles.queue} aria-label="Invoice queue">
        <header><span className={styles.pageCount}>{data.total_matching.toLocaleString()} records</span></header>
        <label className={styles.search} htmlFor={filterId}><span className={styles.srOnly}>Filter this page of invoices</span><input id={filterId} value={filter} onChange={event => setFilter(event.target.value)} placeholder="Find…" type="search" /></label>
        <div className={styles.queueItems}>{items.map(item => {
          const number = fieldText(item.payload, "invoice_number", "invoice_id", "id") ?? item.record_id;
          const chosen = !!row && key(item) === key(row);
          const amount = invoiceAmount(item.payload, item.currency);
          return <button type="button" className={styles.sheetTab} key={key(item)} aria-pressed={chosen} onClick={() => setSelected(key(item))}>
            <span className={styles.sheetNumber}>{String(offset + data.rows.findIndex(candidate => key(candidate) === key(item)) + 1).padStart(2, "0")}</span><span className={styles.sheetContent}><strong>{fieldText(item.payload, "vendor_name", "vendor_display_name", "supplier_name", "vendor_id") ?? number}</strong><span>{number}</span><small>{amount ? `${amount.value} ${amount.currency ?? "Currency unspecified"}${amount.units ? ` · ${amount.units}` : ""}` : "Amount not supplied"}</small>{(isSyntheticRecord(item.payload) || dataset === "sim_bill") && <em>Simulated</em>}</span><span className={styles.sheetArrow} aria-hidden="true">↗</span>
          </button>;
        })}{items.length === 0 && <p className={styles.note}>No matches</p>}</div>
        <footer className={styles.pagination}><button type="button" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setSelected(null); page.refresh(); }}>← Previous</button><span>{offset + 1} to {offset + data.rows.length}</span><button type="button" disabled={!data.has_more} onClick={() => { setOffset(data.next_offset); setSelected(null); page.refresh(); }}>Next →</button></footer>
      </aside>
      {row && <div className={styles.readingArea}><InvoicePaper key={key(row)} row={row} active={active} /><AgentNotes row={row} cases={cases.data?.cases ?? []} tasks={tasks.data?.tasks ?? []} concerns={concerns.data?.concerns ?? []} errors={[cases.error, tasks.error, concerns.error]} partial={!!cases.data?.has_more || !!tasks.data?.has_more || !!concerns.data?.has_more} loading={(!cases.data && !cases.error) || (!tasks.data && !tasks.error) || (!concerns.data && !concerns.error)} /></div>}
    </div>
  </>;
}

export default function AccountsFolio({ active, onMotion }: Props) {
  const auth = useAuth();
  const catalog = useBackend(backend.datasets, active && auth.ready && auth.signedIn, 15000);
  const [chosenDataset, setChosenDataset] = useState<string | null>(null);
  const datasets = eligibleInvoiceDatasets(catalog.data?.datasets ?? []);
  const dataset = datasets.some(item => item.dataset === chosenDataset) ? chosenDataset : preferredInvoiceDataset(datasets);
  const selectId = useId();
  if (!auth.ready) return <div className={styles.empty} role="status"><p>Loading…</p></div>;
  if (!auth.signedIn) return <div className={styles.empty}><h3>{auth.mode === "unconfigured" ? "Sign-in unavailable" : "Sign in to view"}</h3>{auth.mode === "clerk" && <button type="button" onClick={() => void openSignIn()}>Sign in</button>}</div>;
  return <div className={styles.root}>
    <div className={styles.toolbar}>{datasets.length > 0 && <label htmlFor={selectId}><span>Collection</span><select id={selectId} value={dataset ?? ""} onChange={event => setChosenDataset(event.target.value)}>{!dataset && <option value="" disabled>Choose</option>}{datasets.map(item => <option key={item.dataset} value={item.dataset}>{words(item.dataset)} ({item.record_count})</option>)}</select></label>}</div>
    {catalog.error && <p className={styles.warning} role="status">{catalog.error} <button type="button" className={styles.textButton} onClick={catalog.refresh}>Retry</button></p>}
    {!catalog.data && !catalog.error && <div className={styles.loading} role="status"><ActivityOrb status="loading" label="Loading invoices" /><span>Loading…</span></div>}
    {catalog.data && !dataset && <div className={styles.empty}><h3>No invoices</h3><button type="button" onClick={catalog.refresh}>Check for imports</button></div>}
    {/* Payables the deterministic engine has worked out from owner-verified records, above the raw folio. */}
    {dataset && <PayablesVolume key={`volume:${dataset}`} active={active} dataset={dataset} />}
    <EngineCases active={active} />
    {dataset && <FolioPages key={dataset} dataset={dataset} active={active} onMotion={onMotion} />}
  </div>;
}
