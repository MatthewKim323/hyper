# Evaluation protocol

Written before any subject agent was measured. Change it by pull request, not after looking at results.

## Layers

| layer | what it answers | suites | state today |
| --- | --- | --- | --- |
| A. external | how the system does on other people's tasks | apex_public_dev, dabstep, finance_agent_v1, finance_agent_v2_public, benchrec, invoice_sandbox, accountingbench (never claimed) | all pending source verification, none run |
| B. workflow | does it finish real AP exception work correctly, end to end | ap_workflow | 18 development fixtures, grader proven, no subject run |
| C. crypto | does it interpret crypto-native economics | crypto_native (C01 to C12) | registered, not implemented |
| D. reliability | recovery, concurrency, duplicates, stale data | reliability | registered, not implemented |

Execution, provenance and outcome are separate fields everywhere. A completed run of a custom suite is
not an external result, and an external score returned by a publisher is not independent validation.

## Visibility contract

The agent may see: the one visible case JSON copied into a fresh temp workspace, and whatever the
counterparty simulator returns when asked.

The agent may never see: anything under `data/generated/private`, the keys `expected_*`, `invariants`,
`reason`, `solver_must_not_read_this`, `development_family`, `counterparty_events`, `allowed_sequence`,
staged future documents before requesting them, the grader, other trials' outputs, or `eval/runs`.

Enforced by: `expose_inputs` (copies one file, refuses private paths and symlinks, scans for forbidden
keys), and tests in `tests/test_visibility.py`, including one that fails if any module outside
`mirror_eval/grading/` names the private tree or the truth type.

Not enforced by this harness: process isolation. Threads share a filesystem with the repo. A real
subject run should execute the agent in a container or VM that mounts only the workspace. See LIMITATIONS.

## Defender and evaluator are separate

- Defender: the agent and its backend. It gets the workspace, the counterparty handle and limits.
- Evaluator: this harness. It owns private truth, the counterparty simulator, the grader and the run records.
- The oracle and the self-test doubles are evaluator tools. They are never registered as subjects.
- Whoever tunes the agent does not edit the grader in the same change. Grader changes bump `GRADER_VERSION`,
  and runs graded under different versions are not comparable (`compare` checks this).

## Grading rules (ap_workflow)

The grader reads the persisted `CaseFinalState`. `agent_claimed_done` is recorded and ignored.
No check depends on tool-call order.

Control checks (any failure means `fail`, listed in `control_failures`):
`cash_unchanged`, `no_repeated_credit_allocation`, `credits_supported` (each applied credit is VERIFIED or
ALLOCATED, backed by an applicable credit memo for this invoice, at the memo's amount, not already allocated
elsewhere), `recipient_unchanged`, `approval_current` (over the policy threshold: required, present,
human-decided, bound to the current proposal), `single_financial_effect`, `no_unsupported_release`,
`no_invalid_action_accepted`, `no_duplicate_messages`.

Core checks: `disposition_matches`, `net_exact` (exact cents), `credit_set_complete`, `arithmetic_ties`,
`justified_hold` (at least one open issue with a responsible party and a next action).

Quality checks: `evidence_sufficient` (cites the invoice, every applicable credit memo, any later receipt,
any price amendment), `review_independent_pass`.

| expected | state | outcome |
| --- | --- | --- |
| payment ready | all checks ok | pass |
| payment ready | control and core ok, quality not | partial |
| payment ready | WAITING with a justified hold, no control failure | waiting |
| hold (WAITING or ESCALATED) | same hold class, justified | correct_escalation |
| hold | same, but invoice not cited | partial |
| anything | any control failure or core failure otherwise | fail |
| anything | no gradable state (crash, timeout, malformed) | error |

Success means `pass` or `correct_escalation`. Nothing else counts toward whole-task success.
Doing nothing never counts as a justified hold.

Private `invariants` strings are mapped to checks in `INVARIANT_CHECKS`. A string with no mapping is
reported in `unchecked_invariants` on every grade. Today all four strings are mapped.

## Statistics

- Every rate is computed per task, then averaged over tasks. Unit is `ratio` in 0..1.
- pass@1: mean over tasks of the task's trial pass rate. Success at least once in k and success on all k
  are computed per task. Success on all k is never pass@1 raised to the k.
- Intervals: family-level (cluster) bootstrap, 2000 resamples, seeded, 95% percentile. Wilson intervals
  for plain proportions. ap_workflow has one case per family today, so its intervals are wide. That is correct.
- Comparisons are paired by task: both_pass, gained, regressed, both_fail, unavailable, with a paired
  bootstrap on the difference. A task's outcome over k trials is its worst trial.
- n = 0 gives `Unavailable`, never 0.

## Timeouts, crashes, cancellations

A timeout, an agent exception, malformed output or a missing final state becomes an `error` trial. It is
persisted, counted against pass rates, and listed in the run's `incidents`. A trial that never started
(run cancelled, spending cap reached) is persisted as `not_tested` with the reason. Nothing is dropped
and nothing is rerun silently. The spending cap uses adapter-reported cost. If the adapter does not
report cost, the run says so in `incidents` and cost is `Unavailable`.

## Promotion gates

Set before seeing results. **TODO for humans: these thresholds are not set. They must be set, and
committed, before any candidate run.** A gate chosen after looking at a candidate's numbers is not a gate.

- [ ] TODO: minimum whole-task success on ap_workflow (lower CI bound, not the point estimate): ____
- [ ] TODO: maximum `invalid_actions_accepted` and control failures across a run (suggest zero, confirm): ____
- [ ] TODO: minimum correct-escalation rate on hold cases: ____
- [ ] TODO: minimum success on all k, and k: ____
- [ ] TODO: maximum regressed tasks allowed versus the previous promoted system: ____
- [ ] TODO: cost and wall-time ceilings per task: ____
- [ ] TODO: which suites must have a run at all before a version is called promoted: ____
