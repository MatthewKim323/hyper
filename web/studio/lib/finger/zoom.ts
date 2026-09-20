// Zoom gesture: closing an open hand pulls in, opening a closed hand lets go.
// Works on transitions, not poses, so a resting fist or a relaxed open hand does nothing on its own.

export type ZoomDirection = "in" | "out";

// A pose has to hold this long to count, which drops single-frame misreads.
const FIST_MS = 120;
const OPEN_MS = 80;
// The other pose must have been seen this recently for the change to read as one motion.
const LINK_MS = 900;
// The hand usually relaxes right after a grab; that must not undo the zoom it just made.
const SETTLE_MS = 1200;

export class ZoomGesture {
  private openSince = 0;
  private fistSince = 0;
  private lastOpen = -Infinity;
  private lastFist = -Infinity;
  private fistHeld = false;
  private fired = false;
  private lastIn = -Infinity;

  reset() {
    this.openSince = this.fistSince = 0;
    this.lastOpen = this.lastFist = this.lastIn = -Infinity;
    this.fistHeld = this.fired = false;
  }

  /** Feed one camera frame. `open` is a flat hand with every finger out, `fist` every finger curled. */
  update(open: boolean, fist: boolean, now: number): ZoomDirection | null {
    if (fist) {
      if (!this.fistSince) { this.fistSince = now; this.fired = false; }
      this.openSince = 0;
      const held = now - this.fistSince >= FIST_MS;
      if (held) { this.fistHeld = true; this.lastFist = now; }
      if (held && !this.fired && this.fistSince - this.lastOpen <= LINK_MS) {
        this.fired = true;
        this.lastIn = now;
        return "in";
      }
      return null;
    }
    this.fistSince = 0;
    if (!open) { this.openSince = 0; return null; }
    if (!this.openSince) { this.openSince = now; this.fired = false; }
    this.lastOpen = now;
    if (this.fired || now - this.openSince < OPEN_MS) return null;
    const fromFist = this.fistHeld && this.openSince - this.lastFist <= LINK_MS;
    this.fistHeld = false;
    this.fired = true;
    return fromFist && now - this.lastIn >= SETTLE_MS ? "out" : null;
  }
}
