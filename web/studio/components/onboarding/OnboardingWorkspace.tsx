"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useMicrophone } from "voice-glow";
import { store } from "@/lib/engine/core/store";
import { isOnboardingComplete, isOnboardingPresentation, ONBOARDING_EVENTS, subscribeOnboardingCompletion, type OnboardingPresentation } from "@/lib/onboarding/interface";
import OnboardingSurface from "./OnboardingSurface";

const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const sceneSnapshot = () => document.body.dataset.workspaceReady === "true";
const subscribeScene = (update: () => void) => {
  window.addEventListener("hyper:workspace-ready", update);
  return () => window.removeEventListener("hyper:workspace-ready", update);
};
const INTRODUCTION = "Hi, I’m your Hyper onboarding agent. Let’s get to know you.";

function OnboardingSession() {
  const mic = useMicrophone({ constraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const [presentation, setPresentation] = useState<OnboardingPresentation>({});
  const [textPreview, setTextPreview] = useState("");
  const [paused, setPaused] = useState(false);
  const request = useRef(0);
  const pendingStart = useRef(false);
  const { stop, start, stream } = mic;

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setPaused(preference.matches || document.hidden);
    const onHidden = () => {
      updateMotion();
      if (document.hidden) { request.current++; stop(); }
    };
    const update = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      if (isOnboardingPresentation(detail)) setPresentation(previous => ({ ...previous, ...detail }));
    };
    updateMotion();
    preference.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener(ONBOARDING_EVENTS.presentation, update);
    return () => {
      // This counter invalidates pending media requests; it is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      request.current++;
      stop();
      preference.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", onHidden);
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
    return () => {
      if (stream) window.dispatchEvent(new CustomEvent(ONBOARDING_EVENTS.microphone, { detail: { stream: null } }));
    };
  }, [stream]);

  async function toggleMicrophone() {
    if (mic.state === "live") { request.current++; stop(); return; }
    if (pendingStart.current || mic.state === "requesting") return;
    const current = ++request.current;
    pendingStart.current = true;
    try {
      const next = await start();
      // A permission prompt can resolve after navigation or tab suspension.
      if (request.current !== current) {
        next?.getTracks().forEach(track => track.stop());
        stop();
      }
    } finally { pendingStart.current = false; }
  }

  const microphoneError = mic.state === "denied" ? "Microphone access is off. You can type below or enable it in your browser."
    : mic.state === "unsupported" ? "Your microphone needs localhost or HTTPS. You can still type below."
    : mic.state === "error" ? "Your microphone could not start. Try again or type below." : null;
  const status = presentation.status ?? (mic.state === "live" ? "Microphone on. Tap the orb to pause."
    : mic.state === "requesting" ? "Allow microphone access to try your voice."
    : textPreview ? "Your text preview" : "Tap the orb to try your microphone.");

  return <OnboardingSurface
    orbState={presentation.orbState ?? (mic.state === "live" ? "listening" : mic.state === "requesting" ? "connecting" : "composing")}
    status={status}
    transcript={presentation.transcript ?? (textPreview || INTRODUCTION)}
    microphoneState={microphoneError ? "error" : mic.state === "live" || mic.state === "requesting" ? mic.state : "idle"}
    microphoneError={microphoneError}
    stream={stream}
    processing={presentation.processing ?? false}
    paused={paused}
    onToggleMicrophone={() => void toggleMicrophone()}
    onSendText={text => {
      setTextPreview(text);
      window.dispatchEvent(new CustomEvent(ONBOARDING_EVENTS.text, { detail: { text } }));
    }}
  />;
}

export default function OnboardingWorkspace() {
  const pathname = usePathname();
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  const complete = useSyncExternalStore(subscribeOnboardingCompletion, isOnboardingComplete, serverSnapshot);
  const sceneReady = useSyncExternalStore(subscribeScene, sceneSnapshot, serverSnapshot);

  useEffect(() => {
    document.documentElement.dataset.onboarding = complete ? "complete" : "required";
    const navigation = document.querySelector<HTMLElement>(".js-project-filters");
    if (navigation) navigation.inert = !complete;
    if (store.ProjectMenu && pathname === "/projects") {
      store.ProjectMenu.allowControl = complete && store.ProjectFilters?.selectedSection !== "timeline";
    }
  }, [complete, pathname, sceneReady]);

  return hydrated && pathname === "/projects" && sceneReady && !complete ? <OnboardingSession /> : null;
}
