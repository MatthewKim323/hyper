import { describe, expect, it } from "bun:test";
import type { AgentCase, AgentTask, Concern, Dataset } from "@/lib/backend/types";
import { decimalText, eligibleInvoiceDatasets, invoiceAmount, invoiceLines, isSyntheticRecord, preferredInvoiceDataset, readInvoicePage, sourceWork } from "./accounts-data";

describe("AP imported records", () => {
  it("preserves exact cents, large integers, negatives, and sub-cent values", () => {
    expect(decimalText("12345678901234567890123456.123456", 2)).toBe("123,456,789,012,345,678,901,234.56123456");
    expect(decimalText("-7", 2)).toBe("-0.07");
    expect(decimalText("0.5", 2)).toBe("0.005");
    expect(decimalText("-0", 2)).toBe("0.00");
    expect(decimalText("1200.00")).toBe("1,200");
    expect(decimalText("1e7")).toBeNull();
    expect(decimalText(true)).toBeNull();
    expect(decimalText(Number.MAX_SAFE_INTEGER + 1, 2)).toBeNull();
  });
  it("recognizes the backend's text-normalized synthetic flag", () => {
    expect(isSyntheticRecord({ synthetic: "True" })).toBe(true);
    expect(isSyntheticRecord({ synthetic: "true" })).toBe(true);
    expect(isSyntheticRecord({ synthetic: true })).toBe(true);
    expect(isSyntheticRecord({ synthetic: "False" })).toBe(false);
  });
  it("never assumes currency or the scale of provider minor units", () => {
    expect(invoiceAmount({ amount_cents: "4500" }, null)).toEqual({ value: "45.00", currency: null, units: "" });
    expect(invoiceAmount({ amount_minor: "4500" }, "JPY")).toEqual({ value: "4,500", currency: "JPY", units: "minor units" });
    expect(invoiceAmount({ amount: "4500.05" }, "USDC")).toEqual({ value: "4,500.05", currency: "USDC", units: "imported units" });
    expect(invoiceAmount({ amount_cents: null }, "USD")).toBeNull();
  });
  it("does not manufacture line items from invoice totals", () => {
    expect(invoiceLines({ amount_cents: "500" })).toEqual([]);
    expect(invoiceLines({ quantity: "2", unit_price_cents: "500" })).toEqual([{ quantity: "2", unit_price_cents: "500" }]);
    expect(invoiceLines({ line_items: [null, "unparsed", { description: "Paper" }] })).toEqual([{ description: "Paper" }]);
  });
  it("validates real row references and the rows response envelope", () => {
    const page = { dataset: "ap_invoices", rows: [{ source_id: "src_1", record_id: "inv_1", row_number: 1, currency: null, payload: { invoice_number: "I-1" } }], total_matching: 1, has_more: false, next_offset: 1 };
    expect(readInvoicePage(page)).toEqual(page);
    expect(() => readInvoicePage({ ...page, rows: [{ ...page.rows[0], source_id: undefined }] })).toThrow("source reference");
    expect(() => readInvoicePage({ results: [] })).toThrow("response");
  });
  it("prefers actual AP datasets, never AR just because it contains invoices", () => {
    const datasets = (names: string[]) => names.map(dataset => ({ dataset, record_count: 1, sources: [] }) satisfies Dataset);
    expect(preferredInvoiceDataset(datasets(["ar_invoices", "ramp_bills"]))).toBe("ramp_bills");
    expect(preferredInvoiceDataset(datasets(["sim_bill", "ap_invoices"]))).toBe("ap_invoices");
    expect(preferredInvoiceDataset(datasets(["ar_invoices", "customer_invoices", "sales_invoice"]))).toBeNull();
  });
  it("offers invoice and bill collections without relabeling AP side tables", () => {
    const names = ["ap_invoices", "ramp_bills", "sim_bill", "vendor_invoices", "ap", "ap_vendors", "ap_credits", "ap_purchase_orders", "po_invoices", "ar_invoices", "customer_invoices", "sales_invoice", "invoice_credits", "invoice_payments", "invoice_approvals", "invoice_statements", "vendors", "sim_purchase_order"];
    const datasets = names.map(dataset => ({ dataset, record_count: 1, sources: [] }) satisfies Dataset);
    expect(eligibleInvoiceDatasets(datasets).map(item => item.dataset)).toEqual(["ap_invoices", "ramp_bills", "sim_bill", "vendor_invoices"]);
    expect(preferredInvoiceDataset(datasets.filter(item => !["ap_invoices", "ramp_bills", "sim_bill", "vendor_invoices"].includes(item.dataset)))).toBeNull();
  });
  it("accepts a neutral collection only when every source has a supplier invoice header", () => {
    const schema = { invoice_number: "text", vendor_id: "text", amount_cents: "numeric", due_date: "date" };
    const source = { id: "s1", dataset: "september_import", currency: "USD", record_count: 1, schema };
    const valid: Dataset = { dataset: "september_import", record_count: 1, sources: [source] };
    expect(eligibleInvoiceDatasets([valid])).toEqual([valid]);
    const foreignReference = { ...valid, sources: [{ ...source, schema: { invoice_id: "text", vendor_id: "text", amount_cents: "numeric", due_date: "date" } }] };
    const receivable = { ...valid, sources: [{ ...source, schema: { ...schema, customer_id: "text" } }] };
    const payment = { ...valid, sources: [{ ...source, schema: { ...schema, payment_id: "text" } }] };
    const partial = { ...valid, sources: [source, { id: "s2", dataset: "september_import", currency: "USD", record_count: 1 }] };
    const vendors = { ...valid, dataset: "vendors" };
    expect(eligibleInvoiceDatasets([foreignReference, receivable, payment, partial, vendors])).toEqual([]);
  });
});

describe("AP source-linked investigations", () => {
  const cases: AgentCase[] = [{ id: "case_1", case_key: "I-1", title: "Supplier review", version: 1, updated_at: 1, state: { source_ids: ["src_1"], findings: [], unknowns: [], next_actions: [], concern_ids: ["concern_1"] } }];
  const tasks: AgentTask[] = [
    { id: "task_1", case_id: "case_1", objective: "Review supplier", status: "running" },
    { id: "task_2", case_id: "case_2", objective: "Unrelated same invoice name", status: "running" },
    { id: "task_3", case_id: "case_3", objective: "Cited result", status: "complete", result: { outcome: "complete", summary: "Reviewed", source_ids: ["src_1"] } },
  ];
  const concerns: Concern[] = [{ id: "concern_1", request_key: "r", status: "awaiting_response", created_at: 1, updated_at: 1, request: { title: "Review", description: "Review supplier", severity: "low", source_ids: [] }, card: null, decision: null, resolution: null }];
  it("links only explicit source or case references and exposes actual in-flight work", () => {
    const result = sourceWork("src_1", cases, tasks, concerns);
    expect(result.cases.map(item => item.id)).toEqual(["case_1"]);
    expect(result.tasks.map(item => item.id)).toEqual(["task_1", "task_3"]);
    expect(result.concerns.map(item => item.id)).toEqual(["concern_1"]);
    expect(result.busy).toBe(true);
  });
  it("does not infer an association from display names or unrelated active work", () => {
    expect(sourceWork("src_other", cases, tasks, concerns)).toEqual({ cases: [], tasks: [], concerns: [], busy: false });
    expect(sourceWork("src_1", cases, [{ ...tasks[0], status: "complete" }], concerns).busy).toBe(false);
  });
});
