// Shapes GET /benchmarks/timeline (backend/app/bench_timeline.py) for the Benchmarks relic.
// Rules agreed with the loop's owners: an accuracy is never shown for fewer than 20 cases (counts
// only), points marked invalid (pre-fix sandbox) are dropped, and overall accuracy is not a headline:
// tiers 1 to 4 are saturated in both arms, so the signal is the hard tier, speed and cost.
export type ArmTotals = { n: number; correct: number; accuracy: number | null; wrong_releases: number; timeouts: number; median_seconds_released: number | null; requests_per_case: number | null; sessions_per_case: number | null; median_usd_per_case: number | null; costed_cases: number };
export type ExceptionPoint = { at: number; valid: boolean; level?: number; bucket: ArmTotals & { top_tier?: number }; rolling: ArmTotals & { top_tier?: number } };
export type MemoryPoint = { at: number; pairs: number; with_memory: ArmTotals; without_memory: ArmTotals };
export type ExceptionSeries = { id: "exceptions"; subject: string; role: "memory_on" | "memory_off"; twin_of?: string; points: ExceptionPoint[] };
export type MemorySeries = { id: "memory_effect" | "memory_effect_hard_tier"; subject: string; against?: string; points: MemoryPoint[] };
export type StateSeries = { id: "loop_state"; subject: string; points: { at: number; lessons: number; open_cases: number; adversary: { enabled: boolean; spawned: number }; usd_per_hour_all_workers: number | null }[] };
export type LoopSeries =
  | ExceptionSeries
  | MemorySeries
  | StateSeries
  | { id: "retrieval"; subject: string; points: ({ at: number } & Record<string, unknown>)[] }
  | { id: "tests"; subject: string; points: { at: number; passed: number; failed: number }[] };
export type LoopTimeline = { schema_version: number; display_mode: string; generated_at: number; valid_since?: number; events: { at: number; label: string }[]; series: LoopSeries[]; caveats: string[] };

export const MIN_CASES_FOR_RATE = 20;
const RETRIEVAL_MODES = ["keyword", "keyword+graph", "hybrid", "hybrid+graph"] as const;

export type ArmFigure = { with: string; without: string };
export type LoopView = {
  subject: string;
  pairs: number;
  hardTier: ArmFigure;
  seconds: ArmFigure;
  cost: ArmFigure;
  speed: { date: Date; with: number; without: number }[];
  level: { date: Date; level: number }[];
  lessons: number | null;
  /** recall@10 per mode as a PERCENTAGE with one decimal (93.7), ready for a 0 to 100 axis. Not a fraction. */
  retrieval: { mode: string; recall: number }[];
  /** How many questions the latest retrieval run asked, from the recorded point. Null when it did not say. */
  retrievalQuestions: number | null;
};

/** Correct out of n, as a rate only once there are enough cases for a rate to mean something. */
export function outcome(arm: ArmTotals | undefined): string {
  if (!arm || !arm.n) return "0/0";
  return arm.n >= MIN_CASES_FOR_RATE && arm.accuracy !== null ? `${Math.round(arm.accuracy * 100)}%` : `${arm.correct}/${arm.n}`;
}
const seconds = (value: number | null | undefined) => value == null ? "–" : `${value.toFixed(1)}s`;
const dollars = (value: number | null | undefined) => value == null ? "–" : `$${value.toFixed(value < 0.1 ? 3 : 2)}`;

export function shapeLoopTimeline(doc: LoopTimeline): LoopView | null {
  const memory = doc.series.filter((s): s is MemorySeries => s.id === "memory_effect_hard_tier" || s.id === "memory_effect");
  // The lab with the most hard-tier pairs is the one worth showing; fall back to overall pairs.
  const hard = memory.filter(s => s.id === "memory_effect_hard_tier" && s.points.length).sort((a, b) => b.points[b.points.length - 1].pairs - a.points[a.points.length - 1].pairs)[0];
  const overall = memory.filter(s => s.id === "memory_effect" && s.points.length && (!hard || s.subject === hard.subject))[0];
  const chosen = hard ?? overall;
  if (!chosen) return null;
  const subject = chosen.subject;
  // Hard-tier figures come from the hard-tier series or not at all. The overall series is mostly
  // open-book cases, so its numbers must never appear under a hard-tier label.
  const hardLatest = hard?.points[hard.points.length - 1];
  const totals = (overall?.points[overall.points.length - 1]) ?? hardLatest!;

  const arms = doc.series.filter((s): s is ExceptionSeries => s.id === "exceptions");
  const on = arms.find(s => s.role === "memory_on" && s.subject === subject);
  const off = arms.find(s => s.role === "memory_off" && (s.twin_of === subject || s.subject.startsWith(subject)));
  const usable = (series?: { points: ExceptionPoint[] }) => (series?.points ?? []).filter(p => p.valid !== false);
  const offByTime = new Map(usable(off).map(p => [p.at, p]));
  const speed = usable(on).flatMap(p => {
    const twin = offByTime.get(p.at);
    const a = p.rolling.median_seconds_released, b = twin?.rolling.median_seconds_released;
    return a != null && b != null ? [{ date: new Date(p.at), with: a, without: b }] : [];
  });
  const level = usable(on).flatMap(p => { const l = p.level; return l ? [{ date: new Date(p.at), level: l }] : []; });

  const state = doc.series.find((s): s is StateSeries => s.id === "loop_state" && s.subject === subject);
  const retrievalPoint = doc.series.find(s => s.id === "retrieval")?.points.slice(-1)[0] as Record<string, Record<string, number> | undefined> | undefined;
  const retrieval = retrievalPoint ? RETRIEVAL_MODES.flatMap(mode => { const recall = retrievalPoint[mode]?.["recall@10"]; return typeof recall === "number" ? [{ mode, recall: Math.round(recall * 1000) / 10 }] : []; }) : [];

  return {
    subject,
    pairs: totals.pairs,
    hardTier: hardLatest ? { with: outcome(hardLatest.with_memory), without: outcome(hardLatest.without_memory) } : { with: "0/0", without: "0/0" },
    seconds: { with: seconds(totals.with_memory.median_seconds_released), without: seconds(totals.without_memory.median_seconds_released) },
    cost: { with: dollars(totals.with_memory.median_usd_per_case), without: dollars(totals.without_memory.median_usd_per_case) },
    speed, level,
    lessons: state?.points.slice(-1)[0]?.lessons ?? null,
    retrieval,
    retrievalQuestions: (() => { const asked = (retrievalPoint?.commit as { questions?: Record<string, number> } | undefined)?.questions; return asked ? Object.values(asked).reduce((a, b) => a + b, 0) : null; })(),
  };
}
