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

export default function RelicExperience({ station, register, frameBounds, onMotion, onClose, still, fallback }: {
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
      const focus = window.setTimeout(() => heading.current?.focus({ preventScroll: true }), still || fallback ? 0 : 900);
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
      const canvas = frameBounds();
      if (!element || !canvas) return;
      const raw = latest.current.still || latest.current.fallback ? Number(latest.current.active) : clamp((frame.progress - .24) / .65);
      const amount = raw * raw * (3 - 2 * raw);
      if (!latest.current.active && amount < .001) { setShown(null); return; }
      element.style.opacity = String(clamp(amount * 1.8));
      element.style.visibility = amount > .001 ? "visible" : "hidden";
      element.style.pointerEvents = latest.current.active && amount > .7 ? "auto" : "none";
      if (amount > .999) { element.style.transform = "none"; return; }
      const x = canvas.left + frame.center.x * canvas.width;
      const y = canvas.top + frame.center.y * canvas.height;
      const dx = x - (element.offsetLeft + element.offsetWidth / 2);
      const dy = y - (element.offsetTop + element.offsetHeight / 2);
      const scale = Math.max(.22, Math.min(.65, frame.reach * canvas.height * 1.7 / Math.max(1, element.offsetHeight)));
      const tilt = element.dataset.kind === "cases" ? -42 : element.dataset.kind === "identity" ? 32 : 0;
      element.style.transform = `translate3d(${dx * (1 - amount)}px,${dy * (1 - amount)}px,0) perspective(1200px) rotateY(${tilt * (1 - amount)}deg) rotateX(${element.dataset.kind === "benchmarks" ? 22 * (1 - amount) : 0}deg) scale(${scale + (1 - scale) * amount})`;
    };
    register(handle);
    return () => register(null);
  }, [register, frameBounds, shown?.id]);

  const section = shown?.section;
  if (!shown || !section) return null;
  return <section ref={root} className={styles.experience} data-kind={section} data-fallback={fallback || undefined} data-closing={!active || undefined}
    aria-label={`${shown.label} workspace`} inert={!active} aria-hidden={!active || undefined}
    style={fallback ? { opacity: 1, visibility: "visible", transform: "none" } : undefined}
    onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header className={styles.heading}>
      <div><span>{section === "cases" ? "The folio" : section === "identity" ? "The prism" : "The landscape"}</span><h2 ref={heading} tabIndex={-1}>{shown.label}</h2></div>
      <button type="button" onClick={onClose} aria-label={`Close ${shown.label}`}><span aria-hidden="true">↙</span> Back to atrium</button>
    </header>
    <div className={styles.content}>
      {section === "cases" && <AccountsFolio active={active} onMotion={onMotion} />}
      {section === "identity" && <IdentityPrism active={active} onMotion={onMotion} />}
      {section === "benchmarks" && <BenchmarkLandscape active={active} onMotion={onMotion} />}
    </div>
    <span className={styles.escape}>Esc to return to the room</span>
  </section>;
}
