// The preloaded world hands out one freshly drawn frame on request. The onboarding handoff uses it
// as the incoming scene of the engine's own transition, so the blend costs the gallery's frame time
// instead of the world's.
type Provider = () => HTMLCanvasElement | null;
let provider: Provider | null = null;

export function setWarmFrameProvider(next: Provider | null) { provider = next; }

/** Draws the hidden world once and copies it in the same task, before the browser clears its buffer. */
export function captureWarmFrame(): HTMLCanvasElement | null {
  const source = provider?.();
  if (!source || !source.width || !source.height) return null;
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  const context = copy.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0);
  return copy;
}
