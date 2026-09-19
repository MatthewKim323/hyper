// FPSChecker. RAF index 100.
// 600 ms windows x 5, drops min & max, tiers [15,30,45,55] -> store.gpuTier; emits "FPSChecked"(tier).
// Started by E.emit("CheckFPS"); disabled with ?forcehq.
import E from "./event-bus";
import { store } from "./store";

export class FPSChecker {
  run = false;
  hasRun = false;
  checkInterval = 600;
  frames = 0;
  prevTime = 0;
  checkCount = 0;
  totalChecks = 0;
  tiers = [15, 30, 45, 55];
  totalCheckLimit = 10;
  avgFps: number[] = [];

  constructor() {
    store.gpuTier = this.tiers.length;
    if (!store.urlParams.has("forcehq")) {
      store.RAFCollection!.add(this.check, 100);
      document.addEventListener("visibilitychange", this.onDocVisibilityChange);
      E.on(store.events.RESIZE, this.onResize);
      E.on("CheckFPS", () => {
        this.avgFps = [];
        this.totalChecks = 0;
        this.hasRun = true;
        this.enable();
      });
    }
  }

  check = () => {
    if (!this.run) return;
    this.frames++;
    const now = performance.now();
    if (now >= this.prevTime + this.checkInterval) {
      const fps = (1e3 * this.frames) / (now - this.prevTime);
      if (fps > 1) {
        this.avgFps.push(fps);
        this.checkCount++;
        if (this.checkCount === 5) {
          this.run = false;
          const min = Math.min(...this.avgFps);
          const max = Math.max(...this.avgFps);
          for (let t = 0; t < this.avgFps.length; t++)
            if (this.avgFps[t] === min) {
              this.avgFps.splice(t, 1);
              break;
            }
          for (let e = 0; e < this.avgFps.length; e++)
            if (this.avgFps[e] === max) {
              this.avgFps.splice(e, 1);
              break;
            }
          const avg = Math.ceil(this.avgFps.reduce((a, b) => a + b, 0) / this.avgFps.length);
          this.avgFps = [];
          store.gpuTier = this.tiers.filter((tier) => avg >= tier).length;
          this.totalChecks++;
          requestAnimationFrame(() => {
            setTimeout(() => {
              E.emit("FPSChecked", store.gpuTier);
            }, 0);
          });
          if (store.gpuTier < this.totalCheckLimit && this.totalChecks < this.totalCheckLimit) this.enable();
        }
      }
      this.prevTime = now;
      this.frames = 0;
    }
  };

  onDocVisibilityChange = () => {
    if (this.run && document.visibilityState === "visible") {
      this.prevTime = performance.now();
      this.frames = 0;
    }
  };

  onResize = () => {
    if (this.run) {
      this.prevTime = performance.now();
      this.frames = 0;
      this.checkCount = 0;
      this.avgFps = [];
    }
  };

  enable() {
    this.checkCount = 0;
    this.run = true;
  }

  disable() {
    this.run = false;
  }
}

export default FPSChecker;
