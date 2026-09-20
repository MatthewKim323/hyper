import { REVISION, type WebGLRenderer } from "three";

type PatchedRenderer = WebGLRenderer & { transmissionResolutionLimit: number };

/**
 * Configure the Bun-patched r143 transmission pass. Only its private color
 * target is capped; canvas size, viewport, DPR, and drawing-buffer queries keep
 * their native meaning. The patch also accepts WebGL2's HDR color extension.
 */
export function configureAtriumTransmission(renderer: WebGLRenderer, limit: 512 | 1024 = 1024): () => void {
  if (REVISION !== "143" || !("transmissionResolutionLimit" in renderer) || typeof renderer.transmissionResolutionLimit !== "number") {
    throw new Error("The atrium requires the patched Three 0.143.0 renderer. Run bun install to apply patches/three@0.143.0.patch.");
  }
  const patched = renderer as PatchedRenderer;
  const previous = patched.transmissionResolutionLimit;
  patched.transmissionResolutionLimit = limit;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (patched.transmissionResolutionLimit === limit) patched.transmissionResolutionLimit = previous;
  };
}
