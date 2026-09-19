/* eslint-disable @typescript-eslint/no-explicit-any */
// Highway 2.2.0 Renderer lifecycle with shared engine setup.
// BaseRenderer.onFirstLoad initializes the app. lib/engine/boot.ts constructs managers before
// it constructs the Router; the renderer runs the first-view half. Contract: router/README.md.
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import ASScroll from "@ashthornton/asscroll";
import E from "../../core/event-bus";
import { store } from "../../core/store";
import { ComponentManager, $ } from "../../core/component-manager";
import { SvgButton } from "../../dom/svg-button";
import { VideoPlayer } from "../../dom/video-player";
import { MuteButton } from "../../dom/mute-button";
import { Transition, type ShowHideArgs } from "../transitions/base";

export interface PageProperties {
  /** stands in for the fetched Document: only `title` and `body.className` are read. */
  page: { title: string; body: { className: string } };
  view: HTMLElement;
  slug: string;
  renderer: Promise<RendererClass>;
  transition: { class: typeof Transition; name: string } | null;
}

export type RendererClass = new (properties: PageProperties) => Renderer;

/** Highway Renderer. */
export class Renderer {
  wrap: HTMLElement;
  properties: PageProperties;
  Transition: Transition | null;
  [key: string]: any;

  constructor(properties: PageProperties) {
    this.wrap = document.querySelector("[data-router-wrapper]") as HTMLElement;
    this.properties = properties;
    this.Transition = properties.transition
      ? new properties.transition.class(this.wrap, properties.transition.name)
      : null;
  }

  onEnter?(...args: any[]): any;
  onEnterCompleted?(): void;
  onLeave?(): void;
  onLeaveCompleted?(): void;

  setup() {
    this.onEnter && this.onEnter();
    this.onEnterCompleted && this.onEnterCompleted();
  }

  /** Highway appends the fetched view here; React has already mounted it. */
  add() {}

  /** Highway copies the fetched <title>; Next's metadata already set document.title. */
  update() {}

  show(args: ShowHideArgs): Promise<void> {
    return new Promise((resolve) => {
      this.update();
      this.onEnter && this.onEnter();
      Promise.resolve(this.Transition ? this.Transition.show(args) : undefined).then(() => {
        this.onEnterCompleted && this.onEnterCompleted();
        resolve();
      });
    });
  }

  hide(args: ShowHideArgs): Promise<void> {
    return new Promise((resolve) => {
      this.onLeave && this.onLeave();
      Promise.resolve(this.Transition ? this.Transition.hide(args) : undefined).then(() => {
        this.onLeaveCompleted && this.onLeaveCompleted();
        resolve();
      });
    });
  }
}

/**
 * Optional (standalone use only; lib/engine/boot.ts constructs the managers itself). Constructs, in dependency order, everything between `ASScroll` and the `RAFCollection.add` line of
 * `onFirstLoad`: RAFCollection, FPSChecker, AssetLoader, TextLoader, Dom2WebglObserver, PageLoader,
 * NakedLoader, ScrollAnimations, TaskScheduler, Gl (+addPasses), Audio, Dom2Webgl, CustomEase
 * "projectMenuToProject", HomeContact, ProjectMenu, ProjectFilters, Navigation, Menu,
 * Cursor. Owned by lib/engine/boot.ts.
 */
export type EngineFactory = () => void;

let engineFactory: EngineFactory | null = null;
export function setEngineFactory(factory: EngineFactory) {
  engineFactory = factory;
}

/** Shared route renderer lifecycle. */
export class BaseRenderer extends Renderer {
  page!: any; // HTMLElement (loosely typed: subclasses assign wrap.lastElementChild directly)
  buttons!: ComponentManager;
  video!: ComponentManager;
  muteToggles!: ComponentManager;
  rebrandBtn: any;
  muteBtn: any;
  reloadScripts: string[] = [];

  onFirstAssetsLoad = () => {
    store.HomeContact.build();
    store.ProjectMenu.preBuild();
    this.rebrandBtn = new SvgButton($(".js-rebrand-btn") as any);
    this.muteBtn = new MuteButton($(".js-global-mute-btn") as any);
    (store.TextLoader!.loaded as Promise<void>).then(() => {
      store.PageLoader.hiddenPromise.then(() => {
        this.onEnterCompleted();
        E.emit("CheckFPS");
        gsap.from(store.Gl!.screenFxPass.uniforms.u_maxDistort, {
          value: 5,
          duration: 1.5,
          ease: "power2.out",
        });
      });
    });
    E.off("AssetLoader:beforeResolve", this.onFirstAssetsLoad);
  };

  onFirstLoad() {
    // lib/engine/boot.ts already ran this block (ASScroll, every manager, RAF/ScrollTrigger wiring,
    // ?mobilerecording) before constructing the Router; only run it here when nothing did.
    if (!store.RAFCollection) {
      gsap.registerPlugin(ScrollTrigger);
      store.ASScroll = new ASScroll({
        disableRaf: true,
        disableResize: true,
        touchScrollType: "transform",
        lockIOSBrowserUI: false,
        disableNativeScrollbar: false,
        limitLerpRate: false,
      });
      if (!engineFactory) throw new Error("router: no engine factory and boot did not construct the managers");
      engineFactory();
      store.RAFCollection!.add(store.ASScroll.update, 0);
      store.ASScroll.on("update", ScrollTrigger.update);
      ScrollTrigger.addEventListener("refresh", store.ASScroll.resize);
      if (store.urlParams.has("mobilerecording")) {
        const px = parseFloat(store.urlParams.get("mobilerecording") || "150");
        ($(".header") as HTMLElement).style.top = `${px}px`;
        ($(".js-global-mute-btn") as HTMLElement).style.bottom = `${px}px`;
        ($(".js-footer-cta") as HTMLElement).style.bottom = `${px}px`;
        ($(".js-footer-cr") as HTMLElement).style.bottom = `${px}px`;
      }
    }
    this.onEnter();
    E.on("AssetLoader:beforeResolve", this.onFirstAssetsLoad);
  }

  onEnter({ loadScripts = true }: { loadScripts?: boolean } = {}): any {
    this.page = this.wrap.lastElementChild as HTMLElement;
    loadScripts && this.loadScripts();
    store.ASScroll.currentPos = 0;
    window.scrollTo(0, 0);
    store.Dom2Webgl.build();
    this.buttons = new ComponentManager(SvgButton as any, this.page);
    this.video = new ComponentManager(VideoPlayer as any, this.page);
    this.muteToggles = new ComponentManager(MuteButton as any, this.page);
    store.AssetLoader!.load({ element: this.page }).then(() => {
      this.updateScrollTrigger();
      store.ScrollAnimations.build();
      store.Dom2Webgl.enable();

    });
    store.TextLoader!.load({ element: false });
  }

  onEnterCompleted() {
    store.ScrollAnimations.enable();
    store.Navigation.showNavItems();
    store.Cursor.enable();
    store.Menu.updateActiveItem();
  }

  onLeave() {
    store.Cursor.disable();
    store.ASScroll.disable();
    store.html.classList.add("asscroll-disabled");
    store.ScrollAnimations.destroy();
    store.Dom2WebglObserver!.reset();
    store.Highway.firstLoad = false;
  }

  onLeaveCompleted() {
    store.Dom2Webgl.reset();
    this.buttons.callAll("destroy");
    this.video.callAll("destroy");
    this.muteToggles.callAll("destroy");
  }

  updateScrollTrigger() {
    ScrollTrigger.defaults({ scroller: store.ASScroll.containerElement });
    ScrollTrigger.scrollerProxy(store.ASScroll.containerElement, {
      scrollTop: this.getScrollTriggerPos,
      scrollLeft: this.getScrollTriggerPos,
      getBoundingClientRect() {
        return { top: 0, left: 0, width: store.window.w, height: store.window.h };
      },
    });
  }

  getScrollTriggerPos(value?: number): any {
    return arguments.length ? store.ASScroll.scrollTo(value) : store.ASScroll.currentPos;
  }

  /**
   * Inline <script>s inside the view define window.projects / window.worldData /
   * window.currentProjectMenuId. On first load the browser ran them from the SSR HTML; after a client
   * navigation React-inserted scripts never execute, so they are eval'd here after each client navigation.
   */
  loadScripts() {
    this.reloadScripts = [];
    const scripts = this.page.querySelectorAll("script");
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i].textContent || "";
      const src = scripts[i].src;
      if (!store.Highway.firstLoad && text.length > 0) window.eval(text);
      else if (src.length > 0)
        this.appendScript(src, src.split("/").pop() as string).catch((err) => {
          console.error(err);
        });
    }
  }

  appendScript(src: string, filename: string): Promise<Event | void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`[data-filename="${filename}"]`)) return;
      const el = document.createElement("script");
      if (!this.reloadScripts.includes(filename)) el.dataset.filename = filename;
      if (!store.Highway.firstLoad) {
        el.addEventListener("load", resolve);
        el.addEventListener("error", () => reject(new Error("Error loading script: " + filename)));
        el.addEventListener("abort", () => reject(new Error("Script loading aborted: " + filename)));
        el.async = true;
        el.src = src;
      }
      document.body.appendChild(el);
    });
  }

  setup() {
    store.Highway.firstLoad = true;
    this.onFirstLoad();
  }

  show(args: ShowHideArgs): Promise<void> {
    return new Promise(async (resolve) => {
      this.update();
      if (this.onEnter) await this.onEnter();
      if (this.Transition) await this.Transition.show(args);
      if (this.onEnterCompleted) this.onEnterCompleted();
      resolve();
    });
  }
}

export default BaseRenderer;
