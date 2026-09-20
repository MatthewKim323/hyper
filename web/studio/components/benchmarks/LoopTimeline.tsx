"use client";

// The live loop: memory on against memory off, recorded while the adversary runs. Three figures and
// one chart. Counts, not percentages, until there are enough cases for a percentage to mean anything.
import { ArmLines } from "@/components/workspace/charts";
import type { LoopView } from "@/lib/benchmarks/loop-timeline";
import styles from "./LoopTimeline.module.css";

export default function LoopTimeline({ view }: { view: LoopView }) {
  const figures = [
    { label: "Hard tier", ...view.hardTier },
    { label: "Seconds", ...view.seconds },
    { label: "Per case", ...view.cost },
  ].filter(figure => figure.with !== "0/0" || figure.without !== "0/0");
  return <section className={styles.loop} aria-label="Live loop">
    <header className={styles.head}>
      <span className={styles.eyebrow}>{view.pairs} pairs{view.lessons !== null ? ` · ${view.lessons} lessons` : ""}</span>
      <span className={styles.legend}><i data-arm="with" />Memory<i data-arm="without" />No memory</span>
    </header>
    <dl className={styles.figures}>{figures.map(figure => <div key={figure.label}>
      <dt>{figure.label}</dt>
      <dd><strong>{figure.with}</strong><span>{figure.without}</span></dd>
    </div>)}</dl>
    {view.speed.length > 1 && <ArmLines points={view.speed} label="Median seconds to release, memory on and off" />}
  </section>;
}
