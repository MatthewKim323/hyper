"use client";

// Small links on the landing: source, white paper, docs. They wait for the intro to hand off to
// the scene, and leave with the landing when a route transition starts.
import { useEffect, useState } from "react";
import { store } from "@/lib/engine/core/store";

const LINKS = [
  { label: "GitHub", href: "https://github.com/MatthewKim323/hyper." },
  { label: "White paper", href: "/hyper-whitepaper.pdf" },
  { label: "Docs", href: "https://github.com/MatthewKim323/hyper./blob/main/INTEGRATION.md" },
];

export default function HomeLinks() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    // The engine boots after hydration, so its loader may not exist yet.
    const wait = window.setInterval(() => {
      const loader = store.PageLoader;
      if (!loader) return;
      clearInterval(wait);
      void (loader.hiddenPromise as Promise<void>).then(() => { if (active) setReady(true); });
    }, 100);
    return () => { active = false; clearInterval(wait); };
  }, []);

  return <nav className="home-links" data-ready={ready || undefined} aria-label="Project links">
    {LINKS.map(link => <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" data-cursor="hide">
      {link.label}
      <svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 8 8 2M3.5 2H8v4.5" /></svg>
    </a>)}
  </nav>;
}
