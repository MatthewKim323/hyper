"use client";

import { useEffect, useRef, useState } from "react";
import { getAudioContext } from "voice-glow";
import WorldVoiceBox from "@/components/command/WorldVoiceBox";

type Mode = "Idle" | "User voice" | "Thinking" | "Reply" | "Error";
const MODES: Mode[] = ["Idle", "User voice", "Thinking", "Reply", "Error"];

/** An oscillating silent signal for the microphone analyser. Never connects to speakers. */
function syntheticInput() {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const carrier = context.createOscillator();
  const envelope = context.createOscillator();
  const envelopeDepth = context.createGain();
  const amplitude = context.createGain();
  carrier.frequency.value = 190;
  envelope.frequency.value = .72;
  envelopeDepth.gain.value = .14;
  amplitude.gain.value = .16;
  envelope.connect(envelopeDepth);
  envelopeDepth.connect(amplitude.gain);
  carrier.connect(amplitude);
  amplitude.connect(destination);
  carrier.start();
  envelope.start();
  void context.resume().catch(() => {});
  return {
    stream: destination.stream,
    stop() {
      carrier.stop();
      envelope.stop();
      carrier.disconnect();
      envelope.disconnect();
      envelopeDepth.disconnect();
      amplitude.disconnect();
      destination.disconnect();
      destination.stream.getTracks().forEach(track => track.stop());
      void context.close().catch(() => {});
    },
  };
}

export default function VoiceBoxPreview() {
  const [mode, setMode] = useState<Mode>("Idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [draft, setDraft] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const release = useRef<(() => void) | null>(null);
  useEffect(() => () => { release.current?.(); release.current = null; }, []);

  function choose(next: Mode) {
    release.current?.();
    release.current = null;
    setStream(null);
    setMode(next);
    setError(next === "Error" ? "The connection is unavailable. Your draft is kept. Try again." : "");
    setTranscript(next === "Reply" ? "This is a visual transcript preview. The live agent’s reply appears here while you stay in the world." : "");
    if (next !== "User voice") return;
    try {
      getAudioContext();
      const audio = syntheticInput();
      release.current = () => audio.stop();
      setStream(audio.stream);
    } catch { setError("Synthetic audio is unavailable in this browser."); }
  }

  return <>
    <aside className="voice-box-preview-controls" aria-label="Voice box preview">
      <strong>Voice box preview</strong>
      <p>Visual states only. User voice is a muted synthetic signal. No microphone or backend.</p>
      <div role="group" aria-label="Preview state">
        {MODES.map(value => <button type="button" key={value} aria-pressed={mode === value} onClick={() => choose(value)}>{value}</button>)}
      </div>
    </aside>
    <div className="cmd" data-agent-open="true">
      <WorldVoiceBox
        stream={stream}
        listening={mode === "User voice"}
        requesting={false}
        processing={mode === "Thinking"}
        sending={false}
        transcript={transcript}
        status={mode === "Thinking" ? "Thinking" : "Listening"}
        error={error}
        draft={draft}
        visible
        onDraft={setDraft}
        onSend={() => { setTranscript(draft.trim()); setDraft(""); }}
        onMicrophone={() => choose(mode === "User voice" ? "Idle" : "User voice")}
      />
    </div>
    <style>{`
      .voice-box-preview-controls { position: fixed; z-index: 2147482000; top: 18px; left: 18px; width: min(420px, calc(100vw - 36px)); padding: 14px; border: 1px solid rgb(255 255 255 / 70%); border-radius: 16px; background: rgb(250 245 242 / 95%); color: #322824; font: 12px/1.4 system-ui,sans-serif; }
      .voice-box-preview-controls strong { display: block; font-size: 13px; font-weight: 600; }
      .voice-box-preview-controls p { margin: 6px 0 10px; font-size: 11px; }
      .voice-box-preview-controls [role="group"] { display: flex; flex-wrap: wrap; gap: 5px; }
      .voice-box-preview-controls button { padding: 7px 10px; border: 1px solid rgb(67 48 38 / 18%); border-radius: 8px; background: none; color: inherit; font: inherit; cursor: pointer; }
      .voice-box-preview-controls button[aria-pressed="true"] { background: #493e3c; color: #fff9f5; }
    `}</style>
  </>;
}
