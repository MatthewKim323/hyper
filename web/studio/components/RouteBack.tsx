"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import gsap from "gsap";
import { ONBOARDING_PATH, WORLD_PATH } from "@/lib/engine/router/routes";

// Where each route's back control goes. Plain hrefs, so the engine router picks them up
// through LINK_SELECTOR and runs the normal contextual transition; history.back() would
// dead-end on a first visit, and these routes are reachable directly by URL.
const BACK: Record<string, { href: string; label: string }> = {
  [ONBOARDING_PATH]: { href: "/", label: "Back to the landing page" },
  [WORLD_PATH]: { href: "/", label: "Back to the landing page" },
};

const FADE_OUT = 0.28;
const FADE_IN = 0.45;
const RISE = 6;

/**
 * Route-level back link for the pages that have no other way out. The landing and contact
 * scenes are art-directed and already carry the header nav, so they are deliberately absent
 * here; the 404 page ships its own buttons.
 *
 * The element stays mounted for every route and GSAP drives its opacity, because unmounting
 * on a route change gives the exit nothing to animate. Two things hide it: leaving for a
 * route with no back link, and opening a workspace panel (which covers the page and carries
 * its own "Back to the atrium").
 */
export default function RouteBack() {
  const pathname = usePathname();
  const element = useRef<HTMLAnchorElement>(null);
  // The engine's pathname lags: it only updates once the out transition has finished, so the
  // fade follows hyper:navigate-out instead and `target` keeps the last real destination so
  // the label does not change mid-fade.
  const [leaving, setLeaving] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loaderCleared, setLoaderCleared] = useState(false);
  const target = BACK[pathname];
  // Keep the last real destination so the label and href do not change mid fade-out.
  // Committed in an effect, not during render: a render React discards would otherwise
  // leave this holding a value that was never shown.
  const last = useRef(target);
  const shown = !!target && !leaving && !panelOpen && loaderCleared;

  useEffect(() => {
    if (target) last.current = target;
  }, [target]);

  useEffect(() => {
    const onOut = (event: Event) => {
      const to = (event as CustomEvent<{ to?: string }>).detail?.to;
      setLeaving(!(to && BACK[to.replace(/\/+$/, "") || "/"]));
    };
    const onEnd = () => setLeaving(false);
    window.addEventListener("hyper:navigate-out", onOut);
    window.addEventListener("hyper:navigate-end", onEnd);
    return () => {
      window.removeEventListener("hyper:navigate-out", onOut);
      window.removeEventListener("hyper:navigate-end", onEnd);
    };
  }, []);

  // The loading layer covers the page until it has finished fading, so hold the first fade-in
  // until then rather than easing the link in behind it.
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.loaderCleared === "true") { setLoaderCleared(true); return; }
    const observer = new MutationObserver(() => {
      if (root.dataset.loaderCleared === "true") { setLoaderCleared(true); observer.disconnect(); }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-loader-cleared"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // "overview" is the atrium itself, so the route-level back belongs on screen there.
    const sync = () => {
      const section = document.body.dataset.workspaceSection;
      setPanelOpen(!!section && section !== "overview");
    };
    sync();
    window.addEventListener("hyper:section-change", sync);
    return () => window.removeEventListener("hyper:section-change", sync);
  }, []);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(node, { autoAlpha: shown ? 1 : 0, y: 0 });
      return;
    }
    const animation = gsap.to(node, {
      autoAlpha: shown ? 1 : 0,
      y: shown ? 0 : -RISE,
      duration: shown ? FADE_IN : FADE_OUT,
      ease: shown ? "power2.out" : "power2.in",
      overwrite: "auto",
    });
    return () => { animation.kill(); };
  }, [shown]);

  const label = (target ?? last.current)?.label ?? "Back";
  const href = (target ?? last.current)?.href ?? "/";
  return (
    <a
      ref={element}
      href={href}
      className="route-back"
      data-cursor="hide"
      aria-label={label}
      aria-hidden={!shown}
      tabIndex={shown ? undefined : -1}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 13 5 8l5-5" />
      </svg>
      <span>Back</span>
    </a>
  );
}
