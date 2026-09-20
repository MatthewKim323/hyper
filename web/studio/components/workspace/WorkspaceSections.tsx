"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { openSignIn } from "@/lib/backend/auth";
import { Activity, OverviewStrip } from "./sections";
import { useAuth } from "./useBackend";

const EXIT_MS = 420;
const SCREENS = { activity: Activity } as const;
type Screen = keyof typeof SCREENS;

export default function WorkspaceSections() {
  const pathname = usePathname();
  const auth = useAuth();
  const [section, setSection] = useState("overview");
  const [unlocked, setUnlocked] = useState(false);
  // The panel outlives its section by one exit animation, so closing is a motion, not a cut.
  const [shown, setShown] = useState<{ section: string; leaving: boolean } | null>(null);

  useEffect(() => {
    let exit = 0;
    const onSection = (event: Event) => {
      const next = (event as CustomEvent<{ section: string }>).detail?.section ?? "overview";
      setSection(next);
      clearTimeout(exit);
      if (next in SCREENS) { setShown({ section: next, leaving: false }); return; }
      setShown(previous => previous ? { ...previous, leaving: true } : null);
      exit = window.setTimeout(() => setShown(null), EXIT_MS);
    };
    // Workspace access starts when onboarding hands off to the atrium.
    const sync = () => setUnlocked(document.documentElement.dataset.onboarding === "complete");
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-onboarding"] });
    sync();
    window.addEventListener("hyper:section-change", onSection);
    return () => { clearTimeout(exit); observer.disconnect(); window.removeEventListener("hyper:section-change", onSection); };
  }, []);

  if (pathname !== "/projects" || !unlocked) return null;
  const usable = auth.ready && auth.signedIn;
  if (!shown) return section === "overview" && usable ? <OverviewStrip active /> : null;
  const Body = SCREENS[shown.section as Screen];

  return <main className="workspace bench-tokens" aria-label={shown.section} data-section={shown.section} data-leaving={shown.leaving || undefined} inert={shown.leaving}>
    <div className="ws-content">
      <button type="button" className="ws-back" onClick={() => window.dispatchEvent(new CustomEvent("hyper:navigate-section", { detail: { section: "overview" } }))}>← Back to the atrium</button>
      {usable ? <Body active={!shown.leaving} /> : <section className="ws-gate">
        <span className="ws-eyebrow">{shown.section}</span>
        {auth.mode === "unconfigured"
          ? <><h2>Sign-in is not set up yet.</h2><p>This screen reads your organization&apos;s data, which needs a login. Set <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> for Clerk, or run the keyless local backend described in <code>lib/backend/README.md</code>.</p></>
          : !auth.ready ? <h2>Checking your sign-in…</h2>
          : <><h2>Sign in to open your workspace.</h2><p>Your cases, evidence and decisions belong to your organization, so they load after you sign in.</p><button type="button" onClick={() => void openSignIn()}>Sign in</button></>}
      </section>}
    </div>
  </main>;
}
