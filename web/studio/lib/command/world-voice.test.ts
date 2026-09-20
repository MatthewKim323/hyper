import { strict as assert } from "node:assert";
import { test } from "node:test";
import { bindWorldVoice, getWorldVoiceVisual, subscribeWorldVoice } from "./world-voice";

class Track extends EventTarget {
  readyState = "live";
  enabled = true;
  muted = false;
  stopCalls = 0;
  stop() { this.stopCalls++; this.end(); }
  end() { this.readyState = "ended"; this.dispatchEvent(new Event("ended")); }
}
class Stream {
  track = new Track();
  signal = 0;
  active = true;
  getAudioTracks() { return [this.track]; }
  asMedia() { return this as unknown as MediaStream; }
}
class Analyser {
  fftSize = 0;
  smoothingTimeConstant = 1;
  stream: Stream | null = null;
  disconnected = 0;
  buffers = new Set<Float32Array>();
  getFloatTimeDomainData(buffer: Float32Array) { this.buffers.add(buffer); buffer.fill(this.stream?.signal ?? 0); }
  disconnect() { this.disconnected++; }
}
class Source {
  disconnected = 0;
  constructor(readonly stream: Stream) {}
  connect(node: Analyser) {
    assert.ok(node instanceof Analyser, "analysis must not route audio to speakers");
    node.stream = this.stream;
  }
  disconnect() { this.disconnected++; }
}
class Context {
  state: AudioContextState = "running";
  analysers: Analyser[] = [];
  sources: Source[] = [];
  resumes = 0;
  closes = 0;
  createAnalyser() { const node = new Analyser(); this.analysers.push(node); return node; }
  createMediaStreamSource(stream: Stream) { const node = new Source(stream); this.sources.push(node); return node; }
  async resume() { this.resumes++; this.state = "running"; }
  async close() { this.closes++; this.state = "closed"; }
}
function setup() {
  const context = new Context();
  let time = 0;
  let creations = 0;
  const binding = bindWorldVoice({ now: () => time, createAudioContext: () => { creations++; return context as unknown as AudioContext; } });
  return {
    binding, context,
    get creations() { return creations; },
    read(ms = 16) { time += ms; return { ...getWorldVoiceVisual() }; },
  };
}

test("presentation maps real agent states without inventing audible speech or creating audio on mount", () => {
  const h = setup();
  assert.deepEqual(h.read(), { state: "idle", level: 0 });
  h.binding.publish({ connection: "connecting", presentation: { orbState: "connecting", processing: true } });
  assert.equal(h.read().state, "connecting");
  h.binding.publish({ connection: "connected", presentation: { orbState: "solving", processing: true } });
  assert.equal(h.read().state, "thinking");
  h.binding.publish({ presentation: { orbState: "weaving", processing: false } });
  assert.deepEqual(h.read(), { state: "idle", level: 0 });
  h.binding.publish({ presentation: { orbState: "listening" } });
  assert.equal(h.read().state, "listening");
  h.binding.publish({ error: "The session failed" });
  assert.equal(h.read().state, "error");
  h.binding.publish({ connection: "connecting" });
  assert.equal(h.read().state, "connecting");
  h.binding.publish({ connection: "disconnected", presentation: { orbState: "composing" } });
  assert.deepEqual(h.read(), { state: "idle", level: 0 });
  assert.equal(h.creations, 0);
  h.binding.clear();
});

test("speaking requires measured playback and follows its smooth RMS instead of the microphone", () => {
  const h = setup();
  const playback = new Stream();
  const microphone = new Stream();
  microphone.signal = 0.9;
  h.binding.publish({ connection: "connected", presentation: { orbState: "weaving" }, playbackStream: playback.asMedia(), microphoneStream: microphone.asMedia() });
  assert.equal(h.read().state, "listening");
  playback.signal = 0.1;
  const onset = h.read();
  assert.equal(onset.state, "speaking");
  assert.ok(onset.level > 0 && onset.level < 0.3);
  const peak = h.read(100);
  assert.ok(peak.level > onset.level && peak.level < 0.53);
  playback.signal = 0;
  const tail = h.read(70);
  assert.equal(tail.state, "speaking");
  assert.ok(tail.level > 0 && tail.level < peak.level);
  assert.equal(h.read(120).state, "listening");
  assert.equal(h.creations, 1);
  assert.equal(h.context.analysers.length, 2);
  assert.ok(h.context.analysers.every(node => node.buffers.size === 1));
  h.binding.clear();
});

test("stream null clears playback immediately and replacement detaches old audio without stopping tracks", () => {
  const h = setup();
  const first = new Stream();
  first.signal = 0.3;
  h.binding.publish({ playbackStream: first.asMedia() });
  assert.equal(h.read().state, "speaking");
  h.binding.publish({ playbackStream: first.asMedia() });
  assert.equal(h.context.sources.length, 1);
  h.binding.publish({ playbackStream: null });
  assert.deepEqual(h.read(), { state: "idle", level: 0 });
  assert.equal(h.context.sources[0].disconnected, 1);
  assert.equal(h.context.analysers[0].disconnected, 1);
  const second = new Stream();
  second.signal = 0.2;
  h.binding.publish({ playbackStream: second.asMedia() });
  assert.equal(h.read().state, "speaking");
  h.binding.clear();
  h.binding.clear();
  assert.equal(h.context.sources[0].disconnected, 1);
  assert.equal(h.context.sources[1].disconnected, 1);
  assert.equal(h.context.closes, 1);
  assert.equal(first.track.stopCalls + second.track.stopCalls, 0);
});

test("suspended audio does not simulate speaking and a direct user gesture resumes its meter", async () => {
  const h = setup();
  h.context.state = "suspended";
  await h.binding.resumeAudio();
  assert.equal(h.context.resumes, 1);
  const playback = new Stream();
  playback.signal = 0.2;
  h.binding.publish({ playbackStream: playback.asMedia() });
  assert.equal(h.read().state, "speaking");
  h.context.state = "suspended";
  assert.deepEqual(h.read(), { state: "idle", level: 0 });
  await h.binding.resumeAudio();
  assert.equal(h.context.resumes, 2);
  assert.equal(h.read().state, "speaking");
  h.binding.clear();
});

test("ended or muted tracks cannot produce speech, and noisy samples stay finite and bounded", () => {
  const h = setup();
  const playback = new Stream();
  playback.signal = NaN;
  h.binding.publish({ playbackStream: playback.asMedia() });
  assert.deepEqual(h.read(), { state: "idle", level: 0 });
  playback.signal = 50;
  const loud = h.read(60000);
  assert.equal(loud.state, "speaking");
  assert.ok(Number.isFinite(loud.level) && loud.level <= 1);
  playback.track.muted = true;
  assert.equal(h.read().state, "idle");
  playback.track.muted = false;
  playback.track.end();
  assert.equal(h.context.sources[0].disconnected, 1);
  assert.equal(h.read().state, "idle");
  h.binding.clear();
  assert.equal(h.context.sources[0].disconnected, 1);
});

test("a newer session owns the bridge and stale callbacks or cleanup cannot change it", () => {
  const first = setup();
  const stream = new Stream();
  stream.signal = 0.3;
  first.binding.publish({ playbackStream: stream.asMedia() });
  assert.equal(first.read().state, "speaking");
  const second = setup();
  assert.equal(first.context.closes, 1);
  second.binding.publish({ presentation: { orbState: "solving" } });
  first.binding.publish({ connection: "error", playbackStream: stream.asMedia() });
  first.binding.clear();
  assert.deepEqual(second.read(), { state: "thinking", level: 0 });
  second.binding.clear();
  assert.deepEqual(getWorldVoiceVisual(), { state: "idle", level: 0 });
});

test("unavailable audio stays harmless and the reused frame object needs no React subscription", async () => {
  const binding = bindWorldVoice({ createAudioContext: () => { throw new Error("Audio unavailable"); } });
  await binding.resumeAudio();
  binding.publish({ playbackStream: new Stream().asMedia(), presentation: { orbState: "weaving" } });
  const frame = getWorldVoiceVisual();
  assert.equal(frame.state, "idle");
  assert.equal(getWorldVoiceVisual(), frame);
  binding.clear();
});

test("semantic notifications batch publish and rebind, stop after unsubscribe, and never follow frame reads", async () => {
  const changes: string[] = [];
  const unsubscribe = subscribeWorldVoice(() => { changes.push(getWorldVoiceVisual().state); });
  const first = setup();
  first.binding.publish({ connection: "connected" });
  first.binding.publish({ presentation: { orbState: "solving" } });
  assert.equal(changes.length, 0);
  await Promise.resolve();
  assert.deepEqual(changes, ["thinking"]);
  for (let frame = 0; frame < 60; frame++) first.read();
  await Promise.resolve();
  assert.equal(changes.length, 1);

  const second = setup();
  second.binding.publish({ presentation: { orbState: "listening" } });
  first.binding.clear();
  await Promise.resolve();
  assert.deepEqual(changes, ["thinking", "listening"]);
  second.binding.clear();
  await Promise.resolve();
  assert.deepEqual(changes, ["thinking", "listening", "idle"]);
  second.binding.clear();
  await Promise.resolve();
  assert.equal(changes.length, 3);

  const third = setup();
  third.binding.publish({ connection: "error" });
  unsubscribe();
  unsubscribe();
  await Promise.resolve();
  assert.equal(changes.length, 3);
  third.binding.clear();
});
