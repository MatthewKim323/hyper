# Meridian Ledger Labs, Inc. — financial research

## purpose and boundary

This memo supplies accounting and operating context for a synthetic internal-financials dataset. Meridian Ledger Labs, Inc. is fictional. It is a single U.S. legal entity reporting in USD for 1 January 2025 through 30 June 2026. It provides crypto infrastructure SaaS and does not custody customer assets or issue a token. The dataset may include company-owned USDC used for treasury and vendor/customer settlement, but those holdings are not customer reserve assets.

The facts in the company profile, operating history, headcount, customer/vendor counts, funding, amounts, counterparties, and controls are invented for simulation. The accounting principles and source summaries below are research, not claims about Meridian's actual books. Exact monthly values should be generated later from the history and policy choices; this memo intentionally does not invent them.

## researched accounting principles

### crypto-asset scope and measurement

FASB ASU 2023-08, *Intangibles—Goodwill and Other—Crypto Assets (Subtopic 350-60)*, requires in-scope crypto assets to be measured at fair value each reporting period with changes in net income. The scope is limited and includes conditions such as being created or secured through cryptography, recorded on a distributed ledger, and not created or issued by the reporting entity or its related parties. The update also requires separate presentation and disclosures. It is effective for fiscal years beginning after 15 December 2024, including interim periods within those years.

This is a scope question, not a universal “all crypto is fair value” rule. A USDC balance can have a redemption claim and may fall under financial-instrument or cash-equivalent analysis rather than the crypto intangible model. A recent SEC filing illustrates the judgment: one issuer accounts for USDC as a receivable at expected redemption value, while Coinbase's 2025 filing elected to classify payment stablecoins as cash equivalents. These are entity-specific facts and policies, not a blanket conclusion for Meridian.

For this dataset, a **simulated fixed $1 measurement assumption** is permitted for company-owned USDC used in operating settlement. It is an explicit modeling simplification and does not assert that every holder may carry USDC at $1, that it is cash, or that U.S. GAAP requires that result. A production ledger would document the instrument terms, redemption access, counterparty/credit risk, liquidity, classification, and the applicable U.S. GAAP policy before posting.

### USDC settlement and separation from bank cash

Circle's terms state that each USDC is intended to maintain a one-dollar value, that one USDC is redeemable for one USD subject to the terms, law, and fees, and that transfers are generally irreversible. Circle's transparency materials describe reserves held for USDC holders separately from Circle's operating funds. Those facts support modeling a treasury wallet as a distinct asset and recording conversions, receipts, payments, and internal transfers with explicit wallet and bank endpoints.

Meridian is not Circle and does not hold customer reserves. Its company-owned USDC should therefore be tracked separately from USD bank cash for operational control, even if the synthetic policy treats both as $1 for measurement. A conversion from bank USD to USDC is an internal asset reclassification; a vendor payment or customer receipt is an external settlement event; a transfer between Meridian wallets is an internal transfer. Network fees, failed or delayed settlement, address errors, and irreversibility are operational risks that should be represented in reconciliation notes or exception states.

SEC-filed financial statements demonstrate that presentation can differ. Coinbase's 2025 annual report says it changed its policy to classify payment stablecoins including USDC, EURC, and PYUSD as cash equivalents and applied the change retrospectively. Another 2025 SEC filing presents USDC separately from cash and cash equivalents and describes an ASC 310 receivable analysis. The dataset should preserve the policy choice as a Meridian assumption rather than imply a universal answer.

### SaaS revenue, billings, AR, and deferred revenue

ASC 606's five-step model is: identify the customer contract; identify performance obligations; determine transaction price; allocate transaction price; and recognize revenue when or as each obligation is satisfied. SEC-filed SaaS companies commonly describe hosted access as a stand-ready service and recognize subscription revenue ratably over the service term. Amounts billed or collected before service are contract liabilities (deferred revenue), while earned consideration not yet billable may be a contract asset. Current versus noncurrent classification follows the expected recognition horizon.

Meridian's default synthetic policy can therefore model enterprise subscriptions as hosted access recognized ratably from the service commencement date, with annual prepayments recorded first as deferred revenue and released as service is delivered. Implementation, support, usage, or professional services must be assessed separately when contracts contain distinct promises; the dataset should label any such policy rather than silently treating every invoice as subscription revenue. Late collection affects AR and cash timing, not the satisfaction date of the SaaS obligation. Credit memos, disputed invoices, refunds, and expected credit losses should be separate events or adjustments with an explanation.

### AP, contractors, and operating costs

Meridian's likely costs are cloud infrastructure, security tools, contractors, outside legal/accounting, payroll and benefits, and ordinary office/software spend. Vendor invoices should be represented in AP with invoice date, service period, due date, vendor, dispute status, and GL classification. Services received before invoice or payment require an accrual/cutoff decision; annual vendor prepayments may be prepaid assets released over the coverage period. A disputed invoice can remain in AP while its coding, amount, or due date is under review; the dataset should not erase the commercial history merely to make the subledger balance.

Oracle's official Financials documentation is useful as a process reference. Its Payables-to-GL reconciliation guidance says AP is reconciled before and after posting, and its reports compare invoices, payments, liability accounts, business unit/ledger, and accounting dates. Its Receivables-to-GL guidance compares AR transactions and receipts with accounting, includes invoices, credit memos, chargebacks, adjustments, applied/unapplied receipts, and highlights differences. These are control and workflow patterns, not a requirement that Meridian use Oracle.

### cash, funding, and internal transfers

The January 2025 seed round is financing activity: cash received in exchange for equity or another explicitly defined instrument. The dataset should identify the instrument and avoid calling proceeds revenue. Transfers among Meridian's own bank accounts or wallets do not change total assets; they exist to test clearing, endpoint identity, and duplicate/missing-entry controls. Bank cash and company-owned USDC should reconcile by account/wallet, while a consolidated liquidity view may show both under the documented measurement policy.

## data design implications

The synthetic ledger should support:

- one legal entity, USD functional/reporting currency, accrual accounting, and a clear period-close cutoff;
- customer contract, subscription start/end, invoice, cash receipt, AR aging, dispute, credit memo, and deferred-revenue schedules;
- vendor, purchase order or approval reference, invoice, service period, AP aging, payment, prepaid, accrual, and dispute status;
- bank account, USDC wallet, conversion, blockchain settlement reference, network fee, and internal-transfer flags;
- journal source and subledger links so AR/AP/control accounts can be reconciled to the GL;
- audit fields for who/when/why, reversal or correction references, and an exception queue;
- period-end controls for bank reconciliation, wallet reconciliation, AR aging/allowance review, AP completeness, deferred-revenue rollforward, prepaid amortization, payroll/accrual cutoff, and seed-funding classification.

## specialized onboarding unknowns

Before generating transactions, a finance owner would need to answer:

1. Is Meridian's USDC held through Circle Mint, an exchange/custodian, or self-hosted wallets? Who can approve and sign transactions, and what wallet addresses are in scope?
2. What exact USDC accounting policy is selected for the synthetic period: separate current financial asset, cash equivalent, or another documented model? How are fees, depegs, impairments/credit losses, and period-end fair value handled?
3. What are the subscription contract terms, renewal/cancellation rights, implementation obligations, usage fees, customer credits, and sales commissions? Are any customers billed in USDC?
4. What is the chart of accounts, close calendar, materiality threshold, capitalization policy, tax treatment, and expected-credit-loss approach?
5. Which vendors are annual prepayments, which services are usage-based, and what approval/three-way-match evidence exists for contractor and cloud invoices?
6. What is the seed instrument (priced equity, SAFE, convertible note, or another form), issue date, cap table, and legal fees? Are there restrictions or side letters?
7. What bank accounts, payment processors, ERP/subledgers, payroll systems, and source exports are available, and what are the timezone/currency conventions?

## source availability and limitations

The strongest public sources are standards and public-company filings, but they do not provide Meridian-specific policy answers. FASB's ASU documents the amendment's scope and effective date; the Accounting Standards Codification is the authoritative source, while the synthetic fixed-$1 assumption is deliberately narrower. SEC filings are examples of disclosed policies and judgments from other entities; they are not authoritative interpretations of Meridian's facts. Circle's terms and transparency pages describe Circle's product and reserves, not Meridian's rights or solvency. Oracle documentation describes reconciliation workflows in Oracle products, not a required control framework.

No private contracts, bank statements, wallet exports, invoices, tax records, cap table, payroll register, or board approvals were supplied. Accordingly, no precise monthly revenue, expense, AR, AP, cash, USDC, headcount cost, or funding allocation should be inferred from this memo. Those values belong in the generated dataset and should be traceable to the fictional history and declared assumptions.

## sources

- [FASB ASU 2023-08 PDF](https://storage.fasb.org/ASU%202023-08.pdf) — scope, fair-value measurement, net-income presentation, disclosures, and effective date.
- [FASB announcement on ASU 2023-08](https://fasb.org/page/getarticle?isPrintView=true&uid=fasb_Media_Advisory_11-27-23) — rationale for fair-value accounting.
- [SEC: Coinbase 2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1679788/000167978826000015/coin-20251231.htm) — disclosed USDC cash-equivalent policy election and accounting-policy change.
- [SEC: Circle 2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1876042/000187604226000062/crcl-20251231.htm) — corporate-held stablecoin cash-flow discussion and reserve segregation disclosures.
- [SEC: 2025 filing presenting USDC separately from cash](https://www.sec.gov/Archives/edgar/data/1530766/000149315226038293/form10-q.htm) — example of a receivable/current-asset analysis and scope judgment.
- [Circle USDC Terms](https://www.circle.com/legal/usdc-terms) — redemption, intended one-dollar value, and transfer/irreversibility terms.
- [Circle transparency and stability](https://www.circle.com/transparency) — reserve separation, redemption, and assurance descriptions.
- [SEC: CCC 2025 Form 10-K revenue note](https://www.sec.gov/Archives/edgar/data/1818201/000119312526067448/ccc-20251231.htm) — ASC 606 five-step model, hosted subscription ratable recognition, and contract liabilities.
- [Oracle Receivables predefined reports](https://docs.oracle.com/en/cloud/saas/financials/25d/faofc/oracle-receivables-predefined-reports.html) — AR aging, receipt, and reconciliation report patterns.
- [Oracle Payables-to-GL reconciliation setup](https://docs.oracle.com/en/cloud/saas/financials/25d/fappp/considerations-for-setting-up-for-payables-to-general-ledger.html) — AP reconciliation before and after posting.
- [Oracle Receivables-to-GL reconciliation](https://docs.oracle.com/cd/E48434_01/doc.1118/e49609/F1113013AN1FBCB.htm) — transaction/accounting comparison and difference analysis.
