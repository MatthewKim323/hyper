// The packet an approved payable hands to the teams after AP (backend/HANDOFF_API.md), and the
// files each of them would actually take: a payment line, a journal entry, a close record, a cash line.
export type HandoffPacket = {
  proposal_id: string; case_id: string; hash: string; ready: boolean; boundary: "prepared_not_posted";
  state: "not_requested" | "pending" | "rejected" | "approved" | "committed" | "invalidated";
  payment: { vendor_id: string; vendor_name: string | null; remit_account_ref: string; amount_cents: number; currency: string; invoice_id: string; invoice_number: string | null; invoice_date: string | null; terms_days: number | null; due_date: string | null; remit_verified: boolean };
  ledger: { type: string; reference: string; currency: string; entries: { account: string; debit_cents: number; credit_cents: number }[]; balanced: boolean; econ_id: string | null; committed_at: string | null };
  close: {
    invoice_id: string; case_revision: number;
    issues: { type: string; status: string; blocking: boolean; description: string }[];
    credits_applied: { credit_id: string; scope: string; amount_cents: number }[];
    approval: null | { status: string; decided_by: string | null; decided_at: string | null; proposal_hash: string };
    evidence: { record_type: string; original_record_id: string; source_id: string; row_number: number; source_sha256: string; verified_by: string }[];
    checks: { name: string; ok: boolean }[];
  };
  forecast: { currency: string; cash_out_cents: number; expected_date: string | null; billed_cents: number; avoided_cents: number; credits_cents: number; basis: string };
  work_status: string; payment_status: string;
};

export type HandoffSection = "payment" | "ledger" | "close" | "forecast";

const major = (cents: number) => (cents / 100).toFixed(2);
const cell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  // Quote anything a spreadsheet could misread, and defuse leading formula characters.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};
const csv = (rows: unknown[][]) => rows.map(row => row.map(cell).join(",")).join("\n") + "\n";

/** The file a downstream team would import. CSV where they use spreadsheets, JSON for the audit record. */
export function handoffFile(packet: HandoffPacket, section: HandoffSection): { name: string; type: string; body: string } {
  const ref = packet.ledger.reference.replace(/[^\w.-]+/g, "_");
  if (section === "payment") {
    const p = packet.payment;
    return { name: `payment-${ref}.csv`, type: "text/csv", body: csv([
      ["vendor_id", "vendor_name", "remit_account_ref", "amount", "currency", "invoice_number", "invoice_date", "due_date", "approval_hash"],
      [p.vendor_id, p.vendor_name, p.remit_account_ref, major(p.amount_cents), p.currency, p.invoice_number ?? p.invoice_id, p.invoice_date, p.due_date, packet.hash],
    ]) };
  }
  if (section === "ledger") {
    const l = packet.ledger;
    return { name: `journal-${ref}.csv`, type: "text/csv", body: csv([
      ["entry_type", "reference", "account", "debit", "credit", "currency", "event_id", "approval_hash"],
      ...l.entries.map(entry => [l.type, l.reference, entry.account, major(entry.debit_cents), major(entry.credit_cents), l.currency, l.econ_id, packet.hash]),
    ]) };
  }
  if (section === "forecast") {
    const f = packet.forecast;
    return { name: `cash-${ref}.csv`, type: "text/csv", body: csv([
      ["reference", "expected_date", "cash_out", "billed", "avoided", "currency", "date_basis"],
      [packet.ledger.reference, f.expected_date, major(f.cash_out_cents), major(f.billed_cents), major(f.avoided_cents), f.currency, f.basis],
    ]) };
  }
  return { name: `close-${ref}.json`, type: "application/json", body: JSON.stringify({ reference: packet.ledger.reference, hash: packet.hash, state: packet.state, ...packet.close }, null, 2) + "\n" };
}
