import { test } from "node:test";
import { strict as assert } from "node:assert";
import { MAX_NARRATION_SAMPLES, PcmStreamDecoder, playNarrationPcm } from "./narration-player";

test("PCM chunk carry preserves every signed sample across every byte split", () => {
  const bytes = new Uint8Array([0, 128, 255, 127, 0, 0, 1, 0]);
  for (let split = 0; split <= bytes.length; split++) {
    const decoder = new PcmStreamDecoder();
    const values = [...decoder.push(bytes.slice(0, split)), ...decoder.push(bytes.slice(split))]; decoder.finish();
    assert.deepEqual(values, [-1, 32767 / 32768, 0, 1 / 32768]);
  }
});
test("truncated, empty and overlong PCM fails without unbounded decoded audio", () => {
  const decoder = new PcmStreamDecoder(); decoder.push(new Uint8Array([1])); assert.throws(() => decoder.finish());
  assert.throws(() => new PcmStreamDecoder().finish());
  assert.throws(() => new PcmStreamDecoder().push(new Uint8Array((MAX_NARRATION_SAMPLES + 1) * 2)));
});
function fixture() {
  const began = performance.now(), starts: number[] = [], sources = new Set<unknown>();
  const context = { state: "running", baseLatency: 0, destination: {}, get currentTime() { return (performance.now() - began) / 1000; },
    createBuffer(_channels: number, samples: number, rate: number) { return { duration: samples / rate, copyToChannel() {} }; },
    createBufferSource() {
      let timer: ReturnType<typeof setTimeout>;
      const source = { buffer: { duration: 0 }, onended: null as null | (() => void), connect() {}, disconnect() {},
        start(at: number) { starts.push(at); timer = setTimeout(() => source.onended?.(), Math.max(0, (at - context.currentTime + source.buffer.duration) * 1000)); },
        stop() { clearTimeout(timer); } };
      return source;
    } };
  const opts = { context: context as unknown as AudioContext, onSource: (source: AudioBufferSourceNode) => { sources.add(source); }, onSourceEnded: (source: AudioBufferSourceNode) => { sources.delete(source); } };
  return { context, starts, sources, opts };
}
test("caption starts on the scheduled output interval, and completion waits for actual local drain", async () => {
  const f = fixture(); let captionAt = -1, progress = 0;
  const samples = await playNarrationPcm({ ...f.opts, stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4800)); controller.close(); } }), signal: new AbortController().signal,
    onStart: () => { captionAt = f.context.currentTime; }, onProgress: value => { progress = value; } });
  assert.equal(samples, 2400); assert.equal(progress, 2400);
  assert.ok(captionAt >= f.starts[0]); assert.ok(f.context.currentTime >= f.starts[0] + .1);
  assert.equal(f.sources.size, 0);
});
test("interruption during streaming stops owned sources and no future cue can appear", async () => {
  const f = fixture(), abort = new AbortController(); let captions = 0;
  const task = playNarrationPcm({ ...f.opts, stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(48000)); } }), signal: abort.signal, onStart: () => { captions++; } });
  setTimeout(() => abort.abort(new DOMException("Interrupted", "AbortError")), 40);
  await assert.rejects(task); assert.equal(f.sources.size, 0); assert.equal(captions, 0);
});
test("audio lock keeps the text fallback available instead of pretending to speak", async () => {
  const f = fixture(); f.context.state = "suspended";
  await assert.rejects(playNarrationPcm({ ...f.opts, stream: new ReadableStream(), signal: new AbortController().signal, onStart: () => assert.fail("Caption cannot mark speech") }), /Enable CFO audio/);
});
test("lease expiry rejects scheduling even when transport remains open", async () => {
  const f = fixture();
  await assert.rejects(playNarrationPcm({ ...f.opts, deadlineMs: performance.now() - 1, stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(480)); controller.close(); } }), signal: new AbortController().signal, onStart: () => assert.fail("Expired lease cannot speak") }), /permission expired/);
  assert.equal(f.sources.size, 0);
});
