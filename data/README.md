# Meridian: Synthetic Company Financial History

A researched, reproducible financial corpus for MIRROR's general company-discovery and finance-agent demo. The fictional company is **Meridian Ledger Labs, Inc.**, a crypto infrastructure SaaS business. Financial history covers **January 2025 through June 2026**.

This is a generated simulation, not real financial information or a claim of GAAP compliance. It has no live payment addresses, private keys, real counterparties, or external communication side effects.

## Start here

- `research/RESEARCH.md`: researched financial principles, primary sources and policy questions.
- `research/FINANCIAL_RECORD_MAP.md`: how internal records connect.
- `research/COMPANY_HISTORY.md`: canonical business history and generated financial snapshot.
- `generated/visible/company.sqlite`: convenient SQL database of the financial tables.
- `generated/visible/`: canonical JSONL records, schema, selected CSV projections and initial AP fixtures.
- `generated/narratives/`: Luna-authored synthetic draft documents, separate from authoritative records.
- `generated/private/`: authoring packets, future counterparty responses and expected fixture outcomes. Do not give this to a financial defender.
- `swarm/runs/packet-NNN/`: each process's workspace, prompt, schema, raw output, stdout events, stderr, usage and provenance.

## Coverage

The base ledger has **115,348 rows across 39 tables**, including 65,520 daily usage records, 2,200 AR invoices, 1,080 AP invoices, 6,971 journals and 15,778 journal lines. It includes 48 staff, 120 customers, 60 vendors, subscription contracts, annual advance billings/deferred revenue, payroll and remittances, credits/allocations, purchase orders, service acceptance, prepayments/amortization, equipment/depreciation, treasury conversions, internal wallet transfers, bank/USDC settlements, aging, budgets, close checklists and 18 monthly management statement sets.

Usage volume is one meaningful source of scale; repeated CSV/SQLite representations are not counted as additional financial records. Narrative generation targets **102 independent Luna sessions × 6 documents = 612 drafts**. The completed run produced all 612 drafts from 102 distinct sessions. Completion and usage live in `generated/private/swarm-report.json`; targets are not a claim that every job succeeded.

Eighteen AP development fixtures model partial corrections, price/quantity differences, valid amendments, backorders, contested cancellation, missing credit evidence, duplicate invoice/credit delivery, unrelated credits, new receipts, recipient changes, missing records, silence, competing allocation and document prompt injection. They are separate unposted cases and do not inflate historical AP. These are checked development fixtures, not an untouched benchmark or evidence of agent performance.

## Reproduce the financial data

Requires Python 3.10+; standard library only. Run from the repository root. The generator rejects an existing nonempty output to protect prior runs.

```sh
python3 data/engine/generate.py --output data/generated --seed 20260919
python3 data/engine/fixtures.py data/generated
python3 data/engine/validate.py data/generated
python3 -m unittest discover -s data/engine -p 'test_*.py' -v
python3 data/package.py
```

For a fresh independent financial run, choose a new `--output` directory and pass it to `fixtures.py` and `validate.py`. `package.py`, the swarm and export helpers currently operate on `data/generated`.

## Run the actual Luna process pool

Requires an authenticated Codex CLI with access to `gpt-5.6-luna`. No API key is copied or embedded. Python launches a pool of separate **`codex exec` processes**, each with its own task, working directory and logs. Default concurrency is eight; it does not launch all 102 at once. See `swarm/README.md`.

```sh
python3 data/swarm/run.py --workers 8 --limit 102
python3 data/swarm/finalize.py
python3 data/package.py
```

Initial strict validation may reject a response's reference metadata when the model includes an existing contact name/email rather than a record ID. Finalization removes only those grounded non-ID references, accepts identifiers supplied through fields such as `accepted_by`, and preserves the original model text and raw output. It rejects invented references. Monetary mentions are checked against supplied monetary fields and flagged for review. These checks are not an independent semantic certification of every sentence.

## Export for an agent

```sh
python3 data/export.py data/exports/meridian-v1
python3 data/export.py data/exports/meridian-v1-with-drafts --include-drafts
```

Exports require a new destination. Only the explicit `visible` directory and optionally labeled narrative drafts are included, with checksums. Mount the export alone in the evaluated agent's environment. Folder separation and read-only mode alone do not prevent access to sibling private files. Full historical exports are company-discovery input; temporal evaluations require an as-of source filter. Staged future AP evidence must be delivered by a separate counterparty process.

## Checks and limits

Validation checks double entry, posting cutoff, source references, nonnegative liquid asset balances, payment/credit allocations, counterparty identity, settlement-to-ledger agreement, monthly statement/ledger agreement, balance-sheet identity, income/equity and bank-cash rollforwards, AP/AR/aging, usage billing, prepaids and depreciation. Mutation tests deliberately break several of these links and must fail validation. Fixture tests deduplicate credits and independently recompute supported net amounts; they do not constitute a full workflow engine.

The dataset uses a fixed population and synthetic recurring activity; it does not model churn, hiring ramps, market prices, native-chain gas tokens, customer custody, token issuance, tax filing, jurisdiction-specific payroll, credit losses or all close adjustments. USDC is valued at a declared simulated $1 and is separate from bank cash. Bank cash-flow projections are management views with an explicit simplifying classification policy. External settlement records are generated from shared events, so reconciliation consistency does not demonstrate real integration accuracy.

The model-written corpus consists of draft emails, chats, operational notes, contract-field excerpts, questions and follow-ups. It does not establish new signed agreements, approvals, payments or legal terms. Treat the structured source records as authoritative within the simulation.

Generated financial records, narrative drafts, private synthetic fixture answers, and the compressed agent-facing bundle are versioned in Git. Raw process logs, temporary build workspaces, and expanded duplicate exports remain local and ignored. Private fixture answers are simulation truth, not real company secrets; do not expose them to the evaluated agent. Generation scripts do not upload or publish data.
