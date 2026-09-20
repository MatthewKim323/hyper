"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getAuthState, openSignIn, signOut } from "@/lib/backend/auth";
import { store as storeRaw } from "@/lib/engine/core/store";
import { ONBOARDING_PATH, WORLD_PATH } from "@/lib/engine/router/routes";
import { isOnboardingComplete } from "@/lib/onboarding/interface";
import { useAuth } from "./useBackend";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store: any = storeRaw;
const PROTECTED = new Set<string>([ONBOARDING_PATH, WORLD_PATH]);
const isWorkspaceLink = (target: EventTarget | null) => {
  const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
  return !!link && PROTECTED.has(new URL(link.href, location.href).pathname.replace(/\/+$/, ""));
};

/**
 * Sign-in flow for Clerk. Everyone lands on the main page first. Pressing Enter while signed out
 * opens sign-in instead of leaving the page, and the normal transition runs once they are in.
 * The keyless dev token needs none of this.
 */
export default function SignInGate() {
  const pathname = usePathname();
  const auth = useAuth();
  const wasSignedIn = useRef(false);
  const wantsWorkspace = useRef(false);

  useEffect(() => {
    // Capture phase, so this runs before the engine's router takes the click.
    const onClick = (event: MouseEvent) => {
      const state = getAuthState();
      if (state.mode !== "clerk" || state.signedIn || !isWorkspaceLink(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      wantsWorkspace.current = true;
      void openSignIn();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (auth.signedIn && !wasSignedIn.current) {
      // The voice session's owner reconnects on "online"; reuse that after a sign-in on a product route.
      window.dispatchEvent(new Event("online"));
      // Someone who has already onboarded goes straight to the world. Sending them to
      // /onboarding instead made OnboardingWorkspace bounce them with location.replace,
      // a full reload that tears down the WebGL context and replays the whole loader.
      if (wantsWorkspace.current && !PROTECTED.has(pathname))
        store.Highway?.redirect?.(isOnboardingComplete() ? WORLD_PATH : ONBOARDING_PATH, "toProjectMenu");
      wantsWorkspace.current = false;
    }
    wasSignedIn.current = auth.signedIn;
  }, [auth.signedIn, pathname]);

  useEffect(() => {
    // A signed-out visit straight to the workspace goes back to the main page.
    if (auth.mode === "clerk" && auth.ready && !auth.signedIn && PROTECTED.has(pathname)) location.replace("/");
  }, [auth.mode, auth.ready, auth.signedIn, pathname]);

  if (!PROTECTED.has(pathname) || auth.mode !== "clerk" || !auth.signedIn) return null;
  return <button type="button" className="ws-account" onClick={() => void signOut().then(() => location.replace("/"))}>Sign out</button>;
}
