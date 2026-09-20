/* eslint-disable @typescript-eslint/no-explicit-any */
// Router built on the Highway 2.2.0 Core lifecycle.
// Highway fetched the next page's HTML; here the Next App Router renders it. The lifecycle is kept:
//   click / redirect(url, name) / popstate
//   -> contextual transition lookup -> NAVIGATE_OUT -> From.hide() (onLeave, transition out, which
//      "removes" the old view, onLeaveCompleted)
//   -> Next navigation (push, or the held-back popstate replayed to Next) -> wait for the new
//      main[data-router-view] -> NAVIGATE_IN (body class copy) -> To.show() (onEnter, transition in,
//      onEnterCompleted) -> NAVIGATE_END.
// Registered as `store.Highway` so scenes can call `store.Highway.redirect(url, "toProject")`.
import { store } from "../core/store";
import { Renderer, setEngineFactory, type EngineFactory, type PageProperties, type RendererClass } from "./renderers/base";
import DefaultRenderer from "./renderers/default";
import HomeContactRenderer from "./renderers/home-contact";
import ProjectsRenderer from "./renderers/projects";
import NotFoundRenderer from "./renderers/not-found";
import { Transition, type Trigger } from "./transitions/base";
import DefaultTransition from "./transitions/default";
import ToHomeTransition from "./transitions/to-home";
import ToContactTransition from "./transitions/to-contact";
import ToProjectMenuTransition from "./transitions/to-project-menu";
import { CONTEXTUAL_ROUTES, bodyClassFor, matchContextualRoute, type ContextualRoute, type TransitionName } from "./routes";

// Longest authored out transition is 3 s (the landing wipe); allow headroom, then move on.
const OUT_TRANSITION_CAP_MS = 5000;
// Next has never taken this long to commit a view; past it, fall back to a hard navigation.
const VIEW_WAIT_CAP_MS = 15000;

/** Internal links eligible for scene transitions. */
export const LINK_SELECTOR =
  'a[href]:not([target]):not([href|="#"]):not([data-router-disabled]):not(.sf-dump-toggle)';

const RENDERERS: Record<string, RendererClass> = {
  default: DefaultRenderer,
  homeContact: HomeContactRenderer,
  projects: ProjectsRenderer as unknown as RendererClass,
  notFound: NotFoundRenderer as unknown as RendererClass,
};

type TransitionClass = new (wrap: HTMLElement | null, name: string) => Transition;

const TRANSITIONS: { default: TransitionClass; contextual: Record<TransitionName, TransitionClass> } = {
  default: DefaultTransition,
  contextual: {
    default: DefaultTransition,
    toHome: ToHomeTransition,
    toContact: ToContactTransition,
    toProjectMenu: ToProjectMenuTransition,
  },
};

// Highway uses `contextual[name].prototype` as a shared, stateful object (out() sets flags that in()
// reads). One lazily created instance per name reproduces that.
const contextualInstances: Partial<Record<TransitionName, Transition>> = {};
function contextualTransition(name: TransitionName): Transition {
  let t = contextualInstances[name];
  if (!t) {
    t = new TRANSITIONS.contextual[name](null, name);
    contextualInstances[name] = t;
  }
  t.name = name;
  return t;
}

export interface RouterLocation {
  href: string;
  anchor: string | null;
  origin: string | null;
  params: Record<string, string> | null;
  pathname: string;
}

/** Minimal surface of Next's app router that the engine uses. */
export interface NextRouterLike {
  push(href: string, options?: { scroll?: boolean }): void;
  prefetch?(href: string): void;
}

let injectedNextRouter: NextRouterLike | null = null;
/** Optional: hand over `useRouter()` from a client component. Falls back to `window.next.router`. */
export function setNextRouter(router: NextRouterLike) {
  injectedNextRouter = router;
}
function nextRouter(): NextRouterLike | null {
  return injectedNextRouter ?? ((window as any).next?.router as NextRouterLike | undefined) ?? null;
}

/** Highway Helpers. */
export class Helpers {
  getOrigin(url: string): string | null {
    const m = url.match(/(https?:\/\/[\w\-.]+)/);
    return m ? m[1].replace(/https?:\/\//, "") : null;
  }
  getPathname(url: string): string {
    const m = url.match(/https?:\/\/.*?(\/[\w_\-./]+)/);
    return m ? m[1] : "/";
  }
  getAnchor(url: string): string | null {
    const m = url.match(/(#.*)$/);
    return m ? m[1] : null;
  }
  getParams(url: string): Record<string, string> | null {
    const m = url.match(/\?([\w_\-.=&]+)/);
    if (!m) return null;
    const parts = m[1].split("&");
    const out: Record<string, string> = {};
    for (let i = 0; i < parts.length; i++) {
      const kv = parts[i].split("=");
      out[kv[0]] = kv[1];
    }
    return out;
  }
  getLocation(url: string): RouterLocation {
    return {
      href: url,
      anchor: this.getAnchor(url),
      origin: this.getOrigin(url),
      params: this.getParams(url),
      pathname: this.getPathname(url),
    };
  }
  getRenderer(slug: string): Promise<RendererClass> {
    return Promise.resolve(slug in RENDERERS ? RENDERERS[slug] : (Renderer as RendererClass));
  }
  getTransition(slug: string): PageProperties["transition"] {
    // Highway: `slug in transitions` else `default` (no view slug is a transitions key).
    return slug in TRANSITIONS && slug !== "contextual"
      ? { class: (TRANSITIONS as any)[slug], name: slug }
      : { class: TRANSITIONS.default, name: "default" };
  }
  getProperties(view: HTMLElement, pathname: string): PageProperties {
    const slug = view.getAttribute("data-router-view") as string;
    return {
      page: { title: document.title, body: { className: bodyClassFor(pathname, view) } },
      view,
      slug,
      renderer: this.getRenderer(slug),
      transition: this.getTransition(slug),
    };
  }
}

// ---- popstate hold -------------------------------------------------------------------------------
let nativeStateGetter: ((this: PopStateEvent) => any) | null = null;
function holdNativePopState() {
  if (nativeStateGetter) return;
  const desc = Object.getOwnPropertyDescriptor(PopStateEvent.prototype, "state");
  if (!desc || !desc.get) return;
  nativeStateGetter = desc.get as (this: PopStateEvent) => any;
  const getter = nativeStateGetter;
  Object.defineProperty(PopStateEvent.prototype, "state", {
    configurable: true,
    enumerable: desc.enumerable,
    get(this: PopStateEvent) {
      return this.isTrusted ? null : getter.call(this);
    },
  });
}
function realPopState(e: PopStateEvent) {
  return nativeStateGetter ? nativeStateGetter.call(e) : e.state;
}

function wrapper(): HTMLElement {
  return document.querySelector("[data-router-wrapper]") as HTMLElement;
}

/** Live views in the wrapper (ones a transition already "removed" are skipped). */
function liveViews(): HTMLElement[] {
  const wrap = wrapper();
  if (!wrap) return [];
  return Array.prototype.filter.call(
    wrap.children,
    (el: Element) => el.hasAttribute("data-router-view") && !el.hasAttribute("data-router-removed"),
  ) as HTMLElement[];
}

type Listener = (...args: any[]) => void;

export interface RouterOptions {
  /** Only when boot did not construct the managers (see renderers/base.ts `EngineFactory`). */
  constructManagers?: EngineFactory;
}

export class Router {
  Helpers = new Helpers();
  Transitions = TRANSITIONS;
  Contextual: Transition | false = false;
  location: RouterLocation;
  properties: PageProperties;
  popping = false;
  running = false;
  trigger: Trigger = null;
  cache = new Map<string, PageProperties>();
  cached = false;
  firstLoad = false;
  From!: Renderer;
  To: Renderer | undefined;
  router: Record<string, ContextualRoute[]> = {};

  private listeners: Record<string, Listener[]> = {};
  /** state of the popstate event held back from Next while the out transition runs */
  private popEventState: any = null;
  private replayingPop = false;
  private pendingPop = false;
  /** pathname of the view on screen; `window.location` has already moved on a popstate */
  private fromPath = "/";

  constructor({ constructManagers }: RouterOptions = {}) {
    if (constructManagers) setEngineFactory(constructManagers);
    store.Highway = this;

    this.location = this.Helpers.getLocation(window.location.href);
    this.fromPath = this.location.pathname;
    const view = liveViews().pop() as HTMLElement;
    this.properties = this.Helpers.getProperties(view, this.location.pathname);
    this.cache.set(this.location.href, this.properties);
    this.properties.renderer.then((R) => {
      this.From = new R(this.properties);
      this.From.setup();
    });

    // Next's popstate listener is registered first (AppRouter effect) and React flushes popstate
    // renders synchronously, so listener order cannot hold it back. Instead, trusted popstate events
    // report `state: null` to page code (Next's handler then returns early) and the router replays the
    // real state to Next with a synthetic event once the out transition is done.
    holdNativePopState();
    window.addEventListener("popstate", this.onPopStateCapture, true);
    document.addEventListener("click", this.onDocumentClick);

    for (const [from, to, name] of CONTEXTUAL_ROUTES) this.addContextualRoute(from, to, name);

    this.cached = false;
    this.on("NAVIGATE_IN", this.onNavigateIn);
    this.on("NAVIGATE_END", this.onNavigateEnd);
    this.onNavigateIn({ to: false, location: window.location });
    // First load: the layout's pre-paint script applied the route's body class; a view-level
    // `data-body-class` (project light mode) is only known here.
    if (view && view.hasAttribute("data-body-class")) {
      document.body.className = this.properties.page.body.className;
      if (store.isTouch) document.body.classList.add("is-touch");
    }
  }

  // ---- TinyEmitter ----------------------------------------------------------------------------
  on(name: string, fn: Listener) {
    (this.listeners[name] || (this.listeners[name] = [])).push(fn);
    return this;
  }
  off(name: string, fn?: Listener) {
    const list = this.listeners[name];
    if (list && fn) this.listeners[name] = list.filter((l) => l !== fn);
    else delete this.listeners[name];
    return this;
  }
  emit(name: string, ...args: any[]) {
    const list = (this.listeners[name] || []).slice();
    for (let i = 0; i < list.length; i++) list[i].apply(this, args);
    return this;
  }

  // ---- Router (Uo) ------------------------------------------------------------------------------
  onNavigateIn = ({ to }: { to: any; location?: any }) => {
    if (to) document.body.className = to.page.body.className;
    if (store.isTouch) document.body.classList.add("is-touch");
  };


  onNavigateEnd = () => {};

  addContextualRoute(from: string, toPattern: string, transition: TransitionName) {
    if (!this.router) this.router = {};
    if (!this.router[from]) this.router[from] = [];
    this.router[from].push({ toPattern, transition });
  }

  getContextualFromRouter(fromPath: string, toPath: string) {
    const name = matchContextualRoute(this.router, fromPath, toPath);
    if (name) this.Contextual = contextualTransition(name);
  }

  private onDocumentClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    const link = target && typeof target.closest === "function" ? (target.closest("a") as HTMLAnchorElement | null) : null;
    if (!link || !link.matches(LINK_SELECTOR)) return;
    this.navigate(e, link);
  };

  navigate(e: MouseEvent, link: HTMLAnchorElement) {
    if (!e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const name = link.hasAttribute("data-transition") ? (link.dataset.transition as TransitionName) : false;
      if (this.redirect(link.href, name, link)) this.popping = true;
    }
  }

  /** Programmatic navigation with an optional named transition. */
  redirect(url: string, transition: TransitionName | false = false, trigger: Trigger = "script"): boolean {
    const href = new URL(url, window.location.href).href;
    this.trigger = trigger;
    if (this.running || href === this.location.href) return false;
    const loc = this.Helpers.getLocation(href);
    this.Contextual = false;
    if (transition) this.Contextual = contextualTransition(transition);
    if (loc.origin !== this.location.origin || (loc.anchor && loc.pathname === this.location.pathname))
      window.location.href = href;
    else {
      this.location = loc;
      this.beforeFetch();
    }
    return true;
  }

  private onPopStateCapture = (e: PopStateEvent) => {
    if (this.replayingPop) return; // our own replay: let Next's handler run
    e.stopImmediatePropagation();
    this.popState(realPopState(e));
  };

  popState(state: any): boolean | void {
    // Replay back/forward navigation after the current transition to preserve Next history state.
    if (this.popping || this.running) {
      this.pendingPop = true;
      return false;
    }
    this.trigger = "popstate";
    this.Contextual = false;
    const loc = this.Helpers.getLocation(window.location.href);
    this.getContextualFromRouter(this.location.pathname, loc.pathname);
    if (this.location.pathname !== loc.pathname || (!this.location.anchor && !loc.anchor)) {
      this.popping = true;
      this.location = loc;
      this.popEventState = state;
      this.beforeFetch();
    } else this.location = loc;
  }

  async beforeFetch() {
    const from = this.From?.properties ? this.fromPath : this.Helpers.getLocation(window.location.href).pathname;
    try {
      await this.transit(from);
    } catch (error) {
      // A transition that throws used to leave `running` set for good, which killed every later
      // click. Highway's answer to a failed navigation is a hard load; same here.
      console.error("[router] transition failed, loading the page instead", error);
      this.running = this.popping = false;
      window.location.href = this.location.href;
    }
  }

  private async transit(from: string) {
    // React-side layers (the world, the command dock) follow these instead of the pathname, which
    // only changes once the out transition is over.
    const detail = { from, to: this.location.pathname };
    window.dispatchEvent(new CustomEvent("hyper:navigate-out", { detail }));
    document.documentElement.dataset.navigating = this.location.pathname;
    if (this.Contextual === false)
      this.getContextualFromRouter(
        this.Helpers.getLocation(window.location.href).pathname,
        this.location.pathname,
      );

    // ---- Highway Core.beforeFetch ----
    const traverse = this.trigger === "popstate";
    this.running = true;
    this.emit("NAVIGATE_OUT", {
      from: { page: this.From.properties.page, view: this.From.properties.view },
      trigger: this.trigger,
      location: this.location,
    });
    const args = { trigger: this.trigger, contextual: this.Contextual };
    const oldView = this.From.properties.view;
    // Highway fetched in parallel with the out transition; warm Next's cache the same way.
    if (!traverse && !this.cache.has(this.location.href)) {
      try {
        nextRouter()?.prefetch?.(this.location.href);
      } catch {
        /* prefetch is best effort */
      }
    }
    // Bounded: the out transitions are GSAP timelines, and GSAP's ticker is rAF-driven, so a
    // tab that is backgrounded mid-navigation never advances them. Without a cap this await
    // never returns, `running` stays true, and every later navigation is refused for the life
    // of the page -- the URL is already committed to data-navigating by then, so the router
    // would sit half-navigated. Proceed once the animation has had its time.
    await Promise.race([
      this.From.hide(args),
      new Promise<void>(resolve => setTimeout(resolve, OUT_TRANSITION_CAP_MS)),
    ]);
    this.navigateNext(traverse);
    const view = await this.waitForView(oldView, traverse);
    this.properties = this.Helpers.getProperties(view, this.location.pathname);
    this.cache.set(this.location.href, this.properties);
    await this.afterFetch();
  }

  async afterFetch() {
    const R = await this.properties.renderer;
    this.To = new R(this.properties);
    this.To.add();
    this.emit("NAVIGATE_IN", {
      to: { page: this.To.properties.page, view: this.To.wrap.lastElementChild },
      trigger: this.trigger,
      location: this.location,
    });
    await this.To.show({ trigger: this.trigger, contextual: this.Contextual });
    this.popping = false;
    this.running = false;
    this.emit("NAVIGATE_END", {
      to: { page: this.To.properties.page, view: this.To.wrap.lastElementChild },
      from: { page: this.From.properties.page, view: this.From.properties.view },
      trigger: this.trigger,
      location: this.location,
    });
    this.From = this.To;
    this.trigger = null;
    delete document.documentElement.dataset.navigating;
    window.dispatchEvent(new CustomEvent("hyper:navigate-end", { detail: { from: this.fromPath, to: this.location.pathname } }));
    this.fromPath = this.location.pathname;

    if (this.pendingPop) {
      this.pendingPop = false;
      if (window.location.href !== this.location.href) this.popState(window.history.state);
    }
  }

  /** Hand the navigation to Next once the out transition is done. */
  private navigateNext(traverse: boolean) {
    const href = this.location.href;
    if (traverse) {
      this.replayingPop = true;
      try {
        window.dispatchEvent(new PopStateEvent("popstate", { state: this.popEventState }));
      } finally {
        this.replayingPop = false;
        this.popEventState = null;
      }
      return;
    }
    const r = nextRouter();
    if (r) r.push(href, { scroll: false });
    else window.location.href = href;
  }

  /** Resolves with the newly mounted view (Highway's `To.add()` point). */
  private waitForView(oldView: HTMLElement, traverse: boolean): Promise<HTMLElement> {
    const target = new URL(this.location.href);
    const started = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const views = liveViews();
        const fresh = views.filter((v) => v !== oldView).pop();
        if (fresh && !oldView.isConnected) return resolve(fresh);
        if (fresh && oldView.hasAttribute("data-router-removed")) return resolve(fresh);
        // Same component re-rendered in place (no remount): the url is committed but the node is old.
        if (
          !fresh &&
          !traverse &&
          oldView.isConnected &&
          window.location.pathname === target.pathname &&
          performance.now() - started > 100
        ) {
          oldView.style.removeProperty("display");
          oldView.removeAttribute("data-router-removed");
          return resolve(oldView);
        }
        // Highway hard-navigates when the fetch fails; same if Next never commits.
        if (performance.now() - started > VIEW_WAIT_CAP_MS) {
          window.location.href = this.location.href;
          return;
        }
        // setTimeout, not requestAnimationFrame: rAF is throttled to a standstill in a
        // background tab, so a cap checked inside an rAF callback is never evaluated there.
        // This poll and its own deadline then both stop, `running` stays true, and the router
        // is wedged for the life of the page. A timer keeps running when the tab is hidden.
        setTimeout(tick, 16);
      };
      tick();
    });
  }

  destroy() {
    window.removeEventListener("popstate", this.onPopStateCapture, true);
    document.removeEventListener("click", this.onDocumentClick);
  }
}

export default Router;
