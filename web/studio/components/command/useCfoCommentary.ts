"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OnboardingVoiceClient } from "@/lib/onboarding/voice-client";
import { cfoJson, cfoRequest, CfoApiError } from "@/lib/command/cfo-api";
import { createAudioLeadership } from "@/lib/command/audio-leadership";
import { eligible, mergeNarrationHistory, queueNarrations, readWorkflowPage, takeNarration, type CommentaryMode, type NarrationRecord, type WorkflowEvent } from "@/lib/command/cfo-commentary";

type State = { mode: CommentaryMode; history: NarrationRecord[]; caption: NarrationRecord | null; error: string; needsAudio: boolean; leader: boolean; connected: boolean };
type DecisionCue = { event_id: string; text: string; textHash: string };
type Runtime = { interrupt: () => void; conversation: (busy: boolean) => void; acquire: () => void; wake: () => void; decisions: (key: string, cues: DecisionCue[]) => void };
const initial: State = { mode: "demo", history: [], caption: null, error: "", needsAudio: false, leader: false, connected: false };
export function useCfoCommentary(scope: string, getClient: () => OnboardingVoiceClient | null, decisionActive: boolean) {
  const [state, setState] = useState<State>(initial);
  const mode = useRef<CommentaryMode>("demo"), decision = useRef(decisionActive), runtime = useRef<Runtime | null>(null);
  useEffect(() => { decision.current = decisionActive; }, [decisionActive]);
  useEffect(() => {
    if (!scope) return;
    const lifetime = new AbortController();
    let decisionQueue: WorkflowEvent[] = [], decisionKey = "";
    let lastCaption: WorkflowEvent | null = null, greetingEvent: WorkflowEvent | null = null;
    let queue: WorkflowEvent[] = [], cursor: number | null = null, workspace = "", disposed = false, occupied = false, leader = false;
    let playing: AbortController | null = null, active: WorkflowEvent | null = null, timer: ReturnType<typeof setTimeout>, pollTimer: ReturnType<typeof setTimeout>;
    let conversationBusy = false, userQuietUntil = 0, audioEnabled: boolean | null = null, hydrated = false, loadingConfig = false;
    let configTimer: ReturnType<typeof setTimeout> | undefined;
    const clientId = crypto.randomUUID();
    const seen = new Set<string>();
    const publish = (patch: Partial<State>) => { if (!disposed) setState(value => Object.entries(patch).every(([key, next]) => value[key as keyof State] === next) ? value : { ...value, ...patch }); };
    const mark = (event: WorkflowEvent, status: NarrationRecord["status"], caption = false) => {
      if (disposed) return;
      if (caption) lastCaption = event;
      setState(value => ({ ...value, history: mergeNarrationHistory(value.history, [event], status).map(item => item.event.id === event.id ? { event, status } : item), ...(caption ? { caption: { event, status } } : {}) }));
    };
    const interrupt = () => {
      userQuietUntil = Date.now() + 1200;
      playing?.abort();
      if (active) mark(active, "interrupted", true);
    };
    const drain = async () => {
      if (occupied || disposed || !hydrated || document.hidden || conversationBusy || Date.now() < userQuietUntil || !leader) return;
      queue = queueNarrations(queue, [], mode.current, Date.now());
      const client = getClient();
      if (!client || client.hasQueuedAudio()) return;
      const next = takeNarration(queue, decisionQueue, { audioEnabled, playbackEnabled: client.playbackEnabled(), decisionActive: decision.current });
      if (!next) return;
      const { event, delivery } = next;
      queue = next.queue; decisionQueue = next.decisions;
      if (delivery === "caption-only") { mark(event, "caption-only", true); return; }
      if (delivery === "needs-audio") {
        if (lastCaption?.id !== event.id) mark(event, "caption-only", true);
        publish({ needsAudio: true }); return;
      }
      occupied = true; active = event;
      const abort = new AbortController(); playing = abort;
      const signal = AbortSignal.any([lifetime.signal, abort.signal, AbortSignal.timeout(40000)]);
      let utterance = "", lease = "", playedSamples = 0, receipt = "failed";
      try {
        if (!eligible(event, mode.current, Date.now())) { mark(event, "superseded"); return; }
        const requestStart = performance.now();
        const response = await cfoRequest("/world/cfo/speech", { method: "POST", body: JSON.stringify({ event_id: event.id, request_id: crypto.randomUUID(), client_id: clientId, replay: !!event.replay }), signal });
        utterance = response.headers.get("X-Utterance-Id") ?? "";
        lease = response.headers.get("X-Lease-Token") ?? "";
        if (!utterance || !lease || response.headers.get("X-Sample-Rate") !== "24000" || response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "audio/l16" || response.headers.get("X-Text-Hash") !== event.narration.textHash || !response.body) { await response.body?.cancel(); throw new Error("CFO audio could not be matched to its caption."); }
        if (!eligible(event, mode.current, Date.now()) || document.hidden || !leader) { await response.body.cancel(); receipt = "blocked"; mark(event, "caption-only", true); return; }
        const duration = Number(response.headers.get("X-Lease-Duration-Ms"));
        if (!Number.isFinite(duration) || duration <= 1000 || duration > 30000) { await response.body.cancel(); throw new Error("CFO playback permission could not be verified."); }
        playedSamples = await client.playNarration(response.body, signal, () => { if (!signal.aborted) mark(event, "playing", true); }, samples => { playedSamples = samples; }, requestStart + duration - 1000);
        receipt = "completed"; mark(event, "completed", true); publish({ error: "", needsAudio: false });
      } catch (error) {
        receipt = signal.aborted ? "interrupted" : "failed";
        if (error instanceof CfoApiError && error.status === 409) mark(event, "caption-only");
        else {
          mark(event, signal.aborted && playedSamples ? "interrupted" : "caption-only", true);
          if (!signal.aborted) publish({ error: error instanceof Error ? error.message : "CFO audio is unavailable. You can read this update.", needsAudio: !client.playbackEnabled() });
        }
      } finally {
        if (utterance && lease) {
          try { await cfoRequest(`/world/cfo/speech/${encodeURIComponent(utterance)}/receipt`, { method: "POST", body: JSON.stringify({ client_id: clientId, lease_token: lease, state: receipt, played_samples: playedSamples }), signal: AbortSignal.timeout(5000) }); } catch { /* The server lease expires; never replay uncertain audio. */ }
        }
        if (playing === abort) playing = null;
        active = null; occupied = false;
      }
    };
    const collect = (events: WorkflowEvent[], historical: boolean) => {
      const fresh = events.filter(event => !seen.has(event.id)); fresh.forEach(event => seen.add(event.id));
      if (seen.size > 2000) { const keep = [...seen].slice(-1000); seen.clear(); keep.forEach(id => seen.add(id)); }
      if (!fresh.length) return;
      setState(value => ({ ...value, history: mergeNarrationHistory(value.history, fresh, historical ? "history" : "caption-only") }));
      if (historical) return;
      if (active && fresh.some(event => event.narration.supersessionKey === active!.narration.supersessionKey && event.sequence > active!.sequence)) interrupt();
      const previous = queue; queue = queueNarrations(queue, fresh, mode.current, Date.now());
      for (const item of [...previous, ...fresh]) mark(item, queue.some(queued => queued.id === item.id) ? "queued" : "caption-only");
      if (mode.current === "muted" || !leader || !getClient()?.playbackEnabled()) mark(fresh[fresh.length - 1], "caption-only", true);
    };
    const poll = async () => {
      let delay = 1200;
      try {
        if (!document.hidden) {
          const path = cursor === null ? "/workflow/snapshot" : `/workflow/events?after=${cursor}&limit=50`;
          const page = readWorkflowPage(await cfoJson<unknown>(path, { signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(12000)]) }));
          if (disposed) return;
          if (workspace && page.workspaceScope !== workspace) { interrupt(); queue = []; seen.clear(); publish({ history: [], caption: null }); }
          workspace = page.workspaceScope;
          collect(page.history ?? page.events, document.hidden || cursor === null || !!page.historical || page.gap);
          hydrated = !document.hidden && !page.has_more && !page.gap;
          cursor = page.next_after;
          if (page.gap) { cursor = null; publish({ error: "Earlier activity was archived. Loading the current workflow state." }); }
          else publish({ connected: true });
          if (page.has_more) delay = 0;
        }
      } catch (error) {
        if (!disposed) {
          publish({ connected: false, error: error instanceof Error ? error.message : "CFO updates are reconnecting." });
          if (error instanceof CfoApiError && [401, 403].includes(error.status)) { interrupt(); getClient()?.disconnect(); queue = []; decisionQueue = []; lastCaption = null; publish({ history: [], caption: null }); }
          delay = 4000;
        }
      } finally { if (!disposed) pollTimer = setTimeout(poll, delay); }
    };
    const audioOwner = createAudioLeadership({
      locks: navigator.locks, name: `hyper-cfo-audio:${scope}`, visible: () => !document.hidden,
      onChange: next => { leader = next; publish({ leader: next }); },
      onError: () => publish({ error: "CFO audio could not start. Tap the orb to retry." }),
    });
    const visibility = () => {
      if (document.hidden) {
        interrupt(); getClient()?.disconnect(); queue = []; hydrated = false; leader = false; publish({ leader: false });
        audioOwner.release();
      } else { audioOwner.acquire(); userQuietUntil = Date.now() + 500; }
    };
    const owner: Runtime = {
      interrupt,
      acquire: audioOwner.acquire,
      conversation: busy => { conversationBusy = busy; if (busy) { interrupt(); publish({ caption: null }); } },
      wake: () => {
        publish({ needsAudio: audioEnabled !== false && !getClient()?.playbackEnabled(), error: audioEnabled === false ? "CFO voice is unavailable. Captions are still live." : "" });
        audioOwner.acquire();
        if (audioEnabled === null) void loadConfig();
        const replay = lastCaption ?? greetingEvent;
        if (replay && !occupied && !decisionQueue.some(item => item.id === replay.id) && !queue.some(item => item.id === replay.id)
          && (replay.kind === "cfo.greeting" || eligible(replay, mode.current, Date.now()))) queue.unshift({ ...replay, replay: true });
        void drain();
      },
      decisions: (key, cues) => {
        if (key === decisionKey) return;
        decisionKey = key; decisionQueue = [];
        if (active?.kind === "concern.option") interrupt();
        decisionQueue = cues.slice(0, 3).map((cue, index) => ({ id: cue.event_id, sequence: (cursor ?? 0) + index / 10, kind: "concern.option", workflowId: key, state: "needs_input", narration: { id: cue.event_id, text: cue.text, textHash: cue.textHash, eventIds: [], templateVersion: 1, priority: 3, createdAt: Date.now(), expiresAt: null, supersessionKey: cue.event_id } }));
        for (const event of decisionQueue) mark(event, "queued");
      },
    };
    runtime.current = owner;
    const tick = () => { if (disposed) return; void drain(); timer = setTimeout(tick, 250); };
    audioOwner.acquire(); void poll(); tick();
    document.addEventListener("visibilitychange", visibility);
    // The introduction uses the same literal REST route; it never starts STT.
    async function loadConfig() {
      if (loadingConfig || disposed || audioEnabled !== null) return;
      loadingConfig = true; clearTimeout(configTimer);
      try {
        const config = await cfoJson<{ audio_enabled: boolean; greeting?: { event_id: string; text: string; textHash: string } }>("/world/cfo/config", { signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(12000)]) });
        if (disposed) return;
        audioEnabled = config.audio_enabled;
        publish({ error: config.audio_enabled ? "" : "CFO voice is unavailable. Captions are still live.", needsAudio: config.audio_enabled && !getClient()?.playbackEnabled() });
        if (!config.audio_enabled || !config.greeting) return;
        const greeting = config.greeting;
        greetingEvent = { id: greeting.event_id, sequence: 0, kind: "cfo.greeting", workflowId: "cfo", state: "ready", narration: { id: greeting.event_id, eventIds: [], text: greeting.text, textHash: greeting.textHash, templateVersion: 1, priority: 2, createdAt: Date.now(), expiresAt: Date.now() + 15000, supersessionKey: "cfo.greeting" } };
        collect([greetingEvent], false);
      } catch (error) {
        if (!disposed) {
          publish({ error: error instanceof Error ? error.message : "CFO voice is reconnecting." });
          configTimer = setTimeout(loadConfig, 4000);
        }
      } finally { loadingConfig = false; }
    }
    void loadConfig();
    return () => {
      disposed = true; lifetime.abort(); playing?.abort(); clearTimeout(timer); clearTimeout(pollTimer); clearTimeout(configTimer);
      audioOwner.dispose(); document.removeEventListener("visibilitychange", visibility);
      if (runtime.current === owner) runtime.current = null;
    };
  }, [scope, getClient]);
  const setMode = useCallback((next: CommentaryMode) => { mode.current = next; setState(value => ({ ...value, mode: next })); if (next === "muted") runtime.current?.interrupt(); }, []);
  const interrupt = useCallback(() => runtime.current?.interrupt(), []);
  const conversation = useCallback((busy: boolean) => runtime.current?.conversation(busy), []);
  const enableAudio = useCallback(async () => { await getClient()?.primePlayback(); runtime.current?.wake(); }, [getClient]);
  const retryAudio = useCallback(() => runtime.current?.acquire(), []);
  const setDecisionCues = useCallback((key: string, cues: DecisionCue[]) => runtime.current?.decisions(key, cues), []);
  return { ...state, setMode, interrupt, conversation, enableAudio, retryAudio, setDecisionCues };
}
