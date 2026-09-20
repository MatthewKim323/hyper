"use client";

// After approval, a payable is not finished: payments, the ledger, close and forecasting each need
// something from it. This shows the four handoffs and lets each one be taken as the file that team uses.
import { useRef, useState } from "react";
import { Gauge } from "@/components/charts";
import { backend, BackendError } from "@/lib/backend/client";
import { handoffFile, type HandoffPacket, type HandoffSection } from "@/lib/backend/handoff";
import { useBackend } from "./useBackend";

const SECTIONS: { id: HandoffSection; label: string }[] = [
  { id: "payment", label: "Payment" }, { id: "ledger", label: "Ledger" }, { id: "close", label: "Close" }, { id: "forecast", label: "Forecast" },
];
const money = (cents: number, currency: string) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
};
const day = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "–";
const words = (value: string) => value.replaceAll("_", " ").toLowerCase();

function download(packet: HandoffPacket, section: HandoffSection) {
  const file = handoffFile(packet, section);
  const url = URL.createObjectURL(new Blob([file.body], { type: file.type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: file.name });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Slice({ packet, section }: { packet: HandoffPacket; section: HandoffSection }) {
  const { payment, ledger, close, forecast } = packet;
  if (section === "payment") return <dl className="ws-facts">
    <div><dt>Pay</dt><dd>{payment.vendor_name ?? payment.vendor_id}</dd></div>
    <div><dt>Account</dt><dd>{payment.remit_account_ref}{payment.remit_verified && <i className="ws-tick" aria-label="Verified" />}</dd></div>
    <div><dt>Amount</dt><dd>{money(payment.amount_cents, payment.currency)}</dd></div>
    <div><dt>Due</dt><dd>{payment.due_date ? day(payment.due_date) : "No terms on file"}</dd></div>
  </dl>;
  if (section === "ledger") return <table className="ws-journal">
    <thead><tr><th scope="col">Account</th><th scope="col">Debit</th><th scope="col">Credit</th></tr></thead>
    <tbody>{ledger.entries.map(entry => <tr key={entry.account}><th scope="row">{entry.account}</th><td>{entry.debit_cents ? money(entry.debit_cents, ledger.currency) : ""}</td><td>{entry.credit_cents ? money(entry.credit_cents, ledger.currency) : ""}</td></tr>)}</tbody>
  </table>;
  if (section === "close") {
    const open = close.issues.filter(issue => issue.blocking && issue.status === "OPEN").length;
    return <dl className="ws-facts">
      <div><dt>Issues</dt><dd>{close.issues.length - open} resolved{open ? ` · ${open} open` : ""}</dd></div>
      <div><dt>Credits</dt><dd>{close.credits_applied.map(credit => credit.credit_id).join(" · ") || "None"}</dd></div>
      <div><dt>Approved</dt><dd>{close.approval?.decided_by?.replace("human:", "") ?? "–"} · {day(close.approval?.decided_at ?? null)}</dd></div>
      <div><dt>Evidence</dt><dd>{close.evidence.length} verified record{close.evidence.length === 1 ? "" : "s"}</dd></div>
    </dl>;
  }
  const kept = forecast.billed_cents ? Math.round((forecast.cash_out_cents / forecast.billed_cents) * 100) : 100;
  return <div className="ws-forecast">
    <div className="chart-scope ws-forecast-gauge"><Gauge orientation="linear" value={kept} centerValue={forecast.avoided_cents / 100} defaultLabel="Avoided" labelPlacement="bottom" labelAlign="center"
      totalNotches={56} spacing={0} notchCornerRadius={3} inactiveFillOpacity={0.4} formatOptions={{ style: "currency", currency: forecast.currency, maximumFractionDigits: 0 }} /></div>
    <dl className="ws-facts">
      <div><dt>Cash out</dt><dd>{money(forecast.cash_out_cents, forecast.currency)}</dd></div>
      <div><dt>When</dt><dd>{forecast.expected_date ? day(forecast.expected_date) : "No terms on file"}</dd></div>
    </dl>
  </div>;
}

/** An approved payable and everything downstream of it. */
export function PayableHandoff({ proposalId, active, onChanged }: { proposalId: string; active: boolean; onChanged?: () => void }) {
  const { data: packet, refresh } = useBackend(() => backend.handoff(proposalId), active, 15000);
  const [section, setSection] = useState<HandoffSection>("payment");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  if (!packet) return null;

  async function recognise(current: HandoffPacket) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setNote("");
    try { await backend.recognisePayable(current.proposal_id, current.hash); refresh(); onChanged?.(); }
    catch (reason) { setNote(reason instanceof BackendError && reason.status === 403 ? "Owner only" : (reason as Error).message); }
    finally { sending.current = false; setBusy(false); }
  }

  return <article className="ws-card ws-handoff" data-ready={packet.ready} data-pointable={`handoff:${packet.proposal_id}`} data-pointable-label={`Approved payable ${packet.payment.invoice_id}, ready for payment, ledger, close and forecast`}
    data-pointable-data={JSON.stringify({ state: packet.state, amount_cents: packet.payment.amount_cents, due_date: packet.payment.due_date, avoided_cents: packet.forecast.avoided_cents, ledger_balanced: packet.ledger.balanced })}>
    <header><span className="ws-chip">{packet.payment.invoice_id}</span><time>{packet.state === "committed" ? "Payment ready" : words(packet.state)}</time></header>
    <h3>{money(packet.payment.amount_cents, packet.payment.currency)}</h3>
    <div className="ws-tabs" role="tablist" aria-label="Next steps">{SECTIONS.map(item =>
      <button key={item.id} type="button" role="tab" aria-selected={section === item.id} onClick={() => setSection(item.id)} data-cursor="hide">{item.label}</button>)}
    </div>
    <div role="tabpanel" className="ws-slice"><Slice packet={packet} section={section} /></div>
    <div className="ws-actions">
      {packet.ready && <button type="button" onClick={() => download(packet, section)}>Export</button>}
      {packet.state === "approved" && packet.ready && <button type="button" className="ws-link" disabled={busy} onClick={() => void recognise(packet)}>Recognise</button>}
      {packet.ledger.econ_id && <span className="ws-mono">{packet.ledger.econ_id}</span>}
    </div>
    {!packet.ready && <p className="ws-warning">Not ready</p>}
    {note && <p className="ws-warning" role="status">{note}</p>}
  </article>;
}
