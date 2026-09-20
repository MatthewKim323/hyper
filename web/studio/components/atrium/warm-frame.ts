// The preloaded world hands out one freshly drawn frame on request. The onboarding handoff and the
// route transitions use it as the world's side of the engine's own blend, so the blend costs the
// engine's frame time instead of the world's.
type Provider = () => HTMLCanvasElement | null;
let provider: Provider | null = null;

export function setWarmFrameProvider(next: Provider | null) { provider = next; }

/**
 * Draws the world once and copies it in the same task, before the browser clears its buffer.
 * The copy is what the viewport shows: the plane is cover-fitted and scrolls, so the raw canvas
 * is wider or taller than the screen at anything but its own aspect.
 */
export function captureWarmFrame(): HTMLCanvasElement | null {
  const source = provider?.();
  if (!source || !source.width || !source.height) return null;
  const rect = source.getBoundingClientRect();
  const width = window.innerWidth, height = window.innerHeight;
  const laidOut = rect.width >= width - 1 && rect.height >= height - 1;
  const sx = laidOut ? Math.max(0, -rect.left) / rect.width * source.width : 0;
  const sy = laidOut ? Math.max(0, -rect.top) / rect.height * source.height : 0;
  const sw = laidOut ? width / rect.width * source.width : source.width;
  const sh = laidOut ? height / rect.height * source.height : source.height;
  const copy = document.createElement("canvas");
  copy.width = Math.max(1, Math.round(sw));
  copy.height = Math.max(1, Math.round(sh));
  const context = copy.getContext("2d");
  if (!context) return null;
  context.drawImage(source, sx, sy, sw, sh, 0, 0, copy.width, copy.height);
  return copy;
}
