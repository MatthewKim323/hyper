"use client";

// Small links on the landing: source, white paper, docs, and a one-click copy of the MCP
// config. They wait for the intro to hand off to the scene, and leave with the landing when a
// route transition starts.
import { useEffect, useRef, useState } from "react";
import { store } from "@/lib/engine/core/store";

const LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "GitHub", href: "https://github.com/MatthewKim323/hyper." },
  { label: "White paper", href: "/hyper-whitepaper.pdf" },
  { label: "Docs", href: "/docs", external: false },
];

// The shape nearly every MCP client takes. VS Code and Zed rename the outer key; the docs page
// covers those, and this is the one that works unedited in Claude Code, Codex, Cursor, Windsurf
// and Claude Desktop.
const MCP_CONFIG = JSON.stringify({
  mcpServers: {
    hyper: {
      command: "npx",
      args: ["-y", "@hyper/mcp"],
      env: { HYPER_TOKEN: "<your token from Access → Agent access>" },
    },
  },
}, null, 2);

const ARROW = <path d="M2 8 8 2M3.5 2H8v4.5" />;
const CHECK = <path d="M1.5 5.2 4 7.6 8.5 2.6" />;

export default function HomeLinks() {
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const revert = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    // The engine boots after hydration, so its loader may not exist yet.
    const wait = window.setInterval(() => {
      const loader = store.PageLoader;
      if (!loader) return;
      clearInterval(wait);
      void (loader.hiddenPromise as Promise<void>).then(() => { if (active) setReady(true); });
    }, 100);
    return () => { active = false; clearInterval(wait); window.clearTimeout(revert.current); };
  }, []);

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(MCP_CONFIG);
    } catch {
      // Clipboard access is denied outside a secure context or without focus. Fall back to the
      // docs page rather than leaving the button silently dead.
      window.open("/docs/mcp", "_blank", "noopener,noreferrer");
      return;
    }
    setCopied(true);
    window.clearTimeout(revert.current);
    revert.current = window.setTimeout(() => setCopied(false), 2000);
  }

  return <nav className="home-links" data-ready={ready || undefined} aria-label="Project links">
    {LINKS.map(link => <a key={link.label} href={link.href}
      {...(link.external === false ? { "data-router-disabled": "" } : { target: "_blank", rel: "noopener noreferrer" })}
      data-cursor="hide">
      {link.label}
      <Icon>{ARROW}</Icon>
    </a>)}
    <button type="button" onClick={copyConfig} data-cursor="hide" data-copied={copied || undefined}
      aria-label={copied ? "MCP configuration copied to clipboard" : "Copy MCP configuration to clipboard"}>
      {copied ? "Copied" : "Use your agent"}
      <Icon>{copied ? CHECK : ARROW}</Icon>
    </button>
  </nav>;
}

function Icon({ children }: { children: React.ReactNode }) {
  return <svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor"
    strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
