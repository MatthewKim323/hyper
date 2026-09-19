"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useMicrophone } from "voice-glow";
import { store } from "@/lib/engine/core/store";
import { isOnboardingComplete, isOnboardingPresentation, ONBOARDING_EVENTS, setOnboardingComplete, subscribeOnboardingCompletion, type OnboardingPresentation } from "@/lib/onboarding/interface";
import { OnboardingVoiceClient, type VoiceConnection } from "@/lib/onboarding/voice-client";
import { runOnboardingWipeHandoff } from "@/lib/onboarding/handoff-wipe";
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
  const visible = hydrated && pathname === "/projects" && sceneReady;
  // Finishing a live session hands off through the wipe; a returning user skips it.
  const [sessionShown, setSessionShown] = useState(false);
  const [covered, setCovered] = useState(false);
  const showDashboard = complete && (!sessionShown || covered);

  if (visible && !complete && !sessionShown) setSessionShown(true);

  useEffect(() => {
    if (complete && sessionShown && !covered) void runOnboardingWipeHandoff(() => setCovered(true));
  }, [complete, sessionShown, covered]);

  useEffect(() => {
    document.documentElement.dataset.onboarding = showDashboard ? "complete" : "required";
    const navigation = document.querySelector<HTMLElement>(".js-project-filters");
    if (navigation) navigation.inert = !showDashboard;
    if (store.ProjectMenu && pathname === "/projects") {
      store.ProjectMenu.allowControl = showDashboard && store.ProjectFilters?.selectedSection !== "timeline";
    }
  }, [showDashboard, pathname, sceneReady]);

  if (!visible) return null;
  return showDashboard ? <AtriumPreview /> : <OnboardingSession onSkip={() => setSkipped(true)} />;
}
