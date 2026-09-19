/* eslint-disable @typescript-eslint/no-explicit-any */
// App bootstrap and first-view manager construction.
// Client only. EngineRoot dynamic-imports this module and calls bootEngine() once.
import { Favicon } from "./dom/favicon";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CustomEase } from "gsap/CustomEase";
import ASScroll from "@ashthornton/asscroll";
import E from "./core/event-bus";
import { store, initStore } from "./core/store";
import { GlobalEvents } from "./core/global-events";
import { RAFCollection } from "./core/raf";
import { FPSChecker } from "./core/fps-checker";
import { AssetLoader } from "./core/asset-loader";
import { ObserverRegistry } from "./core/observer";
import { TaskScheduler } from "./core/task-scheduler";
import { Gl } from "./core/gl";
import { Audio } from "./core/audio";
import { $ } from "./core/component-manager";
import { MODULE_ORDER, getFactory, hasModule, runBootHooks, type ModuleKey } from "./registry";
import { registerModules } from "./modules";

let booted = false;

function construct(key: ModuleKey) {
  const factory = getFactory(key);
  if (!factory) return;
  try {
    store[key] = factory();
  } catch (err) {
    console.error(`[engine] failed to construct ${key}`, err);
  }
}

/** Initialize shared browser state before constructing the router. */
function appInit() {
  if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
  Object.assign(store, { assetsUrl: "/theme/", publicUrl: "/" }, window.globalData || {});
  store.GlobalEvents = new GlobalEvents();
  window.store = store;
  Favicon.handleFavicon();
}

/** Construct managers in dependency order. */
function firstLoad() {
  gsap.registerPlugin(ScrollTrigger);
  const container = document.querySelector("[asscroll-container]");
  store.ASScroll = container
    ? new ASScroll({
        disableRaf: true,
        disableResize: true,
        touchScrollType: "transform",
        lockIOSBrowserUI: false,
        disableNativeScrollbar: false,
        limitLerpRate: false,
      })
    : null;
  store.RAFCollection = new RAFCollection();
  store.FPSChecker = new FPSChecker();
  store.AssetLoader = new AssetLoader();
  store.TextLoader = new AssetLoader({ name: "TextLoader", progressEventName: "TextLoaderProgress" });
  store.Dom2WebglObserver = new ObserverRegistry({ rootMargin: "0% 0% 0% 0%" }, "dom2webgl", true);
  MODULE_ORDER.early.forEach(construct);
  store.TaskScheduler = new TaskScheduler();
  store.Gl = new Gl();
  store.Gl.addPasses();
  store.Audio = new Audio();
  MODULE_ORDER.afterAudio.forEach(construct);
  gsap.registerPlugin(CustomEase);
  CustomEase.create("projectMenuToProject", "M0,0 C0.532,0 0.5,0.5 1,1 ");
  MODULE_ORDER.scenes.forEach(construct);
  if (store.ASScroll) {
    store.RAFCollection.add(store.ASScroll.update, 0);
    store.ASScroll.on("update", ScrollTrigger.update);
    ScrollTrigger.addEventListener("refresh", store.ASScroll.resize);
  }
  if (store.urlParams.has("mobilerecording")) {
    const px = parseFloat(store.urlParams.get("mobilerecording") || "150");
    const set = (sel: string, prop: "top" | "bottom") => {
      const el = $(sel);
      if (el) el.style[prop] = `${px}px`;
    };
    set(".header", "top");
    set(".js-global-mute-btn", "bottom");
    set(".js-footer-cta", "bottom");
    set(".js-footer-cr", "bottom");
  }
}

/**
 * Build shared scenes after assets load. The router constructs SvgButton and MuteButton
 * because they depend on view markup. Exported for reuse by the router.
 */
export function onFirstAssetsLoadCore(onEnterCompleted?: () => void) {
  const guard = (label: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      console.error(`[engine] ${label} failed`, err);
    }
  };
  guard("HomeContact.build", () => store.HomeContact?.build?.());
  guard("ProjectMenu.preBuild", () => store.ProjectMenu?.preBuild?.());
  const textLoaded = store.TextLoader!.loaded || Promise.resolve();
  textLoaded.then(() => {
    const hidden: Promise<void> = store.PageLoader?.hiddenPromise || Promise.resolve();
    hidden.then(() => {
      onEnterCompleted?.();
      E.emit("CheckFPS");
      gsap.from(store.Gl!.screenFxPass.uniforms.u_maxDistort, { value: 5, duration: 1.5, ease: "power2.out" });
    });
  });
}

/** Minimal first view used only while no Router module is registered (keeps the canvas alive for testing). */
function fallbackFirstEnter() {
  const wrap = document.querySelector("[data-router-wrapper]");
  const page = (wrap?.lastElementChild as HTMLElement | null) || document.body;
  if (store.ASScroll) store.ASScroll.currentPos = 0;
  window.scrollTo(0, 0);
  const onFirstAssetsLoad = () => {
    E.off("AssetLoader:beforeResolve", onFirstAssetsLoad);
    onFirstAssetsLoadCore();
  };
  E.on("AssetLoader:beforeResolve", onFirstAssetsLoad);
  store.AssetLoader!.load({ element: page });
  store.TextLoader!.load({ element: false });
}

export function bootEngine() {
  if (booted || typeof window === "undefined") return store;
  // Fast Refresh re-evaluates this module with a fresh `booted` while the old engine, its router and
  // its listeners stay live on the page. A second engine would run every transition twice, so reload.
  if (window.store?.Highway) {
    window.location.reload();
    return store;
  }
  booted = true;
  initStore();
  registerModules();
  appInit();
  firstLoad();
  runBootHooks();
  if (hasModule("Router")) construct("Router");
  else fallbackFirstEnter();
  if (store.Router && !store.Highway) store.Highway = store.Router;
  return store;
}

export { store };
export default bootEngine;
