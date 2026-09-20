# Hyperfinance Agent: Benchmark Timeline and Evolution

How the benchmark work evolved, end to end. This is the narrative record; the
authoritative numbers live in `EXTERNAL_WORKER_BASELINES.md`,
`eval/export/worker-comparison.json`, and `eval/export/frontier-worker-comparison.json`.

## Phase 1: isolated worker baselines (external benchmarks)

First runs: one Devin worker per benchmark, files plus shell only, no
Hyperfinance Agent backend tools. This measures general agent capability,
not the product.

| Benchmark | Result | Scorer |
| --- | --- | --- |
| Invoice Sandbox | 18/18 customer totals, $0.00 error | Native scorer |
| DABstep dev (10 tasks) | 7/10 | Native scorer |
| BenchRec v3 | 95.83% precision / 91.22% recall | Custom metrics |
| APEX dev (10 tasks) | 71/89 criteria, 0.707 macro | Custom judge |

## Phase 2: scorer credibility fixes

- APEX judge: the chosen model returned 403 on the gateway free tier, so the
  first grade fell back to gpt-4.1. Later re-graded with gpt-6-astra direct:
  **70/89, 0.710 macro**. The judge cache is now keyed by model, protocol,
  rubric, and exact answer. There is no silent fallback.
- DABstep reporting correction: the real split was **1/3 easy, 6/7 hard**,
  not "all hard passed". Overall 7/10 unchanged.
- Judge parser hardened for bare criteria arrays; changed input archives are
  rejected before upload; completed outputs cannot silently change.

## Phase 3: baseline research and matched comparisons

"Improve the numbers" required something to compare against:

- Published baseline research: DABstep's ~16% and APEX's 50-60% frontier
  numbers sit on different splits and harnesses. They are not comparable to
  our dev runs and are cited only as context.
- Rules-only BenchRec baselines: 99.51% precision at 46.48% recall; 99.86%
  precision at 8.70% recall. Proved that precision-only claims are
  meaningless; recall, coverage, and false matches must be reported together.
- The distributed BenchRec reference (`MatcherByChatGPT_submission.csv`)
  scored under our metric: **95.20% precision / 62.20% recall**. Model
  identity is not established; used as a same-data external baseline.

## Phase 4: nine-run improvement experiment (60 ACU)

Same inputs, improved verification prompts, originals frozen:

- DABstep: **7/10, 6/10, 7/10**. No gain. Root causes identified:
  amount-weighted fraud volume vs transaction count, null-wildcard fee rule
  dimensions, and fee pricing tiers not proving a fine threshold.
- BenchRec: mean **96.23% precision / 88.72% recall**. Small precision gain,
  recall regression. A deterministic balance-check experiment moved precision
  only 95.83% to 95.92% while dropping recall to 84.92%: equal totals do not
  prove transaction identity.
- APEX: all three trials hit their 10-ACU caps without emitting output.
  Recorded as budget failures, not dropped.

Verdict: prompting alone does not move it. No broad improvement claimed.

## Phase 5: the real evaluation system (current)

The pivot from "benchmark the agent" to "benchmark the system":

- Durable per-task execution, checkpoints, immutable final results.
- Scoped task tokens, idempotent request keys, no replaying uncertain calls.
- Matched arms: baseline vs backend-connected vs frozen-skill.
- Private grading from persisted backend state, not agent claims.
- 12 development fixtures across AP, accrual, and settlement.
- A 24-ACU paired pilot is registered but blocked on a reachable HTTPS
  endpoint for the evaluator. Zero paid sessions launched.

## Where it stands

```text
agent-only benchmarks    done, honest negative result
matched local baselines  done (rules-only + distributed reference)
backend-connected eval   built and tested (334 eval / 239 backend tests)
paired live pilot        registered, waiting on reachable HTTPS
broad improvement claim  not supported yet, by design
```

The arc: isolated agent scores, then "is the scorer trustworthy", then
"compared to what", then "prompting does not work", and finally "measure
whether our engineering actually helps". The paired pilot exists to answer
that last question.
