"use client";

import ActivityOrb from "@/components/ui/ActivityOrb";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { getAtriumStations, getDefaultAtriumStations, subscribeAtriumStations, type AtriumStation } from "./configuration";
import type { AgentBounds, AtriumManifest, AtriumRenderer, FocusFrame, StationBounds } from "./scene";
import { store } from "@/lib/engine/core/store";
import RelicOrbit, { type OrbitHandle } from "./RelicOrbit";
import RelicExperience, { EXPERIENCE_SECTIONS, type ExperienceHandle, type RelicMotionState } from "./RelicExperience";
import { setWarmFrameProvider } from "./warm-frame";
import styles from "./AtriumPreview.module.css";
import { useRelicActivity } from "./useRelicActivity";
import type { RelicActivity, RelicActivityMap, RelicActivitySection } from "./relic-activity";

const motionSnapshot = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const subscribeMotion = (update: () => void) => {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
};
const staticSnapshot = () => true;
const fineHover = (event: ReactPointerEvent) => event.pointerType !== "touch" && matchMedia("(hover: hover) and (pointer: fine)").matches;
const clampPointer = (value: number) => Math.max(-1, Math.min(1, value));
const withinAgent = (element: HTMLButtonElement, x: number, y: number) => {
  const rect = element.getBoundingClientRect();
  const dx = (x - rect.left) / rect.width * 2 - 1;
  const dy = (y - rect.top) / rect.height * 2 - 1;
  return dx * dx + dy * dy <= 1;
};

// Sections that open beside their relic instead of covering the room.
const FOCUS_SECTIONS = new Set([...EXPERIENCE_SECTIONS, "activity"]);
const goHome = () => window.dispatchEvent(new CustomEvent("hyper:navigate-section", { detail: { section: "overview" } }));

function openStation(station: AtriumStation) {
  if (station.section) window.dispatchEvent(new CustomEvent("hyper:navigate-section", { detail: { section: station.section } }));
  window.dispatchEvent(new CustomEvent("hyper:station-select", { detail: { station } }));
}

/**
 * `warm` mounts the whole world (download, decode, environment maps, shader compile, first frame)
 * without showing it or taking the gallery's renderer, so revealing it later costs nothing.
 * The same instance is kept when `warm` turns off; nothing reloads.
 */
export default function AtriumPreview({ warm = false, live = true }: { warm?: boolean; live?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const renderer = useRef<AtriumRenderer | null>(null);
  const agentButton = useRef<HTMLButtonElement>(null);
  const agentInteraction = useRef({ hovered: false, focused: false, pressed: false, pointerId: null as number | null });
  const publishAgentInteraction = useCallback(() => {
    const interaction = agentInteraction.current;
    renderer.current?.setAgentInteraction({ hovered: interaction.hovered || interaction.focused, pressed: interaction.pressed });
  }, []);
  const resetAgentInteraction = useCallback(() => {
    const pointerId = agentInteraction.current.pointerId;
    agentInteraction.current = { hovered: false, focused: false, pressed: false, pointerId: null };
    if (pointerId !== null && agentButton.current?.hasPointerCapture(pointerId)) agentButton.current.releasePointerCapture(pointerId);
    publishAgentInteraction();
  }, [publishAgentInteraction]);
  const orbit = useRef<OrbitHandle | null>(null);
  const experience = useRef<ExperienceHandle | null>(null);
  const lastFocusFrame = useRef<FocusFrame | null>(null);
  const registerOrbit = useCallback((handle: OrbitHandle | null) => { orbit.current = handle; }, []);
  const registerExperience = useCallback((handle: ExperienceHandle | null) => {
    experience.current = handle;
    if (handle && lastFocusFrame.current) handle(lastFocusFrame.current);
  }, []);
  const drag = useRef<{ pointerId: number; x: number; scrollLeft: number } | null>(null);
  const stations = useSyncExternalStore(subscribeAtriumStations, getAtriumStations, getDefaultAtriumStations);
  const stationsRef = useRef(stations);
  // Read while still hidden, so the activity meshes exist (and their shaders are compiled) before the reveal.
  const { activities } = useRelicActivity(live);
  // Hidden means paused, except for short priming runs: the live path (animated relics, aura, activity
  // rings) has to draw a few real frames out of sight, or its programs compile on the first visible ones.
  const [priming, setPriming] = useState(false);
  const primeTimer = useRef(0);
  const prime = useCallback((ms: number) => {
    setPriming(true);
    clearTimeout(primeTimer.current);
    primeTimer.current = window.setTimeout(() => setPriming(false), ms);
  }, []);
  useEffect(() => () => clearTimeout(primeTimer.current), []);
  // The onboarding handoff runs the hidden world for real, so the wipe uncovers a moving room.
  const [handoffLive, setHandoffLive] = useState(false);
  useEffect(() => {
    const onLive = (event: Event) => setHandoffLive(Boolean((event as CustomEvent<{ live: boolean }>).detail?.live));
    window.addEventListener("hyper:world-live", onLive);
    return () => window.removeEventListener("hyper:world-live", onLive);
  }, []);
  const [preview, setPreview] = useState<Partial<RelicActivityMap> | null>(null);
  const activityStates = preview ?? activities;
  const activityRef = useRef(activityStates);
  const warmRef = useRef(warm);
  useEffect(() => { warmRef.current = warm; }, [warm]);
  useEffect(() => {
    activityRef.current = activityStates;
    stations.forEach(station => renderer.current?.setRelicActivity(station.id, activityStates[station.section as RelicActivitySection] ?? { status: "idle", label: "" }));
    if (warmRef.current && renderer.current && !motionSnapshot()) prime(800);
  }, [activityStates, stations, prime]);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !document.querySelector("[data-atrium-dev]")) return;
    const showPreview = (event: Event) => setPreview((event as CustomEvent<{ activities: Partial<RelicActivityMap> | null }>).detail.activities);
    window.addEventListener("hyper:relic-activity-preview", showPreview);
    return () => window.removeEventListener("hyper:relic-activity-preview", showPreview);
  }, []);
  const [manifest, setManifest] = useState<AtriumManifest | null>(null);
  const [bounds, setBounds] = useState<StationBounds[]>([]);
  const [agentBounds, setAgentBounds] = useState<AgentBounds | null>(null);
  // The station whose workspace is open. The camera flies to it; nothing covers the room.
  const [focus, setFocus] = useState<string | null>(null);
  const [atHome, setAtHome] = useState(true);
  const homeReady = useRef(true);
  const [failed, setFailed] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot, staticSnapshot);
  const motionRef = useRef(reducedMotion);
  const onRelicMotion = useCallback((state: RelicMotionState) => { renderer.current?.setRelicMotion(focus, state); }, [focus]);
  const focusedStation = stations.find(station => station.id === focus) ?? null;
  const customFocus = focusedStation?.section && EXPERIENCE_SECTIONS.has(focusedStation.section) ? focusedStation : null;
  const lastStation = useRef<string | null>(null);
  const closeExperience = useCallback(() => {
    goHome();
  }, []);

  // Hand cursor: a grab flies into the relic nearest the cursor, letting go flies back out.
  const boundsRef = useRef(bounds);
  useEffect(() => { boundsRef.current = bounds; }, [bounds]);
  useEffect(() => {
    if (warm || failed) return;
    const onZoom = (event: Event) => {
      const { direction, x, y } = (event as CustomEvent<{ direction: "in" | "out"; x: number; y: number }>).detail;
      if (direction === "out") { if (document.body.dataset.workspaceSection !== "overview") goHome(); return; }
      const rect = plane.current?.getBoundingClientRect();
      if (focus || !atHome || !rect) return;
      let nearest: StationBounds | null = null, best = Infinity;
      for (const bound of boundsRef.current) {
        const distance = Math.hypot(rect.left + (bound.left + bound.width / 2) * rect.width - x, rect.top + (bound.top + bound.height / 2) * rect.height - y);
        if (distance < best) { best = distance; nearest = bound; }
      }
      if (nearest) openStation(nearest.station);
    };
    window.addEventListener("hyper:finger-zoom", onZoom);
    return () => window.removeEventListener("hyper:finger-zoom", onZoom);
  }, [warm, failed, focus, atHome]);

  useEffect(() => {
    if (warm || focus || !atHome || failed) resetAgentInteraction();
  }, [warm, focus, atHome, failed, resetAgentInteraction]);

  useEffect(() => {
    const hidden = () => { if (document.hidden) resetAgentInteraction(); };
    window.addEventListener("blur", resetAgentInteraction);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", resetAgentInteraction);
      document.removeEventListener("visibilitychange", hidden);
      resetAgentInteraction();
    };
  }, [resetAgentInteraction]);

  useEffect(() => {
    if (focus) { lastStation.current = focus; return; }
    if (!atHome) return;
    const id = lastStation.current;
    if (!id) return;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-station-id="${id}"]`)?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [focus, atHome]);

  // This isolated development route has no gallery section controller.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !document.querySelector("[data-atrium-dev]")) return;
    const navigate = (event: Event) => {
      const section = (event as CustomEvent<{ section: string }>).detail?.section;
      if (!section || !["overview", ...FOCUS_SECTIONS].includes(section)) return;
      document.body.dataset.workspaceSection = section;
      window.dispatchEvent(new CustomEvent("hyper:section-change", { detail: { section } }));
    };
    window.addEventListener("hyper:navigate-section", navigate);
    return () => window.removeEventListener("hyper:navigate-section", navigate);
  }, []);

  useEffect(() => {
    const menu = store.ProjectMenu;
    if (warm) return;
    const previousControl = menu?.allowControl;
    const previousRendering = menu?.renderPass?.enabled;
    let active = true;
    document.body.dataset.atriumActive = "true";
    // Route transitions hold their still of the world until this.
    window.dispatchEvent(new Event("hyper:world-shown"));
    // Labels and the dock fade in after the room has landed (see `[data-entering]` in the styles).
    const room = scroller.current;
    if (room) room.dataset.entering = "true";
    document.body.dataset.worldEntering = "true";
    const entered = window.setTimeout(() => { if (room) delete room.dataset.entering; delete document.body.dataset.worldEntering; }, 3200);
    const suspend = () => {
      if (!active || !menu) return;
      menu.allowControl = false;
      if (menu.renderPass) menu.renderPass.enabled = false;
    };
    suspend();
    // Run after the parent gate's handoff while keeping the cursor event loop alive.
    queueMicrotask(suspend);
    window.addEventListener("hyper:section-change", suspend);
    return () => {
      active = false;
      clearTimeout(entered);
      if (room) delete room.dataset.entering;
      delete document.body.dataset.worldEntering;
      delete document.body.dataset.atriumActive;
      window.removeEventListener("hyper:section-change", suspend);
      if (menu && store.ProjectMenu === menu) {
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
    const next = reducedMotion || (warm && !priming && !handoffLive);
    if (next === motionRef.current) return;
    motionRef.current = next;
    renderer.current?.setPaused(next);
  }, [reducedMotion, warm, priming, handoffLive]);

  useEffect(() => {
    const controller = new AbortController();
    const element = canvas.current;
    let active = true;
    let instance: AtriumRenderer | null = null;
    const update = () => {
      const section = document.body.dataset.workspaceSection ?? "overview";
      const selected = FOCUS_SECTIONS.has(section) ? stationsRef.current.find(station => station.section === section)?.id ?? null : null;
      if (selected) { homeReady.current = false; setAtHome(false); }
      else if (!renderer.current || !lastFocusFrame.current || lastFocusFrame.current.progress < .02) {
        homeReady.current = true;
        setAtHome(true);
      }
      setFocus(selected);
      renderer.current?.setHover(null);
      renderer.current?.setPressed(null);
      resetAgentInteraction();
    };
    const fail = () => {
      controller.abort();
      instance?.dispose();
      if (renderer.current === instance) renderer.current = null;
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
        instance = await createAtriumRenderer(element, value, next => { if (active) setBounds(next); }, controller.signal, next => { if (active) setAgentBounds(next); });
        if (!active || controller.signal.aborted) { instance.dispose(); return; }
        renderer.current = instance;
        publishAgentInteraction();
        instance.setFocusListener(frame => {
          lastFocusFrame.current = frame; orbit.current?.(frame); experience.current?.(frame);
          if (!homeReady.current && frame.progress < .02 && document.body.dataset.workspaceSection === "overview") { homeReady.current = true; setAtHome(true); }
        });
        instance.setPaused(motionRef.current);
        await instance.setStations(stationsRef.current);
        stationsRef.current.forEach(station => instance?.setRelicActivity(station.id, activityRef.current[station.section as RelicActivitySection] ?? { status: "idle", label: "" }));
        if (active && !controller.signal.aborted && renderer.current === instance) {
          const section = document.body.dataset.workspaceSection ?? "overview";
          const selected = FOCUS_SECTIONS.has(section) ? stationsRef.current.find(station => station.section === section)?.id ?? null : null;
          const share = scroller.current && plane.current ? Math.min(1, scroller.current.clientWidth / Math.max(1, plane.current.clientWidth)) : 1;
          instance.setFocus(selected, share);
          setFailed(false);
          if (warmRef.current && !motionSnapshot()) prime(1500);
          // A paused renderer draws when its pressed state is set, which is exactly one fresh frame.
          // Live or hidden, the still is drawn in this task so the copy never reads a cleared buffer.
          setWarmFrameProvider(() => { instance?.setPaused(true); instance?.setPressed(null); instance?.setPaused(motionRef.current); return element; });
          // The intro loader and the handoff both wait on this.
          document.documentElement.dataset.atriumReady = "true";
          window.dispatchEvent(new Event("hyper:atrium-ready"));
        }
      } catch (error) {
        if (!active || controller.signal.aborted) return;
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
      setWarmFrameProvider(null);
      instance?.dispose();
      renderer.current = null;
      element?.removeEventListener("webglcontextlost", fail);
      window.removeEventListener("hyper:section-change", update);
    };
  }, [publishAgentInteraction, resetAgentInteraction, prime]);

  useEffect(() => {
    const element = scroller.current;
    const frame = plane.current;
    // Only the part of the frame on screen counts when placing the relic left of the panel.
    const share = element && frame ? Math.min(1, element.clientWidth / Math.max(frame.clientWidth, 1)) : 1;
    renderer.current?.setFocus(focus, share);
    document.body.dataset.atriumFocus = focus ?? "";
    if (!focus) return;
    element?.scrollTo({ left: (element.scrollWidth - element.clientWidth) / 2, behavior: reducedMotion ? "auto" : "smooth" });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !(event.target as HTMLElement | null)?.closest("input, textarea")) closeExperience();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, reducedMotion, bounds.length, stations, closeExperience]);

  useEffect(() => () => { delete document.body.dataset.atriumFocus; }, []);

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

  function hoverAgent(event: ReactPointerEvent<HTMLButtonElement>) {
    const inside = withinAgent(event.currentTarget, event.clientX, event.clientY);
    agentInteraction.current.hovered = fineHover(event) && inside;
    if (agentInteraction.current.pointerId === event.pointerId) agentInteraction.current.pressed = inside;
    publishAgentInteraction();
  }

  function releaseAgent(event: ReactPointerEvent<HTMLButtonElement>) {
    if (agentInteraction.current.pointerId !== event.pointerId) return;
    agentInteraction.current.pointerId = null;
    agentInteraction.current.pressed = false;
    if (event.type === "pointerup") hoverAgent(event);
    else { agentInteraction.current.hovered = false; publishAgentInteraction(); }
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
        {!failed && !focus && atHome && agentBounds && <button
          ref={agentButton} type="button" className={styles.agent} data-cursor="hide" data-cfo-trigger="" aria-label="Open CFO" aria-haspopup="dialog" aria-controls="hyper-cfo-panel" title="CFO · agent activity"
          style={{ left: `${agentBounds.left * 100}%`, top: `${agentBounds.top * 100}%`, width: `${agentBounds.width * 100}%`, height: `${agentBounds.height * 100}%` }}
          onPointerEnter={hoverAgent}
          onPointerMove={hoverAgent}
          onPointerLeave={() => { agentInteraction.current.hovered = false; agentInteraction.current.pressed = false; publishAgentInteraction(); }}
          onPointerDown={event => {
            event.stopPropagation();
            if (!event.isPrimary || event.button !== 0) return;
            agentInteraction.current.pointerId = event.pointerId;
            agentInteraction.current.pressed = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            publishAgentInteraction();
          }}
          onPointerUp={releaseAgent}
          onPointerCancel={releaseAgent}
          onLostPointerCapture={releaseAgent}
          onFocus={event => { agentInteraction.current.focused = event.currentTarget.matches(":focus-visible"); publishAgentInteraction(); }}
          onBlur={resetAgentInteraction}
          onKeyDown={event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            agentInteraction.current.focused = true;
            agentInteraction.current.pressed = true;
            publishAgentInteraction();
          }}
          onKeyUp={event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            agentInteraction.current.pressed = false;
            publishAgentInteraction();
          }}
          onClick={event => {
            event.stopPropagation();
            if (event.detail > 0 && !withinAgent(event.currentTarget, event.clientX, event.clientY)) return;
            window.dispatchEvent(new CustomEvent("hyper:cfo-toggle", { detail: { keyboard: event.detail === 0 } }));
          }}
        />}
        {!failed && !warm && <RelicOrbit section={customFocus ? null : focusedStation?.section ?? null} register={registerOrbit} />}
        {focus && <button type="button" className={styles.leave} data-cursor="hide" aria-label="Back to the atrium" onClick={closeExperience} />}
        {!failed && !focus && atHome && bounds.map((bound, index) => <button
          type="button"
          key={bound.station.id}
          data-station-id={bound.station.id}
          className={styles.hotspot}
          data-cursor="hide"
          aria-label={`Open ${bound.station.label}${activityStates[bound.station.section as RelicActivitySection]?.status !== "idle" && activityStates[bound.station.section as RelicActivitySection]?.label ? `, ${activityStates[bound.station.section as RelicActivitySection]?.label}` : ""}`}
          data-activity={activityStates[bound.station.section as RelicActivitySection]?.status ?? "idle"}
          style={{ "--i": index, zIndex: 1000 - Math.round(bound.depth * 10), left: `${bound.left * 100}%`, top: `${bound.top * 100}%`, width: `${bound.width * 100}%`, height: `${bound.height * 100}%`, "--station-font": `${bound.fontWidth * 100}cqw` } as CSSProperties}
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
          <span className={styles.label} style={{ left: `${bound.labelLeft * 100}%`, top: `${bound.labelTop * 100}%` }}>{bound.station.label === "Accounts Payable" ? <>Accounts<br />Payable</> : bound.station.label}<RelicStatus activity={activityStates[bound.station.section as RelicActivitySection]} /></span>
          <span className={styles.arrow} aria-hidden="true" style={{ left: `${bound.labelLeft * 100}%`, top: `${bound.arrowTop * 100}%` }}><span className={styles.arrowGlyph}>→</span></span>
        </button>)}
      </div>
      {!focus && <span className={styles.keyboardHint}>← → Explore the room</span>}
    </div>
    {!warm && <RelicExperience station={customFocus} register={registerExperience} onMotion={onRelicMotion} onClose={closeExperience} still={reducedMotion} fallback={failed} />}
    {failed && !warm && <nav className={styles.fallback} aria-label="Workspace navigation">
      <span className={styles.fallbackNote} role="status">The 3D view is unavailable. Your workspaces are still here.</span>
      <div>{stations.map(station => <button type="button" key={station.id} data-cursor="hide" onClick={() => openStation(station)}>{station.label} <span aria-hidden="true">↗</span></button>)}</div>
    </nav>}
  </>;
}

function RelicStatus({ activity }: { activity?: RelicActivity }) {
  if (!activity || activity.status === "idle") return null;
  const labels = { working: "Working", waiting: "Waiting", attention: "Needs you", complete: "Complete", error: "Needs attention" };
  return <span className={styles.status} data-status={activity.status}>
    <ActivityOrb status={activity.status} label={activity.label} />{activity.label.length <= 22 ? activity.label : labels[activity.status]}
    {activity.count && activity.count > 1 ? ` · ${activity.count}` : ""}
  </span>;
}
