"use client";

// Hand cursor: a toggle that turns the webcam into a pointer. Press H or use the pill.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FingerController, FingerState } from "@/lib/finger/controller";
import type { HandFrame, HandTracker } from "@/lib/finger/tracker";

type Status = "off" | "starting" | "live" | "error";

// MediaPipe's 21 point hand topology: thumb, four fingers, and the palm arch.
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]] as const;
const TIPS = new Set([4, 8, 12, 16, 20]);

/** Skeleton over the camera preview. The video is `object-fit: cover` and mirrored; this matches both. */
function drawSkeleton(canvas: HTMLCanvasElement, frame: HandFrame | null) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) { canvas.width = width * dpr; canvas.height = height * dpr; }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!frame) return;
  const scale = Math.max(width / frame.aspect, height);
  const drawnWidth = scale * frame.aspect, drawnHeight = scale;
  const points = frame.landmarks.map(point => ({ x: (1 - point.x) * drawnWidth - (drawnWidth - width) / 2, y: point.y * drawnHeight - (drawnHeight - height) / 2 }));
  context.lineCap = "round";
  context.lineWidth = 1.25;
  context.strokeStyle = "rgba(255,255,255,0.85)";
  context.beginPath();
  for (const [from, to] of BONES) { context.moveTo(points[from].x, points[from].y); context.lineTo(points[to].x, points[to].y); }
  context.stroke();
  points.forEach((point, index) => {
    context.beginPath();
    context.arc(point.x, point.y, TIPS.has(index) ? 2.6 : 1.7, 0, Math.PI * 2);
    context.fillStyle = TIPS.has(index) ? "#fff" : "rgba(255,255,255,0.8)";
    context.fill();
  });
}

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
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const skeleton = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState<"in" | "out" | null>(null);
  const zoomTimer = useRef(0);
  const session = useRef<{ tracker: HandTracker; controller: FingerController } | null>(null);
  const busy = useRef(false);

  const stop = useCallback(() => {
    session.current?.tracker.stop();
    session.current?.controller.destroy();
    session.current?.tracker.video.remove();
    session.current = null;
    clearTimeout(zoomTimer.current);
    setZoom(null);
    if (skeleton.current) drawSkeleton(skeleton.current, null);
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
      controller.onLandmarks = (frame) => { if (skeleton.current) drawSkeleton(skeleton.current, frame); };
      controller.onZoom = (direction, x, y) => {
        window.dispatchEvent(new CustomEvent("hyper:finger-zoom", { detail: { direction, x, y } }));
        setZoom(direction);
        clearTimeout(zoomTimer.current);
        zoomTimer.current = window.setTimeout(() => setZoom(null), 900);
      };
      const tracker = new HandTracker(controller.onFrame, controller.onLost);
      session.current = { tracker, controller };
      if (process.env.NODE_ENV !== "production") (window as unknown as { __finger?: FingerController }).__finger = controller;
      await tracker.start();
      preview.current?.appendChild(tracker.video);
      document.documentElement.setAttribute("data-finger", controller.state === "lost" ? "idle" : "tracking");
      setStatus("live");
    } catch (cause) {
      stop();
      const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");
      setError(denied ? "Camera access is off." : "Hand cursor could not start.");
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
        <div ref={preview} className="finger-preview" aria-hidden="true">
          <canvas ref={skeleton} className="finger-skeleton" />
        </div>
        {status === "live" && (
          <p className="finger-hint">
            <strong>{zoom ? (zoom === "in" ? "Zoom in" : "Zoom out") : LABELS[gesture]}</strong>
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
