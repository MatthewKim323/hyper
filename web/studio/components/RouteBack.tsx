"use client";

import { usePathname } from "next/navigation";
import { ONBOARDING_PATH, WORLD_PATH } from "@/lib/engine/router/routes";

// Where each route's back control goes. Plain hrefs, so the engine router picks them up
// through LINK_SELECTOR and runs the normal contextual transition; history.back() would
// dead-end on a first visit, and these routes are reachable directly by URL.
const BACK: Record<string, { href: string; label: string }> = {
  [ONBOARDING_PATH]: { href: "/", label: "Back to the landing page" },
  [WORLD_PATH]: { href: "/", label: "Back to the landing page" },
};

/**
 * Route-level back link for the pages that have no other way out. The landing and contact
 * scenes are art-directed and already carry the header nav, so they are deliberately absent
 * here; the 404 page ships its own buttons.
 */
export default function RouteBack() {
  const pathname = usePathname();
  const target = BACK[pathname];
  if (!target) return null;
  return (
    <a href={target.href} className="route-back" data-cursor="hide" aria-label={target.label}>
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 13 5 8l5-5" />
      </svg>
      <span>Back</span>
    </a>
  );
}
