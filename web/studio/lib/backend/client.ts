// Typed client for backend/. Every call needs a Clerk session JWT; the backend has no
// development bypass, so the token source is injected once by whatever owns sign-in:
//   setBackendTokenProvider(() => clerk.session?.getToken() ?? null)
// Requests go through the existing same-origin rewrite (/api/onboarding/* -> backend root).
// Nothing here is pushed from the server. Use `poll` for anything that changes.
import { SKILL_ATTESTATION } from "./types";
import type { LoopTimeline } from "@/lib/benchmarks/loop-timeline";
import type { HandoffPacket } from "./handoff";
import type {
  SkillDetail, SkillSummary,
  AccountingRecord, EngineCase, PayableProposal,
  AgentCase, AgentTask, Artifact, Concern, ConcernStatus, Controller, Dataset, EvidenceSearch, FinancialAggregate,
  AdversaryState, ExceptionFamily, FinancialQuery, Scenario, Simulation, SimulationEvent, Source, SourceDetail, Workspace, Connection, ConnectionItem, ProviderInfo,
} from "./types";

const BASE = "/api/onboarding";
type TokenProvider = () => Promise<string | null> | string | null;
let tokenProvider: TokenProvider = () => null;
export function setBackendTokenProvider(provider: TokenProvider) { tokenProvider = provider; }

export class BackendError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
  /** 401: sign in again. 503 with Clerk unset on the server reads the same to a user: not signed in. */
  get needsSignIn() { return this.status === 401; }
  /** 409 on respond means someone already answered; on start or tick it means a lease is in flight. */
  get conflict() { return this.status === 409; }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await tokenProvider();
  if (!token) throw new BackendError(401, "Sign in required");
  const response = await fetch(`${BASE}${path}`, {
    ...init, cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  if (!response.ok) {
    let detail = response.statusText;
    try { const body = await response.json(); if (typeof body?.detail === "string") detail = body.detail; } catch { /* non-JSON error body */ }
    throw new BackendError(response.status, detail);
  }
  return response.json() as Promise<T>;
}
const post = <T>(path: string, body?: unknown) => call<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const query = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string | number][];
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : "";
};

export const backend = {
  workspace: () => call<Workspace>("/me/workspace"),
  connections: () => call<{ connections: Connection[]; has_more: boolean }>("/connections"),
  // Sandbox adversary: simulated suppliers and an internal desk that answer from private facts.
  scenarios: () => call<{ scenarios: Scenario[] }>("/counterparty/scenarios"),
  adversary: () => call<AdversaryState>("/counterparty/adversary"),
  setAdversary: (enabled: boolean, interval_seconds = 30, max_open = 4) => post<AdversaryState["control"]>("/counterparty/adversary", { enabled, interval_seconds, max_open }),
  spawnScenario: (family: ExceptionFamily) => post<Scenario>("/counterparty/scenarios", { family }),
  // Access. Connectors are read-only. Provider secrets are never returned by any of these.
  providers: () => call<{ providers: ProviderInfo[]; read_only: boolean; sync_method: string }>("/connections/providers"),
  /** Returns a Google consent URL. The provider redirects to the backend, so poll `connections` for the result. */
  authorizeGoogle: (kind: "gmail" | "drive", label?: string) =>
    post<{ connection_id: string; authorization_url: string; expires_in: number }>(`/connections/google/${kind}/authorize`, label ? { label } : {}),
  connectRamp: (body: { client_id: string; client_secret: string; environment: "sandbox" | "production"; label?: string }) => post<Connection>("/connections/ramp", body),
  syncConnection: (id: string) => post<Connection>(`/connections/${encodeURIComponent(id)}/sync`),
  disconnect: (id: string) => post<Connection>(`/connections/${encodeURIComponent(id)}/disconnect`),
  connectionItems: (id: string, limit = 5) => call<{ items: ConnectionItem[]; has_more: boolean }>(`/connections/${encodeURIComponent(id)}/items${query({ limit })}`),

  // Review. Claim and resolve exist on the API but are agent actions; they are deliberately absent here.
  concerns: (status?: ConcernStatus, limit = 50, offset = 0) => call<{ concerns: Concern[]; has_more: boolean }>(`/concerns${query({ status, limit, offset })}`),
  concern: (id: string) => call<Concern>(`/concerns/${encodeURIComponent(id)}`),
  respond: (id: string, choice: { option_id: "option_1" | "option_2" | "option_3" } | { option_id: "custom"; custom_response: string }) =>
    post<Concern>(`/concerns/${encodeURIComponent(id)}/respond`, choice),
  regenerateCard: (id: string) => post<Concern>(`/concerns/${encodeURIComponent(id)}/card`),

  // Cases. First 50 only until the backend exposes paging.
  controller: () => call<Controller>("/agents/controller"),
  setController: (enabled: boolean) => post<Controller>("/agents/controller", { enabled }),
  cases: () => call<{ cases: AgentCase[]; has_more: boolean }>("/agents/cases"),
  tasks: () => call<{ tasks: AgentTask[]; has_more: boolean }>("/agents/tasks"),

  // Evidence.
  datasets: () => call<{ datasets: Dataset[]; rules: string[] }>("/datasets"),
  sources: (limit = 50, offset = 0) => call<{ sources: Source[]; has_more: boolean; next_offset: number | null }>(`/sources${query({ limit, offset })}`),
  source: (id: string, offset = 0, limit = 10) => call<SourceDetail>(`/sources/${encodeURIComponent(id)}${query({ offset, limit })}`),
  searchEvidence: (text: string, dataset?: string, limit = 8) => post<EvidenceSearch>("/evidence/search", { query: text, dataset, limit }),
  aggregate: (q: FinancialQuery) => post<FinancialAggregate>("/financials/query", q),
  artifact: (id: string) => call<Artifact>(`/artifacts/${encodeURIComponent(id)}`),

  // Accounting engine. Approval is owner only and bound to the exact proposal hash the owner was shown.
  accountingRecords: () => call<{ records: AccountingRecord[] }>("/accounting/records"),
  engineCases: () => call<{ cases: EngineCase[] }>("/accounting/cases"),
  payableProposals: () => call<{ proposals: PayableProposal[] }>("/accounting/proposals"),
  decideProposal: (proposal_id: string, proposal_hash: string, decision: "APPROVED" | "REJECTED") =>
    post<{ status: string }>("/accounting/approvals", { proposal_id, proposal_hash, decision }),

  // After AP: what an approved payable hands to payments, the ledger, close and forecasting.
  handoff: (proposalId: string) => call<HandoffPacket>(`/accounting/proposals/${encodeURIComponent(proposalId)}/handoff`),
  recognisePayable: (proposalId: string, proposal_hash: string) => post<{ committed: boolean; replayed: boolean; econ_id: string }>(`/accounting/proposals/${encodeURIComponent(proposalId)}/commit`, { proposal_hash }),

  // Learned skills. Activation and retirement are owner only; the attestation is the owner's own statement.
  skills: () => call<{ skills: SkillSummary[]; has_more: boolean }>(`/skills${query({ include_inactive: "true", limit: 30 })}`),
  skill: (id: string) => call<SkillDetail>(`/skills/${encodeURIComponent(id)}`),
  skillResource: (id: string, path: string) => call<{ path: string; content: string }>(`/skills/${encodeURIComponent(id)}/resource${query({ path })}`),
  activateSkill: (skill: { id: string; package_hash: string }, run_id: string) =>
    post<SkillSummary>(`/skills/${encodeURIComponent(skill.id)}/activate`, { skill_id: skill.id, package_hash: skill.package_hash, run_id, attestation: SKILL_ATTESTATION }),
  retireSkill: (id: string, reason: string) => post<{ status: string }>(`/skills/${encodeURIComponent(id)}/retire`, { skill_id: id, reason }),

  // The adversary and memory loop, recorded every few minutes. Development runs, nothing held out.
  benchTimeline: (since?: number) => call<LoopTimeline>(`/benchmarks/timeline${query({ since })}`),

  // Activity.
  simulations: () => call<{ simulations: Simulation[]; has_more: boolean }>("/simulations"),
  simulation: (id: string) => call<Simulation>(`/simulations/${encodeURIComponent(id)}`),
  /** The cursor never moves past an unpublished event, so a failed tick stalls the feed on purpose. Show the run's status and error next to it. */
  simulationEvents: (id: string, after = 0, limit = 100) =>
    call<{ events: SimulationEvent[]; next_after: number; has_more: boolean }>(`/simulations/${encodeURIComponent(id)}/events${query({ after, limit })}`),
};

/** Poll until stopped. Skips while the tab is hidden, backs off on errors, never overlaps requests. */
export function poll<T>(fetcher: () => Promise<T>, onData: (data: T) => void, options: { everyMs?: number; onError?: (error: BackendError | Error) => void } = {}) {
  const every = options.everyMs ?? 4000;
  let stopped = false; let failures = 0; let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped) return;
    if (typeof document !== "undefined" && document.hidden) { timer = setTimeout(tick, every); return; }
    try { const data = await fetcher(); if (stopped) return; onData(data); failures = 0; }
    catch (error) {
      if (stopped) return;
      failures++; options.onError?.(error as Error);
      if (error instanceof BackendError && error.needsSignIn) { stopped = true; return; }
    }
    if (!stopped) timer = setTimeout(tick, Math.min(every * 2 ** failures, 60000));
  };
  void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
