"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { dialogueTurns, type DialogueState } from "@/lib/onboarding/dialogue";
import styles from "./DialogueCaptions.module.css";

export interface DialogueCaptionsProps {
  dialogue: DialogueState;
  agentLabel?: string;
  paused?: boolean;
  compact?: boolean;
  className?: string;
}

/** Spoken and typed turns share a bottom-aligned caption stack, with older lines fading upward. */
export default function DialogueCaptions({ dialogue, agentLabel = "Hyper", paused = false, compact = false, className = "" }: DialogueCaptionsProps) {
  const turns = useMemo(() => dialogueTurns(dialogue.entries), [dialogue.entries]);
  const reducedMotion = useReducedMotion();
  const still = paused || reducedMotion === true;

  if (!turns.length) return null;
  return <div
    className={`${styles.viewport} ${compact ? styles.compact : ""} ${className}`}
    data-paused={paused ? "true" : undefined}
    role="log"
    aria-label="Conversation captions"
    aria-live="polite"
    aria-relevant="additions text"
    aria-atomic="false"
  >
    <div className={styles.stack}>
      {turns.map((turn, index) => <motion.div
        key={turn.id}
        layout={still ? false : "position"}
        initial={still ? false : { opacity: 0 }}
        animate={{ opacity: index < turns.length - 2 ? .7 : 1 }}
        transition={{ duration: still ? 0 : .22, ease: [.23, 1, .32, 1] }}
        className={styles.turn}
        data-speaker={turn.role}
        data-partial={!turn.final ? "true" : undefined}
      >
        <span className={styles.speaker}>{turn.role === "user" ? "You" : agentLabel}</span>
        <p className={styles.text}>{turn.text}</p>
      </motion.div>)}
    </div>
  </div>;
}
