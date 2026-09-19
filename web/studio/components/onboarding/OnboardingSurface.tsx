"use client";

import { useRef, useState, type FormEvent } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { VoiceBeam } from "voice-glow";
import { useSceneGlass } from "./useSceneGlass";

export type OnboardingOrbState = OrbState;

export interface OnboardingSurfaceProps {
  orbState: OnboardingOrbState;
  status: string;
  transcript?: string;
  microphoneState: "idle" | "requesting" | "live" | "error";
  microphoneError?: string | null;
  stream: MediaStream | null;
  processing: boolean;
  onToggleMicrophone: () => void;
  onSendText: (text: string) => Promise<boolean>;
  onSkip: () => void;
  paused?: boolean;
}

export default function OnboardingSurface({
  orbState,
  status,
  transcript,
  microphoneState,
  microphoneError,
  stream,
  processing,
  onToggleMicrophone,
  onSendText,
  onSkip,
  paused = false,
}: OnboardingSurfaceProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const pendingSend = useRef(false);
  const glass = useRef<HTMLDivElement>(null);
  useSceneGlass(glass);
  const live = microphoneState === "live";
  const requesting = microphoneState === "requesting";
  const microphoneLabel = requesting
    ? "Waiting for microphone permission"
    : live
      ? "Turn off microphone"
      : microphoneState === "error"
        ? "Try microphone again"
        : "Turn on microphone";

  async function sendText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pendingSend.current) return;
    pendingSend.current = true;
    setSending(true);
    try {
      if (await onSendText(message)) {
        setDraft(current => current.trim() === message ? "" : current);
      }
    } finally {
      pendingSend.current = false;
      setSending(false);
    }
  }

  return (
    <section
      className="hyper-onboarding"
      aria-label="Voice onboarding"
      tabIndex={-1}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="hyper-onboarding__center">
        <button
          className="hyper-onboarding__orb"
          type="button"
          onClick={onToggleMicrophone}
          aria-label={microphoneLabel}
          aria-pressed={live}
          aria-busy={requesting}
          aria-describedby="onboarding-status"
          disabled={requesting}
          data-microphone={microphoneState}
          data-orb-state={orbState}
        >
          <ThinkingOrb
            state={orbState}
            size={64}
            theme="light"
            paused={paused}
            aria-hidden="true"
            style={{ width: "100%", height: "100%" }}
          />
        </button>
        <p className="hyper-onboarding__status" id="onboarding-status" role="status">
          {status}
        </p>
        {microphoneError && (
          <p className="hyper-onboarding__error" role="alert">
            {microphoneError}
          </p>
        )}
      </div>

      <div className="hyper-onboarding__bottom">
        <VoiceBeam
          className="hyper-onboarding__voice"
          stream={stream}
          processing={processing}
          theme="light"
          colorVariant="colorful"
          paused={paused}
          active={live || processing}
          idle={0}
          strength={0.8}
          scale={1.1}
        >
          <div ref={glass} className="hyper-onboarding__voice-card">
            {transcript && (
              <p className="hyper-onboarding__transcript" aria-live="polite">
                {transcript}
              </p>
            )}
            <form className="hyper-onboarding__composer" onSubmit={sendText} aria-busy={sending}>
            <label className="hyper-onboarding__sr-only" htmlFor="onboarding-message">
              Type a message instead
            </label>
            <input
              id="onboarding-message"
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Or type here…"
              autoComplete="off"
              maxLength={4000}
              enterKeyHint="send"
            />
            <button type="submit" aria-label={sending ? "Sending message" : "Send message"} disabled={!draft.trim() || sending}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
                <path d="M12 18V6m-5 5 5-5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            </form>
          </div>
        </VoiceBeam>
      </div>
      <button className="hyper-onboarding__skip" type="button" onClick={onSkip}>
        Skip onboarding
      </button>
    </section>
  );
}
