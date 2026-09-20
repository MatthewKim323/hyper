"use client";

// The three reviewed options for the decision the CFO is asking about, as something to click: a number and a
// title each, nothing else on screen. What an option does and costs is the CFO's to say, and is the tooltip.
// Speaking or typing a number still works: this is the same selection, recorded the same way.
import { useEffect, useState } from "react";
import type { DecisionConcern, DecisionJob } from "@/lib/command/cfo-decisions";
import type { ConcernOption } from "@/lib/backend/types";
import ActivityOrb from "@/components/ui/ActivityOrb";
import styles from "./CfoDecisionCard.module.css";

const JOB: Record<string, string> = { queued: "Queued", running: "Working", waiting: "Waiting", completed: "Done", failed: "Failed", needs_input: "Needs you" };

export default function CfoDecisionCard({ concern, job, busy, onChoose, onDismiss }: {
  concern: DecisionConcern; job: DecisionJob | null; busy: boolean;
  onChoose: (id: ConcernOption["id"]) => void; onDismiss: () => void;
}) {
  const options = [...(concern.card?.options ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const chosen = concern.decision && "option_id" in concern.decision ? (concern.decision as { option_id?: string }).option_id : undefined;
  const locked = busy || !!chosen || concern.status !== "awaiting_response";
  const done = job?.status === "completed";
  const [leaving, setLeaving] = useState(false);

  // Finished work clears itself: long enough to read "Done", then it eases out. A failure stays until dismissed.
  useEffect(() => {
    if (!done) return;
    const leave = window.setTimeout(() => setLeaving(true), 1500);
    const gone = window.setTimeout(onDismiss, 1500 + 320);
    return () => { clearTimeout(leave); clearTimeout(gone); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, concern.id]);

  useEffect(() => {
    if (locked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
      const option = options[["1", "2", "3"].indexOf(event.key)];
      if (option) { event.preventDefault(); onChoose(option.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Option ids are fixed (option_1..3); only whether choosing is allowed changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, onChoose, concern.id, concern.card_revision]);

  return <section className={styles.card} data-severity={concern.request.severity} data-locked={locked || undefined} data-leaving={leaving || undefined} aria-label={concern.request.title}>
    <header className={styles.head}>
      <ActivityOrb status={locked ? "working" : "attention"} label={locked ? "Working on your choice" : "Needs your decision"} />
      <h2>{concern.request.title}</h2>
      <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Later" data-cursor="hide">
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg>
      </button>
    </header>
    <div className={styles.options}>
      {options.map((option, index) => <button type="button" key={option.id} className={styles.option} disabled={locked} data-chosen={chosen === option.id || undefined}
        title={`${option.action} ${option.tradeoff}`}
        style={{ "--i": index } as React.CSSProperties} onClick={() => onChoose(option.id)} data-cursor="hide">
        <span className={styles.number} aria-hidden="true">{index + 1}</span>
        <strong>{option.title}</strong>
      </button>)}
    </div>
    {job && <footer className={styles.job} data-status={job.status} role="status">
      <ActivityOrb status={job.status} label={JOB[job.status] ?? job.status} />{JOB[job.status] ?? job.status}{job.progress ? ` · ${job.progress}` : ""}{job.error ? ` · ${job.error}` : ""}
    </footer>}
  </section>;
}
