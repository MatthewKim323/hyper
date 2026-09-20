# Evidence-backed AP engineering upgrade

## Objective

Replace narrative-only invoice resolution with persisted, exact reconstruction of supported payable amounts. Demonstrate that a price-only credit cannot resolve a quantity discrepancy, and that later evidence invalidates the previous proposal.

## Implementation

1. Install the existing local `mirror-resolve` package as a backend dependency and create its accounting tables in the same database. Serialize accounting changes by organization.
2. Link immutable backend source rows to versioned engine records with source hashes, row locators and the verifying user. Only an authenticated organization owner can attest records. An LLM cannot promote its own extraction to trusted evidence. Namespace record IDs per organization to isolate global engine credit IDs.
3. Expose engine-backed inventory, case opening, analysis, credit inspection and proposal preparation through HTTP and shared agent tools. Use integer minor units and explicit currency; reconstruct amounts from invoice, PO, receipt, contract and credit records.
4. Validate stated totals, vendor/currency compatibility, PO quantities, linked agreements, cumulative credits and unambiguous receipt allocation. Block unsupported or ambiguous cases. Never silently convert currency or invent missing records.
5. Prepare proposals with exact hashes and engine validation. Owner-only human approval is distinct from concern responses. No commit, payment, bank-change or source-verification tools are available to agents.
6. Invalidate dependent proposals when a raw backing source is replaced. After trusted evidence changes, reverify credit applicability. Preserve audit records and old revisions.

## Acceptance

- $120,000 invoice → $20,000 price credit leaves quantity exception blocked.
- Supplier acknowledgment and a verified $20,000 quantity credit permit an $80,000 proposal.
- Changed receipt or replaced raw source invalidates the earlier proposal.
- Duplicate/cumulative excess credits, wrong currency, altered totals, stale revisions and cross-organization access fail closed.
- Backend and standalone engine regression suites pass.

## Boundaries

Structured record attestation is a deliberate human checkpoint, not automatic forensic verification. This first bridge supports whole-unit, tax-exclusive AP records in USD/EUR/GBP. Partial payments, tax/fee accounting, fractional quantities and ambiguous receipt allocations require explicit additional models. The policy remains the named synthetic demo policy, not an inferred or universal company policy. There is no external payment or ledger posting route. Counterparty simulation and the benchmark agent adapter remain separate work.
