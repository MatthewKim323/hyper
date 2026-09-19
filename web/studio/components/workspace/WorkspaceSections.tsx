"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { openSignIn } from "@/lib/backend/auth";
import { Activity, Cases, Evidence, OverviewStrip, Review } from "./sections";
import { useAuth } from "./useBackend";

const SCREENS = { cases: Cases, evidence: Evidence, activity: Activity, review: Review } as const;
type Screen = keyof typeof SCREENS;

export default function WorkspaceSections() {
  const pathname = usePathname();
  const auth = useAuth();
  const [section, setSection] = useState("overview");
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    const onSection = (event: Event) => setSection((event as CustomEvent<{ section: string }>).detail?.section ?? "overview");
    // The section pills are inert until onboarding hands off, so mirror that here.
    const sync = () => setUnlocked(document.documentElement.dataset.onboarding === "complete");
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-onboarding"] });
    sync();
    window.addEventListener("hyper:section-change", onSection);
    return () => { observer.disconnect(); window.removeEventListener("hyper:section-change", onSection); };
  }, []);

  if (pathname !== "/projects" || !unlocked) return null;
  const Body = SCREENS[section as Screen];
  const usable = auth.ready && auth.signedIn;
  if (!Body) return section === "overview" && usable ? <OverviewStrip active /> : null;

  return <main className="workspace bench-tokens" aria-label={section}>
    <div className="ws-content">
      <button type="button" className="ws-back" onClick={() => window.dispatchEvent(new CustomEvent("hyper:navigate-section", { detail: { section: "overview" } }))}>← Back to the atrium</button>
      {usable ? <Body active /> : <section className="ws-gate">
        <span className="ws-eyebrow">{section}</span>
        {auth.mode === "unconfigured"
          ? <><h2>Sign-in is not set up yet.</h2><p>This screen reads your organization&apos;s data, which needs a login. Set <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> for Clerk, or run the keyless local backend described in <code>lib/backend/README.md</code>.</p></>
          : !auth.ready ? <h2>Checking your sign-in…</h2>
          : <><h2>Sign in to open your workspace.</h2><p>Your cases, evidence and decisions belong to your organization, so they load after you sign in.</p><button type="button" onClick={() => void openSignIn()}>Sign in</button></>}
      </section>}
    </div>
  </main>;
}
