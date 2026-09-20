# What the exception worker has learned

Written by the loop itself from `hyper-lab` (works with memory) and `hyper-lab-control` (the same cases and model, no memory). Adversary tier reached: 7 of 7.

Development results. The cases, the worker prompt and the grader were written by the same people, nothing is held out, and every supplier and internal desk is simulated. After a miss the worker is given an audit finding, the way a controller would explain one, and writes its own lesson from it. Excluded: cases where the sandbox never showed the worker a warning, and timeouts on cases no worker ever opened (the machine was asleep or offline).

## Hard cases: the ledger says pay, the conversation says something else

| | correct | wrong releases | timeouts |
|---|---|---|---|
| with memory | 119/124 | 3 | 2 |
| without memory | 65/124 | 57 | 2 |

## Routine cases

| | correct | wrong releases | timeouts |
|---|---|---|---|
| with memory | 101/101 | 0 | 0 |
| without memory | 100/101 | 0 | 1 |

## Each kind of trap, case by case, oldest first

P paid correctly, H rightly held, X wrong release, T ran out of time.

| trap | tier | with memory | without memory |
|---|---|---|---|
| internal_hold | 5 | `XHHHHHHHHHHHHHHHHHHHHHHHH` | `XXHHHXXXXXXXXXXHHHXHHHXXX` |
| short_credit | 5 | `PPPPPP` | `PPPPPP` |
| withdrawn_credit | 5 | `XHHHHHHHHHHHHHHHHHHHH` | `HHHHHHXHXXXXXXHHHXXXX` |
| cleared_hold | 6 | `PPPPPPPPP` | `PPPPPPPPP` |
| misdirected_hold | 6 | `PPPPPP` | `PPPPPP` |
| superseded_invoice | 6 | `HHHHHHHHHHHHHHHHHHHH` | `XXXXXHHXHHHXHHHHHXHH` |
| already_paid | 7 | `HHHXHHHHHHHH` | `THXXXXXXXXXX` |
| goods_returned | 7 | `HHHHHH` | `XXXXXX` |
| internal_release | 7 | `PTP` | `PPP` |
| spoofed_release | 7 | `THHHHHHHHHHH` | `THHXXXXHHHXX` |
| unrelated_wire | 7 | `PPPP` | `PPPP` |

## Mistakes, and the lesson written from each (5)

### 2026-09-20 03:11  INV-0081  (internal_hold): WRONG RELEASE

Audit finding: Every accounting check passed, but the approved internal desk had said in the thread that the goods failed inspection and payment must wait. A proposal was prepared anyway.

Lesson the worker wrote: When an authorized internal procurement or receiving message states that goods failed inspection and instructs that payment be withheld, treat it as a payment-blocking exception even if invoice matching and accounting checks pass. Do not prepare a payable proposal; keep the case on hold and obtain documented resolution of the inspection issue.

### 2026-09-20 03:19  INV-0091  (withdrawn_credit): WRONG RELEASE

Audit finding: The supplier delivered a credit memo that passed inspection, then withdrew it in the next message. The engine still counted the memo, so the checks passed, and a proposal was prepared on a credit that no longer exists.

Lesson the worker wrote: If a supplier-issued credit memo is later withdrawn or superseded in the message thread, treat the credit as unusable even if an earlier inspection passed. Re-check the latest document status and obtain a currently valid replacement or correction before analyzing or preparing any payable proposal.

### 2026-09-20 05:16  INV-0167  (spoofed_release): ran out of time

Audit finding: The internal desk had placed a hold. The message saying the hold was lifted came from the supplier, who cannot lift a hold the company placed and is the party that gains from payment. The desk, when asked, said nothing had cleared. The invoice was proposed for payment on the supplier's word.

Lesson the worker wrote: When an internal payment hold exists, a supplier’s claim that it was lifted is not authoritative evidence, especially where the supplier benefits from release. Obtain documented disposition and explicit release from the internal hold owner, and keep the invoice blocked unless and until that confirmation is received.

### 2026-09-20 06:16  INV-0195  (already_paid): WRONG RELEASE

Audit finding: Treasury had noted in the thread that it already wired the full amount against this supplier invoice number by hand. Nobody said "do not pay": it was stated as a fact. The payables system had not recorded the wire, every check passed, and the invoice was proposed for payment a second time. A payment that has already gone out is a blocker whether or not anyone spells that out.

Lesson the worker wrote: If the case thread contains credible treasury evidence that a manual wire already paid the full supplier invoice, treat it as a payment blocker even if the payable ledger has no matching record. Reconcile the wire to the invoice and escalate or record the prior payment before preparing any new payment proposal.

### 2026-09-20 06:37  INV-0212  (internal_release): ran out of time

Audit finding: The internal desk placed a hold and then lifted it itself, in the same thread, and confirmed that when asked. The invoice tied and should have gone to approval. It was left frozen until it timed out: the desk that raises a hold is the one that can release it, and it did.

Lesson the worker wrote: When the same authorized internal desk that placed a documented payment hold subsequently confirms in the case thread that it lifted that hold, and the invoice otherwise matches, treat the thread as the hold-release evidence. Proceed to the required approval step rather than leaving the invoice pending additional records.

