"use client";

// Command layer: point at the dashboard, speak, and the world agent acts. The pointer (mouse or hand
// cursor) supplies what "this" means, Deepgram hears the request, the agent's tools answer it, and
// composed charts land here as bklit cards.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { WORLD_PATH } from "@/lib/engine/router/routes";
import { getAudioContext } from "voice-glow";
import ArtifactCard from "./ArtifactCard";
import WorldVoiceBox from "./WorldVoiceBox";
import { useAuth } from "@/components/workspace/useBackend";
import { readArtifactCard, type ArtifactCardModel } from "@/lib/command/artifact";
import { PointerContext } from "@/lib/command/pointer-context";
import { OnboardingVoiceClient, primeWorldVoicePlayback, type VoiceConnection } from "@/lib/onboarding/voice-client";
import { bindWorldVoice, type WorldVoiceBinding } from "@/lib/command/world-voice";
import { createDialogue, reduceDialogueEvent } from "@/lib/onboarding/dialogue";
import { useCfoCommentary } from "./useCfoCommentary";
import { useCfoDecision } from "./useCfoDecision";
import { parseDecisionChoice } from "@/lib/command/cfo-decisions";

const SECTIONS = new Set(["overview", "cases", "evidence", "activity", "review", "timeline", "benchmarks"]);
const CHART_TOOLS = new Set(["compose_financial_artifact", "get_financial_artifact"]);
// How far back the pointer trail is read. People point before they speak, usually by one to two seconds.
const LOOKBACK_MS = 2500;
const POINTER_EVERY_MS = 450;

const subscribeOnboarding = (update: () => void) => {
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-onboarding", "data-handoff", "data-atrium-ready"] });
  observer.observe(document.body, { attributes: true, attributeFilter: ["data-workspace-ready"] });
  return () => observer.disconnect();
};
const onboardingDone = () => document.documentElement.dataset.onboarding === "complete"
  && document.documentElement.dataset.atriumReady === "true"
  && document.body.dataset.workspaceReady === "true"
  && !["covering", "revealing"].includes(document.documentElement.dataset.handoff ?? "");

export default function CommandLayer() {
  const pathname = usePathname();
  const auth = useAuth();
  const ready = useSyncExternalStore(subscribeOnboarding, onboardingDone, () => false);
  useEffect(() => {
    // Entry gestures unlock output only. No microphone or provider request starts here.
    const prime = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.js-view-projects-btn a[href^="/onboarding"], .hyper-onboarding__skip, .hyper-onboarding__orb, .hyper-onboarding__composer button[type="submit"]')) return;
      void primeWorldVoicePlayback().catch(() => {});
    };
    document.addEventListener("click", prime, true);
    return () => document.removeEventListener("click", prime, true);
  }, []);
  return pathname === WORLD_PATH && ready ? <CommandSession key={auth.scope || "signed-out"} scope={auth.ready && auth.signedIn ? auth.scope : ""} /> : null;
}

function CommandSession({ scope }: { scope: string }) {
  const [agentOpen, setAgentOpen] = useState(false);
  const [connection, setConnection] = useState<VoiceConnection>("idle");
  const [listening, setListening] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(null);
  const [processing, setProcessing] = useState(false);
  const [sending, setSending] = useState(false);
  const pendingSend = useRef(false);
  const [status, setStatus] = useState("");
  const [dialogue, setDialogue] = useState(() => createDialogue());
  const [error, setError] = useState("");
  const [cards, setCards] = useState<ArtifactCardModel[]>([]);
  const client = useRef<OnboardingVoiceClient | null>(null);
  const pointer = useRef<PointerContext | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const voiceVisual = useRef<WorldVoiceBinding | null>(null);
  const micRequest = useRef(0);
  const conversationAudioDone = useRef(false);
  const startingMic = useRef(false);
  const lastSent = useRef("");
  const [draft, setDraft] = useState("");
  const [conversationActive, setConversationActive] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const getClient = useCallback(() => client.current, []);
  const decision = useCfoDecision(!!scope, userSpeaking);
  const commentary = useCfoCommentary(scope, getClient, !!decision.concern && ["awaiting_response", "needs_input", "card_failed"].includes(decision.concern.status));
  const { interrupt: interruptCommentary, conversation: setCommentaryConversation } = commentary;
  const { retryAudio } = commentary;
  const { context: activeDecisionContext, submit: submitDecision, acceptEvent: acceptDecisionEvent } = decision;
  const { setDecisionCues } = commentary;
  useEffect(() => {
    const key = activeDecisionContext ? `${activeDecisionContext.concernId}:${activeDecisionContext.cardRevision}:${activeDecisionContext.cardHash}` : "";
    setDecisionCues(key, activeDecisionContext ? decision.concern?.decision_cues ?? [] : []);
  }, [activeDecisionContext, decision.concern?.decision_cues, setDecisionCues]);
  const decisionContextRef = useRef(decision.context);
  useEffect(() => {
    decisionContextRef.current = decision.context;
    client.current?.sendDecisionContext(decision.context);
  }, [decision.context]);

  useEffect(() => {
    const context = new PointerContext();
    pointer.current = context;
    const visual = bindWorldVoice();
    voiceVisual.current = visual;
    const session = new OnboardingVoiceClient({
      onPresentation: (p) => { setStatus(p.status ?? ""); setProcessing(p.processing ?? false); visual.publish({ presentation: p }); },
      onConnection: (next) => {
        setConnection(next);
        visual.publish({ connection: next });
        if (next === "connected") client.current?.sendDecisionContext(decisionContextRef.current);
        if (next === "error" || next === "disconnected") { setUserSpeaking(false); setConversationActive(false); setCommentaryConversation(false); }
        if (next === "error" || next === "disconnected") {
          micRequest.current++;
          startingMic.current = false;
          mic.current?.getTracks().forEach(track => track.stop());
          mic.current = null;
          setListening(false);
          setRequesting(false);
          setMicrophoneStream(null);
          visual.publish({ microphoneStream: null });
        }
      },
      onError: (message) => {
        const worldMessage = message.replace(/onboarding/gi, "voice");
        setError(worldMessage);
        visual.publish({ error: worldMessage });
      },
      onPlaybackStream: (stream) => {
        visual.publish({ playbackStream: stream, ...(stream ? { error: null, connection: "connected" as const } : {}) });
        if (!stream && conversationAudioDone.current) { setConversationActive(false); setCommentaryConversation(false); }
      },
      onComplete: () => {},
      onEvent: (event) => {
        if (event.type === "user.speech.started" || (event.type === "agent.state" && event.reason === "user_speech")) setUserSpeaking(true);
        if ((event.type === "transcript" && event.role === "user" && event.final !== false) || event.type === "error") setUserSpeaking(false);
        if (event.type === "transcript" || event.type === "audio" || event.type === "interrupt" || (event.type === "agent.state" && ["thinking", "researching", "speaking"].includes(String(event.state)))) {
          conversationAudioDone.current = false; setConversationActive(true); setCommentaryConversation(true);
        }
        if (event.type === "audio.done" || (event.type === "agent.state" && ["idle", "error"].includes(String(event.state)))) {
          conversationAudioDone.current = true;
          if (!client.current?.hasQueuedAudio()) { setConversationActive(false); setCommentaryConversation(false); }
        }
        if (event.type === "concern.decision") {
          acceptDecisionEvent(event); setUserSpeaking(false); setConversationActive(false); setCommentaryConversation(false);
          if (typeof event.message === "string") setStatus(event.message);
        }
        setDialogue(previous => reduceDialogueEvent(previous, event));
        if (event.type !== "tool.result" || typeof event.name !== "string") return;
        const result = event.result;
        if (event.name === "navigate_section" && result && typeof result === "object" && "section" in result && SECTIONS.has(String(result.section)))
          window.dispatchEvent(new CustomEvent("hyper:navigate-section", { detail: { section: String(result.section) } }));
        if (CHART_TOOLS.has(event.name)) {
          const card = readArtifactCard(result);
          if (card) setCards((previous) => [card, ...previous.filter((c) => c.id !== card.id)].slice(0, 3));
          else if (result && typeof result === "object" && "error" in result) setError(String(result.error));
        }
      },
    }, "world");
    client.current = session;
    // World entry may speak an introduction; capture still needs a microphone gesture.
    return () => {
      // Invalidate any permission prompt that resolves after this session leaves.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      micRequest.current++;
      startingMic.current = false;
      context.destroy();
      mic.current?.getTracks().forEach((t) => t.stop());
      mic.current = null;
      session.dispose();
      visual.clear();
      voiceVisual.current = null;
      client.current = null;
      pointer.current = null;
    };
  }, [setCommentaryConversation, acceptDecisionEvent]);

  useEffect(() => {
    if (!microphoneStream) return;
    const tracks = microphoneStream.getAudioTracks();
    const ended = () => {
      if (mic.current !== microphoneStream || tracks.some(track => track.readyState !== "ended")) return;
      micRequest.current++;
      startingMic.current = false;
      mic.current = null;
      setMicrophoneStream(null);
      setRequesting(false);
      setListening(false);
      voiceVisual.current?.publish({ microphoneStream: null });
      void client.current?.setMicrophone(null);
    };
    tracks.forEach(track => track.addEventListener("ended", ended));
    return () => tracks.forEach(track => track.removeEventListener("ended", ended));
  }, [microphoneStream]);

  const sharePointer = useCallback(() => {
    const now = performance.now();
    const region = pointer.current?.region(now - LOOKBACK_MS, now);
    const referents = (region?.referents ?? []).filter((r) => r.label || r.id).slice(0, 12);
    if (!region) return;
    const payload = {
      section: document.body.dataset.workspaceSection ?? null,
      area: { x: region.x, y: region.y, width: region.width, height: region.height },
      viewport: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      referents: referents.map((r) => ({ label: r.label.slice(0, 200), kind: r.kind, id: r.id, section: r.section, data: r.data, rect: r.rect })),
    };
    const signature = JSON.stringify([payload.section, payload.referents.map((r) => [r.kind, r.id, r.label])]);
    if (signature === lastSent.current) return;
    lastSent.current = signature;
    client.current?.sendPointer(payload);
  }, []);

  // Share pointing context silently, without drawing target boxes over the scene.
  useEffect(() => {
    if (!listening) return;
    sharePointer();
    const timer = window.setInterval(sharePointer, POINTER_EVERY_MS);
    return () => {
      clearInterval(timer);
      lastSent.current = "";
    };
  }, [listening, sharePointer]);

  // Typed commands carry the same pointing context as spoken ones.
  const submit = useCallback(async () => {
    const text = draft.trim();
    const session = client.current;
    if (!text || !session || pendingSend.current) return;
    interruptCommentary();
    const choice = activeDecisionContext ? parseDecisionChoice(text) : null;
    if (choice) {
      if (await submitDecision(choice, "text")) setDraft(current => current.trim() === text ? "" : current);
      return;
    }
    if (!commentary.leader) { retryAudio(); setError("Voice isn't ready in this tab. Try again."); return; }
    setCommentaryConversation(true); setConversationActive(true);
    pendingSend.current = true;
    setSending(true);
    setAgentOpen(true);
    // Unlock playback before connect awaits. Typed turns never request a mic.
    void session.primePlayback().catch(() => {});
    void voiceVisual.current?.resumeAudio();
    voiceVisual.current?.publish({ error: null });
    setError("");
    try {
      await session.connect();
      if (client.current !== session) return;
      lastSent.current = "";
      sharePointer();
      const delivered = await session.sendText(text);
      if (client.current !== session) return;
      if (delivered) setDraft(current => current.trim() === text ? "" : current);
      else setError("Your message could not be sent. Your draft is kept. Try again.");
    } catch {
      if (client.current === session) setError("Your agent is unavailable. Your draft is kept. Try again in a moment.");
    } finally {
      pendingSend.current = false;
      if (client.current === session) setSending(false);
    }
  }, [draft, sharePointer, interruptCommentary, activeDecisionContext, submitDecision, commentary.leader, retryAudio, setCommentaryConversation]);

  const toggle = useCallback(async () => {
    interruptCommentary();
    setAgentOpen(true);
    if (!commentary.leader) { retryAudio(); setError("Voice isn't ready in this tab. Try again."); return; }
    const session = client.current;
    if (!session) return;
    void voiceVisual.current?.resumeAudio();
    if (mic.current || startingMic.current) {
      micRequest.current++;
      startingMic.current = false;
      mic.current?.getTracks().forEach((t) => t.stop());
      mic.current = null;
      setMicrophoneStream(null);
      setRequesting(false);
      voiceVisual.current?.publish({ microphoneStream: null });
      setListening(false);
      void session.setMicrophone(null).catch(() => {});
      return;
    }
    startingMic.current = true;
    setRequesting(true);
    const request = ++micRequest.current;
    setError("");
    voiceVisual.current?.publish({ error: null });
    try {
      // VoiceBeam analyses this same stream; resume its silent analyser in the gesture.
      getAudioContext();
      const playback = session.primePlayback();
      // Observe a playback failure while the permission prompt is still open.
      void playback.catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (request !== micRequest.current || client.current !== session) { stream.getTracks().forEach(track => track.stop()); return; }
      mic.current = stream;
      setMicrophoneStream(stream);
      await playback;
      if (request !== micRequest.current || client.current !== session) return;
      voiceVisual.current?.publish({ microphoneStream: stream });
      await session.connect();
      if (request !== micRequest.current || client.current !== session) return;
      await session.setMicrophone(stream);
      if (request !== micRequest.current || client.current !== session) return;
      setListening(true);
    } catch (cause) {
      if (request !== micRequest.current || client.current !== session) return;
      mic.current?.getTracks().forEach((t) => t.stop());
      mic.current = null;
      setMicrophoneStream(null);
      voiceVisual.current?.publish({ microphoneStream: null, error: true });
      setListening(false);
      const denied = cause instanceof DOMException && cause.name === "NotAllowedError";
      setError(denied ? "Microphone access is off. Allow it in the address bar and try again." : "The agent could not start listening. Try again.");
    } finally {
      if (request === micRequest.current) { startingMic.current = false; setRequesting(false); }
    }
  }, [interruptCommentary, commentary.leader, retryAudio]);

  useEffect(() => {
    const speak = () => { void toggle(); };
    window.addEventListener("hyper:cfo-toggle", speak);
    return () => window.removeEventListener("hyper:cfo-toggle", speak);
  }, [toggle]);

  const closeAgent = useCallback(() => {
    interruptCommentary();
    micRequest.current++;
    startingMic.current = false;
    mic.current?.getTracks().forEach(track => track.stop());
    mic.current = null;
    setMicrophoneStream(null);
    setRequesting(false);
    client.current?.disconnect();
    voiceVisual.current?.publish({ connection: "disconnected", error: null, microphoneStream: null, playbackStream: null, presentation: { orbState: "composing" } });
    setListening(false);
    setError("");
    setAgentOpen(false);
    document.querySelector<HTMLButtonElement>("[data-cfo-trigger]")?.focus({ preventScroll: true });
  }, [interruptCommentary]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && agentOpen) { event.preventDefault(); closeAgent(); return; }
      if (event.key.toLowerCase() !== "v" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
      void toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [agentOpen, closeAgent, toggle]);

  return (
    <div className="cmd" data-agent-open="true" data-listening={listening} data-connection={connection}>
      <div className="cmd-cards" aria-live="polite">
        {cards.map((card) => <ArtifactCard key={card.id} card={card} onDismiss={() => setCards((previous) => previous.filter((c) => c.id !== card.id))} />)}
      </div>
      <WorldVoiceBox
        stream={microphoneStream}
        listening={listening}
        requesting={requesting}
        processing={processing}
        sending={sending}
        transcript=""
        dialogue={dialogue}
        commentary={commentary.caption}
        speakingConversation={conversationActive}
        status={requesting && !microphoneStream ? "Waiting for microphone permission..." : status}
        error={error || commentary.error || decision.error}
        draft={draft}
        visible
        onDraft={setDraft}
        onSend={() => { void submit(); }}
        onMicrophone={() => { void toggle(); }}
      />
    </div>
  );
}
