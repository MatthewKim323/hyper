# Onboarding interface

The landing Enter link keeps the 3D transition into `/projects`. The gallery uses its original light fog, arches and flooring, warm rays, and untinted butterflies, with no dim overlay. After the renderer signals that the scene is ready, unfinished users see a dark orb and dark text on a clear glass voice box. The resting orb state is `composing`. Workspace navigation and the timeline stay hidden and inert until completion. Completed users skip the surface on subsequent visits.

The interface connects to the existing FastAPI onboarding backend through a same-origin HTTP/WebSocket proxy. Deepgram handles transcription, reasoning, and speech. The client streams the user’s actual microphone input, plays the agent’s PCM audio, and shows committed transcript segments inside the voice box. The introduction remains local display copy until a real turn arrives. Jev’s readiness result, followed by the end of agent playback, drives completion.

`OnboardingSurface` is the controlled view: actual `ThinkingOrb` from `thinking-orbs`, actual `VoiceBeam` from `voice-glow`, transcript within the beam card, and optional text. It accepts all nine orb states. The installed orb version uses `theme="light"`, rather than the older `dark` prop. Reduced motion and hidden tabs pause effects.

The voice card uses clear liquid glass: its curved rim refracts the actual WebGL scene, with CSS specular highlights and no backdrop blur. `useSceneGlass` tracks its CSS bounds independently of device pixel ratio and clears the lens on unmount. Reduced-transparency and higher-contrast preferences switch to a solid readable material. Input focus highlights the rounded card instead of drawing a rectangle around the text field.

## Run the conversation service

Start the backend and evaluator using `backend/README.md`, then run this app with `bun run dev`. Next proxies `/api/onboarding/*` to `http://127.0.0.1:8000` by default. Override `ONBOARDING_BACKEND_URL` in the Next server environment for a different backend and restart Next. Configure the backend’s `ALLOWED_ORIGINS` for the frontend origin. Provider credentials belong in the backend environment, never browser code or `NEXT_PUBLIC_*` variables.

`OnboardingVoiceClient` opens or resumes a session once the gallery scene is ready. It keeps the session capability in per-tab session storage, restores committed transcript history, and deduplicates the compatibility reply events. A socket connection alone does not start the provider microphone stream.

The stream starts only when the user clicks the orb. The same `MediaStream` drives VoiceBeam and the transport’s audio worklet, which sends mono PCM at 16 kHz. Browser playback is unlocked from the orb or text-submit gesture. Agent audio plays at its actual 24 kHz sample rate, with speaking presentation tied to local playback rather than incoming packets. Interruptions discard queued audio, and stale generation events are ignored.

Clicking the orb again stops microphone forwarding while allowing the agent to finish its reply. Hiding the tab stops microphone capture and playback and disconnects the socket. The next orb click or text submission resumes the saved session. Completion and route unmount dispose the client, release microphone tracks, and clear playback. A microphone permission response that arrives after suspension is stopped too. Ambient scene audio remains suppressed while onboarding is visible without changing the user’s mute preference.

Typed input uses the same conversation without requesting a microphone. The draft stays in place until the transport confirms submission. Failures surface an error in the existing onboarding layout, and the orb or text form can retry. Typed messages are never substituted for an agent response locally.

## Presentation hooks

The `hyper:onboarding-presentation` event remains available for external presentation updates through `presentOnboarding`. The interface still emits `hyper:onboarding-text` after accepted typed input and `hyper:onboarding-microphone` when the shared stream changes. These are compatibility notifications; the built-in client already sends the text and audio, so listeners must not submit them a second time.

All nine orb states remain accepted. Backend idle maps to `composing`, listening to `listening`, thinking to `solving`, and researching to `searching`. The client applies the speaking presentation while its audio queue is playing. It calls `setOnboardingComplete(true)` only when the backend has confirmed readiness and the final playback queue has drained.

## Completion state

The small “Skip onboarding” action opens the workspace for the current page session and disposes the voice session. It does not write a completion flag or change the backend’s readiness result. The preview survives in-app navigation while `OnboardingWorkspace` is mounted; reloading restores the real completion state.

`setOnboardingComplete(true)` persists the UI flag under `hyper.onboarding.v1` in local storage. `setOnboardingComplete(false)` resets it. Storage failure falls back to the current page session. Changes sync across tabs. This is browser-local UI state, not authentication or an account record. The account service should reconcile this flag with its authoritative user state after sign-in and clear or replace it when users change.

Tests: `bun test lib/onboarding`.
