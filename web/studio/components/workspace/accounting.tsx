"use client";

// The deterministic AP engine, surfaced. Every amount here is computed by code from owner-verified
// records. The approval button sends the exact hash on screen, so what was read is what gets approved.
import { useRef, useState } from "react";
import { backend, BackendError } from "@/lib/backend/client";
import type { EngineCase, PayableProposal } from "@/lib/backend/types";
import { ChecksRing, PayableWaterfall, RouteBars } from "./charts";
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
      setNote({ ok: false, text: status === 403 ? "Owner only" : (reason as Error).message });
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
    <PayableWaterfall billed={payload.invoice_face_cents} credits={payload.credits.map(credit => ({ id: credit.credit_id, cents: credit.amount_cents }))} currency={payload.currency} />
    {!passing && <ul className="ws-checks">{proposal.checks.filter(check => !check.ok).map(check => <li key={check.name} data-ok="false">{words(check.name)}</li>)}</ul>}
    {pending && <div className="ws-actions">
      <button type="button" disabled={busy || !passing} onClick={() => void decide("APPROVED")}>Approve</button>
      <button type="button" className="ws-link" disabled={busy} onClick={() => void decide("REJECTED")}>Reject</button>
    </div>}
    {note && <p className={note.ok ? "ws-note" : "ws-warning"} role="status">{note.text}</p>}
    <footer><span>{proposal.hash.slice(0, 12)}</span></footer>
  </article>;
}

/** Payables the engine has prepared. Shown in Review: this is the approval that actually moves money. */
export function PayableApprovals({ active, onBusy }: { active: boolean; onBusy?: (id: string, busy: boolean) => void }) {
  const { data, refresh } = useBackend(backend.payableProposals, active, 6000);
  const proposals = data?.proposals ?? [];
  const waiting = proposals.filter(proposal => proposal.approval?.status === "PENDING" && proposal.status === "DRAFT");
  const decided = proposals.filter(proposal => !waiting.includes(proposal) && proposal.approval && proposal.approval.status !== "PENDING");
  if (!proposals.length) return null;
  return <section className="ws-section" data-pointable="group:payable-approvals" data-pointable-label="Payables ready for approval">
    <span className="ws-eyebrow">Payables</span>
    <div className="ws-stack">{waiting.map(proposal => <ProposalCard key={proposal.proposal_id} proposal={proposal} onDecided={refresh} onBusy={onBusy} />)}</div>
    {decided.length > 0 && <ul className="ws-rows ws-rows--tight">{decided.map(proposal => <li key={proposal.proposal_id}>
      <div><strong>{proposal.payload.invoice_id} · {cents(proposal.payload.net_payable_cents, proposal.payload.currency)}</strong><small>{words(proposal.approval!.status)}{proposal.approval!.decided_at ? ` · ${new Date(proposal.approval!.decided_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}</small></div>
    </li>)}</ul>}
  </section>;
}

function EngineCaseCard({ item }: { item: EngineCase }) {
  const calc = item.calculation;
  return <article className="ws-card" data-pointable={`payable-case:${item.case_id}`} data-pointable-label={`Payable case ${item.invoice_id}`}
    data-pointable-data={JSON.stringify({ invoice_id: item.invoice_id, ties: calc?.ties ?? null, residual_cents: calc?.residual_cents ?? null, blocking: item.blocking_issues.length })}>
    <header><span className="ws-chip">{item.invoice_id}</span><time>{words(item.work_status)} · revision {item.revision}</time></header>
    {calc ? <>
      <h3 data-ties={calc.ties}>{cents(calc.ties ? calc.net_after_credits_cents : Math.abs(calc.residual_cents), calc.currency)}{!calc.ties && <small> unexplained</small>}</h3>
      <RouteBars netCents={calc.net_after_credits_cents} supportedCents={calc.independently_supported_cents} currency={calc.currency} />
    </> : <p className="ws-warning">{item.error ?? "Unavailable"}</p>}
    {item.blocking_issues.length > 0 && <div className="ws-list" data-tone="warn"><span className="ws-eyebrow">Blocking</span><ul>{item.blocking_issues.map((issue, index) => <li key={index}>{issue.description}</li>)}</ul></div>}
  </article>;
}

/** Engine cases: two independent routes to the payable that must agree before anything is proposed. */
export function EngineCases({ active }: { active: boolean }) {
  const { data } = useBackend(backend.engineCases, active, 6000);
  const cases = data?.cases ?? [];
  if (!cases.length) return null;
  return <section className="ws-section" data-pointable="group:payable-cases" data-pointable-label="Payable cases">
    <span className="ws-eyebrow">Payable cases</span>
    <div className="ws-stack">{cases.map(item => <EngineCaseCard key={item.case_id} item={item} />)}</div>
  </section>;
}
