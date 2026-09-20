"use client";

// The benchmarks popup: one line per thing we tested, a number and a bar. Open a line for the detail.
import { useEffect, useState } from "react";
import BenchmarkLandscape, { type BenchmarkLandscapeMotion } from "@/components/atrium/workspaces/BenchmarkLandscape";
import { ModeBars, TradeoffBars } from "@/components/workspace/charts";
import { useAuth, useBackend } from "@/components/workspace/useBackend";
import { backend } from "@/lib/backend/client";
import { boardRows, resultsFor, type BoardRow } from "@/lib/benchmarks/board";
import { BENCHREC_TRADEOFF } from "@/lib/benchmarks/evolution";
import { shapeLoopTimeline, type LoopTimeline as LoopDocument, type LoopView } from "@/lib/benchmarks/loop-timeline";
import BenchmarkEvolution from "./BenchmarkEvolution";
import LoopTimeline from "./LoopTimeline";
import styles from "./BenchmarkBoard.module.css";

type Props = { active: boolean; onMotion?: (state: BenchmarkLandscapeMotion) => void };

function Detail({ row, view, active, onMotion }: { row: BoardRow; view: LoopView | null } & Props) {
  if (row.detail === "loop") return view ? <LoopTimeline view={view} /> : null;
  if (row.detail === "retrieval") return view ? <ModeBars rows={view.retrieval} label="Retrieval recall at 10 by mode" /> : null;
  if (row.detail === "suite") return <BenchmarkLandscape active={active} onMotion={onMotion} />;
  if (row.detail === "story") return <BenchmarkEvolution />;
  return <>
    {row.detail === "benchrec" && <TradeoffBars rows={BENCHREC_TRADEOFF} />}
    <table className={styles.results}><tbody>{resultsFor(row.match ?? row.source).map(result => <tr key={`${result.phase}-${result.benchmark}`} data-tone={result.tone ?? "flat"}>
      <th scope="row">{result.benchmark}</th><td>{result.result}</td>
    </tr>)}</tbody></table>
  </>;
}

export default function BenchmarkBoard({ active, onMotion }: Props) {
  const auth = useAuth();
  const live = useBackend(() => backend.benchTimeline(), active && auth.ready && auth.signedIn, 60000);
  // The recorder also writes the same document next to the page, so the board reads without a sign-in.
  const [recorded, setRecorded] = useState<LoopDocument | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch("/benchmarks/timeline.json", { cache: "no-store" }).then(res => (res.ok ? res.json() : null))
      .then(doc => { if (!cancelled && doc?.schema_version === 1) setRecorded(doc as LoopDocument); }).catch(() => {});
    return () => { cancelled = true; };
  }, [active]);
  const document = live.data ?? recorded;
  const view = document ? shapeLoopTimeline(document) : null;
  const rows = boardRows(view);
  const [open, setOpen] = useState("");

  return <section className={styles.board} aria-label="Benchmarks">
    {rows.map(row => {
      const expanded = open === row.id;
      return <article key={row.id} className={styles.row} data-open={expanded} data-pointable={`benchmark:${row.id}`} data-pointable-label={row.title}
        data-pointable-data={JSON.stringify({ source: row.source, bars: row.bars.map(bar => ({ [bar.label]: bar.text })) })}>
        <button type="button" className={styles.summary} aria-expanded={expanded} onClick={() => setOpen(expanded ? "" : row.id)} data-cursor="hide">
          <span className={styles.name}><strong>{row.title}</strong><small>{row.live && <i aria-hidden="true" />}{row.source}</small></span>
          <span className={styles.bars}>{row.bars.map((bar, index) => <span key={bar.label} className={styles.bar} data-rank={index === 0 ? "ours" : "other"}>
            <span className={styles.barLabel}>{bar.label}</span>
            <span className={styles.track} aria-hidden="true">{bar.share !== null && <span style={{ width: `${Math.max(2, bar.share * 100)}%` }} />}</span>
            <span className={styles.value}>{bar.text}</span>
          </span>)}</span>
          <span className={styles.chevron} aria-hidden="true">+</span>
        </button>
        {expanded && <div className={styles.detail}><Detail row={row} view={view} active={active} onMotion={onMotion} /></div>}
      </article>;
    })}
  </section>;
}
