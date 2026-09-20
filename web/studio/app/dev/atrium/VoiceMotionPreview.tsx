"use client";

import { useEffect, useRef, useState } from "react";
import { bindWorldVoice, getWorldVoiceVisual, type WorldVoiceVisual } from "@/lib/command/world-voice";

type PreviewMode = "Idle" | "Listening" | "Thinking" | "Speaking";
const MODES: PreviewMode[] = ["Idle", "Listening", "Thinking", "Speaking"];

function syntheticSpeech() {
  const context = new AudioContext();
  try {
    const stream = context.createMediaStreamDestination();
    const carrier = context.createOscillator();
    carrier.type = "sine";
    carrier.frequency.value = 185;
    const amplitude = context.createGain();
    amplitude.gain.value = 0;
    carrier.connect(amplitude);
    amplitude.connect(stream);
    // Loop a shaped control signal on the audio clock. This is real, silent
    // synthetic playback for the analyser, with no UI timer driving its motion.
    const envelope = context.createBufferSource();
    const duration = 6;
    const rate = 8000;
    const buffer = context.createBuffer(1, duration * rate, rate);
    const samples = buffer.getChannelData(0);
    const syllables = [
      [0.18, 0.22, 0.10], [0.50, 0.32, 0.22], [0.90, 0.20, 0.13],
      [1.21, 0.46, 0.27], [1.79, 0.25, 0.12], [2.12, 0.31, 0.19],
      [2.82, 0.27, 0.15], [3.18, 0.43, 0.25], [3.74, 0.23, 0.12],
      [4.08, 0.34, 0.20], [4.55, 0.22, 0.11], [4.88, 0.42, 0.23],
    ];
    for (const [start, length, strength] of syllables) {
      const from = Math.round(start * rate), count = Math.round(length * rate);
      for (let i = 0; i < count; i++) samples[from + i] = strength * Math.sin(Math.PI * i / count) ** 2;
    }
    envelope.buffer = buffer;
    envelope.loop = true;
    envelope.connect(amplitude.gain);
    carrier.start();
    envelope.start();
    let stopped = false;
    return {
      context,
      stream: stream.stream,
      stop() {
        if (stopped) return;
        stopped = true;
        carrier.stop();
        envelope.stop();
        carrier.disconnect();
        envelope.disconnect();
        amplitude.disconnect();
        stream.disconnect();
        stream.stream.getTracks().forEach(track => track.stop());
      },
    };
  } catch (error) {
    void context.close().catch(() => {});
    throw error;
  }
}

export default function VoiceMotionPreview() {
  const [mode, setMode] = useState<PreviewMode | null>(null);
  const [visual, setVisual] = useState<WorldVoiceVisual>({ state: "idle", level: 0 });
  const [error, setError] = useState("");
  const release = useRef<(() => void) | null>(null);

  useEffect(() => () => { release.current?.(); release.current = null; }, []);
  useEffect(() => {
    if (mode === null) return;
    const timer = window.setInterval(() => setVisual({ ...getWorldVoiceVisual() }), 200);
    return () => window.clearInterval(timer);
  }, [mode]);

  function choose(next: PreviewMode) {
    release.current?.();
    release.current = null;
    setMode(next);
    setError("");
    try {
      const audio = next === "Speaking" ? syntheticSpeech() : null;
      const binding = bindWorldVoice(audio ? { createAudioContext: () => audio.context } : undefined);
      release.current = () => {
        audio?.stop();
        binding.clear();
      };
      if (audio) void binding.resumeAudio();
      binding.publish({
        connection: "connected",
        presentation: { orbState: next === "Thinking" ? "solving" : next === "Listening" ? "listening" : next === "Speaking" ? "weaving" : "composing", processing: next === "Thinking" },
        playbackStream: audio?.stream ?? null,
      });
      setVisual({ ...getWorldVoiceVisual() });
    } catch {
      release.current?.();
      release.current = null;
      setError("Audio preview is unavailable in this browser.");
    }
  }

  return <aside className="voice-motion-preview" aria-label="Voice motion preview" data-voice-motion-preview data-state={visual.state} data-level={visual.level.toFixed(3)}>
    <strong>Motion preview · synthetic audio</strong>
    <p>No microphone or backend. Audio stays muted.</p>
    <div className="voice-motion-preview-modes" role="group" aria-label="Agent motion state">
      {MODES.map(value => <button type="button" key={value} aria-pressed={mode === value} onClick={() => choose(value)}>{value}</button>)}
    </div>
    <output>{mode ? `${visual.state} · level ${visual.level.toFixed(2)}` : "Choose a state to start"}</output>
    {error && <p role="alert">{error}</p>}
    <style>{`
      .voice-motion-preview { position: fixed; z-index: 12000; right: 18px; bottom: 18px; width: 306px; max-width: calc(100vw - 36px); padding: 14px; border: 1px solid rgba(255,255,255,.44); border-radius: 16px; background: rgba(28,30,34,.88); box-shadow: 0 8px 30px rgba(0,0,0,.16); color: #fff; font: 12px/1.4 system-ui,sans-serif; }
      .voice-motion-preview strong { display: block; font-size: 12px; font-weight: 600; }
      .voice-motion-preview p { margin: 5px 0 11px; color: rgba(255,255,255,.65); font-size: 11px; }
      .voice-motion-preview-modes { display: flex; gap: 5px; }
      .voice-motion-preview button { flex: 1; border: 1px solid rgba(255,255,255,.20); border-radius: 8px; padding: 7px 4px; background: transparent; color: #fff; font: inherit; cursor: pointer; }
      .voice-motion-preview button[aria-pressed="true"] { background: #f4e4ed; color: #251d24; border-color: #f4e4ed; }
      .voice-motion-preview button:focus-visible { outline: 2px solid #f4e4ed; outline-offset: 3px; }
      .voice-motion-preview output { display: block; margin-top: 10px; color: rgba(255,255,255,.7); font: 11px/1.4 ui-monospace,monospace; font-variant-numeric: tabular-nums; }
      .voice-motion-preview [role="alert"] { margin-bottom: 0; color: #ffc8c8; }
    `}</style>
  </aside>;
}
