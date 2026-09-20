"use client";

// The live loop: memory on against memory off, recorded while the adversary runs. Three figures and
// one chart. Counts, not percentages, until there are enough cases for a percentage to mean anything.
import { ArmLines, ModeBars } from "@/components/workspace/charts";
import { useAuth, useBackend } from "@/components/workspace/useBackend";
import { backend } from "@/lib/backend/client";
import { shapeLoopTimeline } from "@/lib/benchmarks/loop-timeline";
import styles from "./LoopTimeline.module.css";

export default function LoopTimeline({ active }: { active: boolean }) {
  const auth = useAuth();
  const { data } = useBackend(() => backend.benchTimeline(), active && auth.ready && auth.signedIn, 60000);
  const view = data ? shapeLoopTimeline(data) : null;
  if (!view) return null;
  const figures = [
    { label: "Hard tier", ...view.hardTier },
    { label: "Seconds", ...view.seconds },
    { label: "Per case", ...view.cost },
  ];
  return <section className={styles.loop} aria-label="Live loop" data-pointable="group:loop-timeline" data-pointable-label="Memory on versus memory off"
    data-pointable-data={JSON.stringify({ subject: view.subject, pairs: view.pairs, hardTier: view.hardTier, seconds: view.seconds, cost: view.cost, lessons: view.lessons })}>
    <header className={styles.head}>
      <span className={styles.eyebrow}>Live · {view.pairs} pairs{view.lessons !== null ? ` · ${view.lessons} lessons` : ""}</span>
      <span className={styles.legend}><i data-arm="with" />Memory<i data-arm="without" />No memory</span>
    </header>
    <dl className={styles.figures}>{figures.map(figure => <div key={figure.label}>
      <dt>{figure.label}</dt>
      <dd><strong>{figure.with}</strong><span>{figure.without}</span></dd>
    </div>)}</dl>
    {view.speed.length > 1 && <ArmLines points={view.speed} label="Median seconds to release, memory on and off" />}
    {view.retrieval.length > 0 && <div className={styles.retrieval}><span className={styles.eyebrow}>Recall@10</span><ModeBars rows={view.retrieval} label="Retrieval recall at 10 by mode" /></div>}
  </section>;
}
