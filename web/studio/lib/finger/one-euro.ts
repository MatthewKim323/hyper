// One Euro filter (Casiez, Roussel, Vogel 2012): a low-pass whose cutoff rises with speed.
// Slow hands get heavy smoothing (no jitter), fast hands get almost none (no lag).
const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  private x: number | null = null;
  private dx = 0;

  constructor(
    public minCutoff = 1,
    public beta = 0.01,
    public dCutoff = 1,
  ) {}

  reset() {
    this.x = null;
    this.dx = 0;
  }

  /** `dt` in seconds since the previous sample. */
  filter(value: number, dt: number): number {
    if (this.x === null || dt <= 0) {
      this.x = value;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  /** Filtered velocity in units per second, for prediction. */
  get velocity() {
    return this.dx;
  }
}

export class OneEuro2D {
  private fx: OneEuro;
  private fy: OneEuro;
  constructor(minCutoff = 1, beta = 0.01, dCutoff = 1) {
    this.fx = new OneEuro(minCutoff, beta, dCutoff);
    this.fy = new OneEuro(minCutoff, beta, dCutoff);
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
  }
  filter(x: number, y: number, dt: number) {
    return { x: this.fx.filter(x, dt), y: this.fy.filter(y, dt) };
  }
  get velocity() {
    return { x: this.fx.velocity, y: this.fy.velocity };
  }
}
