import type { WebGLRenderer } from "three";

export type AtriumGpuPhase = "capture" | "beauty" | "bloom" | "tone" | "display" | "calibration";
const PHASES: AtriumGpuPhase[] = ["capture", "beauty", "bloom", "tone", "display", "calibration"];
type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
type PendingQuery = { query: WebGLQuery; phase: AtriumGpuPhase };
export type AtriumGpuTiming = Readonly<{
  captureMs: number | null;
  beautyMs: number | null;
  bloomMs: number | null;
  toneMs: number | null;
  displayMs: number | null;
  calibrationMs: number | null;
  captureSamples: number;
  beautySamples: number;
  bloomSamples: number;
  toneSamples: number;
  displaySamples: number;
  calibrationSamples: number;
  pending: number;
  skipped: number;
}>;
export type AtriumGpuProfile = {
  readonly supported: boolean;
  /** Opt into one complete measurement frame per 750ms, after prior results drain. */
  beginFrame(timestamp?: number): void;
  measure<T>(phase: AtriumGpuPhase, work: () => T): T;
  /** Poll once per frame. Results are read only after QUERY_RESULT_AVAILABLE. */
  poll(): AtriumGpuTiming;
  dispose(): void;
};

/** Development-only, non-blocking WebGL2 GPU timing. Never changes render state. */
export function createAtriumGpuProfile(renderer: WebGLRenderer, enabled = process.env.NODE_ENV === "development"): AtriumGpuProfile {
  const timing = {
    captureMs: null as number | null, beautyMs: null as number | null,
    bloomMs: null as number | null, toneMs: null as number | null, displayMs: null as number | null, calibrationMs: null as number | null,
    captureSamples: 0, beautySamples: 0, bloomSamples: 0, toneSamples: 0, displaySamples: 0, calibrationSamples: 0,
    pending: 0, skipped: 0,
  };
  const gl = enabled && renderer.capabilities.isWebGL2 ? renderer.getContext() as WebGL2RenderingContext : null;
  let extension: TimerExtension | null = null;
  try { extension = gl?.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null; }
  catch { /* GPU timing can be unavailable even when scene rendering works. */ }
  const pending: PendingQuery[] = [];
  let active: WebGLQuery | null = null;
  let disposed = false;
  let failed = false;
  let batched = false;
  let measureFrame = false;
  let lastBatch = -Infinity;
  const measuredPhases = new Set<AtriumGpuPhase>();

  function deleteQuery(query: WebGLQuery) {
    try { gl?.deleteQuery(query); } catch { /* A lost context already released it. */ }
  }

  function discard() {
    for (const item of pending) deleteQuery(item.query);
    pending.length = 0;
    timing.pending = 0;
    for (const phase of PHASES) {
      timing[`${phase}Ms`] = null;
      timing[`${phase}Samples`] = 0;
    }
  }

  return {
    get supported() { return Boolean(gl && extension && !failed && !disposed); },
    beginFrame(timestamp = performance.now()) {
      batched = true;
      measureFrame = false;
      measuredPhases.clear();
      if (!disposed && !failed && gl && extension && !active && pending.length === 0 && Number.isFinite(timestamp) && timestamp - lastBatch >= 750) {
        measureFrame = true;
        lastBatch = timestamp;
      }
    },
    measure(phase, work) {
      let query: WebGLQuery | null = null;
      const allowed = !batched || measureFrame && !measuredPhases.has(phase);
      if (allowed && !disposed && !failed && gl && extension) {
        if (active) timing.skipped++;
        else try {
          if (gl.isContextLost()) discard();
          else if (gl.getParameter(extension.GPU_DISJOINT_EXT)) discard();
          else if (pending.length >= 8 || gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) timing.skipped++;
          else {
            query = gl.createQuery();
            if (query) {
              gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
              active = query;
              if (batched) measuredPhases.add(phase);
            } else timing.skipped++;
          }
        } catch {
          if (query) deleteQuery(query);
          query = null;
          active = null;
          failed = true;
          discard();
        }
      }
      try { return work(); }
      finally {
        if (query && active === query && gl && extension) {
          active = null;
          try {
            gl.endQuery(extension.TIME_ELAPSED_EXT);
            if (disposed) deleteQuery(query);
            else {
              pending.push({ query, phase });
              timing.pending = pending.length;
            }
          } catch {
            deleteQuery(query);
            failed = true;
            discard();
          }
        }
      }
    },
    poll() {
      if (disposed || failed || active || !gl || !extension) return timing;
      try {
        if (gl.isContextLost() || gl.getParameter(extension.GPU_DISJOINT_EXT)) {
          discard();
          return timing;
        }
        // Publish a gated batch together so the HUD never sums a new scene
        // sample with an older bloom or display sample from another frame.
        if (batched) for (const item of pending) {
          if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) return timing;
        }
        while (pending.length) {
          const item = pending[0];
          if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) break;
          const nanoseconds = gl.getQueryParameter(item.query, gl.QUERY_RESULT);
          pending.shift();
          deleteQuery(item.query);
          if (typeof nanoseconds === "number" && Number.isFinite(nanoseconds) && nanoseconds >= 0) {
            timing[`${item.phase}Ms`] = nanoseconds / 1e6;
            timing[`${item.phase}Samples`]++;
          }
        }
        timing.pending = pending.length;
      } catch { failed = true; discard(); }
      return timing;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (active && gl && extension) {
        const query = active;
        active = null;
        try { gl.endQuery(extension.TIME_ELAPSED_EXT); } catch { /* Lost context. */ }
        deleteQuery(query);
      }
      discard();
    },
  };
}
