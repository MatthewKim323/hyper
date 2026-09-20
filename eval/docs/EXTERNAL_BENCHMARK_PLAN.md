# Hyperfinance Agent: External Benchmark Execution Plan

## What we can claim
Backend unit tests validate code, not agent accounting accuracy. Existing AP oracle smoke validates the grader, not our agent. External worker baselines and full application evaluations must stay separate.

## Priority and protocol

| Benchmark | Fit | Execution and metric | Current constraint |
| --- | --- | --- | --- |
| [Invoice Sandbox](https://github.com/ciru-ai/invoice-sandbox-benchmark) | Immediate: invoice validity, duplicates, credits, customer identity | Pinned publisher fixture; isolated Devin worker; native customer-total scorer; customer accuracy, absolute dollar error, missing/unexpected customers | Native scorer does not grade all exclusion reasons; public fixture, not held-out; first run has no backend tools |
| [DABstep](https://huggingface.co/datasets/adyen/DABstep) | Strong: payment data analysis | Validate pipeline on 10 development tasks; freeze configuration, then run all 450 default tasks and use publisher evaluator | Default task answers withheld; local approximate scorer is not official; payment analysis is not settlement journal correctness |
| [APEX Accounting](https://huggingface.co/datasets/mercor/apex-accounting) | Strong: month-end accounting breadth | All 10 public development tasks, original artifacts; blind rubric/gold from subject; independently score each rubric criterion | Public development set; expert/rubric grading needed, not just numerical string matching |
| [BenchRec](https://www.kaggle.com/datasets/benchmarkteam/benchrec-real-world-cash-reconciliation-dataset) | Strong: matching bank and ledger transactions | Use the previously verified public Kaggle v3 data; separate gold solution and sample submission before matching; report precision/recall and unmatched handling | Existing source register records public CC BY 4.0 data and no shipped official scorer; local metrics must be labeled custom, not official |
| [Finance Agent Benchmark](https://huggingface.co/datasets/vals-ai/finance_agent_benchmark) | Secondary: public-company research, different product scope | Filings retrieval and cited financial answers, publisher protocol | Does not measure internal close or autonomous ledger correctness |
| [AccountingBench reference](https://x.com/yunyu_l/status/1946261507723173935) | Valuable: longitudinal error propagation | Month-by-month state, cumulative account balances and drift | X post inaccessible; existing source register identifies accounting.penrose.com as a methodology reference without a public runnable package |

The DABstep dataset card currently shows 450 default tasks plus 10 dev tasks; these are distinct splits. APEX is 10 public dev tasks. Do not label either development result a hidden-test score or compare different evaluation conditions against leaderboard percentages.

## First runnable pilot
`eval/scripts/invoice_devin.py` implements prepare/start/collect with the existing Devin API credentials in ignored backend/.env. It pins publisher revision and scorer hashes; uploads only allowlisted agent workspace directories. It never uploads answer_key or scripts. The native scorer stays local. The subject gets no app token or gold answers. Data stays under ignored eval/runs.

Commands from repository root:

```sh
uv run --directory backend python ../eval/scripts/invoice_devin.py prepare --run ../eval/runs/invoice-devin-001
uv run --directory backend python ../eval/scripts/invoice_devin.py start --run ../eval/runs/invoice-devin-001
uv run --directory backend python ../eval/scripts/invoice_devin.py collect --run ../eval/runs/invoice-devin-001
```

One worker, maximum 5 ACU. Repeated start is refused to avoid duplicate spend after ambiguous creation. Poll collect until structured output complete; never manually fill missing answers. Do not publicly submit benchmark results automatically. Report a terminal failure or missing output as such, never silently drop it.

## Full-system follow-up
The next distinct run should expose the same backend tools as production in an isolated benchmark organization, preserve approved accounting-policy boundaries, and capture persisted results plus tool traces. Backend routes currently require normalized evidence and owner attestation; bypassing those restrictions for benchmark points would measure a different system. Assess preprocessing/normalization separately, including evidence fidelity and completeness.

For repeated trials, preregister scope, cap, prompt/model/harness and revision; retain every attempt and report the denominator. Use three independent runs where affordable. Public-fixture repeats measure stability, not generalization. Custom AP, accrual and settlement tests remain separately labeled development evaluations.

Existing detailed access/revision research is preserved in `registry/source_verification.json` and `registry/suites.json`; the new pilot supplements that register rather than replacing it.

## Verified-workflow comparison (2026-09-19)

Authorized budget: nine fresh Devin sessions, three trials each for BenchRec (5 ACU),
DABstep (5 ACU) and APEX (10 ACU), at most 60 ACU of configured session caps total.
No automatic relaunch, cap increase, or post-suspension nudge. The old APEX baseline
had a completion nudge; report that asymmetry. Provider-reported usage can lag.

Variant `verified-v2` adds source-grounded requirements checklists, executable arithmetic
and join assertions, independent result checks, final-format review and checkpointed
output. BenchRec adds allocation conservation and abstention; DABstep adds manual-derived
rule tables; APEX adds posted-versus-proposed entry reconciliation. No gold answers or
failed-task IDs enter the prompts. This remains worker-only: it does not measure backend
engines or learned-skill reuse.

Runs: `eval/runs/verified-v2-{01,02,03}`. Each copies only the original blinded archive
and provenance manifest. Preparation and launch verify the archive hash. Per-run outputs
are frozen on completion. Missing output stays in the attempted denominator. Three
repetitions of ten questions are not thirty independent questions. The original baseline
has one run, so comparisons do not establish significance or isolate provider-model drift.

Reproducible commands from repository root (preparation uses a NEW destination):

```sh
uv run --directory backend python ../eval/scripts/remaining_devin.py prepare --root ../eval/runs/NEW-RUN --variant verified-v2 --trial 1
uv run --directory backend python ../eval/scripts/remaining_devin.py start --root ../eval/runs/NEW-RUN
uv run --directory backend python ../eval/scripts/remaining_devin.py collect --root ../eval/runs/NEW-RUN
uv run --directory backend python ../eval/scripts/score_remaining.py dabstep --root ../eval/runs/NEW-RUN
uv run --directory backend python ../eval/scripts/score_remaining.py benchrec --root ../eval/runs/NEW-RUN
uv run --directory backend python ../eval/scripts/score_remaining.py apex --root ../eval/runs/NEW-RUN --provider openai --judge EXPLICIT_MODEL_ID
```

The direct OpenAI judge reads `OPENAI_API_KEY` locally. There is no automatic model
fallback. Model/protocol/rubric/answer hashes isolate caches; prior judge results are
preserved. Judge results remain provisional until contradiction and tolerance checks
are adjudicated; a higher grade after switching judges is not an agent improvement.

`compare_external.py` collects without launching sessions, scores native/custom deterministic
outputs, and writes `export/worker-comparison.json`. It withholds old APEX grades rather
than mixing grading protocols. `benchrec_rules.py` supplies two fixed no-LLM rules
baselines using the identical evaluation rows and exact-allocation metric.

## Published reference points (retrieved 2026-09-19)

- [DABstep launch report](https://huggingface.co/blog/dabstep): historical hard-set
  baselines of roughly 16% for o3-mini, 13% for DeepSeek R1, 12% for Claude Sonnet,
  and 6% for DeepSeek V3. These are dated test-set results, not current frontier scores
  and not comparable to our ten-question dev-set 70%. The publisher provides
  [reproducible baseline code](https://huggingface.co/spaces/adyen/DABstep/tree/main/baseline).
- [APEX leaderboard](https://www.mercor.com/apex/apex-accounting-leaderboard/): the live
  headline table showed Fable 5.1 at 61.0% and GPT-6 Astra at 60.0%; the page's older
  narrative/cost table still reported Fable 5 at 56.4%. These are 160 private tasks
  across ten worlds, unlike our ten public tasks, joint-context execution and custom judge.
  No claim of outperforming the leaderboard is supported.
- [BenchRec publisher](https://www.operartis.com/benchrec): emphasizes match rate,
  precision and confidence calibration. The inspected page describes a forthcoming
  leaderboard but provides no reproducible numerical baseline table. Separately, Kaggle
  version 3 includes `MatcherByChatGPT_submission.csv`: our same-data scoring yields
  95.20% precision and 62.20% recall. Model, prompt and compute are unknown. Use this
  distributed reference plus our fixed rules baselines, not vendor marketing statistics.

A credible product claim still needs a baseline-versus-full-system run with identical
inputs, model, tools budget and grader; benchmark development tuning alone does not
establish generalization or the incremental value of the application.

