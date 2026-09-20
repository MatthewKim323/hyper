"use client";

// One clock for "where am I".
//
// There were three, and they disagreed for the length of an out transition (3 s):
//
//   usePathname()        Next commits the new path when the navigation STARTS. The engine
//                        runs From.hide() before that (router.ts), so for the whole blend
//                        React believed it was on the new route while the old scene was
//                        still on screen.
//   hyper:navigate-out   also the start, with both endpoints in its detail.
//   hyper:navigate-end   the finish.
//
// Seven components read the first, two read the third, and every "hold this open until the
// transition ends" flag was somebody hand-reconciling the difference for one component. This
// module makes that reconciliation the library's job: `route` is the settled route, and
// `phase` says whether a transition is in flight and where it is going.
import { useSyncExternalStore } from "react";

export type NavigationPhase = "settled" | "leaving";

export type NavigationState = {
  /** The route whose scene is on screen. Only changes once a transition has finished. */
  route: string;
  /** Where a transition in flight is heading. Equal to `route` when settled. */
  target: string;
  phase: NavigationPhase;
};

/** Trailing slashes are how the engine's route table spells things; strip for comparison. */
export function normalize(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

// A navigation that never finishes must not strand the app mid-transition: the out
// transitions are GSAP timelines and GSAP's ticker is rAF-driven, so a tab hidden mid-flight
// never advances them. Slightly longer than the router's own cap on the same await.
const SETTLE_CAP_MS = 6000;

let state: NavigationState = { route: "/", target: "/", phase: "settled" };
const listeners = new Set<() => void>();
let settleTimer = 0;
let started = false;

function publish(next: NavigationState) {
  if (next.route === state.route && next.target === state.target && next.phase === state.phase) return;
  state = next;
  listeners.forEach(listener => listener());
}

function settle(route: string) {
  clearTimeout(settleTimer);
  settleTimer = 0;
  publish({ route, target: route, phase: "settled" });
}

/** Idempotent; the first subscriber starts it and it then runs for the page's lifetime. */
function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  state = { route: normalize(location.pathname), target: normalize(location.pathname), phase: "settled" };
  listen(window);
}

/** The event wiring, separated so tests can drive it without a DOM. */
export function listen(target: Pick<Window, "addEventListener">) {
  target.addEventListener("hyper:navigate-out", event => {
    const detail = (event as CustomEvent<{ from?: string; to?: string }>).detail ?? {};
    const from = normalize(detail.from ?? state.route);
    const to = normalize(detail.to ?? state.target);
    if (from === to) return;
    publish({ route: from, target: to, phase: "leaving" });
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => settle(to), SETTLE_CAP_MS) as unknown as number;
  });

  target.addEventListener("hyper:navigate-end", event => {
    const detail = (event as CustomEvent<{ to?: string }>).detail ?? {};
    settle(normalize(detail.to ?? state.target));
  });

  // Anything that moves the URL without the engine (history.replaceState in the onboarding
  // handoff, a hard location.replace) still has to be reflected.
  target.addEventListener("popstate", () => {
    if (typeof location !== "undefined") settle(normalize(location.pathname));
  });
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const snapshot = () => state;
const SERVER: NavigationState = { route: "/", target: "/", phase: "settled" };
const serverSnapshot = () => SERVER;

/** The settled route and any transition in flight. Prefer this over usePathname(). */
export function useNavigation(): NavigationState {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * True while the given route's scene owns the screen: it is settled there, or a transition
 * away from it is still running. This is the question nearly every caller actually has, and
 * answering it from `usePathname()` alone is what made the world vanish mid-blend.
 */
export function useOwnsScreen(route: string): boolean {
  const navigation = useNavigation();
  const target = normalize(route);
  return navigation.route === target;
}

/** Non-React readers (engine code, transitions) need the same answer. */
export function navigationState(): NavigationState {
  start();
  return state;
}

/** Test seam: reset module state between cases. */
export function resetNavigationForTests(route = "/") {
  clearTimeout(settleTimer);
  settleTimer = 0;
  state = { route, target: route, phase: "settled" };
  listeners.forEach(listener => listener());
}
