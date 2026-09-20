# What happens after AP

Hyper resolves accounts-payable exceptions. It does not run payments, keep the general ledger, close the books or forecast cash. A resolved payable still has to reach all four, so an approved proposal is packaged for each of them. Nothing here pays, posts or books: `boundary` is always `prepared_not_posted`.

`GET /accounting/proposals/{proposal_id}/handoff` (Clerk bearer, organization scoped, read only)

`ready` is true only when an owner approved this exact hash and every code check still passes (or it was already committed). Downstream systems should act on `ready: true` and nothing else. `state` is `not_requested | pending | rejected | approved | committed`.

| Section | For | What it carries |
|---|---|---|
| `payment` | Payment run, treasury | `vendor_id`, `vendor_name`, `remit_account_ref` from the owner-verified vendor master, `remit_verified`, `amount_cents`, `currency`, `invoice_id`, `invoice_number`, `invoice_date`, `terms_days`, `due_date` |
| `ledger` | General ledger | `type: AP_RECOGNITION`, `reference`, balanced `entries` (`account`, `debit_cents`, `credit_cents`), `balanced`, and `econ_id` plus `committed_at` once recognised |
| `close` | Controller, month-end, audit | every issue with its status, `credits_applied`, the approval (`decided_by`, `decided_at`, `proposal_hash`), the verified `evidence` rows with source SHA-256, and the `checks` re-run now |
| `forecast` | Cash forecasting, FP&A | `cash_out_cents`, `expected_date`, `billed_cents`, `avoided_cents` (what the resolution saved against the bill), `credits_cents`, `basis` |

Amounts are integer minor units. IDs are the original record IDs with the tenant namespace removed.

Payment terms are not part of the verified vendor master. `due_date` and `expected_date` are derived from the imported `vendors` dataset (`terms_days`) when that vendor is listed; otherwise they are null and `forecast.basis` is `no_payment_terms_on_file`. A date is never guessed.

## Recognising the payable

`POST /accounting/proposals/{proposal_id}/commit` with `{"proposal_hash": "..."}`, organization owner only, no agent tool.

Runs the engine's `commit_proposal`: allocates the verified credits, writes one `AP_RECOGNITION` economic event with the balanced entries, and moves the case to `RESOLVED` and `PAYMENT_READY`. It is idempotent on the proposal hash, so a retry returns the same `econ_id` with `replayed: true`. Payment-ready is not paid: no cash entries exist in this engine.

## Not covered

FX, tax, partial payments, payment batching, bank file formats, accrual reversal on recognition, and posting into an ERP. The packet is the contract those integrations would consume.
