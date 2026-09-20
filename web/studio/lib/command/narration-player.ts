/** One sentence, one output interval. This player owns only its own sources. */
export const NARRATION_SAMPLE_RATE = 24000;
export const MAX_NARRATION_SAMPLES = NARRATION_SAMPLE_RATE * 15;

export class PcmStreamDecoder {
  private carry: number | null = null;
  samples = 0;
  push(bytes: Uint8Array): Float32Array<ArrayBuffer> {
    const total = bytes.length + (this.carry === null ? 0 : 1);
    const count = Math.floor(total / 2);
    if (this.samples + count > MAX_NARRATION_SAMPLES) throw new Error("CFO audio exceeded its duration limit.");
    const result = new Float32Array(count);
    let offset = 0, sample = 0;
    if (this.carry !== null && bytes.length) {
      const value = this.carry | bytes[0] << 8;
      result[sample++] = (value >= 32768 ? value - 65536 : value) / 32768;
      offset = 1; this.carry = null;
    }
    while (offset + 1 < bytes.length) {
      const value = bytes[offset] | bytes[offset + 1] << 8;
      result[sample++] = (value >= 32768 ? value - 65536 : value) / 32768;
      offset += 2;
    }
    if (offset < bytes.length) this.carry = bytes[offset];
    this.samples += count;
    return result;
  }
  finish() {
    if (this.carry !== null) throw new Error("CFO audio ended with an incomplete sample.");
    if (!this.samples) throw new Error("CFO audio was empty.");
  }
}

export function outputClock(context: AudioContext): number {
  try {
    const stamp = context.getOutputTimestamp?.();
    if (stamp && typeof stamp.contextTime === "number" && stamp.contextTime > 0) return stamp.contextTime;
  } catch { /* Browser does not expose an output timestamp. */ }
  return Math.max(0, context.currentTime - (context.outputLatency || context.baseLatency || 0));
}

const wait = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 20);
  signal.addEventListener("abort", abort, { once: true });
});

export type NarrationPlayback = {
  context: AudioContext;
  stream: ReadableStream<Uint8Array>;
  signal: AbortSignal;
  tap?: AudioNode | null;
  onSource: (source: AudioBufferSourceNode) => void;
  onSourceEnded: (source: AudioBufferSourceNode) => void;
  onStart: () => void;
  onProgress?: (playedSamples: number) => void;
  deadlineMs?: number;
};

export async function playNarrationPcm(options: NarrationPlayback): Promise<number> {
  const { context, stream, signal } = options;
  if (context.state !== "running") throw new Error("Enable CFO audio to hear updates. Captions remain available.");
  const reader = stream.getReader(), decoder = new PcmStreamDecoder();
  const sources = new Set<AudioBufferSourceNode>();
  const intervals: { start: number; end: number; samples: number }[] = [];
  let clock = context.currentTime + .15, began = false, finished = false;
  const audioDeadline = options.deadlineMs === undefined ? Infinity : context.currentTime + Math.max(0, options.deadlineMs - performance.now()) / 1000;
  const assertRunning = () => {
    signal.throwIfAborted();
    if (context.currentTime >= audioDeadline) throw new Error("CFO playback permission expired. The caption is retained.");
    if (context.state !== "running") throw new Error("CFO audio paused. This update is available in captions.");
  };
  const update = () => {
    const time = outputClock(context);
    if (!began && intervals.length && time >= intervals[0].start) { began = true; options.onStart(); }
    const played = intervals.reduce((sum, item) => sum + Math.min(item.samples, Math.max(0, Math.floor((time - item.start) * NARRATION_SAMPLE_RATE))), 0);
    options.onProgress?.(played);
  };
  const cleanup = () => {
    for (const source of sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect(); options.onSourceEnded(source);
    }
    sources.clear();
  };
  const abort = () => { update(); cleanup(); void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const ticker = setInterval(() => { if (!finished && !signal.aborted) update(); }, 20);
  try {
    while (true) {
      assertRunning();
      const packet = await reader.read();
      assertRunning();
      if (packet.done) break;
      const samples = decoder.push(packet.value);
      for (let offset = 0; offset < samples.length; offset += 4800) {
        while (clock - context.currentTime > 1.8) { assertRunning(); await wait(signal); }
        assertRunning();
        const slice = samples.subarray(offset, offset + 4800);
        const buffer = context.createBuffer(1, slice.length, NARRATION_SAMPLE_RATE);
        buffer.copyToChannel(slice, 0);
        const source = context.createBufferSource(); source.buffer = buffer;
        source.connect(context.destination);
        if (options.tap) source.connect(options.tap);
        const start = Math.max(context.currentTime + .01, clock);
        clock = start + buffer.duration;
        intervals.push({ start, end: clock, samples: slice.length });
        sources.add(source); options.onSource(source);
        source.onended = () => { sources.delete(source); source.disconnect(); options.onSourceEnded(source); };
        if (start >= audioDeadline) throw new Error("CFO playback permission expired. The caption is retained.");
        source.start(start);
        if (Number.isFinite(audioDeadline)) source.stop(audioDeadline);
      }
    }
    decoder.finish();
    while (outputClock(context) < clock || sources.size) { assertRunning(); update(); await wait(signal); }
    update();
    return decoder.samples;
  } finally {
    finished = true; clearInterval(ticker); signal.removeEventListener("abort", abort);
    cleanup(); await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
