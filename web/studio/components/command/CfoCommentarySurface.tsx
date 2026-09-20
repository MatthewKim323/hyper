"use client";
import { useState } from "react";
import type { CommentaryMode, NarrationRecord } from "@/lib/command/cfo-commentary";
import { decisionProgress, hasReviewedOptions, type DecisionChoice, type DecisionConcern, type DecisionJob } from "@/lib/command/cfo-decisions";
import styles from "./CfoCommentarySurface.module.css";

type Props = { mode: CommentaryMode; caption: NarrationRecord | null; error: string; needsAudio: boolean; leader: boolean; connected: boolean;
  onMode: (mode: CommentaryMode) => void; onEnableAudio: () => void; history: NarrationRecord[]; speakingConversation: boolean };
export function CfoCommentarySurface({ mode, caption, error, needsAudio, leader, connected, onMode, onEnableAudio, history, speakingConversation }: Props) {
  const current = !speakingConversation ? caption : null;
  return <div className={styles.surface}>
    <div className={styles.controls}>
      <span className={styles.label}>CFO <span className={styles.connection} title={connected ? "Live workflow updates" : "Connecting to workflow updates"} data-live={connected} /></span>
      <label className={styles.mode}>Commentary<select aria-label="CFO commentary mode" value={mode} onChange={event => onMode(event.target.value as CommentaryMode)}><option value="demo">Live</option><option value="essential">Essential</option><option value="muted">Muted</option></select></label>
      {mode !== "muted" && leader && (needsAudio || (caption && caption.status !== "playing" && !speakingConversation)) && <button type="button" onClick={onEnableAudio}>{needsAudio ? "Enable audio" : "Replay"}</button>}
    </div>
    {current && <div className={styles.caption} role="status" aria-live="polite" aria-atomic="true" data-delivery={current.status}>
      <p>{current.event.narration.text}</p>
      {current.status === "caption-only" && <small>Text update</small>}
      {current.status === "interrupted" && <small>Interrupted</small>}
    </div>}
    {error && <p className={styles.notice} role="status">{error}</p>}
    {!leader && mode !== "muted" && connected && <p className={styles.notice}>Audio is active in another tab. Updates remain available here.</p>}
    {!!history.length && <details className={styles.history}>
      <summary>Recent commentary</summary>
      <ol aria-label="CFO commentary history">{history.slice(-30).reverse().map(item => <li key={item.event.id}><p>{item.event.narration.text}</p><small>{item.status === "history" ? "Earlier update" : item.status.replaceAll("-", " ")}</small></li>)}</ol>
    </details>}
  </div>;
}

type DecisionProps = {
  concern: DecisionConcern; busy: boolean; error: string; message: string; frozen: boolean;
  job: DecisionJob | null;
  onSubmit: (choice: DecisionChoice, input?: "click" | "text") => Promise<boolean>; onDismiss: () => void; onRetrySuggestions: () => Promise<void>;
};
export function CfoDecisionCard({ concern, busy, error, message, frozen, job, onSubmit, onDismiss, onRetrySuggestions }: DecisionProps) {
  const [instruction, setInstruction] = useState("");
  const awaiting = ["awaiting_response", "needs_input", "card_failed"].includes(concern.status);
  const reviewed = hasReviewedOptions(concern);
  const options = reviewed ? [...concern.card!.options].sort((a, b) => a.id.localeCompare(b.id)) : [];
  const progress = decisionProgress(concern, job);
  const status = busy ? message || "Saving your instruction..." : progress.text;
  return <section className={styles.decision} aria-label="Your decision" aria-busy={busy}>
    <div className={styles.decisionTitle}><h3>{concern.request.title}</h3><button type="button" onClick={onDismiss} disabled={busy || frozen} aria-label="Defer this decision">Later</button></div>
    {awaiting && <>
      {reviewed ? <div className={styles.options} role="group" aria-label="Choose a response">{options.map((option, index) => <button key={`${concern.card_revision}:${option.id}`} type="button" disabled={busy || frozen} onClick={() => { void onSubmit({ optionId: option.id }); }}>
        <span className={styles.number}>{index + 1}</span><span className={styles.optionTitle}>{option.title}</span><span className={styles.optionArrow} aria-hidden="true">↗</span>
      </button>)}</div> : <div className={styles.unavailable}><p className={styles.notice}>Suggestions unavailable.</p>
        {concern.status === "card_failed" && <button className={styles.retrySuggestions} type="button" disabled={busy || frozen} onClick={() => { void onRetrySuggestions(); }}>Retry suggestions</button>}
      </div>}
      <form className={styles.custom} onSubmit={async event => { event.preventDefault(); if (instruction.trim() && await onSubmit({ optionId: "custom", instruction: instruction.trim() }, "text")) setInstruction(""); }}>
        <input aria-label="Custom decision instruction" placeholder="Or type your own..." value={instruction} maxLength={4000} onChange={event => setInstruction(event.target.value)} disabled={busy || frozen} />
        <button type="submit" disabled={!instruction.trim() || busy || frozen}>Send</button>
      </form>
      {frozen && <p className={styles.notice}>Finish speaking to choose.</p>}
    </>}
    <details className={styles.decisionDetails} key={`${concern.id}:${concern.card_revision}:${concern.card_hash}`}>
      <summary>Details</summary>
      <p>{concern.card?.summary || concern.request.description}</p>
      {awaiting && reviewed && <ol>{options.map(option => <li key={option.id}>
        <strong>{option.title}</strong><p>{option.action}</p><small>{option.tradeoff}</small>
        {option.requires_approval && <small>Further action requires approval.</small>}
      </li>)}</ol>}
    </details>
    {status && <p className={styles.notice} role="status">{status}</p>}
    {progress.notes && <details className={styles.findings} key={concern.latest_job_id}>
      <summary>Findings</summary>
      <strong>Agent notes</strong>
      {!progress.notesVerified && <small>Not independently verified.</small>}
      <p>{progress.notes}</p>
    </details>}
    {(error || job?.error) && <p className={styles.error} role="alert">{error || job?.error}</p>}
  </section>;
}
