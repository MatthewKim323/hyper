import { expect, test } from "bun:test";
import { handoffFile, type HandoffPacket } from "./handoff";

const packet: HandoffPacket = {
  proposal_id: "prop_1", case_id: "case_1", hash: "abc123", ready: true, boundary: "prepared_not_posted", state: "approved",
  payment: { vendor_id: "V-9", vendor_name: 'Acme, "Tools" Ltd', remit_account_ref: "=HYPERLINK(1)", amount_cents: 8_000_000, currency: "USD", invoice_id: "INV-1042", invoice_number: "1042", invoice_date: "2026-09-01", terms_days: 30, due_date: "2026-10-01", remit_verified: true },
  ledger: { type: "AP_RECOGNITION", reference: "INV-1042", currency: "USD", entries: [{ account: "1400", debit_cents: 8_000_000, credit_cents: 0 }, { account: "2000", debit_cents: 0, credit_cents: 8_000_000 }], balanced: true, econ_id: null, committed_at: null },
  close: { invoice_id: "INV-1042", case_revision: 7, issues: [], credits_applied: [{ credit_id: "CM-201", scope: "PRICE", amount_cents: 2_000_000 }], approval: { status: "APPROVED", decided_by: "human:alice", decided_at: "2026-09-20T01:00:00", proposal_hash: "abc123" }, evidence: [], checks: [{ name: "two_routes_tie", ok: true }] },
  forecast: { currency: "USD", cash_out_cents: 8_000_000, expected_date: "2026-10-01", billed_cents: 12_000_000, avoided_cents: 4_000_000, credits_cents: 4_000_000, basis: "invoice_date_plus_vendor_terms" },
  work_status: "READY_FOR_REVIEW", payment_status: "NOT_READY",
};

test("the journal file balances and carries the approval it came from", () => {
  const file = handoffFile(packet, "ledger");
  expect(file.name).toBe("journal-INV-1042.csv");
  const rows = file.body.trim().split("\n").map(line => line.split(","));
  expect(rows).toHaveLength(3);
  const debit = rows.slice(1).reduce((sum, row) => sum + Number(row[3]), 0);
  const credit = rows.slice(1).reduce((sum, row) => sum + Number(row[4]), 0);
  expect(debit).toBe(80000);
  expect(credit).toBe(80000);
  expect(rows[1][7]).toBe("abc123");
});

test("the payment file quotes awkward names and defuses spreadsheet formulas", () => {
  const body = handoffFile(packet, "payment").body;
  expect(body).toContain('"Acme, ""Tools"" Ltd"');
  expect(body).toContain("'=HYPERLINK(1)");
  expect(body).toContain("80000.00,USD,1042,2026-09-01,2026-10-01,abc123");
});

test("the cash line shows what leaves and what the resolution saved", () => {
  expect(handoffFile(packet, "forecast").body.trim().split("\n")[1]).toBe("INV-1042,2026-10-01,80000.00,120000.00,40000.00,USD,invoice_date_plus_vendor_terms");
  const close = JSON.parse(handoffFile(packet, "close").body);
  expect(close.approval.decided_by).toBe("human:alice");
  expect(close.hash).toBe("abc123");
});
