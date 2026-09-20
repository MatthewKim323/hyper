"use client";

// The benchmark story as a timeline: what was measured, what was corrected, what did not work, and
// where it stands. It keeps the negative result in plain view; that is the point of the page.
import { useState } from "react";
import { BENCHMARK_EVOLUTION, EVOLUTION_SOURCE, EVOLUTION_STANDING } from "@/lib/benchmarks/evolution";
import styles from "./BenchmarkEvolution.module.css";

const STATE_LABEL = { done: "Done", negative: "Negative result", current: "Current" } as const;

export default function BenchmarkEvolution() {
  const [open, setOpen] = useState<string>("system");
  return <section className={styles.evolution} aria-label="How the benchmark work evolved" data-pointable="group:benchmark-evolution" data-pointable-label="Benchmark evolution timeline">
    <header className={styles.head}>
      <span className={styles.eyebrow}>Benchmark evolution</span>
      <h3>From scoring an agent to measuring <em>the system</em>.</h3>
      <p>Five phases, in order, including the experiment that did not work.</p>
    </header>
    <ol className={styles.track}>
      {BENCHMARK_EVOLUTION.map(phase => {
        const expanded = open === phase.id;
        return <li key={phase.id} className={styles.phase} data-state={phase.state} data-open={expanded}
          data-pointable={`benchmark-phase:${phase.id}`} data-pointable-label={`Phase ${phase.phase}: ${phase.title}`} data-pointable-data={JSON.stringify({ state: phase.state, results: phase.results ?? [], verdict: phase.verdict ?? null })}>
          <span className={styles.node} aria-hidden="true">{phase.phase}</span>
          <button type="button" className={styles.title} aria-expanded={expanded} onClick={() => setOpen(expanded ? "" : phase.id)} data-cursor="hide">
            <span className={styles.state}>{STATE_LABEL[phase.state]}</span>
            <strong>{phase.title}</strong>
            <span className={styles.summary}>{phase.summary}</span>
          </button>
          <div className={styles.body} hidden={!expanded}>
            {phase.results && <table className={styles.results}>
              <tbody>{phase.results.map(row => <tr key={row.benchmark} data-tone={row.tone ?? "flat"}>
                <th scope="row">{row.benchmark}</th><td>{row.result}</td>{row.scorer && <td className={styles.scorer}>{row.scorer}</td>}
              </tr>)}</tbody>
            </table>}
            {phase.notes && <ul className={styles.notes}>{phase.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
            {phase.verdict && <p className={styles.verdict}>{phase.verdict}</p>}
          </div>
        </li>;
      })}
    </ol>
    <div className={styles.standing}>
      <span className={styles.eyebrow}>Where it stands</span>
      <ul>{EVOLUTION_STANDING.map(row => <li key={row.label} data-state={row.state}><i aria-hidden="true" /><strong>{row.label}</strong><span>{row.status}</span></li>)}</ul>
    </div>
    <footer className={styles.foot}>Transcribed from <code>{EVOLUTION_SOURCE}</code>. Authoritative figures: <code>eval/export/worker-comparison.json</code>.</footer>
  </section>;
}
