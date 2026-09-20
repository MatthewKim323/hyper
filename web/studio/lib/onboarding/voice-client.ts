import { getAuthState, getBackendToken } from "@/lib/backend/auth";
import type { OnboardingPresentation } from "./interface";
import { playNarrationPcm } from "../command/narration-player";

export type VoiceConnection = "idle" | "connecting" | "connected" | "disconnected" | "error";
type AgentState = "idle" | "listening" | "thinking" | "researching" | "speaking" | "ready" | "error";
type Capability = { id: string; token: string };
type WireEvent = Record<string, unknown>;

export interface VoiceClientCallbacks {
  onPresentation: (presentation: OnboardingPresentation) => void;
  onConnection: (connection: VoiceConnection) => void;
  onError: (message: string) => void;
  onComplete: () => void;
  onReadiness?: (ready: boolean) => void;
  /** The agent's own playback as a stream while it is audible, so the voice beam can follow it. Null when silent. */
  onPlaybackStream?: (stream: MediaStream | null) => void;
  /** Every accepted server event, for consumers that need more than the presentation (tool results, investigations). */
  onEvent?: (event: Record<string, unknown>) => void;
}

/** "world" is the persistent dashboard agent: one saved conversation per member, no readiness gate. */
export type VoiceClientMode = "onboarding" | "world";
export type CfoIntroductionResult = "started" | "already-introduced" | "needs-gesture" | "conversation-active" | "unavailable";

// Entry can unlock output before the world voice client mounts. The mounted client adopts this
// same context, so the eventual provider audio remains tied to the user's entry gesture.
let worldPlaybackContext: AudioContext | null = null;

/** Call directly from Enter/Skip or an explicit voice gesture. No microphone or network access. */
export async function primeWorldVoicePlayback(): Promise<boolean> {
  try {
    if (!worldPlaybackContext || worldPlaybackContext.state === "closed") worldPlaybackContext = new AudioContext();
    if (worldPlaybackContext.state === "suspended") await worldPlaybackContext.resume();
    return worldPlaybackContext.state === "running";
  } catch { return false; }
}

export interface VoiceProtocolState {
  generation: number;
  seen: Set<string>;
  sequence: number;
  speaker: "user" | "assistant" | null;
  transcript: string;
  agent: AgentState;
  status: string;
  ready: boolean;
  audioDone: boolean;
}

const STATES = new Set<AgentState>(["idle", "listening", "thinking", "researching", "speaking", "ready", "error"]);
const SESSION_KEY = "hyper.onboarding.voice-session.v1";
const BASE = "/api/onboarding";

// HTTP stays on the same-origin proxy. The socket does not: Next's dev rewrite proxy was seen
// opening the upstream socket and dropping it at once while the browser sat in CONNECTING until
// the 12 s timeout. In local development the stream therefore goes straight to the backend,
// which already allows this origin. NEXT_PUBLIC_ONBOARDING_WS_URL overrides it (set it to
// "proxy" to force the same-origin path, or to a ws(s):// base for a hosted backend).
function streamUrl(sessionId: string, mode: VoiceClientMode): URL {
  const path = mode === "world" ? "/world/agent/stream" : `/sessions/${encodeURIComponent(sessionId)}/stream`;
  const configured = process.env.NEXT_PUBLIC_ONBOARDING_WS_URL;
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const direct = configured && configured !== "proxy" ? configured
    : configured !== "proxy" && process.env.NODE_ENV === "development" && local ? "ws://127.0.0.1:8000" : null;
  if (direct) return new URL(direct.replace(/\/$/, "") + path);
  const url = new URL(`${BASE}${path}`, location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return url;
}
const RECONNECT_DELAYS = [1000, 2000, 4000];
class TransportError extends Error {}
const record = (value: unknown): value is WireEvent => !!value && typeof value === "object" && !Array.isArray(value);
const generation = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function createVoiceProtocol(): VoiceProtocolState {
  return { generation: 0, seen: new Set(), sequence: 0, speaker: null, transcript: "", agent: "idle", status: "", ready: false, audioDone: false };
}

function appendTranscript(state: VoiceProtocolState, event: WireEvent): VoiceProtocolState {
  if (typeof event.id !== "string" || !event.id || state.seen.has(event.id)
    || typeof event.text !== "string" || !event.text.trim()
    || (event.role !== "user" && event.role !== "assistant")) return state;
  if (typeof event.sequence === "number" && event.sequence <= state.sequence) return state;
  const text = event.text.trim();
  return {
    ...state,
    seen: new Set(state.seen).add(event.id),
    sequence: typeof event.sequence === "number" ? event.sequence : state.sequence,
    speaker: event.role,
    // ConversationText can deliver several committed segments for one response.
    transcript: (state.speaker === event.role ? `${state.transcript} ${text}` : text).slice(-8000),
  };
}

/** Protocol-only reducer, also used to verify reconnect and interruption behavior. */
export function reduceVoiceEvent(previous: VoiceProtocolState, event: WireEvent): VoiceProtocolState {
  if (event.type === "reply") return previous; // Compatibility alias for the same transcript ID.
  if (event.generation !== undefined && !generation(event.generation)) return previous;
  if (generation(event.generation) && event.generation < previous.generation) return previous;
  let state = generation(event.generation) && event.generation > previous.generation
    ? { ...previous, generation: event.generation, audioDone: false, ready: false, status: "" }
    : previous;
  switch (event.type) {
    case "session": {
      if (!record(event.session)) return state;
      state = createVoiceProtocol();
      if (Array.isArray(event.session.transcript)) {
        for (const segment of event.session.transcript) if (record(segment)) state = appendTranscript(state, segment);
      }
      const ready = record(event.session.readiness) && event.session.readiness.status === "ready";
      // Recovered history has no live playback to drain.
      return { ...state, ready, audioDone: ready, agent: ready ? "ready" : "idle" };
    }
    case "transcript":
      return event.final === false ? state : appendTranscript(state, event);
    case "agent.state":
      return STATES.has(event.state as AgentState) ? { ...state, agent: event.state as AgentState, status: "" } : state;
    case "status":
      return typeof event.text === "string" ? { ...state, status: event.text.slice(0, 500) } : state;
    case "readiness":
      // A tool can confirm readiness after an interim utterance in the same turn.
      // Require the closing response's audio.done, not that earlier utterance.
      return { ...state, ready: event.status === "ready", audioDone: event.status === "ready" && !state.ready ? false : state.audioDone };
    case "audio":
      return { ...state, audioDone: false };
    case "audio.done":
      return { ...state, audioDone: true, agent: STATES.has(event.next_state as AgentState) ? event.next_state as AgentState : state.agent, status: "" };
    case "interrupt":
      return { ...state, audioDone: false, ready: false, agent: "listening", status: "" };
    case "error":
      return { ...state, audioDone: false, agent: "error", status: typeof event.message === "string" ? event.message.slice(0, 500) : "The voice agent is unavailable. Try reconnecting." };
    default:
      return state;
  }
}

export function voicePresentation(state: VoiceProtocolState, playing: boolean): OnboardingPresentation {
  const presentations: Record<AgentState, OnboardingPresentation> = {
    idle: { orbState: "composing", status: "Tap the orb to talk, or type below.", processing: false },
    listening: { orbState: "listening", status: "Listening", processing: false },
    thinking: { orbState: "solving", status: "Thinking", processing: true },
    researching: { orbState: "searching", status: "Looking into that", processing: true },
    speaking: { orbState: "composing", status: "Preparing a reply", processing: false },
    ready: { orbState: "composing", status: "Your brief is ready", processing: false },
    error: { orbState: "composing", status: "Tap the orb or send a message to reconnect.", processing: false },
  };
  // Speaking needs its own look. Resting is "composing", so reusing it made a typed reply look idle.
  const base = playing ? { orbState: "weaving" as const, status: "Hyper is speaking", processing: false } : presentations[state.agent];
  return { ...base, ...(state.status && !playing ? { status: state.status } : {}), ...(state.transcript ? { transcript: state.transcript } : {}) };
}

export function canCompleteVoice(state: VoiceProtocolState, queuedAudio: boolean): boolean {
  return state.ready && state.audioDone && !queuedAudio && state.agent !== "error";
}

export function decodePCM16(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  if (bytes.byteLength % 2) throw new Error("Invalid PCM frame");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return samples;
}

/** Per-tab session capability; no API credential is ever sent to the browser. */
export class OnboardingVoiceClient {
  private callbacks: VoiceClientCallbacks;
  private protocol = createVoiceProtocol();
  private connection: VoiceConnection = "idle";
  private capability: Capability | null = null;
  private socket: WebSocket | null = null;
  private authenticated = false;
  private connecting: Promise<void> | null = null;
  private connectionVersion = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private abort = new AbortController();
  private disposed = false;
  private completed = false;
  private context: AudioContext | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private audioClock = 0;
  private authRefresh: ReturnType<typeof setInterval> | null = null;
  private playbackTap: MediaStreamAudioDestinationNode | null = null;
  private playbackShared = false;
  private microphone: MediaStream | null = null;
  private captureVersion = 0;
  private captureSource: MediaStreamAudioSourceNode | null = null;
  private captureWorklet: AudioWorkletNode | null = null;
  private workletModule: Promise<void> | null = null;
  private voiceReady = false;
  private suppressAudioUntilInterrupt = false;
  private unacknowledged: { id: string; text: string } | null = null;
  private pendingText = new Map<string, { resolve: (acknowledged: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
  private introductionId: string | null = null;
  private introductionResult: CfoIntroductionResult | null = null;
  private pendingIntroduction: { id: string; resolve: (result: CfoIntroductionResult) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private introducing: Promise<CfoIntroductionResult> | null = null;
  private userTurnStarted = false;

  private mode: VoiceClientMode;

  constructor(callbacks: VoiceClientCallbacks, mode: VoiceClientMode = "onboarding") {
    this.callbacks = callbacks;
    this.mode = mode;
  }

  /** Read-only narration shares the actual output and analyser, without opening a voice session. */
  async playNarration(stream: ReadableStream<Uint8Array>, signal: AbortSignal, onStart: () => void, onProgress?: (samples: number) => void, deadlineMs?: number): Promise<number> {
    if (this.mode !== "world" || this.disposed) throw new Error("World voice is unavailable.");
    if (!this.context && worldPlaybackContext?.state === "running") {
      this.context = worldPlaybackContext;
      this.context.onstatechange = () => this.publish();
    }
    if (!this.context || this.context.state !== "running") throw new Error("Enable CFO audio to hear updates. Captions remain available.");
    this.playbackTap ??= this.context.createMediaStreamDestination();
    return playNarrationPcm({ context: this.context, stream, signal, tap: this.playbackTap,
      onSource: source => { this.sources.add(source); this.publish(); },
      onSourceEnded: source => { this.sources.delete(source); this.publish(); }, onStart, onProgress, deadlineMs });
  }

  hasQueuedAudio() { return this.sources.size > 0; }

  playbackEnabled() { return (this.context ?? worldPlaybackContext)?.state === "running"; }

  /** Bind numbered voice choices to the card the user is actually looking at. */
  sendDecisionContext(context: unknown) { if (this.mode === "world" && this.authenticated) this.send({ type: "decision.context", context }); }

  /** Tell the dashboard agent what the user is pointing at. Read by its get_pointer_context tool. */
  sendPointer(pointer: unknown) {
    if (this.mode === "world" && this.authenticated) this.send({ type: "pointer", pointer });
  }

  private notifyConnection(value: VoiceConnection) {
    if (this.disposed) return;
    this.connection = value;
    this.callbacks.onConnection(value);
  }

  private publish() {
    if (this.disposed) return;
    const playing = this.context?.state === "running" && this.sources.size > 0;
    if (playing !== this.playbackShared) {
      this.playbackShared = playing;
      this.callbacks.onPlaybackStream?.(playing ? this.playbackTap?.stream ?? null : null);
    }
    this.callbacks.onPresentation(voicePresentation(this.protocol, playing));
    this.callbacks.onReadiness?.(this.protocol.ready);
    if (this.mode === "onboarding" && !this.completed && canCompleteVoice(this.protocol, this.sources.size > 0)) {
      this.completed = true;
      this.callbacks.onComplete();
    }
  }

  private send(value: WireEvent) {
    if (!this.disposed && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }

  private async request(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    this.abort.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 12000);
    try {
      if (this.disposed) throw new Error("Session closed");
      return await fetch(`${BASE}${path}`, { ...init, cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timer);
      this.abort.signal.removeEventListener("abort", abort);
    }
  }

  // Signed-in protocol (backend 8089ee0 onward): the login token authorizes the session, no
  // capability token is issued, and the workspace remembers the latest session to resume.
  private async getSignedInSession(bearer: string): Promise<Capability> {
    const headers = { Authorization: `Bearer ${bearer}` };
    if (this.mode === "world") {
      const response = await this.request("/world/agent", { method: "POST", headers });
      if (response.status === 401) throw new Error("Sign in to talk to your agent.");
      if (!response.ok) throw new Error("Your agent is unavailable. Try again in a moment.");
      const data: unknown = await response.json();
      if (!record(data) || !record(data.session) || typeof data.session.id !== "string") throw new Error("Your agent returned an invalid session.");
      return { id: data.session.id, token: bearer };
    }
    const known = this.capability?.id;
    if (known) {
      const response = await this.request(`/sessions/${encodeURIComponent(known)}`, { headers });
      if (response.ok) return { id: known, token: bearer };
      if (response.status === 401) throw new Error("Your sign-in expired. Sign in again to continue.");
    }
    const workspace = await this.request("/me/workspace", { headers });
    if (workspace.status === 401) throw new Error("Sign in to talk to your agent.");
    if (!workspace.ok) throw new Error("The onboarding service is unavailable. Tap the orb or send a message to retry.");
    const profile: unknown = await workspace.json();
    const latest = record(profile) && record(profile.organization) ? profile.organization.latest_session_id : null;
    if (typeof latest === "string" && /^[\w-]{1,128}$/.test(latest)) {
      const response = await this.request(`/sessions/${encodeURIComponent(latest)}`, { headers });
      if (response.ok) return { id: latest, token: bearer };
    }
    const created = await this.request("/sessions", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ demo: false }) });
    if (!created.ok) throw new Error("The onboarding service is unavailable. Tap the orb or send a message to retry.");
    const data: unknown = await created.json();
    if (!record(data) || !record(data.session) || typeof data.session.id !== "string" || !/^[\w-]{1,128}$/.test(data.session.id)) throw new Error("The onboarding service returned an invalid session.");
    return { id: data.session.id, token: bearer };
  }

  private async getCapability(version: number): Promise<Capability> {
    if (getAuthState().mode !== "unconfigured") {
      const bearer = await getBackendToken();
      if (!bearer) throw new Error("Sign in to talk to your agent.");
      return this.getSignedInSession(bearer);
    }
    // Legacy anonymous protocol, kept for a backend that predates sign-in.
    let saved = this.capability;
    if (!saved) {
      try {
        const parsed: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
        if (record(parsed) && typeof parsed.id === "string" && /^[\w-]{1,128}$/.test(parsed.id)
          && typeof parsed.token === "string" && parsed.token.length <= 256 && parsed.token.length > 0) saved = { id: parsed.id, token: parsed.token };
      } catch { /* Storage can be disabled; the mounted client still retains its capability. */ }
    }
    if (saved) {
      const response = await this.request(`/sessions/${encodeURIComponent(saved.id)}`, { headers: { Authorization: `Bearer ${saved.token}` } });
      if (response.ok) return saved;
      if (response.status !== 404) throw new Error("The onboarding service is unavailable. Tap the orb or send a message to retry.");
      this.capability = null;
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* In-memory fallback. */ }
    }
    const response = await this.request("/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: false }) });
    if (!response.ok) throw new Error("The onboarding service is unavailable. Tap the orb or send a message to retry.");
    const data: unknown = await response.json();
    if (!record(data) || !record(data.session) || typeof data.session.id !== "string"
      || !/^[\w-]{1,128}$/.test(data.session.id) || typeof data.token !== "string" || !data.token || data.token.length > 256) throw new Error("The onboarding service returned an invalid session.");
    saved = { id: data.session.id, token: data.token };
    if (!this.disposed && version === this.connectionVersion) {
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved)); } catch { /* In-memory fallback. */ }
    }
    return saved;
  }

  /** The server closes the socket (1008) when the login token expires, so hand it a fresh one every 20 s. */
  private keepLoginFresh(socket: WebSocket) {
    if (this.authRefresh) clearInterval(this.authRefresh);
    this.authRefresh = null;
    if (getAuthState().mode !== "clerk") return;
    this.authRefresh = setInterval(() => {
      if (this.disposed || this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        if (this.authRefresh) clearInterval(this.authRefresh);
        this.authRefresh = null;
        return;
      }
      void getBackendToken().then(token => { if (token && this.socket === socket) this.send({ type: "auth.refresh", token }); }).catch(() => {});
    }, 20000);
  }

  private canConnect() {
    return !this.disposed && (typeof document === "undefined" || !document.hidden)
      && (typeof navigator === "undefined" || navigator.onLine !== false);
  }

  private cancelReconnect() {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private scheduleReconnect() {
    if (!this.canConnect() || this.reconnectAttempts >= RECONNECT_DELAYS.length) return;
    const delay = RECONNECT_DELAYS[this.reconnectAttempts++];
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.canConnect()) void this.openConnection().catch(() => {});
    }, delay);
  }

  /** Connect or explicitly retry. Recovery restores metadata only, never microphone input or a turn. */
  connect(): Promise<void> {
    this.cancelReconnect();
    this.reconnectAttempts = 0;
    return this.openConnection();
  }

  private openConnection(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Session closed"));
    if (!this.canConnect()) return Promise.reject(new Error("The onboarding connection is paused while this page is hidden or offline."));
    if (this.socket?.readyState === WebSocket.OPEN && this.authenticated) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const version = ++this.connectionVersion;
    const signal = this.abort.signal;
    this.notifyConnection("connecting");
    this.callbacks.onPresentation({ orbState: "connecting", status: "Connecting to Hyper", processing: true });
    this.connecting = (async () => {
      try {
        const capability = await this.getCapability(version);
        if (this.disposed || version !== this.connectionVersion) throw new Error("Session closed");
        this.capability = capability;
        await new Promise<void>((resolve, reject) => {
          const socket = new WebSocket(streamUrl(capability.id, this.mode));
          this.socket = socket;
          let accepted = false;
          const current = () => !this.disposed && this.socket === socket;
          const abort = () => { clearTimeout(timeout); reject(new Error("Session closed")); };
          signal.addEventListener("abort", abort, { once: true });
          const settle = (error?: Error) => {
            clearTimeout(timeout);
            signal.removeEventListener("abort", abort);
            if (error) reject(error); else resolve();
          };
          const timeout = setTimeout(() => settle(new TransportError("The onboarding connection timed out. Try again.")), 12000);
          socket.onopen = () => { if (current()) socket.send(JSON.stringify({ token: capability.token })); };
          socket.onmessage = message => {
            if (!current() || typeof message.data !== "string") return;
            try {
              const event: unknown = JSON.parse(message.data);
              if (!record(event)) return;
              if (!accepted && (event.type === "error" || event.type === "connection.closed")) {
                settle(new Error(typeof event.message === "string" ? event.message : "The onboarding agent is unavailable. Try reconnecting."));
                return;
              }
              if (event.type === "session" && record(event.session)) {
                accepted = true;
                this.authenticated = true;
                this.reconnectAttempts = 0;
                this.notifyConnection("connected");
                this.keepLoginFresh(socket);
                settle();
              }
              this.receive(event);
            } catch {
              const error = new Error("The voice connection returned an unreadable response. Try reconnecting.");
              if (!accepted) settle(error); else this.fail(error.message);
            }
          };
          socket.onerror = () => { if (current() && !accepted) settle(new TransportError("Could not connect to the onboarding agent. Try again.")); };
          socket.onclose = event => {
            if (!current()) return;
            const retryable = [1000, 1001, 1005, 1006, 1011, 1012, 1013, 1014].includes(event?.code ?? 1006);
            const message = "The onboarding connection closed. Tap the orb or send a message to reconnect.";
            this.socket = null;
            if (!accepted) settle(retryable ? new TransportError(message) : new Error(message));
            else this.fail(message, retryable);
          };
        });
      } catch (error) {
        if (!this.disposed && version === this.connectionVersion) this.fail(error instanceof Error && error.name !== "AbortError" ? error.message : "The onboarding service did not respond. Try reconnecting.", error instanceof TransportError);
        throw error;
      } finally { if (version === this.connectionVersion) this.connecting = null; }
    })();
    return this.connecting;
  }

  /** Invoke directly from the orb or submit gesture before requesting microphone permission. */
  async primePlayback(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!this.context) {
        if (this.mode === "world") {
          if (!worldPlaybackContext || worldPlaybackContext.state === "closed") worldPlaybackContext = new AudioContext();
          this.context = worldPlaybackContext;
        } else this.context = new AudioContext();
        this.context.onstatechange = () => this.publish();
      }
      if (this.context.state === "suspended") await this.context.resume();
    } catch {
      if (!this.disposed) this.callbacks.onError("Audio playback is unavailable in this browser. You can still read the transcript.");
    }
  }

  /** A provider greeting, not a synthetic user message. Never enables microphone capture. */
  introduceWorldCfo(entryId?: string): Promise<CfoIntroductionResult> {
    if (this.mode !== "world" || this.disposed) return Promise.resolve("unavailable");
    if (this.introductionResult) return Promise.resolve(this.introductionResult);
    if (this.userTurnStarted) return Promise.resolve("conversation-active");
    if (this.introducing) return this.introducing;
    // Do not queue inaudible speech under an autoplay lock. The next entry/orb gesture can retry.
    if (!this.context && worldPlaybackContext?.state === "running") {
      this.context = worldPlaybackContext;
      this.context.onstatechange = () => this.publish();
    }
    if (this.context?.state !== "running") return Promise.resolve("needs-gesture");
    this.introductionId ??= entryId || crypto.randomUUID();
    this.introducing = (async () => {
      try {
        await this.connect();
        if (this.disposed || !this.authenticated || this.socket?.readyState !== WebSocket.OPEN) return "unavailable";
        if (this.userTurnStarted) return "conversation-active";
        const id = this.introductionId!;
        return await new Promise<CfoIntroductionResult>(resolve => {
          const timer = setTimeout(() => {
            this.pendingIntroduction = null;
            resolve("unavailable");
          }, 20000);
          this.pendingIntroduction = { id, resolve, timer };
          this.send({ type: "agent.introduce", id });
        });
      } catch { return "unavailable"; }
      finally { this.introducing = null; }
    })();
    return this.introducing;
  }

  async sendText(text: string): Promise<boolean> {
    const value = text.trim();
    if (!value || this.disposed) return false;
    if (value.length > 16000) { this.callbacks.onError("Keep your message under 16,000 characters."); return false; }
    this.userTurnStarted = true;
    // This begins in the submit gesture, before any connection awaits.
    void this.primePlayback();
    try {
      await this.connect();
      if (this.disposed || !this.authenticated || this.socket?.readyState !== WebSocket.OPEN) return false;
      if (this.pendingText.size) return false;
      const message = this.unacknowledged?.text === value ? this.unacknowledged : { id: crypto.randomUUID(), text: value };
      if (this.protocol.seen.has(message.id)) { this.unacknowledged = null; return true; }
      this.unacknowledged = message;
      this.clearPlayback();
      this.suppressAudioUntilInterrupt = true;
      this.protocol = { ...this.protocol, agent: "thinking", audioDone: false, ready: false, status: "" };
      const acknowledged = new Promise<boolean>(resolve => {
        const timer = setTimeout(() => {
          this.pendingText.delete(message.id);
          // A retry must hydrate saved history before reusing an unconfirmed ID.
          this.disconnect();
          resolve(false);
          if (!this.disposed) this.callbacks.onError("Message delivery was not confirmed. Your draft is kept; send it again to retry.");
        }, 20000);
        this.pendingText.set(message.id, { resolve, timer });
      });
      this.send({ type: "text", ...message });
      this.publish();
      return await acknowledged;
    } catch { return false; }
  }

  async setMicrophone(stream: MediaStream | null): Promise<void> {
    if (this.disposed) return;
    this.microphone = stream;
    this.stopCapture();
    this.voiceReady = false;
    if (!stream) { this.send({ type: "voice.stop" }); return; }
    this.userTurnStarted = true;
    try {
      await this.connect();
      if (this.disposed || this.microphone !== stream) return;
      this.send({ type: "voice.start" });
    } catch { /* connect reports the real failure; the caller retains ownership of tracks. */ }
  }

  private async startCapture() {
    const stream = this.microphone;
    this.stopCapture();
    const version = this.captureVersion;
    if (!stream || !this.voiceReady || this.disposed) { this.send({ type: "voice.stop" }); return; }
    try {
      await this.primePlayback();
      const context = this.context;
      if (!context?.audioWorklet) throw new Error("Microphone streaming is unavailable in this browser. You can type below.");
      this.workletModule ??= context.audioWorklet.addModule("/audio/onboarding-pcm-worklet.js");
      await this.workletModule;
      if (this.disposed || version !== this.captureVersion || stream !== this.microphone || !this.voiceReady) return;
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "hyper-onboarding-pcm");
      this.captureSource = source;
      this.captureWorklet = worklet;
      worklet.port.onmessage = event => {
        if (!this.disposed && this.voiceReady && version === this.captureVersion
          && this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 64000
          && event.data instanceof ArrayBuffer) this.socket.send(event.data);
      };
      source.connect(worklet);
      worklet.connect(context.destination);
    } catch (error) {
      if (this.disposed || version !== this.captureVersion) return;
      this.workletModule = null;
      this.stopCapture();
      this.send({ type: "voice.stop" });
      this.voiceReady = false;
      this.callbacks.onError(error instanceof Error ? error.message : "The microphone could not connect. You can type below.");
    }
  }

  private stopCapture() {
    this.captureVersion++;
    this.captureSource?.disconnect();
    if (this.captureWorklet) {
      this.captureWorklet.port.onmessage = null;
      this.captureWorklet.port.close();
      this.captureWorklet.disconnect();
    }
    this.captureSource = null;
    this.captureWorklet = null;
  }

  private clearPlayback() {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already finished. */ }
      source.disconnect();
    }
    this.sources.clear();
    this.audioClock = 0;
  }

  private queueAudio(event: WireEvent) {
    if (typeof event.pcm !== "string" || event.pcm.length > 2 ** 21 || event.sample_rate !== 24000) throw new Error("Invalid voice audio");
    if (!this.context || this.context.state === "closed") {
      this.callbacks.onError("Tap the orb or send a message to enable agent audio. The transcript is still available.");
      return;
    }
    const bytes = Uint8Array.from(atob(event.pcm), character => character.charCodeAt(0));
    const samples = decodePCM16(bytes);
    if (!samples.length) return;
    const buffer = this.context.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    // A silent tap of the same audio. Typed turns have no microphone stream to animate the beam.
    if (typeof this.context.createMediaStreamDestination === "function") {
      if (!this.playbackTap || this.playbackTap.context !== this.context) this.playbackTap = this.context.createMediaStreamDestination();
      source.connect(this.playbackTap);
    }
    const start = Math.max(this.context.currentTime, this.audioClock);
    this.audioClock = start + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      if (!this.sources.delete(source)) return;
      source.disconnect();
      this.publish();
    };
    source.start(start);
  }

  private receive(event: WireEvent) {
    if (generation(event.generation) && event.generation < this.protocol.generation) return;
    if (event.generation !== undefined && !generation(event.generation)) return;
    if (event.type === "reply") return;
    if (event.type === "session") this.suppressAudioUntilInterrupt = false;
    if (event.type === "connection.closed") { this.fail("Deepgram disconnected. Tap the orb or send a message to resume your saved conversation."); return; }
    if (event.type === "error") { this.fail(typeof event.message === "string" ? event.message : "The agent is unavailable. Try reconnecting."); return; }
    if (event.type === "interrupt" || (generation(event.generation) && event.generation > this.protocol.generation)) {
      this.clearPlayback();
      this.suppressAudioUntilInterrupt = false;
    }
    if (this.suppressAudioUntilInterrupt && (event.type === "audio" || event.type === "audio.done")) return;
    this.protocol = reduceVoiceEvent(this.protocol, event);
    this.callbacks.onEvent?.(event);
    if (event.type === "agent.introduction" && event.id === this.pendingIntroduction?.id
      && (event.status === "started" || event.status === "already-introduced" || event.status === "conversation-active")) {
      this.introductionResult = event.status;
      this.finishIntroduction(event.status);
    }
    if (event.type === "transcript" && event.role === "user" && typeof event.id === "string" && this.protocol.seen.has(event.id)) {
      const pending = this.pendingText.get(event.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingText.delete(event.id);
        pending.resolve(true);
      }
      if (this.unacknowledged?.id === event.id) this.unacknowledged = null;
    }
    if (event.type === "agent.state" && event.state === "error") this.clearPlayback();
    if (event.type === "voice.ready") {
      this.voiceReady = !!this.microphone;
      if (this.microphone) void this.startCapture(); else this.send({ type: "voice.stop" });
    }
    if (event.type === "audio") {
      try { this.queueAudio(event); }
      catch { this.fail("The agent audio could not be played. Reconnect to resume your saved conversation."); return; }
    }
    this.publish();
  }

  private fail(message: string, retryable = false) {
    if (this.disposed) return;
    this.cancelReconnect();
    this.send({ type: "voice.stop" });
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    this.voiceReady = false;
    socket?.close();
    this.stopCapture();
    this.clearPlayback();
    this.finishPendingText(false);
    this.protocol = { ...this.protocol, agent: "error", audioDone: false, status: message.slice(0, 500) };
    this.notifyConnection("error");
    this.publish();
    this.callbacks.onError(this.protocol.status);
    if (retryable) this.scheduleReconnect();
  }

  private finishPendingText(acknowledged: boolean) {
    this.finishIntroduction("unavailable");
    for (const pending of this.pendingText.values()) {
      clearTimeout(pending.timer);
      pending.resolve(acknowledged);
    }
    this.pendingText.clear();
  }

  private finishIntroduction(result: CfoIntroductionResult) {
    if (!this.pendingIntroduction) return;
    clearTimeout(this.pendingIntroduction.timer);
    this.pendingIntroduction.resolve(result);
    this.pendingIntroduction = null;
  }

  /** Suspend a hidden interface without forgetting the saved conversation. */
  disconnect() {
    if (this.disposed) return;
    this.cancelReconnect();
    this.send({ type: "voice.stop" });
    this.connectionVersion++;
    this.abort.abort();
    this.abort = new AbortController();
    this.connecting = null;
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    this.voiceReady = false;
    this.microphone = null;
    socket?.close(1000, "Interface paused");
    this.stopCapture();
    this.clearPlayback();
    this.finishPendingText(false);
    this.protocol = { ...this.protocol, agent: "idle", audioDone: false, status: "Tap the orb or send a message to resume." };
    this.notifyConnection("disconnected");
    this.publish();
  }

  dispose() {
    if (this.disposed) return;
    this.cancelReconnect();
    this.send({ type: "voice.stop" });
    this.disposed = true;
    this.connectionVersion++;
    this.abort.abort();
    this.socket?.close(1000, "Interface closed");
    this.socket = null;
    this.microphone = null;
    this.stopCapture();
    this.clearPlayback();
    this.finishPendingText(false);
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
      if (worldPlaybackContext === this.context) worldPlaybackContext = null;
    }
    this.context = null;
  }
}
