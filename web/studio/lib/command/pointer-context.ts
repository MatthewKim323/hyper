// PointerContext: remembers where the pointer has been, so speech can be fused with pointing.
// "What is this" is resolved against the pointer position at the moment "this" was spoken, not at the
// moment the sentence ended. Works for the mouse and the hand cursor alike (both emit mousemove).
export type PointerSample = { t: number; x: number; y: number };

export type Referent = {
  /** Screen rectangle of the resolved element, in CSS pixels. */
  rect: { x: number; y: number; width: number; height: number };
  /** Human-readable name: aria-label, data-pointable label, or trimmed text. */
  label: string;
  /** Machine id when the element declares one with data-pointable="kind:id". */
  kind: string | null;
  id: string | null;
  /** Workspace section the element lives in, from the nearest [data-section]. */
  section: string | null;
  /** Free-form JSON an element can expose for the command layer with data-pointable-data. */
  data: unknown;
};

export type Region = { x: number; y: number; width: number; height: number; referents: Referent[] };

const KEEP_MS = 12_000;
const POINTABLE = "[data-pointable], [data-section], button, a, [role='button'], h1, h2, h3, figure, canvas, svg, li, tr, p";

export class PointerContext {
  private trail: PointerSample[] = [];

  constructor() {
    window.addEventListener("mousemove", this.onMove, { passive: true, capture: true });
  }

  destroy() {
    window.removeEventListener("mousemove", this.onMove, { capture: true });
  }

  private onMove = (e: MouseEvent) => {
    const t = performance.now();
    this.trail.push({ t, x: e.clientX, y: e.clientY });
    while (this.trail.length && t - this.trail[0].t > KEEP_MS) this.trail.shift();
  };

  /** Pointer position at a past time (performance clock, ms), interpolated between samples. */
  at(t: number): PointerSample | null {
    const n = this.trail.length;
    if (!n) return null;
    if (t <= this.trail[0].t) return this.trail[0];
    if (t >= this.trail[n - 1].t) return this.trail[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.trail[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = this.trail[lo];
    const b = this.trail[hi];
    const k = (t - a.t) / Math.max(b.t - a.t, 1e-6);
    return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  /** Samples between two times. */
  between(from: number, to: number): PointerSample[] {
    return this.trail.filter((s) => s.t >= from && s.t <= to);
  }

  /** The thing under a point: the nearest ancestor worth naming. */
  describe(x: number, y: number): Referent | null {
    for (const hit of document.elementsFromPoint(x, y)) {
      const el = hit.closest<HTMLElement | SVGElement>(POINTABLE);
      if (!el || el === document.body || el === document.documentElement) continue;
      return describeElement(el);
    }
    return null;
  }

  /**
   * The area the user swept while speaking: a circling or scrubbing motion generalizes from one
   * object to everything inside the swept box. A still pointer gives a region of one referent.
   */
  region(from: number, to: number): Region | null {
    const samples = this.between(from, to);
    const last = samples[samples.length - 1] ?? this.at(to);
    if (!last) return null;
    const xs = samples.length ? samples.map((s) => s.x) : [last.x];
    const ys = samples.length ? samples.map((s) => s.y) : [last.y];
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    // Small sweeps are a point, not an area.
    if (box.width < 90 && box.height < 90) {
      const one = this.describe(last.x, last.y);
      return { ...(one?.rect ?? { x: last.x, y: last.y, width: 0, height: 0 }), referents: one ? [one] : [] };
    }
    const seen = new Set<Element>();
    const referents: Referent[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("[data-pointable]")) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (r.width && cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height && !seen.has(el)) {
        seen.add(el);
        referents.push(describeElement(el));
      }
    }
    return { ...box, referents };
  }
}

function describeElement(el: HTMLElement | SVGElement): Referent {
  const r = el.getBoundingClientRect();
  const pointable = el.getAttribute("data-pointable") ?? "";
  const [kind, id] = pointable.includes(":") ? pointable.split(/:(.*)/s) : [pointable || null, null];
  let data: unknown = null;
  const raw = el.getAttribute("data-pointable-data");
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }
  const label = (el.getAttribute("data-pointable-label") ?? el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return {
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    label,
    kind: kind || null,
    id: id || null,
    section: el.closest("[data-section]")?.getAttribute("data-section") ?? null,
    data,
  };
}
