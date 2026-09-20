// FingerController: hand landmarks in, a precise cursor out.
// Camera-rate work (filtering, gestures) happens in onFrame; display-rate work (prediction,
// pointer events, drawing) happens in render, so a 30 fps camera still gives a smooth cursor.
import { OneEuro2D } from "./one-euro";
import { VirtualPointer } from "./pointer";
import { chooseTarget, snapPoint, type SnapRect, type SnapState } from "./snap";
import type { HandFrame } from "./tracker";
import { ZoomGesture, type ZoomDirection } from "./zoom";

const SNAPPABLE = "a[href], button:not(:disabled), [role='button'], input:not([type='hidden']):not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [data-magnetic]";

/** Everything clickable that is really on screen and really on top, as plain rects. */
// Stable ids, so a target keeps its hold on the cursor when the page around it re-renders.
const targetIds = new WeakMap<Element, number>();
let nextTargetId = 1;

function collectTargets(): SnapRect[] {
  const out: SnapRect[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(SNAPPABLE)) {
    let id = targetIds.get(el);
    if (!id) { id = nextTargetId++; targetIds.set(el, id); }
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) continue;
    // Whole-screen catchers and page-sized areas need no help to hit.
    if (r.width > 600 && r.height > 300) continue;
    if (el.closest("[inert], [aria-hidden='true']")) continue;
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    if (!top || !(el === top || el.contains(top) || top.contains(el))) continue;
    out.push({ id, left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return out;
}

type P2 = { x: number; y: number };
type P3 = { x: number; y: number; z: number };

export type FingerState = "lost" | "point" | "pinch" | "drag" | "scroll" | "hold";

// Share of the camera frame that maps to the whole screen, so the arm never has to reach the edges.
const BOX_WIDTH = 0.5;
const BOX_CENTER = { x: 0.5, y: 0.56 };
// Pointing anchor: mostly the index knuckle, which barely moves during a pinch, plus some fingertip.
const TIP_WEIGHT = 0.3;
// Filter tuned for coordinates where 1 is a full screen width.
const MIN_CUTOFF = 0.55;
const BETA = 0.07;
// Display-rate glide: the drawn cursor eases toward the target, heavily when slow and barely when fast.
const GLIDE_SLOW_S = 0.14;
const GLIDE_FAST_S = 0.022;
const REST_PX = 2.2;
// Pointer events go out on their own fast clock (browser timers floor at 4 ms, so about 250 Hz),
// independent of both the camera and the display.
const POLL_MS = 4;
// Pinch ratio (thumb tip to index tip over palm length) with hysteresis.
const PINCH_ON = 0.38;
const PINCH_OFF = 0.58;
const PINCH_FRAMES = 2;
// The cursor slows to a stop as a pinch closes, so the click lands where the user was aiming.
const FREEZE_FROM = 0.7;
const FREEZE_FULL = 0.44;
const DRAG_THRESHOLD = 0.028;
const FIST_MS = 150;
const LOST_HOLD_MS = 220;
const PREDICT_S = 0.036;
const SCROLL_GAIN = 2.4;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const dist3 = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export class FingerController {
  state: FingerState = "lost";
  /** 0 open, 1 fully pinched. Drives the ring. */
  pinchStrength = 0;
  /** Last thumb to index distance over palm length, for tuning. */
  pinchRatio = 1;
  onState?: (state: FingerState) => void;
  /** Closing an open hand ("in") or opening a closed one ("out"), at the cursor's position. */
  onZoom?: (direction: ZoomDirection, x: number, y: number) => void;
  /** Every camera frame, for the preview's skeleton. Null when the hand is gone. */
  onLandmarks?: (frame: HandFrame | null) => void;

  private pointer = new VirtualPointer();
  private filter = new OneEuro2D(MIN_CUTOFF, BETA, 1);
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private poll = 0;

  private lastT = 0;
  private lastSeen = 0;
  private prev: P2 | null = null;
  private offset: P2 = { x: 0, y: 0 };
  private sample = { pos: { x: 0.5, y: 0.5 }, vel: { x: 0, y: 0 }, t: 0 };
  private pinchCount = 0;
  private pinched = false;
  private dragging = false;
  private pinchTravel = 0;
  private fistSince = 0;
  private scrollVel = 0;
  private px: P2 = { x: -100, y: -100 };
  private lastRender = 0;
  private trail: P2[] = [];
  private pops: { x: number; y: number; t: number }[] = [];
  private alpha = 0;
  private targets: SnapRect[] = [];
  private targetsAt = 0;
  private snap: SnapState = { id: null };
  private zoom = new ZoomGesture();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("mousemove", this.onRealMouse, { passive: true, capture: true });
    this.raf = requestAnimationFrame(this.render);
    this.poll = window.setInterval(this.tick, POLL_MS);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.poll);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("mousemove", this.onRealMouse, { capture: true });
    this.giveBack();
  }

  // Only hardware moves are trusted; the finger's own events are synthetic.
  private realMouse: P2 | null = null;
  private onRealMouse = (event: MouseEvent) => { if (event.isTrusted) this.realMouse = { x: event.clientX, y: event.clientY }; };

  /** Return control to the hardware mouse: clear every hover the finger caused and put the pointer back where the mouse is. */
  private giveBack() {
    this.snap.id = null;
    const at = this.realMouse ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.pointer.handBack(at.x, at.y);
  }

  private resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  private setState(next: FingerState) {
    if (next === this.state) return;
    this.state = next;
    this.onState?.(next);
  }

  onLost = () => {
    // One dropped frame keeps the last pose, in the cursor and in the preview's skeleton alike.
    if (performance.now() - this.lastSeen < LOST_HOLD_MS) return;
    this.onLandmarks?.(null);
    if (this.state === "lost") return;
    // Never leave a button held when the hand leaves the frame.
    this.giveBack();
    this.pinched = this.dragging = false;
    this.pinchCount = 0;
    this.prev = null;
    this.scrollVel = 0;
    this.filter.reset();
    this.zoom.reset();
    this.sample.vel = { x: 0, y: 0 };
    this.setState("lost");
  };

  onFrame = (f: HandFrame) => {
    const now = performance.now();
    this.onLandmarks?.(f);
    const dt = this.lastT ? clamp((f.t - this.lastT) / 1000, 1 / 240, 0.2) : 1 / 30;
    this.lastT = f.t;
    this.lastSeen = now;

    // Mirror, then map the active box to the screen. Box height follows the screen aspect so motion is isotropic.
    const lm = f.landmarks.map((p) => ({ x: 1 - p.x, y: p.y }));
    const boxH = clamp((BOX_WIDTH * f.aspect) / (window.innerWidth / window.innerHeight), 0.2, 0.85);
    const ax = lm[5].x * (1 - TIP_WEIGHT) + lm[8].x * TIP_WEIGHT;
    const ay = lm[5].y * (1 - TIP_WEIGHT) + lm[8].y * TIP_WEIGHT;
    const raw = { x: (ax - (BOX_CENTER.x - BOX_WIDTH / 2)) / BOX_WIDTH, y: (ay - (BOX_CENTER.y - boxH / 2)) / boxH };
    const filt = this.filter.filter(raw.x, raw.y, dt);

    // Gestures use world landmarks (meters), so they hold up when the hand tilts or moves in depth.
    const w = f.world;
    const palm = Math.max(dist3(w[0], w[9]), 1e-4);
    const ratio = dist3(w[4], w[8]) / palm;
    this.pinchRatio = ratio;
    const extended = (tip: number, pip: number) => dist3(w[tip], w[0]) > dist3(w[pip], w[0]) * 1.12;
    const index = extended(8, 6);
    const middle = extended(12, 10);
    const ring = extended(16, 14);
    const pinky = extended(20, 18);
    const fist = !index && !middle && !ring && !pinky && ratio > PINCH_OFF * 0.6;
    // A flat hand: every finger out and the thumb clear of the index, so a pinch never reads as open.
    const openHand = index && middle && ring && pinky && ratio > PINCH_OFF * 1.4;
    const zoomed = this.pinched ? null : this.zoom.update(openHand, fist, now);
    if (zoomed) {
      this.pops.push({ x: this.px.x, y: this.px.y, t: now });
      this.onZoom?.(zoomed, this.px.x, this.px.y);
    }
    const scrollPose = index && middle && !ring && !pinky && ratio > PINCH_OFF && dist3(w[8], w[12]) / palm < 0.42;

    // Pinch with hysteresis; entering needs consecutive frames, leaving is immediate.
    if (!this.pinched) {
      this.pinchCount = ratio < PINCH_ON ? this.pinchCount + 1 : 0;
      if (this.pinchCount >= PINCH_FRAMES) {
        this.pinched = true;
        this.dragging = false;
        this.pinchTravel = 0;
        this.commit(now);
        this.pointer.down();
        this.pops.push({ x: this.px.x, y: this.px.y, t: now });
      }
    } else if (ratio > PINCH_OFF) {
      this.pinched = this.dragging = false;
      this.pinchCount = 0;
      this.pointer.up();
    }
    this.pinchStrength = 1 - smoothstep(PINCH_ON, 0.95, ratio);

    if (fist) this.fistSince ||= now;
    else this.fistSince = 0;
    const holding = !this.pinched && this.fistSince > 0 && now - this.fistSince > FIST_MS;
    const scrolling = !this.pinched && !holding && scrollPose;

    // Gain: how much of the hand's motion reaches the cursor. Whatever is withheld goes into
    // an offset, so re-engaging never makes the cursor jump.
    let gain = smoothstep(FREEZE_FULL, FREEZE_FROM, ratio);
    if (holding || scrolling) gain = 0;
    if (this.pinched) gain = this.dragging ? 1 : 0;
    const delta = this.prev ? { x: filt.x - this.prev.x, y: filt.y - this.prev.y } : { x: 0, y: 0 };
    this.prev = filt;
    if (this.pinched && !this.dragging) {
      this.pinchTravel += Math.hypot(delta.x, delta.y);
      if (this.pinchTravel > DRAG_THRESHOLD) this.dragging = true;
    }
    this.offset.x -= delta.x * (1 - gain);
    this.offset.y -= delta.y * (1 - gain);
    const vel = this.filter.velocity;
    const speed = Math.hypot(vel.x, vel.y);
    if (gain === 1 && !this.pinched) {
      // Bleed the offset away while the hand is moving fast, where the correction is invisible.
      const k = clamp(speed * 1.6 * dt);
      this.offset.x *= 1 - k;
      this.offset.y *= 1 - k;
    }
    const pos = { x: clamp(filt.x + this.offset.x), y: clamp(filt.y + this.offset.y) };
    // Hitting a screen edge re-anchors too, so there is no dead travel coming back.
    this.offset = { x: pos.x - filt.x, y: pos.y - filt.y };
    this.sample = { pos, vel: { x: vel.x * gain, y: vel.y * gain }, t: now };

    if (scrolling) this.scrollVel = -delta.y * window.innerHeight * SCROLL_GAIN * (1 / dt / 60);

    this.setState(this.pinched ? (this.dragging ? "drag" : "pinch") : holding ? "hold" : scrolling ? "scroll" : "point");
  };

  /** Predicted cursor position in pixels for a given display time. */
  private predict(now: number): P2 {
    const { pos, vel, t } = this.sample;
    const speed = Math.hypot(vel.x, vel.y);
    // Prediction scales with speed: none at rest (it would amplify jitter), full when moving fast.
    const ahead = Math.min((now - t) / 1000, 0.05) + PREDICT_S * smoothstep(0.12, 0.9, speed);
    let x = clamp(pos.x + vel.x * ahead) * window.innerWidth;
    let y = clamp(pos.y + vel.y * ahead) * window.innerHeight;
    if (this.state === "point" || this.state === "hold") {
      if (now - this.targetsAt > 300) { this.targetsAt = now; this.targets = collectTargets(); }
      const target = chooseTarget(x, y, this.targets, this.snap, speed, vel);
      if (target) ({ x, y } = snapPoint(x, y, target));
    } else if (this.state !== "pinch") this.snap.id = null;
    return { x, y };
  }

  /** Ease the drawn cursor toward its target. Smooths the camera-rate steps and any residual shake. */
  private glide(target: P2, now: number): P2 {
    const dt = clamp((now - this.lastRender) / 1000, 1 / 1000, 0.1);
    this.lastRender = now;
    if (this.px.x < 0) return target;
    const dx = target.x - this.px.x;
    const dy = target.y - this.px.y;
    const d = Math.hypot(dx, dy);
    const speed = Math.hypot(this.sample.vel.x, this.sample.vel.y);
    // At rest, ignore sub-pixel-scale wobble entirely.
    if (d < REST_PX && speed < 0.04) return this.px;
    const fast = Math.max(smoothstep(0.05, 0.7, speed), smoothstep(40, 260, d));
    const tau = GLIDE_SLOW_S + (GLIDE_FAST_S - GLIDE_SLOW_S) * fast;
    const k = 1 - Math.exp(-dt / tau);
    return { x: this.px.x + dx * k, y: this.px.y + dy * k };
  }

  /** Bring the virtual pointer to where the cursor is drawn right now. */
  private commit(now: number) {
    const p = this.px.x < 0 ? this.predict(now) : this.px;
    this.px = p;
    this.pointer.move(p.x, p.y);
  }

  /** Pointer clock: advance the cursor and emit mouse events. */
  private tick = () => {
    if (this.state === "lost") return;
    const now = performance.now();
    const p = this.state === "pinch" ? this.px : this.glide(this.predict(now), now);
    if (Math.hypot(p.x - this.pointer.x, p.y - this.pointer.y) > 0.1) this.pointer.move(p.x, p.y);
    this.px = p;
  };

  private render = (now: number) => {
    this.raf = requestAnimationFrame(this.render);
    const live = this.state !== "lost";
    this.alpha += ((live ? 1 : 0) - this.alpha) * 0.18;
    if (live) {
      // Timers are throttled in background tabs; the frame loop keeps the cursor honest either way.
      this.tick();
      if (Math.abs(this.scrollVel) > 0.4) {
        this.pointer.scroll(0, this.scrollVel);
        if (this.state !== "scroll") this.scrollVel *= 0.93;
      }
      this.trail.push({ x: this.px.x, y: this.px.y });
      if (this.trail.length > 16) this.trail.shift();
    } else if (this.trail.length) this.trail.shift();
    this.draw(now);
  };

  private draw(now: number) {
    const c = this.ctx;
    c.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (this.alpha < 0.01) return;
    const { x, y } = this.px;
    c.lineCap = c.lineJoin = "round";

    for (let i = 1; i < this.trail.length; i++) {
      const t = i / this.trail.length;
      c.strokeStyle = `rgba(255,255,255,${0.35 * t * t * this.alpha})`;
      c.lineWidth = 1 + 5 * t;
      c.beginPath();
      c.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
      c.lineTo(this.trail[i].x, this.trail[i].y);
      c.stroke();
    }

    // Ring closes as the pinch closes: feedforward for the click.
    const pressed = this.state === "pinch" || this.state === "drag";
    const radius = pressed ? 7 : 24 - 15 * this.pinchStrength;
    c.strokeStyle = `rgba(255,255,255,${0.9 * this.alpha})`;
    c.lineWidth = pressed ? 3 : 1.5;
    if (this.state === "hold") c.setLineDash([3, 5]);
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    if (this.state === "scroll") {
      c.beginPath();
      c.moveTo(x, y - 34);
      c.lineTo(x, y + 34);
      c.moveTo(x - 5, y - 29);
      c.lineTo(x, y - 34);
      c.lineTo(x + 5, y - 29);
      c.moveTo(x - 5, y + 29);
      c.lineTo(x, y + 34);
      c.lineTo(x + 5, y + 29);
      c.stroke();
    }

    this.pops = this.pops.filter((p) => now - p.t < 420);
    for (const p of this.pops) {
      const t = clamp((now - p.t) / 420);
      const ease = 1 - Math.pow(1 - t, 3);
      c.strokeStyle = `rgba(255,255,255,${(1 - t) * 0.8})`;
      c.lineWidth = 2 * (1 - t) + 0.5;
      c.beginPath();
      c.arc(p.x, p.y, 8 + 46 * ease, 0, Math.PI * 2);
      c.stroke();
    }
  }
}
