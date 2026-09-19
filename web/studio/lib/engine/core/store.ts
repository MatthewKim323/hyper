/* eslint-disable @typescript-eslint/no-explicit-any */
// Global singleton state.
// Window-dependent fields are filled by `initStore()` (called first thing in bootEngine),
// so importing this module never touches `window`.
import { Vector2 } from "three";
import type { RAFCollection } from "./raf";
import type { AssetLoader } from "./asset-loader";
import type { Gl } from "./gl";
import type { Audio } from "./audio";
import type { TaskScheduler } from "./task-scheduler";
import type { FPSChecker } from "./fps-checker";
import type { ObserverRegistry } from "./observer";
import type { GlobalEvents } from "./global-events";

export const events = {
  RAF: "GRAF",
  MOUSEMOVE: "GMouseMove",
  MOUSEDRAG: "GMouseDrag",
  MOUSEDOWN: "GMouseDown",
  MOUSEUP: "GMouseUp",
  RESIZE: "GResize",
  TOUCHDETECTED: "TouchDetected",
  WHEEL: "GWheel",
} as const;

export interface Store {
  html: HTMLElement;
  body: HTMLElement;
  window: { w: number; h: number; fullHeight: number; dpr: number };
  mouse: {
    x: number;
    y: number;
    gl: Vector2;
    glNormalized: Vector2;
    glScreenSpace: Vector2;
    smooth: { glNormalized: Vector2 };
  };
  mq: {
    xs: MediaQueryList;
    sm: MediaQueryList;
    md: MediaQueryList;
    lg: MediaQueryList;
    xlg: MediaQueryList;
  };
  urlParams: URLSearchParams;
  isTouch: boolean;
  isIOS: boolean;
  projectToProjectTransition: boolean;
  currentProjectMenuId: number;
  projectLightMode: boolean;
  audioMuted: boolean;
  debug: boolean;
  events: typeof events;
  /** merged from window.globalData */
  assetsUrl: string;
  publicUrl: string;
  clockDelta: number;
  gpuTier: number;

  GlobalEvents: GlobalEvents | null;
  RAFCollection: RAFCollection | null;
  FPSChecker: FPSChecker | null;
  AssetLoader: AssetLoader | null;
  TextLoader: AssetLoader | null;
  Dom2WebglObserver: ObserverRegistry | null;
  TaskScheduler: TaskScheduler | null;
  Gl: Gl | null;
  Audio: Audio | null;

  // Instances owned by other areas (typed loosely on purpose).
  ASScroll: any;
  Dom2Webgl: any;
  PageLoader: any;
  NakedLoader: any;
  ScrollAnimations: any;
  HomeContact: any;
  ProjectMenu: any;
  ProjectFilters: any;
  World: any;
  Navigation: any;
  Menu: any;
  WorldButton: any;
  Cursor: any;
  Highway: any;
  Gui?: any;
  [key: string]: any;
}

// Filled in by initStore(); the object identity never changes, so `import { store }` is safe anywhere.
export const store = {
  projectToProjectTransition: false,
  currentProjectMenuId: 0,
  projectLightMode: false,
  ASScroll: null,
  AssetLoader: null,
  TaskScheduler: null,
  Dom2Webgl: null,
  Gl: null,
  HomeContact: null,
  ProjectMenu: null,
  World: null,
  Audio: null,
  audioMuted: false,
  events,
  assetsUrl: "/theme/",
  publicUrl: "/",
  clockDelta: 0,
} as unknown as Store;

let initialised = false;

export function initStore(): Store {
  if (initialised) return store;
  initialised = true;
  Object.assign(store, {
    html: document.documentElement,
    body: document.body,
    window: {
      w: window.innerWidth,
      h: window.innerHeight,
      fullHeight: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
    mouse: {
      x: 0,
      y: 0,
      gl: new Vector2(),
      glNormalized: new Vector2(),
      glScreenSpace: new Vector2(),
      smooth: { glNormalized: new Vector2() },
    },
    mq: {
      xs: window.matchMedia("(max-width: 415px)"),
      sm: window.matchMedia("(min-width: 768px)"),
      md: window.matchMedia("(min-width: 1024px)"),
      lg: window.matchMedia("(min-width: 1366px)"),
      xlg: window.matchMedia("(min-width: 1921px)"),
    },
    urlParams: new URLSearchParams(window.location.search),
    isTouch: false,
    isIOS:
      [
        "iPad Simulator",
        "iPhone Simulator",
        "iPod Simulator",
        "iPad",
        "iPhone",
        "iPod",
      ].includes(navigator.platform) ||
      (navigator.userAgent.includes("Mac") && "ontouchend" in document),
    debug: new URLSearchParams(window.location.search).has("debug"),
  });
  return store;
}

export default store;
