"use client";

// Command layer: point at the dashboard, speak, and the world agent acts. The pointer (mouse or hand
// cursor) supplies what "this" means, Deepgram hears the request, the agent's tools answer it, and
// composed charts land here as bklit cards.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import ArtifactCard from "./ArtifactCard";
import { readArtifactCard, type ArtifactCardModel } from "@/lib/command/artifact";
import { PointerContext, type Referent } from "@/lib/command/pointer-context";
import { OnboardingVoiceClient, type VoiceConnection } from "@/lib/onboarding/voice-client";

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
  const [connection, setConnection] = useState<VoiceConnection>("idle");
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [error, setError] = useState("");
  const [cards, setCards] = useState<ArtifactCardModel[]>([]);
  const [target, setTarget] = useState<Referent | null>(null);
  const client = useRef<OnboardingVoiceClient | null>(null);
  const pointer = useRef<PointerContext | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const lastSent = useRef("");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const context = new PointerContext();
    pointer.current = context;
    const session = new OnboardingVoiceClient({
      onPresentation: (p) => setStatus(p.status ?? ""),
      onConnection: setConnection,
      onError: setError,
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
    void session.connect().catch(() => {});
    return () => {
      context.destroy();
      mic.current?.getTracks().forEach((t) => t.stop());
      mic.current = null;
      session.dispose();
      client.current = null;
      pointer.current = null;
    };
  }, []);

  const sharePointer = useCallback(() => {
    const now = performance.now();
    const region = pointer.current?.region(now - LOOKBACK_MS, now);
    const referents = (region?.referents ?? []).filter((r) => r.label || r.id).slice(0, 12);
    setTarget(referents[0] ?? null);
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

  // While listening, keep the agent informed of what is being pointed at, and show the same thing on screen.
  useEffect(() => {
    if (!listening) return;
    sharePointer();
    const timer = window.setInterval(sharePointer, POINTER_EVERY_MS);
    return () => {
      clearInterval(timer);
      setTarget(null);
      lastSent.current = "";
    };
  }, [listening, sharePointer]);

  // Typed commands carry the same pointing context as spoken ones.
  const submit = useCallback(async () => {
    const text = draft.trim();
    const session = client.current;
    if (!text || !session) return;
    setError("");
    setDraft("");
    setHeard(text);
    try {
      await session.connect();
      lastSent.current = "";
      sharePointer();
      // Show what "this" resolved to for a moment, then clear it: typed commands have no listening state.
      window.setTimeout(() => { if (!mic.current) setTarget(null); }, 2600);
      if (!(await session.sendText(text))) setError("Your message could not be sent. Try again.");
    } catch {
      setError("Your agent is unavailable. Try again in a moment.");
    }
  }, [draft, sharePointer]);

  const toggle = useCallback(async () => {
    const session = client.current;
    if (!session) return;
    if (mic.current) {
      mic.current.getTracks().forEach((t) => t.stop());
      mic.current = null;
      setListening(false);
      void session.setMicrophone(null).catch(() => {});
      return;
    }
    setError("");
    try {
      const playback = session.primePlayback();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      await playback;
      mic.current = stream;
      await session.connect();
      await session.setMicrophone(stream);
      setListening(true);
    } catch (cause) {
      mic.current?.getTracks().forEach((t) => t.stop());
      mic.current = null;
      setListening(false);
      const denied = cause instanceof DOMException && cause.name === "NotAllowedError";
      setError(denied ? "Microphone access is off. Allow it in the address bar and try again." : "The agent could not start listening. Try again.");
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "v" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
      void toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const line = error || (listening ? heard || status || "Listening. Point at something and ask." : said || "Ask about what you are pointing at");
  return (
    <div className="cmd" data-listening={listening} data-connection={connection}>
      {target && target.rect.width > 0 && (
        <div className="cmd-target" style={{ left: target.rect.x, top: target.rect.y, width: target.rect.width, height: target.rect.height }} aria-hidden="true">
          <span>{target.label.slice(0, 60)}</span>
        </div>
      )}
      <div className="cmd-cards" aria-live="polite">
        {cards.map((card) => <ArtifactCard key={card.id} card={card} onDismiss={() => setCards((previous) => previous.filter((c) => c.id !== card.id))} />)}
      </div>
      <div className="cmd-bar" data-error={!!error}>
        <button type="button" className="cmd-mic" onClick={() => void toggle()} aria-pressed={listening} data-cursor="hide" title="Talk to your agent (V)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
          </svg>
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
          placeholder={line}
          aria-label="Ask your agent"
          maxLength={2000}
        />
        <p className="sr" role={error ? "alert" : "status"}>{line}</p>
      </div>
    </div>
  );
}
