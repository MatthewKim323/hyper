// The benchmarks popup as a short list: what was tested, one number, one bar against what it is compared to.
// Public figures are copied from eval/docs/BENCHMARK_EVOLUTION.md (board.test.ts fails if one is not in it).
import { BENCHMARK_EVOLUTION, type EvolutionResult } from "./evolution";
import type { LoopView } from "./loop-timeline";

export type BoardBar = { label: string; text: string; share: number | null };
export type BoardRow = {
  id: string; title: string; source: string; live?: boolean;
  /** Ours first, then what it is measured against. */
  bars: BoardBar[];
  detail: "loop" | "retrieval" | "results" | "benchrec" | "suite" | "story";
  match?: string;
};

const fraction = (text: string): number | null => {
  const found = text.match(/^(\d+)\/(\d+)/);
  return found && Number(found[2]) > 0 ? Number(found[1]) / Number(found[2]) : null;
};
const percent = (value: number) => `${Math.round(value * 100)}%`;

export const PUBLIC_ROWS: BoardRow[] = [
  { id: "invoices", title: "Reads invoices", source: "Invoice Sandbox", detail: "results", match: "Invoice Sandbox",
    bars: [{ label: "Totals right", text: "18/18", share: 18 / 18 }] },
  { id: "benchrec", title: "Matches bank transactions", source: "BenchRec v3", detail: "benchrec", match: "BenchRec",
    bars: [{ label: "Found", text: "91.22%", share: 0.9122 }, { label: "Reference", text: "62.20%", share: 0.622 }] },
  { id: "dabstep", title: "Answers data questions", source: "DABstep", detail: "results", match: "DABstep",
    bars: [{ label: "Correct", text: "7/10", share: 7 / 10 }] },
  { id: "apex", title: "Month-end close", source: "APEX", detail: "results", match: "APEX",
    bars: [{ label: "Criteria met", text: "70/89", share: 70 / 89 }] },
];

export function boardRows(view: LoopView | null): BoardRow[] {
  const rows: BoardRow[] = [];
  if (view && (view.hardTier.with !== "0/0" || view.pairs > 0)) {
    const hard = view.hardTier.with !== "0/0";
    rows.push({ id: "loop", title: "Learns from its mistakes", source: `Adversary loop · ${view.pairs} pairs`, live: true, detail: "loop",
      bars: hard ? [{ label: "Memory", text: view.hardTier.with, share: fraction(view.hardTier.with) }, { label: "No memory", text: view.hardTier.without, share: fraction(view.hardTier.without) }]
        : [{ label: "Memory", text: view.seconds.with, share: null }, { label: "No memory", text: view.seconds.without, share: null }] });
  }
  if (view?.retrieval.length) {
    const best = view.retrieval.reduce((a, b) => (b.recall > a.recall ? b : a));
    const plain = view.retrieval.find(row => row.mode === "hybrid") ?? view.retrieval.find(row => row.mode === "keyword");
    rows.push({ id: "retrieval", title: "Finds the right evidence", source: "Meridian · 172 questions", live: true, detail: "retrieval",
      bars: [{ label: "With graph", text: percent(best.recall), share: best.recall }, ...(plain && plain !== best ? [{ label: "Search only", text: percent(plain.recall), share: plain.recall }] : [])] });
  }
  return [...rows, ...PUBLIC_ROWS,
    { id: "suite", title: "Framework versions", source: "AP workflow suite", detail: "suite", bars: [] },
    { id: "story", title: "How we got here", source: "5 phases", detail: "story", bars: [] }];
}

/** Every recorded result for one benchmark, oldest phase first. */
export function resultsFor(match: string): (EvolutionResult & { phase: number })[] {
  return BENCHMARK_EVOLUTION.flatMap(phase => (phase.results ?? []).filter(row => row.benchmark.startsWith(match)).map(row => ({ ...row, phase: phase.phase })));
}
