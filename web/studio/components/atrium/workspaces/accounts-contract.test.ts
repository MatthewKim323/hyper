import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentCase, AgentTask, Concern, Dataset, SourceDetail } from "@/lib/backend/types";
import { invoiceAmount, invoiceLines, isSyntheticRecord, readInvoicePage, sourceWork } from "./accounts-data";

const python = fileURLToPath(new URL("../../../../../backend/.venv/bin/python", import.meta.url));
const fixture = fileURLToPath(new URL("./accounts-contract-fixture.py", import.meta.url));
type Contract = {
  current_source_id: string; previous_source_id: string; other_source_id: string;
  catalog: { datasets: Dataset[] }; first_page: unknown; second_page: unknown; other_page: unknown;
  source: SourceDetail; source_next: SourceDetail;
  download: { status: number; headers: Record<string, string>; same_bytes: boolean };
  connections: { connections: Record<string, unknown>[]; has_more: boolean };
  other_connections: { connections: Record<string, unknown>[]; has_more: boolean };
  cases: { cases: AgentCase[] }; tasks: { tasks: AgentTask[] }; concerns: { concerns: Concern[] };
  other_cases: { cases: AgentCase[] }; other_tasks: { tasks: AgentTask[] }; other_concerns: { concerns: Concern[] };
  anonymous_status: number; invalid_status: number; foreign_source_status: number; foreign_download_status: number;
};

// Backend dependencies are optional for a frontend-only checkout. When present, these
// assertions consume actual FastAPI responses, not handcrafted copies of its schemas.
describe.skipIf(!existsSync(python))("folio and identity read contracts against isolated backend", () => {
  let result: Contract;
  function contract() {
    result ??= JSON.parse(execFileSync(python, [fixture], { encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024 })) as Contract;
    return result;
  }

  it("reads the real row envelope, active source version, and page cursor without losing precision", () => {
    const c = contract();
    const first = readInvoicePage(c.first_page), second = readInvoicePage(c.second_page);
    expect(first.rows).toHaveLength(2);
    expect(first.total_matching).toBe(3);
    expect(first.has_more).toBe(true);
    expect(first.next_offset).toBe(2);
    expect(second.rows).toHaveLength(1);
    expect(second.has_more).toBe(false);
    expect(first.rows.every(row => row.source_id === c.current_source_id)).toBe(true);
    expect(first.rows.some(row => row.source_id === c.previous_source_id)).toBe(false);
    expect(invoiceAmount(first.rows[0].payload, first.rows[0].currency)).toEqual({ value: "123,456,789,012,345,678,901,234.56123456", currency: null, units: "" });
    expect(invoiceLines(first.rows[0].payload)[0].description).toBe("Fixture line");
    expect(isSyntheticRecord(first.rows[0].payload)).toBe(true);
    expect(c.catalog.datasets[0].record_count).toBe(3);
  });

  it("retains original source locators and requires authenticated downloads", () => {
    const c = contract();
    expect(c.source.chunks.map(chunk => chunk.locator)).toEqual(["row:1", "row:2"]);
    expect(c.source.has_more).toBe(true);
    expect(c.source.next_offset).toBe(2);
    expect(c.source_next.chunks.map(chunk => chunk.locator)).toEqual(["row:3"]);
    expect(c.source.download_url).toBe(`/sources/${c.current_source_id}/download`);
    expect(c.download.same_bytes).toBe(true);
    expect(c.download.headers["x-content-type-options"]).toBe("nosniff");
    expect(c.download.headers["cache-control"]).toBe("private, no-store");
    expect(c.foreign_source_status).toBe(404);
    expect(c.foreign_download_status).toBe(404);
    expect(c.anonymous_status).toBe(401);
    expect(c.invalid_status).toBe(401);
  });

  it("keeps financial rows, cases, tasks, decisions, and connections organization scoped", () => {
    const c = contract();
    expect(readInvoicePage(c.other_page).rows.map(row => row.record_id)).toEqual(["B-1"]);
    const work = sourceWork(c.current_source_id, c.cases.cases, c.tasks.tasks, c.concerns.concerns);
    expect(work.busy).toBe(true);
    expect(work.cases[0].state.unknowns).toEqual(["Fixture receipt missing"]);
    expect(work.tasks[0].case_id).toBe(work.cases[0].id);
    expect(work.concerns[0].id).toBe("concern-alice");
    expect(c.other_cases.cases).toEqual([]);
    expect(c.other_tasks.tasks).toEqual([]);
    expect(c.other_concerns.concerns).toEqual([]);
    expect(c.connections.connections.map(connection => connection.id)).toEqual(["connection-alice"]);
    expect(c.other_connections.connections.map(connection => connection.id)).toEqual(["connection-bob"]);
    for (const key of ["credentials", "organization_id", "cursor", "claim_token", "lease_until", "external_id"]) {
      expect(c.connections.connections[0]).not.toHaveProperty(key);
    }
  });
});
