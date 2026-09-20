import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createSwarmSseParser, fetchSwarmMessages, fetchSwarmSnapshot, MAX_SWARM_EVENTS, mergeSwarmEvents,
  mergeSwarmSnapshot, readSwarmSnapshot, streamSwarm, SwarmFeedError, type SwarmEvent, type SwarmSnapshot,
} from "./cfo-feed";

function event(id: string, timestamp: number, text = id): SwarmEvent {
  return { id, timestamp, text, title: "Case opened", kind: "case.created", source: "application", task_id: null, session_id: null, section: "cases" };
}
function snapshot(patch: Partial<SwarmSnapshot> = {}): SwarmSnapshot {
  return {
    controller: { enabled: true, status: "running", session_id: "controller-session", error: null },
    tasks: [], task_total: 0, tasks_has_more: false, tasks_next_offset: null,
    events: [event("a", 1)], cursor: "newest", older_cursor: "oldest", has_more: true,
    provider_logs: { status: "no_sessions", message: "No agent sessions yet.", sessions: [] }, generated_at: 1,
    ...patch,
  };
}
const signal = () => new AbortController().signal;
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

test("snapshot validation rejects non-finite timestamps, unknown sources and malformed tasks", () => {
  const good = snapshot();
  assert.equal(readSwarmSnapshot(good), good);
  assert.equal(readSwarmSnapshot({ ...good, generated_at: NaN }), null);
  assert.equal(readSwarmSnapshot({ ...good, events: [{ ...good.events[0], source: "invented" }] }), null);
  assert.equal(readSwarmSnapshot({ ...good, events: [{ ...good.events[0], section: "arbitrary" }] }), null);
  assert.equal(readSwarmSnapshot({ ...good, tasks: [{ id: "incomplete" }] }), null);
  assert.equal(readSwarmSnapshot({ ...good, tasks_next_offset: -1 }), null);
  assert.equal(readSwarmSnapshot({ ...good, provider_logs: { ...good.provider_logs, sessions: [{ session_id: "secret" }] } }), null);
});

test("SSE accepts every CRLF and JSON split boundary and ignores heartbeat and unrelated events", () => {
  const source = `: heartbeat\r\n\r\nevent: snapshot\r\ndata: ${JSON.stringify(snapshot())}\r\n\r\nevent: other\r\ndata: ${JSON.stringify(snapshot())}\r\n\r\n`;
  for (let split = 0; split <= source.length; split++) {
    const results: SwarmSnapshot[] = [];
    const parser = createSwarmSseParser(value => results.push(value));
    parser.push(source.slice(0, split)); parser.push(source.slice(split)); parser.finish();
    assert.equal(results.length, 1, `split ${split}`);
    assert.deepEqual(results[0], snapshot());
  }
});

test("malformed SSE frames are isolated, multi-line data works, and partial final frames stay unpublished", () => {
  const results: SwarmSnapshot[] = [];
  const parser = createSwarmSseParser(value => results.push(value));
  parser.push('event: update\ndata: {bad}\n\nevent: update\ndata: {"wrong":true}\n\n');
  const formatted = JSON.stringify(snapshot(), null, 2).split("\n").map(line => `data: ${line}`).join("\n");
  parser.push(`event: update\n${formatted}\n\n`);
  parser.push(`event: update\ndata: ${JSON.stringify(snapshot())}\n`); parser.finish();
  assert.equal(results.length, 1);
});

test("SSE bounds both unterminated lines and repeated empty data fields", () => {
  const oneLine = createSwarmSseParser(() => {}, 64);
  assert.throws(() => oneLine.push("x".repeat(65)), SwarmFeedError);
  const emptyFields = createSwarmSseParser(() => {}, 64);
  assert.throws(() => emptyFields.push("data:\n".repeat(20)), SwarmFeedError);
});

test("reconnect deduplication preserves chronological order, replacements and a bounded recent window", () => {
  const merged = mergeSwarmEvents([event("c", 3), event("a", 1)], [event("b", 2), event("a", 1, "updated"), event("d", 3)]);
  assert.deepEqual(merged.map(item => item.id), ["a", "b", "c", "d"]);
  assert.equal(merged[0].text, "updated");
  assert.deepEqual(mergeSwarmEvents(merged, [event("e", 4)], 3).map(item => item.id), ["c", "d", "e"]);
});

test("older event pagination never rewinds the live reconnect cursor or replaces already-loaded history", () => {
  const initial = snapshot({ events: [event("latest", 100)], cursor: "live-100", older_cursor: "old-100" });
  const older = snapshot({ events: [event("old", 10)], cursor: "old-10", older_cursor: "older-10", has_more: false });
  const merged = mergeSwarmSnapshot(initial, older, "older");
  assert.equal(merged.cursor, "live-100");
  assert.equal(merged.older_cursor, "older-10");
  assert.equal(merged.has_more, false);
  const live = mergeSwarmSnapshot(merged, snapshot({ events: [event("new", 101)], cursor: "live-101" }));
  assert.deepEqual(live.events.map(item => item.id), ["old", "latest", "new"]);
  assert.equal(live.older_cursor, "older-10");
  assert.equal(live.cursor, "live-101");
  assert.equal(live.has_more, false);
  const full = mergeSwarmSnapshot(initial, snapshot({ events: Array.from({ length: MAX_SWARM_EVENTS + 1 }, (_, n) => event(String(n), n)) }));
  assert.equal(full.events.length, MAX_SWARM_EVENTS); assert.equal(full.has_more, false);
});

test("HTTP transport gets a fresh token per request, uses auth headers and encodes opaque cursors", async () => {
  let tokens = 0;
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), init }); return jsonResponse(snapshot()); });
  const options = { token: async () => `token-${++tokens}`, signal: signal(), fetcher };
  await fetchSwarmSnapshot(options, { before: "opaque&cursor", taskOffset: 100 });
  await fetchSwarmSnapshot(options);
  assert.equal(tokens, 2);
  assert.equal(new Headers(calls[0].init?.headers).get("Authorization"), "Bearer token-1");
  assert.equal(new Headers(calls[1].init?.headers).get("Authorization"), "Bearer token-2");
  assert.ok(calls[0].url.includes("before=opaque%26cursor"));
  assert.ok(!calls[0].url.includes("token-"));
  assert.equal(calls[0].init?.cache, "no-store");
});

test("auth rejection is explicit and cancelled token resolution cannot start a request", async () => {
  const options = { token: async () => "token", signal: signal(), fetcher: (async () => new Response("denied", { status: 403 })) };
  await assert.rejects(fetchSwarmSnapshot(options), cause => cause instanceof SwarmFeedError && cause.unauthorized);
  let calls = 0;
  const abort = new AbortController();
  let release!: (value: string) => void;
  const token = new Promise<string>(resolve => { release = resolve; });
  const pending = fetchSwarmSnapshot({ token: () => token, signal: abort.signal, fetcher: (async () => { calls++; return jsonResponse(snapshot()); }) });
  abort.abort(); release("next-account-token");
  await assert.rejects(pending, cause => cause instanceof DOMException && cause.name === "AbortError");
  assert.equal(calls, 0);
});

test("provider message pagination uses scoped task routes and supports the controller", async () => {
  const urls: string[] = [];
  const options = { token: async () => "token", signal: signal(), fetcher: (async (url: RequestInfo | URL) => {
    urls.push(String(url)); return jsonResponse({ events: [], has_more: false, next_cursor: null });
  }) };
  await fetchSwarmMessages(options, "task/path", "after&next");
  await fetchSwarmMessages(options, null, null);
  assert.ok(urls[0].includes("/tasks/task%2Fpath/messages?after=after%26next"));
  assert.ok(urls[1].includes("/controller/messages?limit=100"));
});

test("stream decodes split UTF-8 without corrupting provider text", async () => {
  const input = snapshot({ events: [event("voice", 1, "CFO café 🌊")] });
  const bytes = new TextEncoder().encode(`event: update\ndata: ${JSON.stringify(input)}\n\n`);
  const values: SwarmSnapshot[] = [];
  let opened = 0;
  const fetcher = (async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); },
  }), { headers: { "content-type": "text/event-stream; charset=utf-8" } }));
  await streamSwarm({ token: async () => "token", signal: signal(), fetcher, after: "opaque", onOpen: () => opened++, onSnapshot: value => values.push(value) });
  assert.equal(opened, 1); assert.equal(values[0].events[0].text, "CFO café 🌊");
});

test("oversized JSON and unexpected stream content are rejected instead of becoming activity", async () => {
  const options = { token: async () => "token", signal: signal(), fetcher: (async () => new Response("{}", { headers: { "content-length": "99999999" } })) };
  await assert.rejects(fetchSwarmSnapshot(options), /message limit/);
  await assert.rejects(streamSwarm({ ...options, after: null, onSnapshot: () => assert.fail("must not publish") }), /unavailable/);
});

test("provider-scoped tasks accept real relic sections and reject dates outside the browser range", () => {
  const task = { id: "worker", title: "Review", objective: "Inspect evidence", status: "running", section: "evidence", case_id: null, session_id: "session", session_url: null, error: null, result_summary: null, created_at: 1 };
  assert.ok(readSwarmSnapshot(snapshot({ tasks: [task as SwarmSnapshot["tasks"][number]] })));
  assert.equal(readSwarmSnapshot(snapshot({ events: [{ ...event("a", 1), timestamp: 8.64e15 + 1 }] })), null);
  assert.equal(readSwarmSnapshot(snapshot({ generated_at: 8.64e15 + 1 })), null);
});

test("an explicit access_lost stream event is an auth failure even when its JSON is malformed", () => {
  const parser = createSwarmSseParser(() => assert.fail("must not publish revoked activity"));
  assert.throws(() => parser.push('event: access_lost\ndata: {broken}\n\n'), cause => cause instanceof SwarmFeedError && cause.status === 401 && cause.unauthorized);
});

test("task pagination preserves loaded task pages and does not skip the live reconnect backlog", () => {
  const tasks = Array.from({ length: 130 }, (_, n) => ({ id: String(n), title: "Case", objective: "Review", status: "working", section: "cases" as const, case_id: null, session_id: null, session_url: null, error: null, result_summary: null, created_at: 200 - n }));
  const first = snapshot({ tasks: tasks.slice(0, 100), task_total: 130, tasks_has_more: true, tasks_next_offset: 100, cursor: "partial-stream-cursor" });
  const more = snapshot({ tasks: tasks.slice(100), task_total: 130, tasks_has_more: false, tasks_next_offset: null, cursor: "newest-get-cursor" });
  const paged = mergeSwarmSnapshot(first, more, "tasks");
  assert.equal(paged.tasks.length, 130);
  assert.equal(paged.cursor, "partial-stream-cursor");
  assert.equal(paged.tasks_has_more, false);
  const live = mergeSwarmSnapshot(paged, { ...first, tasks: [{ ...tasks[0], status: "complete" }, ...tasks.slice(1, 100)] });
  assert.equal(live.tasks.length, 130);
  assert.equal(live.tasks[0].status, "complete");
  assert.equal(live.tasks_has_more, false);
  assert.equal(live.tasks_next_offset, null);
});

test("expired authentication is distinguishable from removed access so only expiry can refresh automatically", () => {
  for (const reason of ["token_expired", "access_removed"] as const) {
    const parser = createSwarmSseParser(() => assert.fail("must clear before reconnecting"));
    assert.throws(() => parser.push(`event: access_lost\ndata: ${JSON.stringify({ reason })}\n\n`), cause => cause instanceof SwarmFeedError && cause.unauthorized && cause.reason === reason);
  }
});

test("aborting a live stream ends its read without publishing another workspace snapshot", async () => {
  const controller = new AbortController();
  let open!: () => void;
  const opened = new Promise<void>(resolve => { open = resolve; });
  const fetcher = async (_url: string, init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({
    start(reader) { init?.signal?.addEventListener("abort", () => reader.error(init.signal?.reason), { once: true }); },
  }), { headers: { "content-type": "text/event-stream" } });
  const stream = streamSwarm({ token: async () => "token", signal: controller.signal, fetcher, after: null, onOpen: open, onSnapshot: () => assert.fail("aborted stream must not publish") });
  await opened; controller.abort();
  await assert.rejects(stream, cause => cause instanceof DOMException && cause.name === "AbortError");
});
