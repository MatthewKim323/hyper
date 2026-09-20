/** Read-only CFO activity transport. Provider messages and application events stay distinguishable. */
export type SwarmSection = "cases" | "evidence" | "review" | "timeline" | "benchmarks" | "identity";
export type SwarmTask = {
  id: string; title: string; objective: string; status: string; section: SwarmSection | null;
  case_id: string | null; session_id: string | null; session_url: string | null;
  error: string | null; result_summary: string | null; created_at: number;
};
export type SwarmEvent = {
  id: string; kind: string; source: "application" | "devin"; timestamp: number; title: string; text: string;
  task_id: string | null; session_id: string | null; section: SwarmSection | null;
};
export type ProviderLogState = {
  task_id: string | null; session_id: string; status: "available" | "unavailable";
  has_more: boolean; next_cursor: string | null; message: string | null;
};
export type SwarmSnapshot = {
  controller: { enabled: boolean; status: string; session_id: string | null; error: string | null };
  tasks: SwarmTask[]; task_total: number; tasks_has_more: boolean; tasks_next_offset: number | null;
  events: SwarmEvent[]; events_truncated?: boolean; cursor: string | null; older_cursor: string | null; has_more: boolean;
  provider_logs: {
    status: "available" | "partial" | "not_configured" | "no_sessions" | "unavailable";
    message: string; sessions: ProviderLogState[];
  };
  generated_at: number;
};
export type SwarmMessages = { events: SwarmEvent[]; next_cursor: string | null; has_more: boolean };
export type CfoConnection = "idle" | "connecting" | "connected" | "reconnecting" | "paused" | "disconnected" | "unauthorized";
export const MAX_SWARM_EVENTS = 1000;
export const MAX_SWARM_TASKS = 1000;
const MAX_PAYLOAD = 2 * 1024 * 1024;
const BASE = "/api/onboarding/agents/swarm";
const SECTIONS = new Set(["cases", "evidence", "review", "timeline", "benchmarks", "identity"]);
const LOG_STATUSES = new Set(["available", "partial", "not_configured", "no_sessions", "unavailable"]);
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_PAYLOAD;
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const timestamp = (value: unknown): value is number => finite(value) && value <= 8.64e15;
const integer = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value);
const optionalInteger = (value: unknown): value is number | null => value === null || integer(value);
const array = <T>(value: unknown, valid: (item: unknown) => item is T): value is T[] => Array.isArray(value) && value.length <= 2000 && value.every(valid);

function isEvent(value: unknown): value is SwarmEvent {
  return record(value) && text(value.id) && !!value.id && text(value.kind) && (value.source === "application" || value.source === "devin")
    && timestamp(value.timestamp) && text(value.title) && text(value.text) && nullableText(value.task_id) && nullableText(value.session_id)
    && (value.section === null || (typeof value.section === "string" && SECTIONS.has(value.section)));
}
function isTask(value: unknown): value is SwarmTask {
  return record(value) && text(value.id) && !!value.id && text(value.title) && text(value.objective) && text(value.status)
    && (value.section === null || (typeof value.section === "string" && SECTIONS.has(value.section))) && nullableText(value.case_id) && nullableText(value.session_id)
    && nullableText(value.session_url) && nullableText(value.error) && nullableText(value.result_summary) && timestamp(value.created_at);
}
function isLog(value: unknown): value is ProviderLogState {
  return record(value) && nullableText(value.task_id) && text(value.session_id) && (value.status === "available" || value.status === "unavailable")
    && typeof value.has_more === "boolean" && nullableText(value.next_cursor) && nullableText(value.message);
}
export function readSwarmSnapshot(value: unknown): SwarmSnapshot | null {
  if (!record(value) || !record(value.controller) || !record(value.provider_logs)) return null;
  const control = value.controller, logs = value.provider_logs;
  if (typeof control.enabled !== "boolean" || !text(control.status) || !nullableText(control.session_id) || !nullableText(control.error)
    || !array(value.tasks, isTask) || !integer(value.task_total) || typeof value.tasks_has_more !== "boolean" || !optionalInteger(value.tasks_next_offset)
    || !array(value.events, isEvent) || (value.events_truncated !== undefined && typeof value.events_truncated !== "boolean") || !nullableText(value.cursor) || !nullableText(value.older_cursor) || typeof value.has_more !== "boolean"
    || typeof logs.status !== "string" || !LOG_STATUSES.has(logs.status) || !text(logs.message) || !array(logs.sessions, isLog) || !timestamp(value.generated_at)) return null;
  return value as SwarmSnapshot;
}
export function readSwarmMessages(value: unknown): SwarmMessages | null {
  return record(value) && array(value.events, isEvent) && nullableText(value.next_cursor) && typeof value.has_more === "boolean" ? value as SwarmMessages : null;
}

/** Newer copies replace matching ids; timestamp ties have a deterministic order across reconnects. */
export function mergeSwarmEvents(current: readonly SwarmEvent[], incoming: readonly SwarmEvent[], limit = MAX_SWARM_EVENTS): SwarmEvent[] {
  const items = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) items.set(item.id, item);
  return [...items.values()].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)).slice(-Math.max(1, limit));
}
export function mergeSwarmSnapshot(previous: SwarmSnapshot | null, next: SwarmSnapshot, mode: "live" | "older" | "tasks" = "live"): SwarmSnapshot {
  if (!previous) return { ...next, events: mergeSwarmEvents([], next.events), tasks: next.tasks.slice(0, MAX_SWARM_TASKS) };
  const tasks = new Map(previous.tasks.map(task => [task.id, task]));
  for (const task of next.tasks) tasks.set(task.id, task);
  const events = mergeSwarmEvents(previous.events, next.events);
  const loadingTasks = mode === "tasks";
  const hasLoadedTasks = previous.tasks.length > 100;
  return {
    ...next,
    tasks: [...tasks.values()].sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(0, MAX_SWARM_TASKS),
    tasks_has_more: tasks.size >= MAX_SWARM_TASKS ? false : loadingTasks || !hasLoadedTasks ? next.tasks_has_more : previous.tasks_has_more,
    tasks_next_offset: loadingTasks || !hasLoadedTasks ? next.tasks_next_offset : previous.tasks_next_offset,
    events,
    events_truncated: !!previous.events_truncated || !!next.events_truncated,
    cursor: mode !== "live" ? previous.cursor : next.cursor ?? previous.cursor,
    older_cursor: mode === "older" ? next.older_cursor : previous.older_cursor ?? next.older_cursor,
    has_more: events.length >= MAX_SWARM_EVENTS ? false : mode === "older" ? next.has_more : previous.has_more,
  };
}

export class SwarmFeedError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly reason?: "token_expired" | "access_removed") { super(message); this.name = "SwarmFeedError"; }
  get unauthorized() { return this.status === 401 || this.status === 403; }
}

/** Incremental SSE parser: CRLF may span chunks, comments are heartbeats, malformed frames are isolated. */
export function createSwarmSseParser(onSnapshot: (value: SwarmSnapshot) => void, maxPayload = MAX_PAYLOAD) {
  let pending = "", event = "", data: string[] = [], bytes = 0;
  function line(value: string) {
    if (!value) {
      if (event === "access_lost") {
        let reason: "token_expired" | "access_removed" | undefined;
        try {
          const payload = JSON.parse(data.join("\n"));
          if (payload?.reason === "token_expired" || payload?.reason === "access_removed") reason = payload.reason;
        } catch { /* An unparseable access revocation is terminal too. */ }
        throw new SwarmFeedError("Sign in again to see your CFO activity.", 401, reason);
      }
      if (data.length && (event === "snapshot" || event === "update")) {
        try { const result = readSwarmSnapshot(JSON.parse(data.join("\n"))); if (result) onSnapshot(result); }
        catch (cause) { if (!(cause instanceof SyntaxError)) throw cause; }
      }
      data = []; event = ""; bytes = 0; return;
    }
    bytes += value.length + 1;
    if (bytes > maxPayload) throw new SwarmFeedError("The activity stream exceeded its message limit.");
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":");
    const field = colon === -1 ? value : value.slice(0, colon);
    let body = colon === -1 ? "" : value.slice(colon + 1);
    if (body.startsWith(" ")) body = body.slice(1);
    if (field === "event") event = body;
    if (field === "data") data.push(body);
  }
  return {
    push(chunk: string) {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        const next = pending.slice(0, end).replace(/\r$/, "");
        pending = pending.slice(end + 1);
        if (next.length > maxPayload) throw new SwarmFeedError("The activity stream exceeded its message limit.");
        line(next);
      }
      if (pending.length + bytes > maxPayload) throw new SwarmFeedError("The activity stream exceeded its message limit.");
    },
    // A missing blank line indicates an incomplete event, so a broken connection cannot publish it.
    finish() { pending = ""; data = []; event = ""; bytes = 0; },
  };
}

type Transport = { token: () => Promise<string | null>; signal: AbortSignal; fetcher?: (input: string, init?: RequestInit) => Promise<Response> };
async function request(url: string, options: Transport, accept = "application/json"): Promise<Response> {
  const token = await options.token();
  options.signal.throwIfAborted();
  if (!token) throw new SwarmFeedError("Sign in to see your CFO activity.", 401);
  const response = await (options.fetcher ?? fetch)(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept }, cache: "no-store", signal: options.signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const message = response.status === 401 || response.status === 403 ? "Sign in again to see your CFO activity."
      : response.status >= 500 ? "The activity service is unavailable. Reconnecting..." : "The activity feed could not be loaded.";
    throw new SwarmFeedError(message, response.status);
  }
  return response;
}
async function readJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_PAYLOAD) {
    await response.body?.cancel().catch(() => {});
    throw new SwarmFeedError("The activity response exceeded its message limit.");
  }
  if (!response.body) throw new SwarmFeedError("The activity response was empty.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let body = "", bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_PAYLOAD) throw new SwarmFeedError("The activity response exceeded its message limit.");
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    try { return JSON.parse(body); } catch { throw new SwarmFeedError("The activity response was not valid JSON."); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
const query = (values: Record<string, string | number | null | undefined>) => {
  const entries = Object.entries(values).filter(([, value]) => value !== null && value !== undefined);
  return entries.length ? `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)]))}` : "";
};
export async function fetchSwarmSnapshot(options: Transport, page: { before?: string | null; taskOffset?: number } = {}): Promise<SwarmSnapshot> {
  const response = await request(`${BASE}${query({ before: page.before, limit: 50, task_offset: page.taskOffset ?? 0, task_limit: 100 })}`, options);
  const snapshot = readSwarmSnapshot(await readJson(response));
  if (!snapshot) throw new SwarmFeedError("The activity response has an unexpected format.");
  return snapshot;
}
export async function fetchSwarmMessages(options: Transport, taskId: string | null, after: string | null): Promise<SwarmMessages> {
  const path = taskId === null ? "/controller/messages" : `/tasks/${encodeURIComponent(taskId)}/messages`;
  const response = await request(`${BASE}${path}${query({ after, limit: 100 })}`, options);
  const page = readSwarmMessages(await readJson(response));
  if (!page) throw new SwarmFeedError("The agent messages have an unexpected format.");
  return page;
}
export async function streamSwarm(options: Transport & { after: string | null; onSnapshot: (data: SwarmSnapshot) => void; onOpen?: () => void }): Promise<void> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(options.signal.reason);
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  let timer: ReturnType<typeof setTimeout>;
  const resetWatchdog = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45000); };
  resetWatchdog();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const parser = createSwarmSseParser(options.onSnapshot), decoder = new TextDecoder();
  try {
    const response = await request(`${BASE}/stream${query({ after: options.after })}`, { ...options, signal: controller.signal }, "text/event-stream");
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new SwarmFeedError("The activity stream is unavailable. Reconnecting...");
    }
    reader = response.body.getReader();
    options.onOpen?.();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      resetWatchdog();
      parser.push(decoder.decode(chunk.value, { stream: true }));
    }
    parser.push(decoder.decode());
  } catch (cause) {
    if (timedOut && !options.signal.aborted) throw new SwarmFeedError("The activity stream paused. Reconnecting...");
    throw cause;
  } finally {
    clearTimeout(timer!); options.signal.removeEventListener("abort", abort); parser.finish();
    await reader?.cancel().catch(() => {}); reader?.releaseLock();
  }
}
