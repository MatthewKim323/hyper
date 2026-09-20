// Snap targeting for the hand cursor. Aiming a fingertip at a 36 px button through a webcam is hard, so the
// cursor quietly commits to the most likely target and stays on it. The hand keeps moving freely
// underneath: leaving a target takes a deliberate move, not a tremor. All of this is invisible; the
// user just finds that the cursor lands where they meant.
export type SnapRect = { id: number; left: number; top: number; width: number; height: number };
export type SnapState = { id: number | null };

// A target starts pulling from this far outside its edge, and keeps its hold until the hand is this far out.
export const CAPTURE_PX = 90;
export const RELEASE_PX = 140;
// A rival has to be this much closer to steal the cursor from the current target.
const STEAL_RATIO = 0.6;
// Above this hand speed (screen widths per second) nothing captures: you are travelling, not aiming.
export const TRAVEL_SPEED = 1.15;
// Targets bigger than this are easy to hit; the cursor is kept inside them but not dragged to the middle.
const LARGE_PX = 300;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Distance from a point to the nearest edge of a rect, 0 inside it. */
export function edgeDistance(x: number, y: number, r: SnapRect) {
  const dx = Math.max(r.left - x, 0, x - (r.left + r.width));
  const dy = Math.max(r.top - y, 0, y - (r.top + r.height));
  return Math.hypot(dx, dy);
}

/**
 * Picks the target for a raw cursor position. Mutates `state` so the choice sticks between frames.
 * `heading` is the hand's direction of travel (any length); targets ahead of it win ties.
 */
export function chooseTarget(x: number, y: number, rects: readonly SnapRect[], state: SnapState, speed: number, heading = { x: 0, y: 0 }): SnapRect | null {
  const current = state.id === null ? null : rects.find(r => r.id === state.id) ?? null;
  const held = current && edgeDistance(x, y, current) <= RELEASE_PX ? current : null;
  if (!held) state.id = null;
  if (speed > TRAVEL_SPEED) return held;

  const length = Math.hypot(heading.x, heading.y);
  let best: SnapRect | null = null;
  let bestScore = Infinity;
  for (const r of rects) {
    const d = edgeDistance(x, y, r);
    if (d > CAPTURE_PX) continue;
    // Small targets are the hard ones, so they get a little priority over the big area behind them.
    let score = d + Math.min(r.width, r.height) * 0.04;
    if (length > 1e-3 && d > 0) {
      const cx = r.left + r.width / 2 - x;
      const cy = r.top + r.height / 2 - y;
      const ahead = (cx * heading.x + cy * heading.y) / (Math.hypot(cx, cy) * length || 1);
      score *= 1 - 0.3 * ahead;
    }
    if (score < bestScore) { bestScore = score; best = r; }
  }
  if (held) {
    const heldScore = edgeDistance(x, y, held);
    if (!best || best.id === held.id || bestScore > heldScore * STEAL_RATIO) return held;
  }
  state.id = best ? best.id : null;
  return best;
}

/** Where the cursor should sit for a chosen target: the center of small ones, the nearest inside point of large ones. */
export function snapPoint(x: number, y: number, r: SnapRect) {
  if (r.height > LARGE_PX || (r.width > LARGE_PX && r.height > 120)) {
    const inset = 10;
    return { x: clamp(x, r.left + inset, r.left + r.width - inset), y: clamp(y, r.top + inset, r.top + r.height - inset) };
  }
  // Wide, short targets (a text field, a long button) keep the hand's x so typing position feels natural.
  if (r.width > r.height * 3.2) return { x: clamp(x, r.left + r.height / 2, r.left + r.width - r.height / 2), y: r.top + r.height / 2 };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
