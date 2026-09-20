# Accounting workflow research and implementation plan

## Decision
Implement processor settlement → bank reconciliation as the next workflow after AP. Agents retrieve and investigate; a deterministic engine proves the supplied batch arithmetic and bank match. This is an evidence review, not a general ledger close or authorization to move money.

## Research (2026-09-19)

| Workflow | Why difficult | Useful agent work | Required engineering |
| --- | --- | --- | --- |
| Processor settlement reconciliation | Many sales/refunds/disputes/fees/reserves become one deposit; reference ambiguity and timing gaps | Obtain complete reports, explain exceptions, request missing bank evidence | Signed integer arithmetic, identity matching, duplicate checks, independent payout and bank residuals |
| Revenue recognition | Contracts, performance obligations, modifications, variable consideration | Extract obligations and amendments with citations; ask for policy decisions | Approved recognition rules, schedules, allocations, reversal and catch-up calculations |
| Foreign-currency close | Different currencies, measurement dates, functional currency and exchange-rate selection | Find missing rates and explain exposure | Approved rate sources, dated valuations, separate realized/unrealized differences |

Adyen documents both transaction-level and batch-to-bank reconciliation: https://docs.adyen.com/reporting/settlement-reconciliation . Its settlement report distinguishes refunds, chargebacks, reserve movements, fees and payout references: https://docs.adyen.com/reporting/settlement-reconciliation/transaction-level/settlement-details-report .

Stripe's reconciliation report supplies payout membership for automatic payouts. Instant payouts cannot be assigned transaction membership by Stripe in the same way; do not infer membership from matching amounts: https://docs.stripe.com/reports/payout-reconciliation .

IFRS 15 describes the revenue recognition framework: https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/ . IAS 21 is the foreign-currency reference: https://www.ifrs.org/issued-standards/list-of-standards/ias-21-the-effects-of-changes-in-foreign-exchange-rates/ . These motivate future workflows, not a claim that this implementation provides standards-compliant close automation.

## Implemented sequence
1. Strict normalized report contracts, one processor batch and one bank statement; integer minor units, USD/EUR/GBP only.
2. Separate exact processor and bank residuals; explicit account/reference identity, duplicate, coverage and completeness checks.
3. Durable organization-scoped, content-hashed calculation snapshots with immutable source citations. Identical inputs reuse a run.
4. Shared HTTP and agent tools. Agents investigate and escalate using the existing concern system. Human owner verification is a separate API and not an agent tool.
5. Source replacement makes old verification stale. Reject reuse of a bank transaction across current verified runs.
6. Regression tests for arithmetic, blocking conditions, exact types, tenancy, freshness, owner-only verification and reuse.

## Boundaries
Normalized uploads are implemented; direct Stripe/Adyen report fetching is not. Source completeness and membership are declared, then owner-attested, not independently certified by provider APIs. No automatic FX, manual/instant payout reconstruction, split deposits, failed/reversed payouts, taxes, opening/closing processor balance roll-forward, or ledger posting. Unsupported movement kinds fail validation rather than becoming arbitrary adjustments. Dates are report-local dates; adapters must preserve provider time-zone semantics. Account/transaction IDs must be stable canonical provider IDs. A zero residual can still mask offsetting errors; it is not proof of source truth.

## Next expansion
Add provider-authenticated report adapters that establish membership, pagination completeness, and stable IDs; then multiple payouts/statement periods, reversals and partial bank settlements. Keep those as distinct contracts rather than silently weakening this check.
