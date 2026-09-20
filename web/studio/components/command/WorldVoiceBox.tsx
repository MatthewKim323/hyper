"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { VoiceBeam } from "voice-glow";
import styles from "./WorldVoiceBox.module.css";
import { dialogueTurns, type DialogueState } from "@/lib/onboarding/dialogue";
import type { NarrationRecord } from "@/lib/command/cfo-commentary";

const pausedSnapshot = () => document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches;
const subscribePaused = (update: () => void) => {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener("change", update);
  document.addEventListener("visibilitychange", update);
  return () => {
    motion.removeEventListener("change", update);
    document.removeEventListener("visibilitychange", update);
  };
};

type Props = {
  stream: MediaStream | null;
  listening: boolean;
  requesting: boolean;
  processing: boolean;
  sending: boolean;
  transcript: string;
  dialogue?: DialogueState;
  commentary?: NarrationRecord | null;
  speakingConversation?: boolean;
  status: string;
  error: string;
  draft: string;
  visible: boolean;
  onDraft: (value: string) => void;
  onSend: () => void;
  onMicrophone: () => void;
};

/** The world session owns capture and transport. This surface only observes its mic. */
export default function WorldVoiceBox({ stream, listening, requesting, processing, sending, transcript, dialogue, commentary, speakingConversation = false, status, error, draft, visible, onDraft, onSend, onMicrophone }: Props) {
  const paused = useSyncExternalStore(subscribePaused, pausedSnapshot, () => true);
  const turn = dialogue ? dialogueTurns(dialogue.entries).at(-1) : undefined;
  const narration = !speakingConversation ? commentary : null;
  const line = narration?.event.narration.text || (turn?.role === "assistant" ? turn.text : transcript);
  const captionKey = narration?.event.id || turn?.id || "preview";
  const holding = narration ? narration.status === "playing" : speakingConversation;
  const microphoneLabel = requesting ? "Cancel microphone request" : listening ? "Stop listening" : "Speak to your CFO";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim() && !sending) onSend();
  };

  return (
    <section
      className={styles.dock}
      aria-label="Talk to your CFO"
      hidden={!visible}
      data-listening={listening}
      data-requesting={requesting}
      data-error={!!error}
      onPointerDown={event => event.stopPropagation()}
      onPointerUp={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
    >
      {line && <FadingCaption key={captionKey} text={line} holding={holding} />}
      {error && <FadingCaption key={`error:${error}`} text={error} error />}
      <VoiceBeam
        className={styles.beam}
        stream={stream}
        processing={processing}
        theme="light"
        colorVariant="colorful"
        active={listening || requesting || processing}
        paused={paused || !visible}
        idle={listening ? .1 : 0}
        strength={.8}
        scale={.85}
        attack={.16}
        release={.55}
      >
        <div className={styles.glass}>
          <form className={styles.composer} onSubmit={submit} aria-busy={sending}>
            <input
              className={styles.input}
              type="text"
              aria-label="Message your CFO"
              value={draft}
              onChange={event => onDraft(event.target.value)}
              placeholder={requesting ? "Starting microphone..." : listening ? "Listening..." : processing ? status || "Thinking..." : "Ask your CFO..."}
              autoComplete="off"
              enterKeyHint="send"
              maxLength={2000}
            />
            {draft.trim() && <button
              className={styles.send}
              type="submit"
              aria-label={sending ? "Sending message" : "Send message"}
              disabled={sending}
              data-cursor="hide"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
            </button>}
            <button
              className={styles.microphone}
              type="button"
              onClick={onMicrophone}
              aria-label={microphoneLabel}
              title={microphoneLabel}
              aria-pressed={listening}
              aria-busy={requesting}
              data-cursor="hide"
            >
              {listening || requesting
                ? <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
                : <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3m-3 0h6" /></svg>}
            </button>
          </form>
        </div>
      </VoiceBeam>
    </section>
  );
}

/** Keep live speech readable, then clear the scene without moving the composer. */
function FadingCaption({ text, holding = false, error = false }: { text: string; holding?: boolean; error?: boolean }) {
  const [expired, setExpired] = useState("");
  const version = `${holding}:${text}`;
  const shown = expired !== version;
  useEffect(() => {
    if (holding) return;
    // Text-only updates get enough time to read; spoken lines linger briefly after playback.
    const delay = Math.max(4500, Math.min(10000, text.split(/\s+/).length * 220));
    const timer = window.setTimeout(() => setExpired(version), delay);
    return () => window.clearTimeout(timer);
  }, [holding, text, version]);
  return <p className={styles.caption} data-visible={shown} data-error={error || undefined}
    role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} aria-atomic="true" aria-hidden={!shown}>{text}</p>;
}
