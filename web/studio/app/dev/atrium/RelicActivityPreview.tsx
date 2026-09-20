"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkspaceSection } from "@/components/atrium/configuration";
import styles from "./RelicActivityPreview.module.css";

type Activity = {
  status: "idle" | "working" | "waiting" | "attention" | "complete" | "error";
  label: string;
  count?: number;
  eventKey?: string;
};
type Activities = Partial<Record<WorkspaceSection, Activity>>;
type PreviewMode = "Working" | "Waiting" | "Approval" | "Complete";
const MODES: PreviewMode[] = ["Working", "Waiting", "Approval", "Complete"];
const PREVIEWS: Record<PreviewMode, Activities> = {
  Working: {
    cases: { status: "working", label: "Reconciling" },
    evidence: { status: "working", label: "Indexing" },
    timeline: { status: "working", label: "Training" },
  },
  Waiting: { cases: { status: "waiting", label: "Supplier reply" } },
  Approval: { review: { status: "attention", label: "Needs approval", count: 1 } },
  Complete: {
    cases: { status: "complete", label: "Complete" },
    evidence: { status: "complete", label: "Complete" },
    review: { status: "complete", label: "Complete" },
  },
};
const SEQUENCE: { at: number; mode: PreviewMode | null }[] = [
  { at: 6500, mode: "Waiting" },
  { at: 11000, mode: "Approval" },
  { at: 16500, mode: "Complete" },
  { at: 22000, mode: null },
];

function publish(mode: PreviewMode | null, key = "reset") {
  const activities: Activities | null = mode === null ? null : Object.fromEntries(
    Object.entries(PREVIEWS[mode]).map(([section, activity]) => [section, { ...activity, eventKey: `${key}:${section}` }]),
  );
  window.dispatchEvent(new CustomEvent("hyper:relic-activity-preview", { detail: { activities } }));
}

export default function RelicActivityPreview() {
  const [mode, setMode] = useState<PreviewMode | null>(null);
  const [playing, setPlaying] = useState(false);
  const timers = useRef(new Set<number>());
  const revision = useRef(0);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(timer => window.clearTimeout(timer));
      pending.clear();
      publish(null);
    };
  }, []);

  function clearSequence() {
    timers.current.forEach(timer => window.clearTimeout(timer));
    timers.current.clear();
  }

  function show(next: PreviewMode | null) {
    setMode(next);
    publish(next, `preview-${++revision.current}`);
  }

  function choose(next: PreviewMode | null) {
    clearSequence();
    setPlaying(false);
    show(next);
  }

  function playSequence() {
    clearSequence();
    setPlaying(true);
    show("Working");
    for (const step of SEQUENCE) {
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        show(step.mode);
        if (step.mode === null) setPlaying(false);
      }, step.at);
      timers.current.add(timer);
    }
  }

  return <aside className={styles.preview} aria-label="Relic activity motion preview" data-relic-activity-preview data-mode={mode?.toLowerCase() ?? "idle"} data-playing={playing}>
    <strong>Motion preview · relic activity</strong>
    <p>Simulated states. No work is submitted.</p>
    <div className={styles.modes} role="group" aria-label="Relic activity state">
      {MODES.map(value => <button type="button" key={value} aria-pressed={mode === value} onClick={() => choose(value)}>{value}</button>)}
      <button type="button" aria-pressed={mode === null} onClick={() => choose(null)}>Reset</button>
    </div>
    <div className={styles.sequence}>
      <button type="button" data-relic-preview-play aria-pressed={playing} onClick={playSequence}>Play sequence</button>
      <output aria-live="polite">{playing ? `${mode} · 22s sequence` : mode ? `${mode} preview` : "Choose a state to start"}</output>
    </div>
  </aside>;
}
