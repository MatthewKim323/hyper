"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { getAtriumStations, getDefaultAtriumStations, subscribeAtriumStations, type AtriumStation } from "./configuration";
import type { AtriumManifest, AtriumRenderer, StationBounds } from "./scene";
import { store } from "@/lib/engine/core/store";
import styles from "./AtriumPreview.module.css";

const motionSnapshot = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const subscribeMotion = (update: () => void) => {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
};
const staticSnapshot = () => true;
const fineHover = (event: ReactPointerEvent) => event.pointerType !== "touch" && matchMedia("(hover: hover) and (pointer: fine)").matches;
const clampPointer = (value: number) => Math.max(-1, Math.min(1, value));

function openStation(station: AtriumStation) {
  if (station.section) window.dispatchEvent(new CustomEvent("hyper:navigate-section", { detail: { section: station.section } }));
  window.dispatchEvent(new CustomEvent("hyper:station-select", { detail: { station } }));
}

/**
 * `warm` mounts the whole world (download, decode, environment maps, shader compile, first frame)
 * without showing it or taking the gallery's renderer, so revealing it later costs nothing.
 * The same instance is kept when `warm` turns off; nothing reloads.
 */
export default function AtriumPreview({ warm = false }: { warm?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const renderer = useRef<AtriumRenderer | null>(null);
  const drag = useRef<{ pointerId: number; x: number; scrollLeft: number } | null>(null);
  const stations = useSyncExternalStore(subscribeAtriumStations, getAtriumStations, getDefaultAtriumStations);
  const stationsRef = useRef(stations);
  const [manifest, setManifest] = useState<AtriumManifest | null>(null);
  const [bounds, setBounds] = useState<StationBounds[]>([]);
  const [covered, setCovered] = useState(false);
  const [failed, setFailed] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot, staticSnapshot);
  const motionRef = useRef(reducedMotion);

  useEffect(() => {
    const menu = store.ProjectMenu;
    if (!menu || warm) return;
    const previousControl = menu.allowControl;
    const previousRendering = menu.renderPass?.enabled;
    let active = true;
    document.body.dataset.atriumActive = "true";
    const suspend = () => {
      if (!active) return;
      menu.allowControl = false;
      if (menu.renderPass) menu.renderPass.enabled = false;
    };
    suspend();
    // Run after the parent gate's handoff while keeping the cursor event loop alive.
    queueMicrotask(suspend);
    window.addEventListener("hyper:section-change", suspend);
    return () => {
      active = false;
      delete document.body.dataset.atriumActive;
      window.removeEventListener("hyper:section-change", suspend);
      if (store.ProjectMenu === menu) {
        menu.allowControl = previousControl;
        if (menu.renderPass && previousRendering !== undefined) menu.renderPass.enabled = previousRendering;
      }
    };
  }, [warm]);

  useEffect(() => {
    stationsRef.current = stations;
    void renderer.current?.setStations(stations).catch(() => {
      renderer.current?.dispose();
      renderer.current = null;
      setBounds([]);
      setFailed(true);
    });
  }, [stations]);

  useEffect(() => {
    // Hidden means paused: the scene still prepares its first frame, then stops drawing.
    motionRef.current = reducedMotion || warm;
    renderer.current?.setPaused(motionRef.current);
  }, [reducedMotion, warm]);

  useEffect(() => {
    const controller = new AbortController();
    const element = canvas.current;
    let active = true;
    let instance: AtriumRenderer | null = null;
    const update = () => {
      setCovered(["timeline", "benchmarks"].includes(document.body.dataset.workspaceSection ?? "overview"));
      renderer.current?.setHover(null);
      renderer.current?.setPressed(null);
    };
    const fail = () => {
      controller.abort();
      instance?.dispose();
      renderer.current = null;
      if (active) { setBounds([]); setFailed(true); }
    };
    update();
    window.addEventListener("hyper:section-change", update);
    element?.addEventListener("webglcontextlost", fail);
    const timeout = window.setTimeout(() => { fail(); controller.abort(); }, 45000);
    async function mount() {
      if (!element) return;
      try {
        const [{ createAtriumRenderer, isAtriumManifest }, response] = await Promise.all([
          import("./scene"),
          fetch("/assets/hyper-atrium/scene.json", { signal: controller.signal }),
        ]);
        if (!response.ok) throw new Error("Atrium manifest unavailable");
        const value: unknown = await response.json();
        if (!active) return;
        if (!isAtriumManifest(value)) throw new Error("Atrium manifest invalid");
        setManifest(value);
        instance = await createAtriumRenderer(element, value, next => { if (active) setBounds(next); }, controller.signal);
        if (!active || controller.signal.aborted) { instance.dispose(); return; }
        renderer.current = instance;
        instance.setPaused(motionRef.current);
        await instance.setStations(stationsRef.current);
        if (active && !controller.signal.aborted && renderer.current === instance) {
          setFailed(false);
          // The intro loader and the handoff both wait on this.
          document.documentElement.dataset.atriumReady = "true";
          window.dispatchEvent(new Event("hyper:atrium-ready"));
        }
      } catch (error) {
        if (process.env.NODE_ENV === "development") console.error("[atrium] Scene initialization failed", error);
        fail();
      }
      finally { clearTimeout(timeout); }
    }
    void mount();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
      instance?.dispose();
      renderer.current = null;
      element?.removeEventListener("webglcontextlost", fail);
      window.removeEventListener("hyper:section-change", update);
    };
  }, []);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const center = () => { element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2; };
    const wheel = (event: WheelEvent) => {
      event.stopPropagation();
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || element.scrollWidth <= element.clientWidth + 1) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1;
      element.scrollLeft += event.deltaY * unit;
    };
    const observer = new ResizeObserver(center);
    observer.observe(element);
    element.addEventListener("wheel", wheel, { passive: false });
    center();
    return () => { observer.disconnect(); element.removeEventListener("wheel", wheel); };
  }, [manifest]);

  function hoverStation(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (!fineHover(event)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    renderer.current?.setHover(id, clampPointer((event.clientX - rect.left) / rect.width * 2 - 1), clampPointer((event.clientY - rect.top) / rect.height * 2 - 1));
  }

  function releaseStation(event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.dataset.pressed = "false";
    renderer.current?.setPressed(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function releaseRoom(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.dataset.dragging = "false";
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const planeStyle = manifest ? { "--aspect": manifest.width / manifest.height } as CSSProperties : undefined;
  return <>
    <div ref={scroller} className={styles.atrium} data-warm={warm || undefined} aria-hidden={warm || undefined} inert={warm} role="region" aria-label="Hyper finance atrium" tabIndex={0}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const element = event.currentTarget;
        if (event.key === "Home") element.scrollLeft = 0;
        else if (event.key === "End") element.scrollLeft = element.scrollWidth;
        else element.scrollLeft += (event.key === "ArrowLeft" ? -1 : 1) * Math.max(180, element.clientWidth * 0.35);
      }}
      onPointerDown={event => {
        event.stopPropagation();
        if (event.pointerType !== "mouse" || event.button !== 0 || drag.current || (event.target as Element).closest("button, a, input")) return;
        if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth + 1) return;
        event.preventDefault();
        drag.current = { pointerId: event.pointerId, x: event.clientX, scrollLeft: event.currentTarget.scrollLeft };
        event.currentTarget.dataset.dragging = "true";
        event.currentTarget.setPointerCapture(event.pointerId);
        renderer.current?.setHover(null);
      }}
      onPointerMove={event => {
        if (drag.current?.pointerId === event.pointerId) {
          event.currentTarget.scrollLeft = drag.current.scrollLeft - (event.clientX - drag.current.x);
          return;
        }
        if (!fineHover(event)) return;
        const rect = plane.current?.getBoundingClientRect();
        if (rect) renderer.current?.setPointer(clampPointer((event.clientX - rect.left) / rect.width * 2 - 1), clampPointer((event.clientY - rect.top) / rect.height * 2 - 1));
      }}
      onPointerUp={releaseRoom}
      onPointerCancel={releaseRoom}
      onLostPointerCapture={releaseRoom}
      onPointerLeave={() => { renderer.current?.setHover(null); renderer.current?.setPointer(0, 0); }}
    >
      <div ref={plane} className={styles.plane} style={planeStyle}>
        <canvas ref={canvas} className={styles.water} aria-hidden="true" />
        {!covered && !failed && bounds.map(bound => <button
          type="button"
          key={bound.station.id}
          className={styles.hotspot}
          data-cursor="hide"
          aria-label={`Open ${bound.station.label}`}
          style={{ zIndex: 1000 - Math.round(bound.depth * 10), left: `${bound.left * 100}%`, top: `${bound.top * 100}%`, width: `${bound.width * 100}%`, height: `${bound.height * 100}%`, "--station-font": `${bound.fontWidth * 100}cqw` } as CSSProperties}
          onPointerEnter={event => hoverStation(event, bound.station.id)}
          onPointerMove={event => hoverStation(event, bound.station.id)}
          onPointerLeave={event => { renderer.current?.setHover(null); releaseStation(event); }}
          onPointerDown={event => {
            event.stopPropagation();
            if (!event.isPrimary || event.button !== 0) return;
            event.currentTarget.dataset.pressed = "true";
            event.currentTarget.setPointerCapture(event.pointerId);
            renderer.current?.setPressed(bound.station.id);
          }}
          onPointerUp={releaseStation}
          onPointerCancel={releaseStation}
          onLostPointerCapture={releaseStation}
          onFocus={event => { if (event.currentTarget.matches(":focus-visible")) renderer.current?.setHover(null); }}
          onBlur={() => { renderer.current?.setHover(null); renderer.current?.setPressed(null); }}
          onClick={event => { event.stopPropagation(); openStation(bound.station); }}
        >
          <span className={styles.label} style={{ left: `${bound.labelLeft * 100}%`, top: `${bound.labelTop * 100}%` }}>{bound.station.label === "Accounts Payable" ? <>Accounts<br />Payable</> : bound.station.label}</span>
          <span className={styles.arrow} aria-hidden="true" style={{ left: `${bound.labelLeft * 100}%`, top: `${bound.arrowTop * 100}%` }}><span className={styles.arrowGlyph}>→</span></span>
        </button>)}
      </div>
      <span className={styles.keyboardHint}>← → Explore the room</span>
    </div>
    {failed && !covered && !warm && <nav className={styles.fallback} aria-label="Workspace navigation">
      <span className={styles.fallbackNote} role="status">The 3D view is unavailable. Your workspaces are still here.</span>
      <div>{stations.map(station => <button type="button" key={station.id} data-cursor="hide" onClick={() => openStation(station)}>{station.label} <span aria-hidden="true">↗</span></button>)}</div>
    </nav>}
    {covered && !warm && <button type="button" className={styles.back} data-cursor="hide" onClick={() => window.dispatchEvent(new CustomEvent("hyper:navigate-section", { detail: { section: "overview" } }))}>← Back to atrium</button>}
  </>;
}
