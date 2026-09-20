import type { AgentCase, AgentTask, Concern, Dataset } from "@/lib/backend/types";

export type InvoiceRow = {
  source_id: string;
  record_id: string;
  row_number: number;
  currency: string | null;
  payload: Record<string, unknown>;
};
export type InvoicePage = {
  dataset: string;
  rows: InvoiceRow[];
  total_matching: number;
  has_more: boolean;
  next_offset: number;
};

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const valueText = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
export const fieldText = (record: Record<string, unknown>, ...keys: string[]) => keys.map(key => valueText(record[key])).find(Boolean) ?? null;
export const isSyntheticRecord = (record: Record<string, unknown>) => record.synthetic === true || (typeof record.synthetic === "string" && record.synthetic.toLowerCase() === "true");

/** Rows have a different response envelope from aggregates on the existing financial query route. */
export function readInvoicePage(value: unknown): InvoicePage {
  if (!object(value) || typeof value.dataset !== "string" || !Array.isArray(value.rows)
    || typeof value.total_matching !== "number" || typeof value.next_offset !== "number" || typeof value.has_more !== "boolean") {
    throw new Error("The invoice response could not be read. Try refreshing this folio.");
  }
  const rows = value.rows.map((row): InvoiceRow => {
    if (!object(row) || typeof row.source_id !== "string" || typeof row.record_id !== "string" || !Number.isInteger(row.row_number)
      || !(row.currency === null || typeof row.currency === "string") || !object(row.payload)) {
      throw new Error("An imported invoice is missing its source reference.");
    }
    return { source_id: row.source_id, record_id: row.record_id, row_number: row.row_number as number, currency: row.currency, payload: row.payload };
  });
  return { dataset: value.dataset, rows, total_matching: value.total_matching, has_more: value.has_more, next_offset: value.next_offset };
}

/** Match invoice collections, not every AP-related table or a foreign invoice reference. */
export function eligibleInvoiceDatasets(datasets: Dataset[]): Dataset[] {
  return datasets.filter(dataset => {
    const name = dataset.dataset.toLowerCase();
    const invoiceName = /(^|_)(bills?|invoices?)(_|$)/.test(name);
    if (/(^|_)(ar|receivables?|customers?|sales|revenue|credits?|memos?|po|purchase|orders?|payments?|refunds?|receipts?|remittances?|allocations?|approvals?|statements?)(_|$)/.test(name)) return false;
    if (invoiceName) return true;
    if (/(^|_)(vendors?|suppliers?|contracts?|accounts?|transactions?)(_|$)/.test(name)) return false;
    // The catalog includes schemas at runtime. Require every source to describe an
    // invoice header before admitting a collection with an otherwise neutral name.
    return dataset.sources.length > 0 && dataset.sources.every(source => {
      const metadata: unknown = source;
      if (!object(metadata) || !object(metadata.schema)) return false;
      const fields = metadata.schema;
      const has = (...keys: string[]) => keys.some(key => Object.hasOwn(fields, key));
      return !has("customer_id", "customer_name", "credit_note_id", "credit_memo_id", "payment_id", "payment_reference")
        && has("invoice_number", "bill_number")
        && has("vendor_id", "vendor_name", "vendor_display_name", "supplier_id", "supplier_name")
        && has("amount_cents", "total_cents", "amount_minor", "total_amount", "amount", "total")
        && has("invoice_date", "bill_date", "due_date", "issue_date");
    });
  });
}

export function preferredInvoiceDataset(datasets: Dataset[]): string | null {
  const eligible = eligibleInvoiceDatasets(datasets);
  for (const name of ["ap_invoices", "ramp_bills", "sim_bill"]) {
    if (eligible.some(dataset => dataset.dataset === name)) return name;
  }
  return eligible[0]?.dataset ?? null;
}

/** Keep the API's exact decimal strings, including sub-cent precision and large amounts. */
export function decimalText(value: unknown, shift = 0): string | null {
  // Nested JSON line items are not normalized by the backend. Unsafe numeric integers
  // have already lost precision in the browser, so never present them as exact amounts.
  if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) return null;
  const text = valueText(value);
  if (!text || !/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const padded = whole.padStart(shift + 1, "0");
  const integer = (shift ? padded.slice(0, -shift) : padded).replace(/^0+(?=\d)/, "");
  const tail = ((shift ? padded.slice(-shift) : "") + fraction).replace(/0+$/, "");
  const decimals = shift ? tail.padEnd(shift, "0") : tail;
  const sign = negative && /[1-9]/.test(text) ? "-" : "";
  return `${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${decimals ? `.${decimals}` : ""}`;
}

export type InvoiceAmount = { value: string; units: string; currency: string | null };
export function invoiceAmount(record: Record<string, unknown>, currency: string | null, keys = ["amount_cents", "total_cents", "amount_minor", "amount", "total"]): InvoiceAmount | null {
  for (const key of keys) {
    const isCents = key.endsWith("_cents");
    const formatted = decimalText(record[key], isCents ? 2 : 0);
    if (formatted !== null) return { value: formatted, currency, units: isCents ? "" : key.endsWith("_minor") ? "minor units" : "imported units" };
  }
  return null;
}

export function invoiceLines(record: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["line_items", "items", "lines"]) {
    if (Array.isArray(record[key])) return (record[key] as unknown[]).filter(object);
  }
  // Some source schemas store a single quantity and unit price directly on the invoice row.
  if (record.quantity != null || record.unit_price_cents != null || record.unit_price != null) return [record];
  return [];
}

export function sourceWork(sourceId: string, cases: AgentCase[], tasks: AgentTask[], concerns: Concern[]) {
  const relatedCases = cases.filter(item => item.state.source_ids.includes(sourceId));
  const caseIds = new Set(relatedCases.map(item => item.id));
  const relatedTasks = tasks.filter(task => caseIds.has(task.case_id) || task.result?.source_ids.includes(sourceId));
  const relatedConcerns = concerns.filter(concern => concern.request.source_ids.includes(sourceId)
    || relatedCases.some(item => item.state.concern_ids.includes(concern.id)));
  return {
    cases: relatedCases,
    tasks: relatedTasks,
    concerns: relatedConcerns,
    busy: relatedTasks.some(task => task.status === "running" || task.status === "launching"),
  };
}
