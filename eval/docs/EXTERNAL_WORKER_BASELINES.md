# Hyperfinance Agent: External Worker Baselines

Three isolated Devin worker runs on 2026-09-19, following the Invoice Sandbox pilot
(`INVOICE_WORKER_PILOT.md`). Same protocol: inputs only to the worker, grading keys and
scorers local, no Hyperfinance Agent backend tools, no leaderboard submissions. Run directory:
`eval/runs/remaining-20260919/` (ignored). Runner: `eval/scripts/remaining_devin.py`;
scorers: `eval/scripts/score_remaining.py`.

## Results

| Benchmark | Metric | Result | Grading |
| --- | --- | ---: | --- |
| BenchRec v3 (Kaggle, CC BY 4.0) | Precision on proposed matches | **95.83%** (29,042 / 30,306) | Custom exact-allocation metrics; no official scorer exists |
| | Recall vs gold matches | 91.22% (29,042 / 31,836) | |
| | Coverage (rows with a proposed allocation) | 94.56% (30,306 / 32,048) | |
| | Exact-row accuracy over all 32,048 B rows | 91.25% | |
| DABstep development set (10 tasks) | Correct answers | **7 / 10** | Pinned native `question_scorer` |
| APEX public development set (10 tasks) | Rubric criteria passed | **71 / 89** | Custom single-model rubric judgment |
| | Macro task mean | 0.707 | |
| | Tasks with every criterion passed | 3 / 10 | |

## What each number supports

**BenchRec.** The worker wrote and returned a standard-library-only Python matcher
(`matcher.py`, 10.5 KB), which was then executed locally in a locked-down container
(`--network none --cap-drop ALL --read-only`, pinned `python:3.11-slim` image) against
the full 69,171-row eval CSV. It proposed allocations for 30,306 of 32,048 bank rows;
29,042 were correct and 1,264 were wrong. Precision is below the 99.8% target the prompt
asked it to prioritize. This measures one worker's matching script on one public dataset -
not our settlement engine, which does not exist in this run.

**DABstep.** The worker computed all 10 development answers with pandas/Decimal code over
the full 138k-row payments dataset. The pinned publisher scorer passed 7/10: 6 of 7 hard
tasks and 1 of 3 easy tasks passed. Tasks 49, 70 and 2697 failed. Failures are recorded in
`dabstep/result.json`; we report the raw count, not a normalized claim. The dev split is
not the hidden 450-task default split.

**APEX.** The worker answered all 10 development tasks but exhausted its 10-ACU cap before
emitting structured output; a follow-up message retrieved the completed answers. Grading
is a single `openai/gpt-4.1` judge against the publisher's rubric criteria and reference
outputs (`judge-protocol.json` records the protocol; per-task `judge-*.json` files keep
criterion-level verdicts with validated answer quotes). This is a local, non-official
rubric assessment - a single-model judge is not the publisher's expert grading and can
disagree with it. The originally configured judge model was unavailable on the AI
Gateway free tier; the substitution is recorded here and in `judge-protocol.json`.

**Audit correction:** this score is provisional. At least one judge verdict says a number
is outside an interval despite lying inside its stated bounds. Do not use 71/89 as a
validated headline or compare it with a new judge's result. A new explicit-model protocol
must re-grade the baseline and every candidate identically, preserving the old artifacts.

**Frontier re-grade completed:** direct OpenAI `gpt-6-astra` scores the original frozen
answers at **70/89 criteria**, **71.0% macro task mean**, and **3/10 perfect tasks**.
It correctly accepts the previously inconsistent tolerance case. This is still a
single-model, non-official assessment, not independent expert validation. Candidate
answers must use this identical protocol before comparison. New safe summaries live
in `eval/export/frontier-worker-comparison.json`; original GPT-4.1 results remain intact.

## Honest limitations (all three)

- **One trial each.** Single runs on public development material measure capability on
  these fixtures, not stability or held-out generalization.
- **Worker baseline, not full system.** No run touched Hyperfinance Agent's accounting, accrual,
  settlement, skills or concern APIs. They say nothing about what the backend adds.
- **Instruction-based isolation.** Cloud network access was not disabled; "do not look up
  answers" is enforced by prompt, not firewall. Public fixtures may be pretraining-contaminated.
- **ACU accounting.** The provider reported 0.0 consumed ACU at collection; billing may
  lag. Caps were 5 / 5 / 10 ACU.
- **APEX completion path.** Output was collected after a suspension nudge; the answers
  were complete, but the session's internal tool trace is not preserved in the structured
  output beyond its self-reported methodology.

## Artifacts

- `eval/export/worker-baselines.json` - safe summary export.
- `eval/runs/remaining-20260919/{benchrec,dabstep,apex}/` - manifests, prompts, session
  snapshots, worker outputs, matcher code, judge transcripts, result JSONs (gitignored).

## Same-data external reference

Kaggle dataset version 3 distributes `MatcherByChatGPT_submission.csv`. It was downloaded
only to the evaluator's private directory, after the candidate workers had launched.
Its predictions are JSON arrays of zero or one allocation; the scorer normalizes those
to the same scalar-ID/abstention contract without selecting from multiple guesses.
All 32,048 bank IDs passed the completeness/uniqueness check.

| Method | Precision | Recall | Coverage | False matches |
| --- | ---: | ---: | ---: | ---: |
| Distributed reference submission | 95.20% | 62.20% | 64.90% | 998 |
| Original Devin worker | 95.83% | 91.22% | 94.56% | 1,264 |
| Verified-v2 worker mean (3 trials) | 96.23% | 88.72% | 91.58% | 1,104.67 |

This is a direct same-data prediction comparison, not an official leaderboard score.
The reference file's model version, prompt, compute and training procedure are unverified;
do not describe it as a frontier-model baseline. The original worker has higher precision
and recall, but also more absolute false matches because it proposes more assignments.
File SHA-256: `ca74a5f846f681eb74b0476505d03b0ee2c8a7eb743f83ea990414d3f2fe7a8d`.
Safe metrics: `eval/export/benchrec-reference-comparison.json`.

Verified-v2 trial precision: 96.33%, 95.92%, 96.46%; recall: 88.57%, 87.07%, 90.52%.
Compared with the original worker, mean precision rises 0.40 percentage points while
recall drops 2.50 points. No trial reaches 99.8% precision. The new prompt is a tradeoff,
not an unqualified improvement, and should not be promoted solely from this experiment.

## Same-data rules baselines and candidate experiment

Two fixed no-LLM baselines were implemented before reading their scores. They use
only visible records, exact Decimal arithmetic and currency/account/date constraints;
no gold-based threshold tuning. `benchrec_rules.py` saves a code/input hash and scores
with the same exact-allocation function as the original worker.

| Method | Precision | Recall | Coverage | False matches |
| --- | ---: | ---: | ---: | ---: |
| Original Devin matcher | 95.83% | 91.22% | 94.56% | 1,264 |
| Unique exact allocation total | 99.51% | 46.48% | 46.40% | 73 |
| Exact reference and conserved allocation total | 99.86% | 8.70% | 8.66% | 4 |

The last row meets the requested precision target on this dataset but automates very
little. A precision gain with collapsed recall is a tradeoff, not blanket superiority.
These are local rules baselines, not published leaderboard entries or learned agents.
Artifact: `eval/runs/remaining-20260919/rules-baselines.json`.

Nine new `verified-v2` worker trials were launched with explicit approval (three per
benchmark, total configured cap 60 ACU). Inputs are identical to the original runs;
new prompts require evidence references, executable cross-checks, conservation checks,
manual-derived rule interpretation and final-answer review. Frozen outputs are scored
without feeding back gold. All attempts remain in `export/worker-comparison.json`,
including incomplete and unscored attempts. Published reference points and reproduction
commands are in `EXTERNAL_BENCHMARK_PLAN.md`. All three APEX candidates stopped at their
10-ACU caps with `usage_limit_exceeded` and no complete or partial structured output.
Completion is **0/3**, with all three attempts retained and ungraded. They were not
resumed or given larger caps. The original APEX baseline required a completion nudge,
so this is not a clean capability comparison. The original was re-graded with GPT-6
Astra; there are no candidate answers to grade. No learned-skill improvement is shown.

## Post-hoc deterministic conservation check

A separate strict conservation gate was tested on frozen worker assignments. It only
rejects proposals: every bank ID must appear once, the allocation must exist, account and
currency must agree, and all assigned bank amounts must sum exactly to the ledger
allocation total. It neither changes amounts nor invents alternative matches.

On the original worker, precision rose from 95.83% to 95.92%, but recall fell from
91.22% to 84.92%; false matches declined from 1,264 to 1,150. Thus conservation alone
does not resolve incorrect identity matches and is not a successful overall improvement.
The gate was designed after viewing aggregate scores, without row-level gold tuning;
report it as a post-hoc development experiment, not a preregistered or held-out result.
Artifact: `eval/runs/remaining-20260919/conservation-ablation.json`.

## DABstep repeated-run diagnosis

All three `verified-v2` runs completed: **7/10, 6/10, 7/10**, mean **66.67%** versus
70% for the single original run. This does not demonstrate an improvement. Tasks 49,
70 and 2697 failed in all three; task 1273 also failed in the second trial. Do not
report thirty independent questions or choose only the best trial.

`payment_checks.py` reproduces source-only diagnostics with no private answers and
never replaces worker submissions. On the visible input, NL leads fraud transaction
count and fraud EUR volume, but BE leads both count-based and amount-weighted fraud
fractions. The supplied manual defines fraud as fraudulent volume divided by total
volume. The workers' choice of a count ranking is therefore a concrete semantic concern.
One trial also excluded null `is_credit` fee rules, contrary to the manual's wildcard
rule. Other methodology reports conflated a pricing tier with a fine threshold, and
used different unsupported choices for reducing multiple matching fee rules to one fee.
These observations motivate executable semantic checks rather than longer prompts.

The new helper tests distinct count/amount denominators, natural-month/leap-year scope,
null wildcard handling and rejection of fine-risk conclusions without a supplied
threshold and policy source. These helpers were written after the v2 experiment was
frozen; they were NOT available to those workers. Any next experiment must have a new
variant, artifacts and approved budget. It remains development-set tuning.

## Next

Full-system evaluation needs the same workloads routed through a benchmark-scoped
organization exercising the real tool bridge - that measures what the deterministic
engines and controls add. Repeated trials (3x) would separate variance from signal.
AccountingBench remains a methodology reference without a runnable public package;
the Finance Agent Benchmark is out of scope for internal close work.
