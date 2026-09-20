// PageLoader: the intro wipe. Black field, white panel springs to 67% while the counter runs,
// then to 100% once assets are ready, a black end panel wipes over, and the layer fades out.
// After the first entry the router reuses this overlay as a plain black curtain (show / hide).
import gsap from "gsap";
import { animate, type AnimationPlaybackControls } from "motion";
import { store } from "../core/store";
import { E } from "../core/event-bus";

// Stage timings (ms) and springs, in the order the stages run.
// The loader parks here while the scene's assets finish.
const HOLD_AT = 67;
const TO_HOLD = { type: "spring", duration: 1.6, bounce: 0 } as const;
const STAGE = { type: "spring", duration: 1.1, bounce: 0 } as const;
const WORLD_WAIT_CAP = 15000;
const HOLD_MS = 1500;
const HOLD_FULL = 600;
const HOLD_END = 600;

// Counter: 0 to 100 over 1s easeOut, paused for 1s at the hold.
const COUNT_EASE = [0, 0, 0.58, 1] as const;
const COUNT_FIRST = HOLD_AT / 100;
const COUNT_PAUSE = 1000;
const COUNT_REST = 1 - HOLD_AT / 100;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PageLoader {
  dom: {
    loader: HTMLElement;
    colors: HTMLElement;
    white: HTMLElement;
    end: HTMLElement;
    count: HTMLElement;
  };
  hidden = false;
  hiddenPromise: Promise<void>;
  private hiddenResolve!: () => void;
  private assetsLoaded = false;
  private assetsReady: Promise<void>;
  private assetsResolve!: () => void;
  private hidingPromise?: Promise<void>;
  private introDone = false;
  private fade?: AnimationPlaybackControls;

  constructor() {
    const loader = document.querySelector<HTMLElement>(".js-loader")!;
    this.dom = {
      loader,
      colors: loader.querySelector(".js-loader-colors")!,
      white: loader.querySelector(".js-loader-white")!,
      end: loader.querySelector(".js-loader-end")!,
      count: loader.querySelector(".js-loader-count")!,
    };
    this.hiddenPromise = new Promise((resolve) => {
      this.hiddenResolve = resolve;
    });
    this.assetsReady = new Promise((resolve) => {
      this.assetsResolve = resolve;
    });
    E.on("AssetLoader:afterResolve", this.onAssetsLoaded);
    if (store.urlParams.has("skiploader")) return;
    this.intro();
  }

  onAssetsLoaded = () => {
    if (this.assetsLoaded) return;
    this.assetsLoaded = true;
    this.assetsResolve();
    if (store.urlParams.has("skiploader")) this.finish();
  };

  private setCount(v: number) {
    const n = Math.round(v);
    this.dom.count.textContent = n + "%";
    this.dom.loader.setAttribute("aria-valuenow", String(n));
  }

  private async intro() {
    const { white, end, colors, count } = this.dom;
    animate(white, { width: `${HOLD_AT}%` }, TO_HOLD);
    const counter = animate(0, HOLD_AT, {
      duration: COUNT_FIRST,
      ease: COUNT_EASE,
      onUpdate: (v) => this.setCount(v),
    }).then(() => wait(COUNT_PAUSE));

    // The fill to 100% waits for the scene's assets, never less than the authored hold.
    // The 3D world preloads hidden behind this layer. Hold here until it has rendered once, so
    // nothing loads later. Capped: a slow or failed world must not trap the visitor on the loader.
    const worldReady = new Promise<void>((resolve) => {
      if (document.documentElement.dataset.atriumReady === "true") return resolve();
      window.addEventListener("hyper:atrium-ready", () => resolve(), { once: true });
      setTimeout(resolve, WORLD_WAIT_CAP);
    });
    await Promise.all([wait(HOLD_MS), this.assetsReady, worldReady]);
    animate(white, { width: "100%" }, STAGE);
    wait(200).then(() => counter).then(() =>
      animate(HOLD_AT, 100, { duration: COUNT_REST, ease: COUNT_EASE, onUpdate: (v) => this.setCount(v) }),
    );

    await wait(HOLD_FULL);
    animate(end, { width: "100%" }, STAGE);
    count.style.display = "none";

    await wait(HOLD_END);
    this.introDone = true;
    this.finish();
    this.fade = animate(colors, { opacity: 0 }, STAGE);
    await this.fade;
    if (this.fade) gsap.set(this.dom.loader, { autoAlpha: 0 });
  }

  // Scene enters as the layer starts to fade, matching the authored overlap.
  private finish() {
    if (this.hidden) return;
    this.removeEvents();
    this.hidden = true;
    store.Audio?.muteAll(false);
    if (!this.introDone) gsap.set(this.dom.loader, { autoAlpha: 0 });
    this.hiddenResolve();
    this.hidingPromise = this.hiddenPromise;
  }

  show() {
    this.hidingPromise = undefined;
    this.fade?.stop();
    this.fade = undefined;
    const { white, end, colors, count } = this.dom;
    // Curtain state: plain black field, no counter.
    gsap.set(count, { display: "none" });
    gsap.set([white, end], { width: "0%" });
    gsap.set(colors, { opacity: 1 });
    return new Promise<void>((resolve) => {
      gsap.to(this.dom.loader, {
        duration: 1,
        autoAlpha: 1,
        ease: "expo.inOut",
        onComplete: resolve,
      });
    });
  }

  hide(delay = 0) {
    // First entry: resolves when the intro hands off to the scene.
    if (!this.hidden) return this.hiddenPromise;
    if (this.hidingPromise) return this.hidingPromise;
    this.hidingPromise = new Promise<void>((resolve) => {
      gsap
        .timeline({ delay, defaults: { ease: "power2.inOut" } })
        .to(this.dom.loader, { duration: 0.5, autoAlpha: 0 }, 0)
        .call(resolve, undefined, 0.3);
    });
    return this.hidingPromise;
  }

  removeEvents() {
    E.off("AssetLoader:afterResolve", this.onAssetsLoaded);
  }
}

export default PageLoader;
