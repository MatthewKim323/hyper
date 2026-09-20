"use client";

// The benchmark story as a timeline: what was measured, what was corrected, what did not work, and
// where it stands. It keeps the negative result in plain view; that is the point of the page.
import { useState } from "react";
import { TradeoffBars } from "@/components/workspace/charts";
import { BENCHMARK_EVOLUTION, BENCHREC_TRADEOFF, EVOLUTION_STANDING } from "@/lib/benchmarks/evolution";
import styles from "./BenchmarkEvolution.module.css";

const STATE_LABEL = { done: "Done", negative: "Negative result", current: "Current" } as const;

export default function BenchmarkEvolution() {
  const [open, setOpen] = useState<string>("system");
  return <section className={styles.evolution} aria-label="How the benchmark work evolved" data-pointable="group:benchmark-evolution" data-pointable-label="Benchmark evolution timeline">
    <header className={styles.head}>
      <span className={styles.eyebrow}>Benchmark evolution</span>
    </header>
    <div className={styles.tradeoff}>
      <span className={styles.eyebrow}>BenchRec · <i data-series="precision" />precision <i data-series="recall" />recall</span>
      <TradeoffBars rows={BENCHREC_TRADEOFF} />
    </div>
    <ol className={styles.track}>
      {BENCHMARK_EVOLUTION.map(phase => {
        const expanded = open === phase.id;
        return <li key={phase.id} className={styles.phase} data-state={phase.state} data-open={expanded}
          data-pointable={`benchmark-phase:${phase.id}`} data-pointable-label={`Phase ${phase.phase}: ${phase.title}`} data-pointable-data={JSON.stringify({ state: phase.state, results: phase.results ?? [], verdict: phase.verdict ?? null })}>
          <span className={styles.node} aria-hidden="true">{phase.phase}</span>
          <button type="button" className={styles.title} aria-expanded={expanded} onClick={() => setOpen(expanded ? "" : phase.id)} data-cursor="hide">
            <span className={styles.state}>{STATE_LABEL[phase.state]}</span>
            <strong>{phase.title}</strong>
          </button>
          <div className={styles.body} hidden={!expanded}>
            {phase.results && <table className={styles.results}>
              <tbody>{phase.results.map(row => <tr key={row.benchmark} data-tone={row.tone ?? "flat"}>
                <th scope="row">{row.benchmark}</th><td>{row.result}</td>{row.scorer && <td className={styles.scorer}>{row.scorer}</td>}
              </tr>)}</tbody>
            </table>}
            {phase.verdict && <p className={styles.verdict}>{phase.verdict}</p>}
          </div>
        </li>;
      })}
    </ol>
    <div className={styles.standing}>
      <span className={styles.eyebrow}>Where it stands</span>
      <ul>{EVOLUTION_STANDING.map(row => <li key={row.label} data-state={row.state}><i aria-hidden="true" /><strong>{row.label}</strong><span>{row.status}</span></li>)}</ul>
    </div>
  </section>;
}
