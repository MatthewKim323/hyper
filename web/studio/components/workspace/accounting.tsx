"use client";

// The deterministic AP engine, surfaced. Every amount here is computed by code from owner-verified
// records. The approval button sends the exact hash on screen, so what was read is what gets approved.
import { useRef, useState } from "react";
import { backend, BackendError } from "@/lib/backend/client";
import type { EngineCase, PayableProposal } from "@/lib/backend/types";
import { useBackend } from "./useBackend";

const cents = (value: number, currency: string) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value / 100); }
  catch { return `${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${currency}`; }
};
const words = (value: string) => value.replaceAll("_", " ").toLowerCase();

function ProposalCard({ proposal, onDecided }: { proposal: PayableProposal; onDecided: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const sending = useRef(false);
  const { payload } = proposal;
  const passing = proposal.checks.every(check => check.ok);
  const pending = proposal.approval?.status === "PENDING" && proposal.status === "DRAFT";
  const credits = payload.credits.reduce((sum, credit) => sum + credit.amount_cents, 0);

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setNote(null);
    try {
      await backend.decideProposal(proposal.proposal_id, proposal.hash, decision);
      setNote({ ok: true, text: decision === "APPROVED" ? "Approved. This decision is bound to the figures above." : "Rejected. Nothing will be paid from this proposal." });
    } catch (reason) {
      const status = reason instanceof BackendError ? reason.status : 0;
      setNote({ ok: false, text: status === 403 ? "Only an organization owner can approve or reject a payable."
        : status === 409 ? `${(reason as Error).message}. The evidence changed, so the agent has to prepare a new proposal.` : (reason as Error).message });
    } finally {
      sending.current = false;
      setBusy(false);
      onDecided();
    }
  }

  return <article className="ws-card ws-card--decision" data-pointable={`proposal:${proposal.proposal_id}`} data-pointable-label={`Payable proposal for ${payload.invoice_id}`}
    data-pointable-data={JSON.stringify({ invoice_id: payload.invoice_id, net_payable_cents: payload.net_payable_cents, currency: payload.currency, approval: proposal.approval?.status ?? null })}>
    <header>
      <span className="ws-chip">{payload.invoice_id}</span>
      <time>{proposal.approval ? words(proposal.approval.status) : "not requested"} · revision {proposal.based_on_revision}</time>
    </header>
    <h3>Pay {cents(payload.net_payable_cents, payload.currency)}</h3>
    <dl className="ws-ledger">
      <div><dt>Invoice as billed</dt><dd>{cents(payload.invoice_face_cents, payload.currency)}</dd></div>
      {payload.credits.map(credit => <div key={credit.credit_id}><dt>Credit {credit.credit_id} <small>{words(credit.scope)}</small></dt><dd>−{cents(credit.amount_cents, payload.currency)}</dd></div>)}
      <div data-total><dt>Supported payable</dt><dd>{cents(payload.invoice_face_cents - credits, payload.currency)}</dd></div>
    </dl>
    <ul className="ws-checks" aria-label="Checks run by code just now">{proposal.checks.map(check => <li key={check.name} data-ok={check.ok}>{words(check.name)}</li>)}</ul>
    {payload.recipient && <p className="ws-note">Pays vendor {payload.recipient.vendor_id} to the account on the verified vendor master ({payload.recipient.remit_account_ref}).</p>}
    {pending && <div className="ws-actions">
      <button type="button" disabled={busy || !passing} onClick={() => void decide("APPROVED")}>Approve {cents(payload.net_payable_cents, payload.currency)}</button>
      <button type="button" className="ws-link" disabled={busy} onClick={() => void decide("REJECTED")}>Reject</button>
    </div>}
    {pending && !passing && <p className="ws-warning">A check no longer passes, so this cannot be approved. The agent needs to prepare a new proposal.</p>}
    {note && <p className={note.ok ? "ws-note" : "ws-warning"} role="status">{note.text}</p>}
    <footer><span>Bound to {proposal.hash.slice(0, 12)}… · prepared by {proposal.created_by.replace("agent:", "the ")} agent · validated by code, approved only by an owner</span></footer>
  </article>;
}

/** Payables the engine has prepared. Shown in Review: this is the approval that actually moves money. */
export function PayableApprovals({ active }: { active: boolean }) {
  const { data, refresh } = useBackend(backend.payableProposals, active, 6000);
  const proposals = data?.proposals ?? [];
  const waiting = proposals.filter(proposal => proposal.approval?.status === "PENDING" && proposal.status === "DRAFT");
  const decided = proposals.filter(proposal => !waiting.includes(proposal) && proposal.approval && proposal.approval.status !== "PENDING");
  if (!proposals.length) return null;
  return <section className="ws-section" data-pointable="group:payable-approvals" data-pointable-label="Payables ready for approval">
    <span className="ws-eyebrow">Payables ready for approval</span>
    <div className="ws-stack">{waiting.map(proposal => <ProposalCard key={proposal.proposal_id} proposal={proposal} onDecided={refresh} />)}</div>
    {!waiting.length && <p className="ws-empty">No payable is waiting for approval.</p>}
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
      <h3>{calc.ties ? `Supported payable ${cents(calc.net_after_credits_cents, calc.currency)}` : `${cents(Math.abs(calc.residual_cents), calc.currency)} still unexplained`}</h3>
      <dl className="ws-ledger" data-ties={calc.ties}>
        <div><dt>Invoice minus verified credits</dt><dd>{cents(calc.net_after_credits_cents, calc.currency)}</dd></div>
        <div><dt>Received quantity at the agreed price</dt><dd>{cents(calc.independently_supported_cents, calc.currency)}</dd></div>
        <div data-total><dt>{calc.ties ? "Both routes agree" : "Difference between the two routes"}</dt><dd>{cents(Math.abs(calc.residual_cents), calc.currency)}</dd></div>
      </dl>
    </> : <p className="ws-warning">{item.error ?? "This case could not be evaluated."}</p>}
    {item.blocking_issues.length > 0 && <div className="ws-list" data-tone="warn"><span className="ws-eyebrow">Blocking</span><ul>{item.blocking_issues.map((issue, index) => <li key={index}>{issue.description}{issue.next_action ? ` Next: ${issue.next_action}` : ""}</li>)}</ul></div>}
  </article>;
}

/** Engine cases: two independent routes to the payable that must agree before anything is proposed. */
export function EngineCases({ active }: { active: boolean }) {
  const { data } = useBackend(backend.engineCases, active, 6000);
  const cases = data?.cases ?? [];
  if (!cases.length) return null;
  return <section className="ws-section" data-pointable="group:payable-cases" data-pointable-label="Payable cases">
    <span className="ws-eyebrow">Payables worked out by the engine</span>
    <div className="ws-stack">{cases.map(item => <EngineCaseCard key={item.case_id} item={item} />)}</div>
  </section>;
}
