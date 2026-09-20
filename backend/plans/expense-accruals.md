# Expense Accruals: Implementation Plan

## Outcome
A confirmed $40,000 September service delivery with no recorded expense produces a $40,000 debit to expense and credit to accrued liabilities for September 30, plus a proposed inverse journal on October 1. It remains an unposted proposal until the owner reviews the evidence. Later imported evidence tracks the posting, reversal and explicitly allocated invoice.

## Accounting basis and boundary
IAS 37 paragraph 11 distinguishes accruals for received goods/services not yet paid/invoiced from more uncertain provisions: https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/ias-37-provisions-contingent-liabilities-and-contingent-assets.pdf?bypass=on .
This implementation supports fixed-rate service expenses with whole-unit confirmed delivery, in USD/EUR/GBP. It does not infer performance from a purchase commitment alone, nor claim general accounting-standards compliance. Taxes, capitalization, prepayments, variable-price contracts, fractional quantities, FX and prior-period corrections need separate treatment. Prior-period deliveries block because aggregate ledger entries do not prove their allocation.

## Implemented plan
1. Load three immutable normalized source packets: contract/rate/account mapping, deliveries and complete posted expense ledger for one obligation.
2. Filter delivery and postings at month-end. Compute quantity × price in integer minor units. Subtract net posted expense, including explicitly linked accrual reversals. Exclude future delivery/postings from cutoff totals.
3. Block uncertain/incomplete/duplicate evidence, over-authorized quantities, wrong vendor/currency/obligation, invalid reversal links, overbooked expense, prior-period scope and invalid dates/accounts.
4. Persist hash-bound proposals, citations, approval actor/time. Owner-only approval; agent tools cannot approve. Keep previous approved obligation/cutoff reserved even if stale, since a journal might already have been posted externally.
5. Expose the same preparation/read/tracking operations to HTTP, dashboard voice/text and Devin workers. Existing concern tools handle escalations.
6. Persist lifecycle observations from reports explicitly allocated to the accrual: original posting, expected next-day reversal and eventual invoice amounts. Surface outstanding invoice balance and exceptions. No ledger writes.
7. Test arithmetic/cutoff, journal balance, reversal validation, partial invoices, idempotency, freshness, tenant and approval boundaries; run PostgreSQL smoke test.

## Agent responsibilities
Discover evidence with existing dataset/search tools, identify candidate obligations from receipts versus ledger, call the calculation tool, investigate issues and raise concerns with citations. Never manufacture delivery, report completeness, account mapping or invoice allocation. Historical closes can suggest a policy, but this release does not learn or activate accounting policies automatically.

## Limitations and next steps
Normalized upload contracts are required; arbitrary document extraction and autonomous corpus-wide completeness discovery are not delivered by this engine. Owner attestation establishes report completeness and account mapping, not an independent provider signature. Lifecycle results are observations of supplied evidence, not external posting confirmations. There is no scheduled reversal execution. Corrections after approval currently fail closed and require a future explicit supersession/disposition workflow rather than silently approving another journal. Future releases can add provider-backed ledger adapters and approved historical policy suggestions.
