"use client";

import { useEffect, useState } from "react";
import DialogueCaptions from "@/components/onboarding/DialogueCaptions";
import { createDialogue, reduceDialogueEvent } from "@/lib/onboarding/dialogue";
import styles from "./DialoguePreview.module.css";

// This bounded sample lives only under the development-gated route.
const EVENTS: { label: string; event: Record<string, unknown> }[] = [
  { label: "Assistant partial", event: { id: "preview-agent-1", role: "assistant", text: "I'm your", sequence: 1, final: false } },
  { label: "Assistant partial updates the same row", event: { id: "preview-agent-1", role: "assistant", text: "I'm your CFO. How can I", sequence: 1, final: false } },
  { label: "Assistant final", event: { id: "preview-agent-1", role: "assistant", text: "I'm your CFO. How can I help?", sequence: 1, final: true } },
  { label: "User partial", event: { id: "preview-user-1", role: "user", text: "Show me", sequence: 2, final: false } },
  { label: "User final", event: { id: "preview-user-1", role: "user", text: "Show me where each agent is working.", sequence: 2, final: true } },
  { label: "Assistant new turn", event: { id: "preview-agent-2", role: "assistant", text: "The room connects each workflow to its relic.", sequence: 3, final: true } },
  { label: "Adjacent assistant sentence joins its turn", event: { id: "preview-agent-3", role: "assistant", text: "Your CFO panel shows the activity behind it.", sequence: 4, final: true } },
  { label: "Longer user turn wraps and pushes older lines up", event: { id: "preview-user-2", role: "user", text: "Can I keep talking while I look through the workflow and review the evidence?", sequence: 5, final: true } },
  { label: "Assistant response", event: { id: "preview-agent-4", role: "assistant", text: "Yes. The conversation stays with you while you explore.", sequence: 6, final: true } },
  { label: "Duplicate final must not create a new row", event: { id: "preview-agent-4", role: "assistant", text: "Yes. The conversation stays with you while you explore.", sequence: 6, final: true } },
];

export default function DialoguePreview() {
  const [dialogue, setDialogue] = useState(createDialogue);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [still, setStill] = useState(false);

  function next() {
    const item = EVENTS[step];
    if (!item) { setPlaying(false); return; }
    setDialogue(previous => reduceDialogueEvent(previous, { type: "transcript", generation: 1, ...item.event }));
    setStep(step + 1);
  }

  useEffect(() => {
    if (!playing || step >= EVENTS.length) return;
    const timer = setTimeout(() => {
      const item = EVENTS[step];
      setDialogue(previous => reduceDialogueEvent(previous, { type: "transcript", generation: 1, ...item.event }));
      setStep(step + 1);
    }, step > 0 && EVENTS[step - 1].event.final === false ? 700 : 1500);
    return () => clearTimeout(timer);
  }, [playing, step]);

  function reset(play = false) {
    setPlaying(play);
    setStep(0);
    setDialogue(createDialogue());
  }

  return <div className={styles.preview}>
    <aside className={styles.controls} aria-label="Dialogue preview controls">
      <strong>Development preview: dialogue captions</strong>
      <p>Sample conversation only. No microphone, provider audio, agent actions, or customer data.</p>
      <div className={styles.buttons}>
        <button type="button" onClick={() => reset(false)}>Reset</button>
        <button type="button" onClick={() => { setPlaying(false); next(); }} disabled={step >= EVENTS.length}>Next event</button>
        <button type="button" onClick={() => step >= EVENTS.length ? reset(true) : setPlaying(!playing)}>{playing && step < EVENTS.length ? "Pause" : step >= EVENTS.length ? "Replay" : "Play sequence"}</button>
        <button type="button" onClick={() => {
          setPlaying(false);
          setDialogue(EVENTS.reduce((state, item) => reduceDialogueEvent(state, { type: "transcript", generation: 1, ...item.event }), createDialogue()));
          setStep(EVENTS.length);
        }}>Show full history</button>
      </div>
      <label className={styles.preference}><input type="checkbox" checked={still} onChange={event => setStill(event.target.checked)} /> Reduced-motion preview</label>
      <p className={styles.step} aria-live="polite">{step}/{EVENTS.length} · {step ? EVENTS[step - 1].label : "Ready. Choose Next event or Play sequence."}</p>
    </aside>
    <div className={styles.variants}>
      <section className={styles.variant} aria-label="Onboarding captions preview">
        <h1>Onboarding</h1>
        <div className={styles.card}>
          {dialogue.entries.length ? <DialogueCaptions dialogue={dialogue} agentLabel="Hyper" paused={still} /> : <div className={styles.empty}>Awaiting sample dialogue</div>}
          <div className={styles.composer}><span>Or type here…</span><span aria-hidden="true">↑</span></div>
        </div>
      </section>
      <section className={styles.variant} aria-label="World captions preview">
        <h1>World, compact</h1>
        <div className={styles.card}>
          {dialogue.entries.length ? <DialogueCaptions dialogue={dialogue} agentLabel="CFO" paused={still} compact /> : <div className={`${styles.empty} ${styles.compactEmpty}`}>Awaiting sample dialogue</div>}
          <div className={styles.composer}><span>Talk to your CFO…</span><span aria-hidden="true">↑</span></div>
        </div>
      </section>
    </div>
  </div>;
}
