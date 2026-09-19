import type { OrbState } from "thinking-orbs";

export const ORB_STATES = ["working", "searching", "solving", "listening", "connecting", "weaving", "composing", "breathing", "shaping"] as const satisfies readonly OrbState[];

/** The conversation service owns these values. The interface never simulates replies. */
export interface OnboardingPresentation {
  orbState?: OrbState;
  status?: string;
  transcript?: string;
  processing?: boolean;
}

export const ONBOARDING_EVENTS = {
  presentation: "hyper:onboarding-presentation",
  text: "hyper:onboarding-text",
  microphone: "hyper:onboarding-microphone",
  completion: "hyper:onboarding-completion",
} as const;

export const ONBOARDING_STORAGE_KEY = "hyper.onboarding.v1";
let sessionCompletion: boolean | undefined;

export function isOnboardingComplete(): boolean {
  if (typeof window === "undefined") return false;
  if (sessionCompletion !== undefined) return sessionCompletion;
  try { return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "complete"; }
  catch { return sessionCompletion ?? false; }
}

/** UI persistence only. Call after the conversation service confirms completion. */
export function setOnboardingComplete(complete: boolean) {
  try {
    if (complete) localStorage.setItem(ONBOARDING_STORAGE_KEY, "complete");
    else localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    sessionCompletion = undefined;
  } catch { sessionCompletion = complete; }
  window.dispatchEvent(new Event(ONBOARDING_EVENTS.completion));
}

export function subscribeOnboardingCompletion(update: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === ONBOARDING_STORAGE_KEY || event.key === null) {
      sessionCompletion = undefined;
      update();
    }
  };
  window.addEventListener(ONBOARDING_EVENTS.completion, update);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(ONBOARDING_EVENTS.completion, update);
    window.removeEventListener("storage", onStorage);
  };
}

export function isOnboardingPresentation(value: unknown): value is OnboardingPresentation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (data.orbState === undefined || ORB_STATES.includes(data.orbState as OrbState))
    && (data.status === undefined || (typeof data.status === "string" && data.status.length <= 500))
    && (data.transcript === undefined || (typeof data.transcript === "string" && data.transcript.length <= 8000))
    && (data.processing === undefined || typeof data.processing === "boolean");
}

/** Call from the browser-side voice adapter when the real agent changes state. */
export function presentOnboarding(presentation: OnboardingPresentation) {
  window.dispatchEvent(new CustomEvent(ONBOARDING_EVENTS.presentation, { detail: presentation }));
}
