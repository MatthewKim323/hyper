# Onboarding interface

The landing Enter link keeps the 3D transition into `/projects`. After the renderer signals that the scene is ready, unfinished users see the original scene without a dim overlay, with a white orb and dark voice box. The resting orb state is `composing`. Workspace navigation and the timeline stay hidden and inert until completion. Completed users skip the surface on subsequent visits.

This package implements the interface, local microphone visualization, and presentation/completion hooks. It does not connect to Deepgram, transcribe audio, synthesize speech, record audio, or collect a profile. The initial introduction is display copy. The conversation service owns real replies and completion.

`OnboardingSurface` is the controlled view: actual `ThinkingOrb` from `thinking-orbs`, actual `VoiceBeam` from `voice-glow`, transcript within the beam card, and optional text. It accepts all nine orb states. The installed orb version uses `theme="dark"`, rather than the older `dark` prop. Reduced motion and hidden tabs pause effects.

## Connect the conversation service

Browser-side adapter:

```ts
import {
  ONBOARDING_EVENTS,
  presentOnboarding,
  setOnboardingComplete,
} from "@/lib/onboarding/interface";

const handleText = (event: Event) => {
  const { text } = (event as CustomEvent<{ text: string }>).detail;
  // Send text to your conversation session.
};
const handleMicrophone = (event: Event) => {
  const { stream } = (event as CustomEvent<{ stream: MediaStream | null }>).detail;
  // Connect this stream to the voice transport. Null means disconnect input.
};
window.addEventListener(ONBOARDING_EVENTS.text, handleText);
window.addEventListener(ONBOARDING_EVENTS.microphone, handleMicrophone);

// Drive these from actual provider events, not timers.
presentOnboarding({ orbState: "listening", status: "Listening", processing: false });
presentOnboarding({ orbState: "solving", status: "Thinking", processing: true });
presentOnboarding({
  orbState: "composing",
  transcript: "Your agent's actual response",
  status: "Speaking",
  processing: false,
});

// Only after your service has confirmed onboarding is finished:
setOnboardingComplete(true);

// Remove adapter listeners when its session is disposed.
window.removeEventListener(ONBOARDING_EVENTS.text, handleText);
window.removeEventListener(ONBOARDING_EVENTS.microphone, handleMicrophone);
```

The stream starts only when the user clicks the orb. It stops when the orb is clicked again, the tab is hidden, onboarding completes, or the route unmounts. A late permission response is stopped too. Ambient scene audio is temporarily suppressed while onboarding is visible without changing the user's mute preference.

Text submission emits an event and displays the submitted text as a preview until the adapter supplies a transcript. Nothing is uploaded by this interface. The microphone event passes the same stream analyzed by VoiceBeam, so the voice service does not need to open a second microphone.

## Completion state

`setOnboardingComplete(true)` persists the UI flag under `hyper.onboarding.v1` in local storage. `setOnboardingComplete(false)` resets it. Storage failure falls back to the current page session. Changes sync across tabs. This is browser-local UI state, not authentication or an account record. The account service should reconcile this flag with its authoritative user state after sign-in and clear or replace it when users change.

Tests: `bun test lib/onboarding`.
