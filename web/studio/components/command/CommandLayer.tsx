"use client";

// Command layer: point at the dashboard, speak, and the world agent acts. The pointer (mouse or hand
// cursor) supplies what "this" means, Deepgram hears the request, the agent's tools answer it, and
// composed charts land here as bklit cards.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import ArtifactCard from "./ArtifactCard";
import { readArtifactCard, type ArtifactCardModel } from "@/lib/command/artifact";
import { PointerContext } from "@/lib/command/pointer-context";
import { OnboardingVoiceClient, type VoiceConnection } from "@/lib/onboarding/voice-client";
import { bindWorldVoice, type WorldVoiceBinding } from "@/lib/command/world-voice";

const SECTIONS = new Set(["overview", "cases", "evidence", "activity", "review", "timeline", "benchmarks"]);
const CHART_TOOLS = new Set(["compose_financial_artifact", "get_financial_artifact"]);
// How far back the pointer trail is read. People point before they speak, usually by one to two seconds.
const LOOKBACK_MS = 2500;
const POINTER_EVERY_MS = 450;

const subscribeOnboarding = (update: () => void) => {
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-onboarding"] });
  return () => observer.disconnect();
};
const onboardingDone = () => document.documentElement.dataset.onboarding === "complete";

export default function CommandLayer() {
  const pathname = usePathname();
  const ready = useSyncExternalStore(subscribeOnboarding, onboardingDone, () => false);
  return pathname === "/projects" && ready ? <CommandSession /> : null;
}

function CommandSession() {
  const [agentOpen, setAgentOpen] = useState(false);
  const agentPanel = useRef<HTMLElement>(null);
  const [connection, setConnection] = useState<VoiceConnection>("idle");
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [error, setError] = useState("");
  const [cards, setCards] = useState<ArtifactCardModel[]>([]);
  const client = useRef<OnboardingVoiceClient | null>(null);
  const pointer = useRef<PointerContext | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const voiceVisual = useRef<WorldVoiceBinding | null>(null);
  const micRequest = useRef(0);
  const startingMic = useRef(false);
  const lastSent = useRef("");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const context = new PointerContext();
    pointer.current = context;
    const visual = bindWorldVoice();
    voiceVisual.current = visual;
    const session = new OnboardingVoiceClient({
      onPresentation: (p) => { setStatus(p.status ?? ""); visual.publish({ presentation: p }); },
      onConnection: (next) => {
        setConnection(next);
        visual.publish({ connection: next });
        if (next === "error" || next === "disconnected") {
          micRequest.current++;
          startingMic.current = false;
          mic.current?.getTracks().forEach(track => track.stop());
          mic.current = null;
          setListening(false);
          visual.publish({ microphoneStream: null });
        }
      },
      onError: (message) => {
        const worldMessage = message.replace(/onboarding/gi, "voice");
        setError(worldMessage);
        visual.publish({ error: worldMessage });
      },
      onPlaybackStream: (stream) => visual.publish({ playbackStream: stream }),
      onComplete: () => {},
      onEvent: (event) => {
        if (event.type === "transcript" && typeof event.text === "string") (event.role === "user" ? setHeard : setSaid)(event.text);
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
    // The orb starts the connection. Entering the world stays quiet and idle.
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
  }, []);

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
    if (!text || !session) return;
    void voiceVisual.current?.resumeAudio();
    voiceVisual.current?.publish({ error: null });
    setError("");
    setDraft("");
    setHeard(text);
    try {
      await session.connect();
      lastSent.current = "";
      sharePointer();
      if (!(await session.sendText(text))) setError("Your message could not be sent. Try again.");
    } catch {
      setError("Your agent is unavailable. Try again in a moment.");
    }
  }, [draft, sharePointer]);

  const toggle = useCallback(async () => {
    setAgentOpen(true);
    const session = client.current;
    if (!session) return;
    void voiceVisual.current?.resumeAudio();
    if (mic.current) {
      micRequest.current++;
      startingMic.current = false;
      mic.current.getTracks().forEach((t) => t.stop());
      mic.current = null;
      voiceVisual.current?.publish({ microphoneStream: null });
      setListening(false);
      void session.setMicrophone(null).catch(() => {});
      return;
    }
    if (startingMic.current) return;
    startingMic.current = true;
    const request = ++micRequest.current;
    setError("");
    voiceVisual.current?.publish({ error: null });
    try {
      const playback = session.primePlayback();
      // Observe a playback failure while the permission prompt is still open.
      void playback.catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (request !== micRequest.current || client.current !== session) { stream.getTracks().forEach(track => track.stop()); return; }
      mic.current = stream;
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
      voiceVisual.current?.publish({ microphoneStream: null, error: true });
      setListening(false);
      const denied = cause instanceof DOMException && cause.name === "NotAllowedError";
      setError(denied ? "Microphone access is off. Allow it in the address bar and try again." : "The agent could not start listening. Try again.");
    } finally {
      if (request === micRequest.current) startingMic.current = false;
    }
  }, []);

  const closeAgent = useCallback(() => {
    micRequest.current++;
    startingMic.current = false;
    mic.current?.getTracks().forEach(track => track.stop());
    mic.current = null;
    client.current?.disconnect();
    voiceVisual.current?.publish({ connection: "disconnected", error: null, microphoneStream: null, playbackStream: null, presentation: { orbState: "composing" } });
    setListening(false);
    setError("");
    setAgentOpen(false);
    document.querySelector<HTMLButtonElement>('button[aria-label="Talk to Hyper"]')?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (agentOpen) agentPanel.current?.focus({ preventScroll: true });
  }, [agentOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && agentOpen) { event.preventDefault(); closeAgent(); return; }
      if (event.key.toLowerCase() !== "v" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
      void toggle();
    };
    window.addEventListener("keydown", onKey);
    const onOrb = () => { void toggle(); };
    window.addEventListener("hyper:agent-toggle", onOrb);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hyper:agent-toggle", onOrb);
    };
  }, [agentOpen, closeAgent, toggle]);

  const line = error || (listening ? heard || status || "Listening. Point at something and ask." : said || "Ask about what you are pointing at");
  return (
    <div className="cmd" data-agent-open={agentOpen} data-listening={listening} data-connection={connection}>
      <div className="cmd-cards" aria-live="polite">
        {cards.map((card) => <ArtifactCard key={card.id} card={card} onDismiss={() => setCards((previous) => previous.filter((c) => c.id !== card.id))} />)}
      </div>
      {agentOpen && <section ref={agentPanel} className="cmd-agent" role="dialog" aria-label="Hyper voice agent" tabIndex={-1} data-error={!!error}>
        <header>
          <span>Hyper</span>
          <button type="button" onClick={closeAgent} aria-label="Close voice agent" data-cursor="hide">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <p className="cmd-transcript" role={error ? "alert" : "status"}>{line}</p>
        <form onSubmit={event => { event.preventDefault(); void submit(); }}>
          <input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder="Or type here..."
            aria-label="Ask your agent"
            maxLength={2000}
          />
          <button type="submit" aria-label="Send message" disabled={!draft.trim()} data-cursor="hide">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
          </button>
        </form>
      </section>}
    </div>
  );
}
