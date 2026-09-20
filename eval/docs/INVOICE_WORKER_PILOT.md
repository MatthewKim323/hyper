# Hyperfinance Agent: Invoice Sandbox Worker Baseline

## Measured result

| Metric | Result |
| --- | ---: |
| Customer totals correct within publisher's $0.01 tolerance | 18 / 18 (100%) |
| Total absolute dollar error | $0.00 |
| Missing / unexpected customers | 0 / 0 |
| Input PDFs / total files | 112 / 147 |
| Independent trials | 1 |
| Launch-to-result-collection time | 227.6 seconds |
| ACU budget | 5 |

The provider reported 0.0 consumed ACU at collection; billing may lag. This is not a zero-cost claim. Elapsed time includes polling latency, not just agent execution time.

**Supported claim:** “Our isolated Devin worker matched all 18 customer net totals on the public Invoice Sandbox fixture using the publisher's native scorer, with $0.00 aggregate absolute error in one run.”

**Unsupported claims:** full-system accuracy, held-out generalization, independent validation, invoice-field accuracy, trap recall, payment readiness, or superiority to humans/other agents. Customer outcomes share a single fixture and are not 18 independent datasets.

## Method

Publisher: https://github.com/ciru-ai/invoice-sandbox-benchmark . Revision: `b8cb58ff9747486e86c623e867b76fad5d8d075f`.

The native generator created 112 PDFs (the README's headline count says 110). The runner uploaded only the workspace inputs, split into 16 archives after an 80 MB attachment was rejected before session creation. Grading keys and scripts stayed local. No financial API tokens were supplied to the session. An isolated Devin worker produced customer totals as structured CSV, and the original pinned `scripts/score_submission.py` graded it locally. No leaderboard submission was made.

Devin self-reported using PyMuPDF extraction, Decimal aggregation, CRM identity checks, invoice arithmetic checks, and exclusions for duplicate, superseded, void and statement documents. The native score confirms customer net totals only; it does not independently validate those explanations. Cloud network access was not disabled, so the instruction against accessing public answers is not a technical network boundary. The fixture is public and potential pretraining contamination is unknown.

The run does not call Hyperfinance Agent's AP, settlement, or accrual APIs. It measures the worker harness in isolation. Register and measure the backend-connected system separately before attributing improvements to our accounting controls.

## Artifacts

- Safe summary: `eval/export/invoice-worker-pilot.json`.
- Full local artifacts (ignored): `eval/runs/invoice-devin-001/` includes fixture/scorer revision, blinded archive hashes, prompt, session snapshots, submission CSV, native scorer output, and result JSON.
- Repeatable runner: `eval/scripts/invoice_devin.py`.
- Execution roadmap: `eval/docs/EXTERNAL_BENCHMARK_PLAN.md`.

Next: freeze configuration and repeat for stability, then evaluate unseen inputs and the backend-connected system. Keep every run, including errors and timeouts; do not cherry-pick a best score.
