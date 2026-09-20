"use client";

import ActivityOrb from "@/components/ui/ActivityOrb";

// The deterministic AP engine, surfaced. Every amount here is computed by code from owner-verified
// records. The approval button sends the exact hash on screen, so what was read is what gets approved.
import { useRef, useState } from "react";
import { backend, BackendError } from "@/lib/backend/client";
import type { EngineCase, PayableProposal } from "@/lib/backend/types";
import { ChecksRing, PayableFunnel, RouteBars, VolumeArea } from "./charts";
import { PayableHandoff } from "./handoff";
import { useBackend } from "./useBackend";

const cents = (value: number, currency: string) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value / 100); }
  catch { return `${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${currency}`; }
};
const words = (value: string) => value.replaceAll("_", " ").toLowerCase();

function ProposalCard({ proposal, onDecided, onBusy }: { proposal: PayableProposal; onDecided: () => void; onBusy?: (id: string, busy: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const sending = useRef(false);
  const { payload } = proposal;
  const passing = proposal.checks.every(check => check.ok);
  const pending = proposal.approval?.status === "PENDING" && proposal.status === "DRAFT";

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    onBusy?.(`proposal:${proposal.proposal_id}`, true);
    setNote(null);
    try {
      await backend.decideProposal(proposal.proposal_id, proposal.hash, decision);
      setNote({ ok: true, text: decision === "APPROVED" ? "Approved" : "Rejected" });
    } catch (reason) {
      const status = reason instanceof BackendError ? reason.status : 0;
      setNote({ ok: false, text: status === 403 ? "An organization owner must approve this proposal." : (reason as Error).message });
    } finally {
      sending.current = false;
      setBusy(false);
      onBusy?.(`proposal:${proposal.proposal_id}`, false);
      onDecided();
    }
  }

  return <article className="ws-card ws-card--decision" data-pointable={`proposal:${proposal.proposal_id}`} data-pointable-label={`Payable proposal for ${payload.invoice_id}`}
    data-pointable-data={JSON.stringify({ invoice_id: payload.invoice_id, net_payable_cents: payload.net_payable_cents, currency: payload.currency, approval: proposal.approval?.status ?? null })}>
    <header>
      <span className="ws-chip">{payload.invoice_id}</span>
      <time>{proposal.approval ? words(proposal.approval.status) : "not requested"} · revision {proposal.based_on_revision}</time>
    </header>
    <div className="ws-figure">
      <h3>{cents(payload.net_payable_cents, payload.currency)}</h3>
      <ChecksRing passed={proposal.checks.filter(check => check.ok).length} total={proposal.checks.length} />
    </div>
    <PayableFunnel billed={payload.invoice_face_cents} credits={payload.credits.map(credit => ({ id: credit.credit_id, cents: credit.amount_cents }))} currency={payload.currency} />
    {!passing && <ul className="ws-checks">{proposal.checks.filter(check => !check.ok).map(check => <li key={check.name} data-ok="false">{words(check.name)}</li>)}</ul>}
    {pending && <div className="ws-actions">
      <button type="button" disabled={busy || !passing} onClick={() => void decide("APPROVED")}>Approve</button>
      <button type="button" className="ws-link" disabled={busy} onClick={() => void decide("REJECTED")}>Reject</button>
    </div>}
    {note && <p className={note.ok ? "ws-note" : "ws-warning"} role="status">{note.text}</p>}
    <footer><span>{proposal.hash.slice(0, 12)}</span></footer>
  </article>;
}

/** Payables prepared for an owner's decision. Approval does not execute a payment. */
// One payable open at a time. A real queue is dozens long: a chart for every one of them is noise and a
// lot of drawing, so the rest stay as one line each until chosen.
const POLL_MS = 30000;
const VISIBLE_ROWS = 12;

export function PayableApprovals({ active, onBusy }: { active: boolean; onBusy?: (id: string, busy: boolean) => void }) {
  const { data, refresh } = useBackend(backend.payableProposals, active, POLL_MS);
  const [chosen, setChosen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const proposals = data?.proposals ?? [];
  const waiting = proposals.filter(proposal => proposal.approval?.status === "PENDING" && proposal.status === "DRAFT");
  const approved = proposals.filter(proposal => proposal.approval?.status === "APPROVED");
  const closed = proposals.filter(proposal => proposal.approval && !["PENDING", "APPROVED"].includes(proposal.approval.status));
  if (!proposals.length) return null;
  const queue = [...approved, ...waiting];
  const open = queue.find(proposal => proposal.proposal_id === chosen) ?? approved[0] ?? waiting[0];
  const rows = queue.filter(proposal => proposal !== open);
  const total = waiting.reduce((sum, proposal) => sum + proposal.payload.net_payable_cents, 0);
  const currency = (waiting[0] ?? queue[0])?.payload.currency ?? "USD";
  return <section className="ws-section" data-pointable="group:payable-approvals" data-pointable-label="Payables ready for approval"
    data-pointable-data={JSON.stringify({ waiting: waiting.length, approved: approved.length, waiting_total_cents: total, currency })}>
    <span className="ws-eyebrow">Payables · {waiting.length} waiting{waiting.length ? ` · ${cents(total, currency)}` : ""}</span>
    {open && (open.approval?.status === "APPROVED"
      ? <PayableHandoff key={open.proposal_id} proposalId={open.proposal_id} active={active} onChanged={refresh} />
      : <ProposalCard key={open.proposal_id} proposal={open} onDecided={refresh} onBusy={onBusy} />)}
    {rows.length > 0 && <ul className="ws-queue">{(all ? rows : rows.slice(0, VISIBLE_ROWS)).map(proposal => <li key={proposal.proposal_id}>
      <button type="button" onClick={() => setChosen(proposal.proposal_id)} data-cursor="hide" data-pointable={`proposal:${proposal.proposal_id}`} data-pointable-label={`Payable ${proposal.payload.invoice_id}`}
        data-pointable-data={JSON.stringify({ net_payable_cents: proposal.payload.net_payable_cents, billed_cents: proposal.payload.invoice_face_cents, approval: proposal.approval?.status ?? null })}>
        <i data-state={proposal.approval?.status === "APPROVED" ? "approved" : proposal.checks.every(check => check.ok) ? "ready" : "blocked"} aria-hidden="true" />
        <span>{proposal.payload.invoice_id}</span>
        <strong>{cents(proposal.payload.net_payable_cents, proposal.payload.currency)}</strong>
      </button>
    </li>)}</ul>}
    {rows.length > VISIBLE_ROWS && <button type="button" className="ws-link" onClick={() => setAll(value => !value)}>{all ? "Fewer" : `All ${rows.length}`}</button>}
    {closed.length > 0 && <ul className="ws-rows ws-rows--tight">{closed.map(proposal => <li key={proposal.proposal_id}>
      <div><strong>{proposal.payload.invoice_id} · {cents(proposal.payload.net_payable_cents, proposal.payload.currency)}</strong><small>{words(proposal.approval!.status)}</small></div>
    </li>)}</ul>}
  </section>;
}

function EngineCaseCard({ item }: { item: EngineCase }) {
  const calc = item.calculation;
  return <article className="ws-card" data-pointable={`payable-case:${item.case_id}`} data-pointable-label={`Payable case ${item.invoice_id}`}
    data-pointable-data={JSON.stringify({ invoice_id: item.invoice_id, ties: calc?.ties ?? null, residual_cents: calc?.residual_cents ?? null, blocking: item.blocking_issues.length })}>
    <header><span className="ws-chip">{item.invoice_id}</span><span><ActivityOrb status={item.work_status} label={`Case: ${words(item.work_status)}`} /> · revision {item.revision}</span></header>
    {calc ? <>
      <h3 data-ties={calc.ties}>{cents(calc.ties ? calc.net_after_credits_cents : Math.abs(calc.residual_cents), calc.currency)}{!calc.ties && <small> unexplained</small>}</h3>
      <RouteBars netCents={calc.net_after_credits_cents} supportedCents={calc.independently_supported_cents} currency={calc.currency} />
    </> : <p className="ws-warning">{item.error ?? "Unavailable"}</p>}
    {item.blocking_issues.length > 0 && <div className="ws-list" data-tone="warn"><span className="ws-eyebrow">Blocking</span><ul>{item.blocking_issues.map((issue, index) => <li key={index}>{issue.description}</li>)}</ul></div>}
  </article>;
}

/** Engine cases: two independent routes to the payable that must agree before anything is proposed. */
export function EngineCases({ active }: { active: boolean }) {
  const { data } = useBackend(backend.engineCases, active, POLL_MS);
  const [chosen, setChosen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  // Blocked cases are the ones that need someone, so they lead.
  const cases = [...(data?.cases ?? [])].sort((x, y) => Number(y.blocking_issues.length > 0) - Number(x.blocking_issues.length > 0));
  if (!cases.length) return null;
  const blocked = cases.filter(item => item.blocking_issues.length > 0).length;
  const open = cases.find(item => item.case_id === chosen) ?? cases[0];
  const rows = cases.filter(item => item !== open);
  return <section className="ws-section" data-pointable="group:payable-cases" data-pointable-label="Payable cases" data-pointable-data={JSON.stringify({ cases: cases.length, blocked })}>
    <span className="ws-eyebrow">Payable cases · {cases.length}{blocked ? ` · ${blocked} blocked` : ""}</span>
    <EngineCaseCard key={open.case_id} item={open} />
    {rows.length > 0 && <ul className="ws-queue">{(all ? rows : rows.slice(0, VISIBLE_ROWS)).map(item => <li key={item.case_id}>
      <button type="button" onClick={() => setChosen(item.case_id)} data-cursor="hide" data-pointable={`payable-case:${item.case_id}`} data-pointable-label={`Payable case ${item.invoice_id}`}>
        <i data-state={item.blocking_issues.length ? "blocked" : item.calculation?.ties ? "ready" : "open"} aria-hidden="true" />
        <span>{item.invoice_id}</span>
        <strong>{item.calculation ? cents(item.calculation.net_after_credits_cents, item.calculation.currency) : "–"}</strong>
      </button>
    </li>)}</ul>}
    {rows.length > VISIBLE_ROWS && <button type="button" className="ws-link" onClick={() => setAll(value => !value)}>{all ? "Fewer" : `All ${rows.length}`}</button>}
  </section>;
}

/** Payables booked per period, read from the imported invoices. */
export function PayablesVolume({ active, dataset }: { active: boolean; dataset: string }) {
  const { data } = useBackend(async () => {
    const query = { dataset, group_by: ["date"], limit: 200 };
    // Exact sums need Postgres; the count still shows the shape of activity when only SQLite is there.
    try { return { unit: "sum" as const, result: await backend.aggregate({ ...query, operation: "sum", field: "amount_cents" }) }; }
    catch { return { unit: "count" as const, result: await backend.aggregate({ ...query, operation: "count" }) }; }
  }, active, 30000);
  const points = (data?.result.results ?? [])
    .map(row => ({ date: new Date(`${String(Object.values(row.group ?? {})[0])}T00:00:00Z`), value: Number(row.value) / (data?.unit === "sum" ? 100 : 1) }))
    .filter(point => !Number.isNaN(point.date.getTime()) && Number.isFinite(point.value))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (points.length < 2) return null;
  return <section className="ws-hero" data-pointable="chart:payables-volume" data-pointable-label="Payables by month" data-pointable-data={JSON.stringify({ dataset, unit: data?.unit, periods: points.length })}>
    <span className="ws-eyebrow">{data?.unit === "sum" ? "Payables booked" : "Invoices booked"}</span>
    <VolumeArea points={points} />
  </section>;
}
