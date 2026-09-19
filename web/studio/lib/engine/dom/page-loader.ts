// PageLoader: a single Enter button gates the first scene until its assets are ready.
import gsap from "gsap";
import { store } from "../core/store";
import { E } from "../core/event-bus";
import { SvgButton } from "./svg-button";

export class PageLoader {
  dom: { loader: HTMLElement };
  enterButton: HTMLButtonElement;
  hidden = false;
  hiddenPromise: Promise<void>;
  private hiddenResolve!: () => void;
  private assetsLoaded = false;
  private hidingPromise?: Promise<void>;

  constructor() {
    this.dom = { loader: document.querySelector<HTMLElement>(".js-loader")! };
    this.enterButton = document.querySelector<HTMLButtonElement>(".js-enter-btn")!;
    this.enterButton.disabled = true;
    this.enterButton.setAttribute("aria-busy", "true");
    new SvgButton(this.enterButton);
    this.hiddenPromise = new Promise((resolve) => {
      this.hiddenResolve = resolve;
    });
    E.on("AssetLoader:afterResolve", this.onAssetsLoaded);
    E.on("click", this.enterButton, this.onEnterButtonClick);
  }

  onAssetsLoaded = () => {
    if (this.assetsLoaded || this.hidden) return;
    this.assetsLoaded = true;
    this.enterButton.disabled = false;
    this.enterButton.setAttribute("aria-busy", "false");
    if (store.urlParams.has("skiploader")) this.hide();
  };

  onEnterButtonClick = () => {
    if (!this.assetsLoaded || this.hidingPromise || this.hidden) return;
    store.Audio?.muteAll(false);
    this.hide();
  };

  show() {
    this.hidingPromise = undefined;
    // The router also uses this overlay as a curtain after the initial entry.
    gsap.set(this.enterButton, { autoAlpha: 0 });
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
    if (!this.assetsLoaded) return this.hiddenPromise;
    if (this.hidingPromise) return this.hidingPromise;
    this.removeEvents();
    this.hidden = true;
    this.enterButton.disabled = true;
    this.enterButton.blur();
    this.hidingPromise = new Promise<void>((resolve) => {
      gsap
        .timeline({ delay, defaults: { ease: "power2.inOut" } })
        .to(this.dom.loader, { duration: 0.5, autoAlpha: 0 }, 0)
        .call(
          () => {
            this.hiddenResolve();
            resolve();
          },
          undefined,
          0.3,
        );
    });
    return this.hidingPromise;
  }

  removeEvents() {
    E.off("AssetLoader:afterResolve", this.onAssetsLoaded);
    E.off("click", this.enterButton, this.onEnterButtonClick);
  }
}

export default PageLoader;
