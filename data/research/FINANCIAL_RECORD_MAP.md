# How internal financial records connect

This design translates the research into a synthetic operating corpus. It is a simulation specification, not a claim that all these workflows have been implemented or that statements meet every reporting requirement.

## The record layers

1. **Commercial agreements:** customer contracts, vendor statements of work, amendments, approval terms. Establish what was agreed, not that it was delivered or paid.
2. **Operational evidence:** API usage, service acceptance, employee service, asset receipt. Establish what occurred and when.
3. **Subledgers:** invoices, credits, receivables, payables, payment allocations, payroll, asset and prepaid schedules. Maintain individual obligations and remaining balances.
4. **Settlement evidence:** bank transactions, provider statements, simulated token transfers and settlement states. Movement alone does not establish business purpose.
5. **General ledger:** balanced postings with source references. Records the accounting interpretation; may differ from an unposted disputed supplier claim.
6. **Close and reporting:** rollforwards, reconciliations, trial balances, statements, budgets and variance commentary derived from the records above.
7. **Correspondence:** explanations, requests, disagreements and approvals. A promise or claim does not automatically supersede an authoritative financial record.

## Required distinctions

| Event | Financial meaning in this simulation |
|---|---|
| Equity funding received | Bank asset and contributed equity increase; no revenue |
| Monthly service performed and invoiced | AR and earned revenue increase |
| Customer billed in advance | AR increases with deferred revenue; earnings follow service delivery |
| Customer settles in USDC | AR falls, company-owned USDC rises; bank cash is unchanged |
| USD converted into USDC | One company asset exchanged for another, with fees separately identified |
| Own-wallet transfer | Asset moves between wallet accounts; no customer revenue or supplier expense |
| Vendor service accepted/invoiced | Expense or eligible asset and AP increase |
| Verified supplier credit | The supported obligation is reduced once, within its scope |
| Vendor payment confirmed | AP and the settlement asset decrease |
| Payment proposal approved | Authority recorded; no bank movement by itself |
| Annual service prepaid | Asset initially; amortized across supported service periods |
| Equipment purchased | Fixed asset initially; depreciation follows declared useful life |
| Payroll processed | Gross expense, deductions/payables, net payout and later remittance distinguished |

## Period close

For every month, recompute balances from postings. Reconcile AP and AR to their item-level outstanding balances, bank accounts and wallets to their movements, prepaids to unamortized schedules, fixed assets to cost less accumulated depreciation, and deferred revenue to unearned service. Tie equity to contributions plus cumulative profit/loss. Separate USD bank cash flow from non-bank token movements.

Statements are projections of transactions. Never independently invent a balance sheet merely because its totals look plausible.

## Onboarding research opportunities

Company ownership of a wallet; exact redemption/custody rights; contract coverage dates; whether a reply confirms delivery or merely promises it; service acceptance authority; which export timestamps mean settlement versus initiation; why a recurring vendor invoice differs; whether an annual billing represents earned or future service; whether a policy changed prospectively.

A capable agent can decide which of these to investigate. Dataset construction must ensure an answer is discoverable from the permitted source records, available through a counterparty response, or explicitly unknown. Hidden truth is for simulation and grading, not an agent retrieval index.

## Research anchors

- SEC financial statements introduction: https://www.sec.gov/about/reports-publications/investorpubsbegfinstmtguide
- Oracle subledger reconciliation: https://docs.oracle.com/en/cloud/saas/financials/25d/faugl/account-reconciliation-and-subledgers.html
- Oracle invoice matching: https://docs.oracle.com/en/cloud/saas/financials/25d/fappp/matching-invoice-lines.html
- Oracle credit memo matching: https://docs.oracle.com/en/cloud/saas/financials/25d/fappp/payables-credit-memo-matching-report.html
- FASB scope criteria: https://storage.fasb.org/ASU%202023-08.pdf
- Circle tokenization/redemption: https://help.circle.com/support/en/tokenizing-and-redeeming-usdc?id=kb_article_view&sysparm_article=KB0010781

The precise synthetic amounts, company policies, rates and thresholds are invented. No real company records, credentials, wallet keys, or individual payroll data are used.
