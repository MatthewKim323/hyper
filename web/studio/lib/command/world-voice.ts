import type { OnboardingPresentation } from "../onboarding/interface";
import type { VoiceConnection } from "../onboarding/voice-client";

export type WorldVoiceState = "idle" | "listening" | "thinking" | "speaking" | "connecting" | "error";
export type WorldVoiceVisual = Readonly<{ state: WorldVoiceState; level: number }>;
export type WorldVoiceUpdate = {
  presentation?: OnboardingPresentation;
  connection?: VoiceConnection;
  playbackStream?: MediaStream | null;
  microphoneStream?: MediaStream | null;
  error?: string | boolean | null;
};
export type WorldVoiceBinding = {
  publish(update: WorldVoiceUpdate): void;
  /** Call directly from the mic or submit gesture, before awaiting anything. */
  resumeAudio(): Promise<void>;
  clear(): void;
};

type Host = { createAudioContext?: () => AudioContext; now?: () => number };
type Meter = { stream: MediaStream; sample(): number; live(): boolean; dispose(): void };
type ActiveBinding = WorldVoiceBinding & { read(): WorldVoiceVisual };
const IDLE: WorldVoiceVisual = Object.freeze({ state: "idle", level: 0 });
const THINKING = new Set(["working", "searching", "solving", "shaping"]);
let active: ActiveBinding | null = null;
const listeners = new Set<() => void>();
let notificationQueued = false;

function notify() {
  if (notificationQueued || listeners.size === 0) return;
  notificationQueued = true;
  queueMicrotask(() => {
    notificationQueued = false;
    for (const listener of listeners) listener();
  });
}

/** Semantic changes only, for a static/reduced-motion scene to render once. */
export function subscribeWorldVoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function smoothLevel(level: number, rms: number, gain: number, delta: number) {
  const target = Math.min(1, Math.max(0, rms - 0.004) * gain);
  const seconds = target > level ? 0.045 : 0.19;
  const result = level + (target - level) * (1 - Math.exp(-delta / seconds));
  return result < 0.0001 ? 0 : result;
}

function audioMeter(context: AudioContext, stream: MediaStream): Meter | null {
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  try {
    const tracks = stream.getAudioTracks();
    if (!tracks.some(track => track.readyState !== "ended")) return null;
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0;
    source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    // The analyser needs no output connection. In particular, microphone audio
    // must never be routed to the speakers or fed back into the voice client.
    const samples = new Float32Array(analyser.fftSize);
    let disposed = false;
    const live = () => {
      if (disposed || stream.active === false) return false;
      for (const track of tracks) if (track.readyState !== "ended" && track.enabled && !track.muted) return true;
      return false;
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      for (const track of tracks) track.removeEventListener("ended", ended);
      source?.disconnect();
      analyser?.disconnect();
    };
    const ended = () => { if (tracks.every(track => track.readyState === "ended")) dispose(); };
    for (const track of tracks) track.addEventListener("ended", ended);
    return {
      stream, live, dispose,
      sample() {
        if (!live() || context.state !== "running") return 0;
        try { analyser!.getFloatTimeDomainData(samples); }
        catch { return 0; }
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const sample = samples[i];
          if (Number.isFinite(sample)) sum += sample * sample;
        }
        return Math.min(1, Math.sqrt(sum / samples.length));
      },
    };
  } catch {
    source?.disconnect();
    analyser?.disconnect();
    return null;
  }
}

/** Own one mounted world-agent session. Rebinding retires the previous owner. */
export function bindWorldVoice(host: Host = {}): WorldVoiceBinding {
  active?.clear();
  const now = host.now ?? (() => performance.now());
  const createContext = host.createAudioContext ?? (() => new AudioContext());
  const visual: { state: WorldVoiceState; level: number } = { state: "idle", level: 0 };
  let context: AudioContext | null = null;
  let playback: Meter | null = null;
  let microphone: Meter | null = null;
  let presentation: OnboardingPresentation = {};
  let connection: VoiceConnection = "idle";
  let error = false;
  let disposed = false;
  let lastRead: number | null = null;
  let lastAudible = -Infinity;
  let playbackLevel = 0;
  let microphoneLevel = 0;

  function ensureContext() {
    if (disposed) return null;
    try {
      if (!context || context.state === "closed") context = createContext();
      return context;
    } catch { return null; }
  }

  function replaceMeter(previous: Meter | null, stream: MediaStream | null) {
    if (previous?.stream === stream) return previous;
    previous?.dispose();
    if (!stream) return null;
    const audio = ensureContext();
    if (!audio) return null;
    if (audio.state === "suspended") void audio.resume().catch(() => {});
    return audioMeter(audio, stream);
  }

  const binding: ActiveBinding = {
    publish(update) {
      if (disposed || active !== binding) return;
      if (update.presentation !== undefined) presentation = update.presentation;
      if (update.connection !== undefined) {
        connection = update.connection;
        if (connection === "connecting" || connection === "connected") error = false;
      }
      if (update.error !== undefined) error = Boolean(update.error);
      if (update.playbackStream !== undefined) {
        if (playback?.stream !== update.playbackStream) {
          playbackLevel = 0;
          lastAudible = -Infinity;
        }
        playback = replaceMeter(playback, update.playbackStream);
      }
      if (update.microphoneStream !== undefined) {
        if (microphone?.stream !== update.microphoneStream) microphoneLevel = 0;
        microphone = replaceMeter(microphone, update.microphoneStream);
      }
      notify();
    },
    async resumeAudio() {
      if (disposed || active !== binding) return;
      const audio = ensureContext();
      if (audio?.state === "suspended") {
        try { await audio.resume(); } catch { /* The next user gesture can retry. */ }
      }
    },
    read() {
      if (disposed) return IDLE;
      const time = now();
      const delta = lastRead === null ? 1 / 60 : Math.max(0, Math.min(0.25, (time - lastRead) / 1000));
      lastRead = time;
      const playbackRms = playback?.sample() ?? 0;
      const microphoneRms = microphone?.sample() ?? 0;
      playbackLevel = smoothLevel(playbackLevel, playbackRms, 5.5, delta);
      microphoneLevel = smoothLevel(microphoneLevel, microphoneRms, 3.5, delta);
      if (playbackRms > 0.006) lastAudible = time;
      const speaking = context?.state === "running" && playback?.live() && time - lastAudible < 180;
      if (error || connection === "error") visual.state = "error";
      else if (connection === "connecting" || presentation.orbState === "connecting") visual.state = "connecting";
      else if (connection === "disconnected") visual.state = "idle";
      else if (speaking) visual.state = "speaking";
      else if (presentation.processing || THINKING.has(presentation.orbState ?? "")) visual.state = "thinking";
      else if (presentation.orbState === "listening" || microphone?.live()) visual.state = "listening";
      else visual.state = "idle";
      visual.level = visual.state === "speaking" ? playbackLevel : visual.state === "listening" ? microphoneLevel : 0;
      return visual;
    },
    clear() {
      if (disposed) return;
      disposed = true;
      playback?.dispose();
      microphone?.dispose();
      playback = microphone = null;
      if (context && context.state !== "closed") void context.close().catch(() => {});
      context = null;
      if (active === binding) { active = null; notify(); }
    },
  };
  active = binding;
  notify();
  return binding;
}

/** Allocation-free frame read. The returned object is reused; do not mutate it. */
export function getWorldVoiceVisual(): WorldVoiceVisual {
  return active?.read() ?? IDLE;
}
