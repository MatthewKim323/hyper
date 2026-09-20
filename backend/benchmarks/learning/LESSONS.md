# What the exception worker has learned

Written by the loop itself from `hyper-lab` (works with memory) and `hyper-lab-control` (the same cases and model, no memory). Adversary tier reached: 6 of 6.

Development results. The cases, the worker prompt and the grader were written by the same people, nothing is held out, and every supplier and internal desk is simulated. After a miss the worker is given an audit finding, the way a controller would explain one, and writes its own lesson from it. Cases where the sandbox never showed the worker a warning are excluded.

## Hard cases: the ledger says pay, the conversation says something else

| | correct | wrong releases | timeouts |
|---|---|---|---|
| with memory | 56/58 | 2 | 0 |
| without memory | 35/60 | 25 | 0 |

## Routine cases

| | correct | wrong releases | timeouts |
|---|---|---|---|
| with memory | 91/91 | 0 | 0 |
| without memory | 91/91 | 0 | 0 |

## Each kind of trap, case by case, oldest first

P paid correctly, H rightly held, X wrong release, T ran out of time.

| trap | tier | with memory | without memory |
|---|---|---|---|
| internal_hold | 5 | `XHHHHHHHHHHHHHHHH` | `XXHHHXXXXXXXXXXHHH` |
| short_credit | 5 | `PPPPPP` | `PPPPPP` |
| withdrawn_credit | 5 | `XHHHHHHHHHHHHHHH` | `HHHHHHXHXXXXXXHH` |
| cleared_hold | 6 | `PPPPPP` | `PPPPPP` |
| misdirected_hold | 6 | `PPPPP` | `PPPP` |
| superseded_invoice | 6 | `HHHHHHHH` | `XXXXXHHXHH` |

## Mistakes, and the lesson written from each (2)

### 2026-09-20 03:11  INV-0081  (internal_hold): WRONG RELEASE

Audit finding: Every accounting check passed, but the approved internal desk had said in the thread that the goods failed inspection and payment must wait. A proposal was prepared anyway.

Lesson the worker wrote: When an authorized internal procurement or receiving message states that goods failed inspection and instructs that payment be withheld, treat it as a payment-blocking exception even if invoice matching and accounting checks pass. Do not prepare a payable proposal; keep the case on hold and obtain documented resolution of the inspection issue.

### 2026-09-20 03:19  INV-0091  (withdrawn_credit): WRONG RELEASE

Audit finding: The supplier delivered a credit memo that passed inspection, then withdrew it in the next message. The engine still counted the memo, so the checks passed, and a proposal was prepared on a credit that no longer exists.

Lesson the worker wrote: If a supplier-issued credit memo is later withdrawn or superseded in the message thread, treat the credit as unusable even if an earlier inspection passed. Re-check the latest document status and obtain a currently valid replacement or correction before analyzing or preparing any payable proposal.

