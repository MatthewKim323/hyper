"use client";

import { ThinkingOrb } from "thinking-orbs";
import { activityOrb } from "@/lib/command/activity-orb";
import styles from "./ActivityOrb.module.css";

export default function ActivityOrb({ status, label }: { status: string; label?: string }) {
  const state = activityOrb(status);
  const description = label ?? status.replaceAll("_", " ");
  return <ThinkingOrb state={state} size={64} theme="light" speed={1.4}
    className={styles.orb} data-resting={state === "composing" || undefined}
    role="img" aria-label={description} title={description}
    style={{ display: "inline-block", flexShrink: 0, verticalAlign: "middle", width: 32, height: 32 }} />;
}
