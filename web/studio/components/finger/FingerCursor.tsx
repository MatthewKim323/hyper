"use client";

// Hand cursor: a toggle that turns the webcam into a pointer. Press H or use the pill.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FingerController, FingerState } from "@/lib/finger/controller";
import type { HandTracker } from "@/lib/finger/tracker";

type Status = "off" | "starting" | "live" | "error";

const LABELS: Record<FingerState, string> = {
  lost: "Show your hand",
  point: "Pinch to click",
  pinch: "Click",
  drag: "Dragging",
  scroll: "Scrolling",
  hold: "Holding still",
};

export default function FingerCursor() {
  const [status, setStatus] = useState<Status>("off");
  const [gesture, setGesture] = useState<FingerState>("lost");
  const [error, setError] = useState("");
  const [fps, setFps] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const session = useRef<{ tracker: HandTracker; controller: FingerController } | null>(null);
  const busy = useRef(false);

  const stop = useCallback(() => {
    session.current?.tracker.stop();
    session.current?.controller.destroy();
    session.current?.tracker.video.remove();
    session.current = null;
    document.documentElement.removeAttribute("data-finger");
    setStatus("off");
    setGesture("lost");
  }, []);

  const start = useCallback(async () => {
    if (busy.current || !canvas.current) return;
    busy.current = true;
    setStatus("starting");
    setError("");
    try {
      const [{ HandTracker }, { FingerController }] = await Promise.all([import("@/lib/finger/tracker"), import("@/lib/finger/controller")]);
      const controller = new FingerController(canvas.current);
      controller.onState = (next) => {
        setGesture(next);
        document.documentElement.setAttribute("data-finger", next === "lost" ? "idle" : "tracking");
      };
      const tracker = new HandTracker(controller.onFrame, controller.onLost);
      session.current = { tracker, controller };
      if (process.env.NODE_ENV !== "production") (window as unknown as { __finger?: FingerController }).__finger = controller;
      await tracker.start();
      preview.current?.appendChild(tracker.video);
      setFps(Math.round(tracker.fps));
      document.documentElement.setAttribute("data-finger", controller.state === "lost" ? "idle" : "tracking");
      setStatus("live");
    } catch (cause) {
      stop();
      const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");
      setError(denied ? "Camera access is off. Allow it in the address bar and try again." : "The hand cursor could not start on this device.");
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }, [stop]);

  const toggle = useCallback(() => {
    if (session.current) stop();
    else void start();
  }, [start, stop]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() !== "h" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  useEffect(() => stop, [stop]);

  const on = status === "live" || status === "starting";
  return (
    <>
      <canvas ref={canvas} className="finger-overlay" aria-hidden="true" />
      <div className="finger-dock" data-status={status} data-gesture={gesture}>
        <div ref={preview} className="finger-preview" aria-hidden="true" />
        {status === "live" && (
          <p className="finger-hint">
            <strong>{LABELS[gesture]}</strong>
            <span>Pinch to click and drag · two fingers to scroll · fist to hold</span>
            {fps > 0 && <span>Camera {fps} fps</span>}
          </p>
        )}
        {status === "error" && <p className="finger-hint finger-hint--error" role="alert">{error}</p>}
        <button type="button" className="finger-toggle" onClick={toggle} aria-pressed={on} data-cursor="hide" title="Hand cursor (H)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v5a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-4-2L4.4 15a1.6 1.6 0 0 1 2.5-2L9 15" />
          </svg>
          <span>{status === "starting" ? "Starting camera" : on ? "Hand cursor on" : "Hand cursor"}</span>
        </button>
      </div>
    </>
  );
}
