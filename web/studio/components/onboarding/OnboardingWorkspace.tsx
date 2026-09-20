"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useMicrophone } from "voice-glow";
import { store } from "@/lib/engine/core/store";
import { ONBOARDING_PATH, WORLD_PATH } from "@/lib/engine/router/routes";
import { isOnboardingComplete, isOnboardingPresentation, ONBOARDING_EVENTS, setOnboardingComplete, subscribeOnboardingCompletion, type OnboardingPresentation } from "@/lib/onboarding/interface";
import { OnboardingVoiceClient, type VoiceConnection } from "@/lib/onboarding/voice-client";
import { runOnboardingWipeHandoff } from "@/lib/onboarding/handoff-wipe";
import { createDialogue, reduceDialogueEvent } from "@/lib/onboarding/dialogue";
import OnboardingSurface from "./OnboardingSurface";
import AtriumPreview from "../atrium/AtriumPreview";

const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const sceneSnapshot = () => document.body.dataset.workspaceReady === "true";
const subscribeScene = (update: () => void) => {
  window.addEventListener("hyper:workspace-ready", update);
  return () => window.removeEventListener("hyper:workspace-ready", update);
};
const INTRODUCTION = "Hi, I’m your Hyper onboarding agent. Let’s get to know you.";

function OnboardingSession({ onSkip }: { onSkip: () => void }) {
  const mic = useMicrophone({ constraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const [presentation, setPresentation] = useState<OnboardingPresentation>({});
  const [dialogue, setDialogue] = useState(() => createDialogue(INTRODUCTION));
  const [connection, setConnection] = useState<VoiceConnection>("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [agentStream, setAgentStream] = useState<MediaStream | null>(null);
  const client = useRef<OnboardingVoiceClient | null>(null);
  const request = useRef(0);
  const pendingStart = useRef(false);
  const { stop, start, stream } = mic;

  useEffect(() => {
    let active = true;
    const session = new OnboardingVoiceClient({
      onPresentation: next => {
        if (active) setPresentation(previous => ({ ...previous, ...next }));
      },
      onConnection: next => {
        if (!active) return;
        setConnection(next);
        if (next === "connecting" || next === "connected") setConnectionError(null);
        if (next === "error" || next === "disconnected") {
          request.current++;
          stop();
        }
      },
      onError: message => {
        if (!active) return;
        setConnectionError(message);
        request.current++;
        stop();
      },
      onComplete: () => {
        if (active) setOnboardingComplete(true);
      },
      onPlaybackStream: next => {
        if (active) setAgentStream(next);
      },
      onEvent: event => {
        if (active) setDialogue(previous => reduceDialogueEvent(previous, event));
      },
    });
    client.current = session;
    void session.connect().catch(() => {
      // Transport callbacks supply the useful connection error.
    });
    return () => {
      active = false;
      // Invalidate in-flight permission requests, rather than capture an old count.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      request.current++;
      stop();
      session.dispose();
      if (client.current === session) client.current = null;
    };
  }, [stop]);

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setPaused(preference.matches || document.hidden);
    const resumeConnection = () => {
      // Reopen session metadata only. The microphone still requires an orb click.
      if (!document.hidden && navigator.onLine) void client.current?.connect().catch(() => {});
    };
    const onHidden = () => {
      updateMotion();
      if (document.hidden) {
        request.current++;
        stop();
        client.current?.disconnect();
      } else resumeConnection();
    };
    const update = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      if (isOnboardingPresentation(detail)) setPresentation(previous => ({ ...previous, ...detail }));
    };
    updateMotion();
    preference.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("online", resumeConnection);
    window.addEventListener(ONBOARDING_EVENTS.presentation, update);
    return () => {
      // This counter invalidates pending media requests; it is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      request.current++;
      stop();
      preference.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("online", resumeConnection);
      window.removeEventListener(ONBOARDING_EVENTS.presentation, update);
    };
  }, [stop]);

  useEffect(() => {
    store.Audio?.setInputActive(true);
    document.querySelector<HTMLElement>(".hyper-onboarding")?.focus({ preventScroll: true });
    return () => store.Audio?.setInputActive(false);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(ONBOARDING_EVENTS.microphone, { detail: { stream } }));
    if (!stream) void client.current?.setMicrophone(null).catch(() => {});
    return () => {
      if (stream) window.dispatchEvent(new CustomEvent(ONBOARDING_EVENTS.microphone, { detail: { stream: null } }));
    };
  }, [stream]);

  async function toggleMicrophone() {
    const session = client.current;
    if (!session) return;
    if (mic.state === "live") {
      request.current++;
      stop();
      void session.setMicrophone(null).catch(() => {});
      return;
    }
    if (pendingStart.current || mic.state === "requesting") return;
    const current = ++request.current;
    pendingStart.current = true;
    setConnectionError(null);
    // Resume output in this gesture, before waiting for microphone permission.
    const playback = session.primePlayback();
    const capture = start();
    try {
      await playback;
      const next = await capture;
      // A permission prompt can resolve after navigation or tab suspension.
      if (request.current !== current || document.hidden) {
        next?.getTracks().forEach(track => track.stop());
        stop();
        return;
      }
      if (next) await session.setMicrophone(next);
      else await session.setMicrophone(null);
    } catch {
      // Stop a microphone even if permission resolves after a connection failure.
      request.current++;
      void capture.then(next => next?.getTracks().forEach(track => track.stop()));
      stop();
      setConnectionError("The voice connection could not start. Tap the orb to retry or type below.");
    } finally { pendingStart.current = false; }
  }

  async function sendText(text: string) {
    const session = client.current;
    if (!session) return false;
    setConnectionError(null);
    try {
      await session.primePlayback();
      const sent = await session.sendText(text);
      if (sent) window.dispatchEvent(new CustomEvent(ONBOARDING_EVENTS.text, { detail: { text } }));
      return sent;
    } catch {
      setConnectionError("Your message could not be sent. Try again, your draft is still here.");
      return false;
    }
  }

  const microphoneError = mic.state === "denied" ? "Microphone access is off. You can type below or enable it in your browser."
    : mic.state === "unsupported" ? "Your microphone needs localhost or HTTPS. You can still type below."
    : mic.state === "error" ? "Your microphone could not start. Try again or type below." : null;
  const status = connection === "connecting" ? "Connecting to your agent…"
    : connection === "error" || connection === "disconnected" ? "Connection paused. Tap the orb or send a message to reconnect."
    : mic.state === "requesting" ? "Allow microphone access to talk to your agent."
    : presentation.status ?? (mic.state === "live" ? "Microphone on. Tap the orb to pause." : "Tap the orb to talk, or type below.");

  return <OnboardingSurface
    orbState={connection === "connecting" || mic.state === "requesting" ? "connecting" : presentation.orbState ?? (mic.state === "live" ? "listening" : "composing")}
    status={status}
    transcript={presentation.transcript ?? INTRODUCTION}
    dialogue={dialogue}
    microphoneState={microphoneError || connectionError ? "error" : mic.state === "live" || mic.state === "requesting" ? mic.state : "idle"}
    microphoneError={microphoneError ?? connectionError}
    stream={stream}
    agentStream={agentStream}
    processing={presentation.processing ?? false}
    paused={paused}
    onToggleMicrophone={() => void toggleMicrophone()}
    onSendText={sendText}
    onSkip={onSkip}
  />;
}

export default function OnboardingWorkspace() {
  const pathname = usePathname();
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  const savedComplete = useSyncExternalStore(subscribeOnboardingCompletion, isOnboardingComplete, serverSnapshot);
  const [skipped, setSkipped] = useState(false);
  const complete = savedComplete || skipped;
  const sceneReady = useSyncExternalStore(subscribeScene, sceneSnapshot, serverSnapshot);
  const onOnboarding = pathname === ONBOARDING_PATH;
  // Next updates pathname the moment a navigation starts, but the engine's out transition runs
  // after that and blends from a still of the live world. Re-warming on the new pathname would
  // clear body[data-atriumActive] first, so to-home would find no world and cut instead of
  // animating. Hold the world open from navigate-out until navigate-end.
  const [leavingWorld, setLeavingWorld] = useState(false);
  const onWorld = pathname === WORLD_PATH || leavingWorld;
  const visible = hydrated && onOnboarding && sceneReady;
  // Finishing a live session hands off through the wipe; a returning user skips it.
  const [sessionShown, setSessionShown] = useState(false);
  // Whether onboarding was already done when this mounted, as opposed to completing here.
  const arrivedComplete = useRef(savedComplete);
  const [covered, setCovered] = useState(false);
  // On /world the world is simply shown: there is no session to hand off from. The second
  // branch is the onboarding handoff and only applies there -- unscoped it also matched the
  // landing page, where a returning (complete) visitor has no session shown, so the world
  // stayed un-warmed on / and came back over the landing scene after navigating home.
  const showDashboard = onWorld || (onOnboarding && complete && (!sessionShown || covered));

  // Latched in an effect, not during render: a render-phase setState here runs before the
  // external-store subscriptions settle, and `visible` depends on sceneReady, which
  // ProjectsRenderer.onLeave clears on every navigation away.
  useEffect(() => {
    if (visible && !complete && !sessionShown) setSessionShown(true);
  }, [visible, complete, sessionShown]);

  useEffect(() => {
    let timer = 0;
    const onOut = (event: Event) => {
      const { from, to } = (event as CustomEvent<{ from?: string; to?: string }>).detail ?? {};
      const leaving = (from ?? "").replace(/\/+$/, "") || "/";
      const arriving = (to ?? "").replace(/\/+$/, "") || "/";
      if (leaving === WORLD_PATH && arriving !== WORLD_PATH) { setLeavingWorld(true); timer = failsafe(); }
    };
    const onEnd = () => setLeavingWorld(false);
    // navigate-end is the normal release, but it only fires if the out transition finished.
    // A stalled one (its GSAP timeline never advances in a hidden tab) would otherwise hold
    // the world open over the landing scene for good, so release on a cap as well.
    const failsafe = () => window.setTimeout(() => setLeavingWorld(false), 4000);
    window.addEventListener("hyper:navigate-out", onOut);
    window.addEventListener("hyper:navigate-end", onEnd);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hyper:navigate-out", onOut);
      window.removeEventListener("hyper:navigate-end", onEnd);
    };
  }, []);

  useEffect(() => {
    if (onOnboarding && complete && sessionShown && !covered) void runOnboardingWipeHandoff(() => setCovered(true));
  }, [onOnboarding, complete, sessionShown, covered]);

  // The wipe leaves the world already on screen, so move the URL to /world underneath it.
  // replace(), not push(), so Back from the world returns to the landing page rather than to
  // a completed onboarding that would immediately hand off again.
  useEffect(() => {
    // Passing Next's private history state marks this as an internal update and skips
    // usePathname synchronization, leaving the CFO unmounted behind a /world URL.
    if (onOnboarding && covered) window.history.replaceState(null, "", WORLD_PATH);
  }, [onOnboarding, covered]);

  // A returning visitor who lands on /onboarding with it already done belongs in the world.
  useEffect(() => {
    // `arrivedComplete` is captured on mount, so finishing a live session here runs the wipe
    // instead of racing it with a hard reload when the completion event lands in the same tick.
    if (onOnboarding && hydrated && arrivedComplete.current && !sessionShown) location.replace(WORLD_PATH);
  }, [onOnboarding, hydrated, sessionShown]);

  useEffect(() => {
    document.documentElement.dataset.onboarding = showDashboard ? "complete" : "required";
    const navigation = document.querySelector<HTMLElement>(".js-project-filters");
    if (navigation) navigation.inert = !showDashboard;
    if (store.ProjectMenu && (onOnboarding || onWorld)) {
      store.ProjectMenu.allowControl = showDashboard && store.ProjectFilters?.selectedSection !== "timeline";
    }
  }, [showDashboard, onOnboarding, onWorld, sceneReady]);

  // The world mounts once, hidden, as soon as the page hydrates (so during the first loader, on
  // any route) and is only revealed here. Remounting it at the handoff is what used to freeze,
  // which is also why it stays mounted across the /onboarding -> /world move.
  if (!hydrated || pathname.startsWith("/dev/")) return null;
  return <>
    <AtriumPreview warm={!showDashboard} />
    {visible && !showDashboard && <OnboardingSession onSkip={() => setSkipped(true)} />}
  </>;
}
