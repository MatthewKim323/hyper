// How the benchmark work evolved, transcribed from eval/docs/BENCHMARK_EVOLUTION.md. Figures are copied,
// never recomputed here. The authoritative numbers live in eval/export/worker-comparison.json and
// eval/export/frontier-worker-comparison.json; update this file when that document changes.
export type EvolutionResult = { benchmark: string; result: string; scorer?: string; tone?: "good" | "flat" | "bad" };
export type EvolutionPhase = {
  id: string;
  phase: number;
  title: string;
  summary: string;
  results?: EvolutionResult[];
  notes?: string[];
  verdict?: string;
  state: "done" | "negative" | "current";
};

export const EVOLUTION_SOURCE = "eval/docs/BENCHMARK_EVOLUTION.md";

export const BENCHMARK_EVOLUTION: EvolutionPhase[] = [
  {
    id: "baselines", phase: 1, state: "done",
    title: "Isolated worker baselines",
    summary: "One Devin worker per benchmark with files and a shell only, none of our backend tools. This measures general agent ability, not the product.",
    results: [
      { benchmark: "Invoice Sandbox", result: "18/18 customer totals, $0.00 error", scorer: "Native scorer", tone: "good" },
      { benchmark: "DABstep dev (10 tasks)", result: "7/10", scorer: "Native scorer", tone: "flat" },
      { benchmark: "BenchRec v3", result: "95.83% precision / 91.22% recall", scorer: "Custom metrics", tone: "good" },
      { benchmark: "APEX dev (10 tasks)", result: "71/89 criteria, 0.707 macro", scorer: "Custom judge", tone: "flat" },
    ],
  },
  {
    id: "scorers", phase: 2, state: "done",
    title: "Making the scorers trustworthy",
    summary: "Before improving a number, check that the number means what it says.",
    notes: [
      "APEX judge: the chosen model returned 403 on the gateway free tier, so the first grade fell back to gpt-4.1. Re-graded with gpt-6-astra direct: 70/89, 0.710 macro. The judge cache is now keyed by model, protocol, rubric and exact answer. No silent fallback.",
      "DABstep correction: the real split was 1/3 easy and 6/7 hard, not \"all hard passed\". Overall 7/10 unchanged.",
      "Judge parser hardened for bare criteria arrays. Changed input archives are rejected before upload. Completed outputs cannot silently change.",
    ],
  },
  {
    id: "compared-to-what", phase: 3, state: "done",
    title: "Compared to what",
    summary: "Improving the numbers needed something honest to compare against.",
    results: [
      { benchmark: "BenchRec, rules only", result: "99.51% precision at 46.48% recall", tone: "flat" },
      { benchmark: "BenchRec, stricter rules", result: "99.86% precision at 8.70% recall", tone: "flat" },
      { benchmark: "BenchRec, distributed reference", result: "95.20% precision / 62.20% recall", scorer: "Same data, our metric", tone: "flat" },
    ],
    notes: [
      "Published numbers (DABstep about 16%, APEX 50 to 60% frontier) sit on different splits and harnesses. They are context, not a comparison.",
      "Precision alone is meaningless: recall, coverage and false matches have to be reported together.",
      "The distributed reference's model identity is not established. It is used as a same-data external baseline.",
    ],
  },
  {
    id: "prompting", phase: 4, state: "negative",
    title: "Nine-run improvement experiment (60 ACU)",
    summary: "Same inputs, improved verification prompts, originals frozen.",
    results: [
      { benchmark: "DABstep", result: "7/10, 6/10, 7/10. No gain", tone: "flat" },
      { benchmark: "BenchRec", result: "96.23% precision / 88.72% recall. Small precision gain, recall regression", tone: "bad" },
      { benchmark: "APEX", result: "All three trials hit their 10 ACU caps with no output. Recorded as budget failures, not dropped", tone: "bad" },
    ],
    notes: [
      "DABstep root causes: amount-weighted fraud volume versus transaction count, null-wildcard fee rule dimensions, and fee pricing tiers that do not prove a fine threshold.",
      "A deterministic balance check moved BenchRec precision only from 95.83% to 95.92% while recall fell to 84.92%. Equal totals do not prove transaction identity.",
    ],
    verdict: "Prompting alone does not move it. No broad improvement claimed.",
  },
  {
    id: "system", phase: 5, state: "current",
    title: "Benchmark the system, not the agent",
    summary: "The pivot: measure whether our engineering actually helps.",
    notes: [
      "Durable per-task execution, checkpoints, immutable final results.",
      "Scoped task tokens, idempotent request keys, no replaying uncertain calls.",
      "Matched arms: baseline versus backend-connected versus frozen-skill.",
      "Private grading from persisted backend state, not agent claims.",
      "12 development fixtures across AP, accrual and settlement.",
      "A 24 ACU paired pilot is registered but blocked on a reachable HTTPS endpoint for the evaluator. Zero paid sessions launched.",
    ],
    verdict: "Built and tested. The paired pilot exists to answer whether the system helps.",
  },
];

export const EVOLUTION_STANDING: { label: string; status: string; state: "done" | "negative" | "waiting" | "unsupported" }[] = [
  { label: "Agent-only benchmarks", status: "Done, honest negative result", state: "negative" },
  { label: "Matched local baselines", status: "Done (rules only plus distributed reference)", state: "done" },
  { label: "Backend-connected eval", status: "Built and tested (334 eval / 239 backend tests)", state: "done" },
  { label: "Paired live pilot", status: "Registered, waiting on reachable HTTPS", state: "waiting" },
  { label: "Broad improvement claim", status: "Not supported yet, by design", state: "unsupported" },
];
