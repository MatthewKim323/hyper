import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PCMResampler } from "../../public/audio/onboarding-pcm-worklet.js";
import { canCompleteVoice, createVoiceProtocol, decodePCM16, OnboardingVoiceClient, reduceVoiceEvent, voicePresentation } from "./voice-client";

test("reconnect restores history, deduplicates IDs, and displays only the current turn", () => {
  let state = reduceVoiceEvent(createVoiceProtocol(), {
    type: "session",
    session: { transcript: [
      { id: "1", sequence: 1, role: "user", text: "Old question" },
      { id: "2", sequence: 2, role: "assistant", text: "Old answer" },
      { id: "3", sequence: 3, role: "user", text: "Current question" },
      { id: "4", sequence: 4, role: "assistant", text: "First part." },
    ], readiness: { status: "collecting" } },
  });
  state = reduceVoiceEvent(state, { type: "transcript", id: "4", sequence: 4, role: "assistant", text: "First part.", final: true, generation: 0 });
  state = reduceVoiceEvent(state, { type: "transcript", id: "5", sequence: 5, role: "assistant", text: "Second part.", final: true, generation: 0 });
  state = reduceVoiceEvent(state, { type: "reply", id: "5", sequence: 5, role: "assistant", text: "Second part.", generation: 0 });
  assert.equal(state.transcript, "First part. Second part.");
  assert.equal(state.seen.size, 5);
  state = reduceVoiceEvent(state, { type: "transcript", id: "6", sequence: 6, role: "user", text: "Next question", generation: 1 });
  state = reduceVoiceEvent(state, { type: "transcript", id: "7", sequence: 7, role: "assistant", text: "New answer", generation: 1 });
  assert.equal(state.transcript, "New answer");
});

test("interrupts invalidate completion and stale generation audio, transcript, and state", () => {
  let state = reduceVoiceEvent(createVoiceProtocol(), { type: "readiness", status: "ready" });
  state = reduceVoiceEvent(state, { type: "audio.done", generation: 0, next_state: "ready" });
  assert.equal(canCompleteVoice(state, false), true);
  state = reduceVoiceEvent(state, { type: "interrupt", generation: 2 });
  assert.equal(canCompleteVoice(state, false), false);
  for (const event of [
    { type: "audio", generation: 1 },
    { type: "agent.state", state: "speaking", generation: 1 },
    { type: "audio.done", next_state: "ready", generation: 1 },
    { type: "transcript", id: "old", role: "assistant", text: "Obsolete", generation: 1 },
    { type: "interrupt", generation: -1 },
  ]) assert.equal(reduceVoiceEvent(state, event), state);
});

test("readiness cannot finish onboarding until provider audio is done and local audio drains", () => {
  let state = reduceVoiceEvent(createVoiceProtocol(), { type: "readiness", status: "ready" });
  assert.equal(canCompleteVoice(state, false), false);
  state = reduceVoiceEvent(state, { type: "audio.done", generation: 0, next_state: "ready" });
  assert.equal(canCompleteVoice(state, true), false);
  assert.equal(canCompleteVoice(state, false), true);
  state = reduceVoiceEvent(state, { type: "error", message: "Provider disconnected" });
  assert.equal(state.ready, true); // Readiness remains independently visible.
  assert.equal(canCompleteVoice(state, false), false);
});

test("actual local playback takes precedence over runtime state and status", () => {
  let state = reduceVoiceEvent(createVoiceProtocol(), { type: "agent.state", state: "researching", generation: 0 });
  state = reduceVoiceEvent(state, { type: "status", text: "Searching records" });
  assert.equal(voicePresentation(state, false).orbState, "searching");
  assert.deepEqual(voicePresentation(state, true), { orbState: "composing", status: "Hyper is speaking", processing: false });
  state = reduceVoiceEvent(state, { type: "agent.state", state: "thinking", generation: 0 });
  assert.equal(voicePresentation(state, false).orbState, "solving");
  state = reduceVoiceEvent(state, { type: "agent.state", state: "idle", generation: 0 });
  assert.equal(voicePresentation(state, false).orbState, "composing");
});

test("new generations invalidate an earlier audio.done marker", () => {
  let state = reduceVoiceEvent(createVoiceProtocol(), { type: "audio.done", generation: 0 });
  state = reduceVoiceEvent(state, { type: "audio", generation: 1 });
  state = reduceVoiceEvent(state, { type: "readiness", status: "ready" });
  assert.equal(canCompleteVoice(state, false), false);
});

test("readiness after an interim utterance waits for the final response in the same generation", () => {
  let state = reduceVoiceEvent(createVoiceProtocol(), { type: "interrupt", generation: 1 });
  state = reduceVoiceEvent(state, { type: "audio.done", generation: 1, next_state: "listening" });
  state = reduceVoiceEvent(state, { type: "agent.state", generation: 1, state: "thinking" });
  state = reduceVoiceEvent(state, { type: "readiness", status: "ready" });
  assert.equal(canCompleteVoice(state, false), false);
  state = reduceVoiceEvent(state, { type: "audio.done", generation: 1, next_state: "ready" });
  assert.equal(canCompleteVoice(state, false), true);
});

test("PCM output is signed little endian and decoding respects byte offsets", () => {
  const resampler = new PCMResampler(16000, 16000, 4);
  const [frame] = resampler.push([new Float32Array([-2, -0.5, 0.5, 2])]);
  assert.deepEqual([...new Uint8Array(frame)], [0, 128, 0, 192, 0, 64, 255, 127]);
  const padded = new Uint8Array([99, 99, 0, 128, 255, 127, 99, 99]);
  assert.deepEqual([...decodePCM16(padded.subarray(2, 6))], [-1, 32767 / 32768]);
  assert.throws(() => decodePCM16(new Uint8Array([0])));
});

test("48 kHz and 44.1 kHz capture produce exactly 16 kHz across arbitrary render blocks", () => {
  for (const inputRate of [48000, 44100]) {
    const resampler = new PCMResampler(inputRate, 16000, 160);
    const chunks: ArrayBuffer[] = [];
    for (let offset = 0; offset < inputRate; offset += 128) {
      const count = Math.min(128, inputRate - offset);
      chunks.push(...resampler.push([new Float32Array(count).fill(0.5)]));
    }
    assert.equal(chunks.length, 100);
    assert.equal(chunks.reduce((sum, frame) => sum + frame.byteLength / 2, 0), 16000);
    assert.ok(chunks.every(frame => [...decodePCM16(new Uint8Array(frame))].every(value => Math.abs(value - 0.5) <= 1 / 32768)));
  }
});

test("resampling remains continuous between worklet callbacks and mixes stereo to mono", () => {
  const samples = new Float32Array(4410).map((_, index) => Math.sin(index * 0.13));
  const whole = new PCMResampler(44100, 16000, 160).push([samples]);
  const partial = new PCMResampler(44100, 16000, 160);
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < samples.length; offset += 137) chunks.push(...partial.push([samples.subarray(offset, offset + 137)]));
  assert.deepEqual(chunks.map(frame => [...new Uint8Array(frame)]), whole.map(frame => [...new Uint8Array(frame)]));
  const stereo = new PCMResampler(48000, 16000, 1).push([new Float32Array([1, 1, 1]), new Float32Array([-1, -1, -1])]);
  assert.equal(decodePCM16(new Uint8Array(stereo[0]))[0], 0);
});

test("client preserves unacknowledged drafts across reconnects and drains real playback before completion", async () => {
  const originals = new Map(["fetch", "sessionStorage", "location", "WebSocket", "AudioContext", "setTimeout"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const sockets: FakeSocket[] = [];
  const storage = new Map<string, string>();
  const history: Record<string, unknown>[] = [];
  const frames: FakeSource[] = [];
  const presentations: { orbState?: string }[] = [];
  const errors: string[] = [];
  let completions = 0;
  let contexts = 0;
  let createdSessions = 0;
  const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    bufferedAmount = 0;
    sent: Record<string, unknown>[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: URL) {
      sockets.push(this);
      queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
    }
    send(raw: string) {
      const value = JSON.parse(raw);
      this.sent.push(value);
      if (value.token) queueMicrotask(() => this.emit({ type: "session", session: { id: "session-id", transcript: history, readiness: { status: "collecting" } } }));
    }
    emit(value: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
  }
  class FakeSource {
    buffer: unknown;
    onended: (() => void) | null = null;
    stopped = false;
    connect() {}
    disconnect() {}
    start() {}
    stop() { this.stopped = true; }
  }
  class FakeAudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
    constructor() { contexts++; }
    resume() { return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
    createBuffer(_channels: number, count: number, rate: number) { return { duration: count / rate, copyToChannel() {} }; }
    createBufferSource() { const source = new FakeSource(); frames.push(source); return source; }
  }
  const callbacks = {
    onPresentation: (value: { orbState?: string }) => presentations.push(value),
    onConnection() {},
    onError: (message: string) => errors.push(message),
    onComplete: () => { completions++; },
  };
  const client = new OnboardingVoiceClient(callbacks);
  let lateClient: OnboardingVoiceClient | undefined;
  try {
    Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "http://localhost:3888/projects", protocol: "http:" } });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
    Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeSocket });
    Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (_url: string, init: RequestInit) => {
      if (init.method === "POST") {
        createdSessions++;
        assert.deepEqual(JSON.parse(init.body as string), { demo: false });
        return new Response(JSON.stringify({ session: { id: "session-id" }, token: "private-capability" }));
      }
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer private-capability");
      return new Response(JSON.stringify({ id: "session-id", transcript: history }));
    } });

    await Promise.all([client.connect(), client.connect()]);
    assert.equal(sockets.length, 1);
    assert.equal(contexts, 0);
    assert.deepEqual([...sockets[0].sent], [{ token: "private-capability" }]);
    assert.equal(sockets[0].url.pathname, "/api/onboarding/sessions/session-id/stream");

    const failedSend = client.sendText("Keep this draft");
    await tick();
    const firstMessage = sockets[0].sent.find(event => event.type === "text")!;
    sockets[0].emit({ type: "error", message: "Deepgram unavailable" });
    assert.equal(await failedSend, false);
    assert.equal(errors.at(-1), "Deepgram unavailable");

    const retry = client.sendText("Keep this draft");
    await tick();
    const secondMessage = sockets[1].sent.find(event => event.type === "text")!;
    assert.equal(secondMessage.id, firstMessage.id);
    sockets[1].emit({ type: "interrupt", generation: 1 });
    const userSegment = { type: "transcript", id: secondMessage.id, sequence: 1, role: "user", text: secondMessage.text, generation: 1 };
    history.push(userSegment);
    sockets[1].emit(userSegment);
    assert.equal(await retry, true);
    assert.equal(createdSessions, 1);

    sockets[1].emit({ type: "audio", generation: 1, sample_rate: 24000, pcm: "AAAAAA==" });
    assert.equal(frames.length, 1);
    sockets[1].emit({ type: "interrupt", generation: 2 });
    assert.equal(frames[0].stopped, true);
    sockets[1].emit({ type: "audio", generation: 1, sample_rate: 24000, pcm: "AAAAAA==" });
    assert.equal(frames.length, 1);
    sockets[1].emit({ type: "audio", generation: 2, sample_rate: 24000, pcm: "AAAAAA==" });
    sockets[1].emit({ type: "agent.state", generation: 2, state: "thinking" });
    assert.equal(presentations.at(-1)?.orbState, "composing");
    sockets[1].emit({ type: "readiness", status: "ready" });
    sockets[1].emit({ type: "audio.done", generation: 2, next_state: "ready" });
    assert.equal(completions, 0);
    frames[1].onended?.();
    assert.equal(completions, 1);

    client.disconnect();
    await client.connect();
    assert.equal(sockets.length, 3);
    assert.equal(createdSessions, 1);
    assert.deepEqual([...sockets[2].sent], [{ token: "private-capability" }]);

    // The server committed the turn, but its acknowledgement never reached us.
    // Advance only that deadline; reconnect must recover it without injecting twice.
    let expireAcknowledgement!: () => void;
    const realSetTimeout = globalThis.setTimeout;
    Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: (callback: () => void, delay?: number) => {
      const timer = realSetTimeout(callback, delay);
      if (delay === 20000) expireAcknowledgement = () => { clearTimeout(timer); callback(); };
      return timer;
    } });
    const unconfirmed = client.sendText("Recover this accepted turn");
    await tick();
    const committed = sockets[2].sent.find(event => event.type === "text")!;
    assert.ok(committed);
    history.push({ id: committed.id, sequence: 2, role: "user", text: committed.text });
    expireAcknowledgement();
    assert.equal(await unconfirmed, false);
    assert.equal(sockets[2].readyState, 3);
    assert.equal(await client.sendText("Recover this accepted turn"), true);
    assert.equal(sockets.length, 4);
    assert.equal(createdSessions, 1);
    assert.deepEqual(sockets[3].sent, [{ token: "private-capability" }]);

    client.dispose();
    const before = presentations.length;
    sockets[3].emit({ type: "error", message: "A late packet" });
    assert.equal(presentations.length, before);

    let resolveFetch!: (response: Response) => void;
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: () => new Promise<Response>(resolve => { resolveFetch = resolve; }) });
    lateClient = new OnboardingVoiceClient(callbacks);
    const lateConnection = lateClient.connect().catch(() => {});
    const lateCount = presentations.length;
    lateClient.dispose();
    resolveFetch(new Response(JSON.stringify({ id: "session-id" })));
    await lateConnection;
    assert.equal(sockets.length, 4);
    assert.equal(presentations.length, lateCount);
  } finally {
    client.dispose();
    lateClient?.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

class RecoverySocket {
  static OPEN = 1;
  readyState = 0;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: URL, private controls: { authenticate: boolean }) {}
  send(raw: string) {
    const value = JSON.parse(raw);
    this.sent.push(value);
    if (value.token && this.controls.authenticate) queueMicrotask(() => this.emit({
      type: "session", session: { transcript: [{ id: "saved-turn", sequence: 1, role: "assistant", text: "Saved reply" }], readiness: { status: "collecting" } },
    }));
  }
  emit(event: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(event) }); }
  close(code = 1000) { this.readyState = 3; queueMicrotask(() => this.onclose?.({ code })); }
}

async function withRecoveryHarness(run: (harness: {
  client: OnboardingVoiceClient;
  sockets: RecoverySocket[];
  controls: { authenticate: boolean; hidden: boolean; online: boolean };
  flush: () => Promise<void>;
  advance: (delay: number) => Promise<void>;
  delays: () => number[];
  sessions: () => number;
  presentations: { transcript?: string }[];
}) => Promise<void>) {
  const keys = ["fetch", "sessionStorage", "location", "WebSocket", "AudioContext", "setTimeout", "clearTimeout", "document", "navigator"];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const controls = { authenticate: false, hidden: false, online: true };
  const sockets: RecoverySocket[] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const storage = new Map<string, string>();
  const presentations: { transcript?: string }[] = [];
  let nextTimer = 0;
  let sessions = 0;
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  class Socket extends RecoverySocket {
    constructor(url: URL) {
      super(url, controls);
      sockets.push(this);
      queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
    }
  }
  const client = new OnboardingVoiceClient({ onPresentation: value => presentations.push(value), onConnection() {}, onError() {}, onComplete() {} });
  try {
    const globals: Record<string, unknown> = {
      document: { get hidden() { return controls.hidden; } },
      navigator: { get onLine() { return controls.online; } },
      location: { href: "http://localhost:3888/projects", protocol: "http:" },
      sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
      WebSocket: Socket,
      AudioContext: class { constructor() { assert.fail("Recovery must not start audio or microphone capture"); } },
      setTimeout: (callback: () => void, delay = 0) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
      clearTimeout: (id: number) => timers.delete(id),
      fetch: async (_url: string, init: RequestInit) => {
        if (init.method === "POST") {
          sessions++;
          return new Response(JSON.stringify({ session: { id: "recovery-session" }, token: "test-session-capability" }));
        }
        return new Response(JSON.stringify({ id: "recovery-session" }));
      },
    };
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
    await run({
      client, sockets, controls, flush, presentations,
      sessions: () => sessions,
      delays: () => [...timers.values()].map(timer => timer.delay),
      advance: async delay => {
        const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
        assert.ok(entry, `Expected a pending ${delay} ms timer`);
        timers.delete(entry[0]);
        entry[1].callback();
        await flush();
      },
    });
  } finally {
    client.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("a timed-out handshake automatically restores the same session without restarting voice or text", async () => {
  await withRecoveryHarness(async h => {
    const first = h.client.connect().catch(error => error);
    await h.flush();
    await h.advance(12000);
    assert.match((await first).message, /timed out/);
    assert.equal(h.sockets[0].readyState, 3);
    h.controls.authenticate = true;
    await h.advance(1000);
    assert.equal(h.sockets.length, 2);
    assert.equal(h.sessions(), 1);
    assert.equal(h.presentations.at(-1)?.transcript, "Saved reply");
    for (const socket of h.sockets) assert.ok(socket.sent.every(event => event.token || event.type === "voice.stop"));
    assert.deepEqual(h.delays(), []);
    // Successful authentication resets the retry budget for a later transport loss.
    h.sockets[1].close(1006);
    await h.flush();
    await h.advance(1000);
    assert.equal(h.sockets.length, 3);
    assert.deepEqual(h.sockets[2].sent, [{ token: "test-session-capability" }]);
  });
});

test("transport recovery stops after three retries and a manual retry resets the budget", async () => {
  await withRecoveryHarness(async h => {
    const first = h.client.connect().catch(() => {});
    await h.flush();
    await h.advance(12000);
    await first;
    for (const delay of [1000, 2000, 4000]) {
      await h.advance(delay);
      await h.advance(12000);
    }
    assert.equal(h.sockets.length, 4);
    assert.equal(h.sessions(), 1);
    assert.deepEqual(h.delays(), []);
    h.controls.authenticate = true;
    await h.client.connect();
    h.sockets.at(-1)!.close(1006);
    await h.flush();
    await h.advance(1000);
    assert.equal(h.sockets.length, 6);
    assert.deepEqual(h.delays(), []);
  });
});

test("pending recovery stops when hidden, offline, disconnected, or disposed", async () => {
  for (const stop of ["hidden", "offline", "disconnect", "dispose"] as const) {
    await withRecoveryHarness(async h => {
      const first = h.client.connect().catch(() => {});
      await h.flush();
      await h.advance(12000);
      await first;
      if (stop === "hidden") h.controls.hidden = true;
      if (stop === "offline") h.controls.online = false;
      if (stop === "disconnect") h.client.disconnect();
      if (stop === "dispose") h.client.dispose();
      if (stop === "hidden" || stop === "offline") await h.advance(1000);
      assert.equal(h.sockets.length, 1);
      assert.deepEqual(h.delays(), []);
    });
  }
});

test("provider errors and authentication rejections require explicit retry", async () => {
  for (const failure of ["provider", "policy"] as const) {
    await withRecoveryHarness(async h => {
      h.controls.authenticate = true;
      await h.client.connect();
      if (failure === "provider") h.sockets[0].emit({ type: "error", message: "Deepgram unavailable" });
      else h.sockets[0].close(1008);
      await h.flush();
      assert.equal(h.sockets.length, 1);
      assert.deepEqual(h.delays(), []);
    });
  }
});

test("an error before session authentication settles immediately without retrying", async () => {
  await withRecoveryHarness(async h => {
    const connection = h.client.connect().catch(error => error);
    await h.flush();
    h.sockets[0].emit({ type: "error", message: "Session configuration rejected" });
    assert.equal((await connection).message, "Session configuration rejected");
    assert.deepEqual(h.delays(), []);
    assert.equal(h.sockets[0].readyState, 3);
  });
});
