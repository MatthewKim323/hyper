"use client";

import { useEffect, useRef, useState } from "react";
import AccountsFolio from "./workspaces/AccountsFolio";
import BenchmarkLandscape from "./workspaces/BenchmarkLandscape";
import IdentityPrism from "./workspaces/IdentityPrism";
import type { AtriumStation } from "./configuration";
import type { FocusFrame } from "./scene";
import styles from "./RelicExperience.module.css";

export type RelicMotionState = { busy?: boolean; selectedIndex?: number; values?: readonly (number | null)[] };
export type ExperienceHandle = (frame: FocusFrame) => void;
export const EXPERIENCE_SECTIONS = new Set(["cases", "identity", "benchmarks"]);
const clamp = (n: number) => Math.min(1, Math.max(0, n));

export default function RelicExperience({ station, register, onMotion, onClose, still, fallback }: {
  station: AtriumStation | null;
  register: (handle: ExperienceHandle | null) => void;
  frameBounds: () => DOMRect | undefined;
  onMotion: (state: RelicMotionState) => void;
  onClose: () => void;
  still: boolean;
  fallback: boolean;
}) {
  const [shown, setShown] = useState(station);
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const latest = useRef({ active: !!station, still, fallback });
  const active = !!station;
  if (station && station.id !== shown?.id) setShown(station);

  useEffect(() => {
    latest.current = { active, still, fallback };
    if (active) {
      const focus = window.setTimeout(() => heading.current?.focus({ preventScroll: true }), still || fallback ? 0 : 1000);
      return () => clearTimeout(focus);
    }
    if (still || fallback) { const timer = setTimeout(() => setShown(null), 0); return () => clearTimeout(timer); }
    // The camera supplies the normal completion. This also cleans up if WebGL stops mid-flight.
    const timer = setTimeout(() => setShown(null), 15000);
    return () => clearTimeout(timer);
  }, [active, station?.id, still, fallback]);

  useEffect(() => {
    const handle: ExperienceHandle = frame => {
      const element = root.current;
      if (!element) return;
      if (!latest.current.active && frame.progress < .01) { setShown(null); return; }
      const instant = latest.current.still || latest.current.fallback;
      const amount = instant ? Number(latest.current.active) : clamp((frame.progress - .42) / .48);
      const reveal = amount * amount * (3 - 2 * amount);
      element.style.setProperty("--reveal", String(reveal));
      element.style.setProperty("--reveal-y", `${(1-reveal)*12}px`);
      element.style.opacity = String(instant ? 1 : clamp((frame.progress - .25) / .30));
      element.style.visibility = frame.progress > .25 || instant ? "visible" : "hidden";
      element.style.pointerEvents = latest.current.active && reveal > .7 ? "auto" : "none";
    };
    register(handle);
    return () => register(null);
  }, [register, shown?.id]);

  const section = shown?.section;
  if (!shown || !section) return null;
  return <section ref={root} className={styles.experience} data-kind={section} data-fallback={fallback || undefined} data-closing={!active || undefined}
    aria-label={`${shown.label} workspace`} inert={!active} aria-hidden={!active || undefined}
    style={fallback ? { opacity: 1, visibility: "visible" } : undefined}
    onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header className={styles.heading}>
      <div><span>{section === "cases" ? "SOURCE RECORDS" : section === "identity" ? "YOUR WORKSPACE" : "FRAMEWORK PERFORMANCE"}</span><h2 ref={heading} tabIndex={-1}>{shown.label}</h2></div>
      <button type="button" onClick={onClose} aria-label={`Close ${shown.label}`}><span aria-hidden="true">[</span> Close <span aria-hidden="true">]</span></button>
    </header>
    <div className={styles.content}>
      {section === "cases" && <AccountsFolio active={active} onMotion={onMotion} />}
      {section === "identity" && <IdentityPrism active={active} onMotion={onMotion} />}
      {section === "benchmarks" && <BenchmarkLandscape active={active} onMotion={onMotion} />}
    </div>
    <footer className={styles.footer}><span>Esc to return to the atrium</span></footer>
  </section>;
}
