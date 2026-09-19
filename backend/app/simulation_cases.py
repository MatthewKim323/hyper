"""Version 2 synthetic evidence cases. Scenario labels never enter source records."""
import hashlib
import random
from datetime import datetime, timedelta
from typing import Literal

Scenario = Literal[
    'clean', 'price_and_quantity', 'duplicate_invoice', 'revised_invoice',
    'split_approval', 'bank_change', 'partial_payment', 'payment_reversal',
    'misapplied_credit', 'late_receipt', 'fx_settlement', 'prepaid_expense',
    'tax_mismatch', 'wrong_entity',
]
SCENARIOS = list(Scenario.__args__)


def case_events(run, cycle, scenario):
    """A case is observable documents, not conclusions or an agent action script."""
    config = run['config']
    digest = hashlib.sha256(f"{config['seed']}:{cycle}:v2".encode()).digest()
    prefix = f"{run['id']}-{cycle + 1}"
    quantity, unit = 100 + digest[1], (50 + digest[2]) * 100
    total = quantity * unit
    vendor = f'sim-vendor-{digest[3] % 5}'
    entity = config['company_name'] + ' US LLC'
    contract, po, bill = (prefix + suffix for suffix in ('-contract', '-po', '-bill'))
    rows = []

    def add(kind, suffix, **facts):
        row = dict(id=prefix + '-' + suffix, company_name=config['company_name'],
                   legal_entity=entity, vendor_id=vendor, currency='USD', synthetic=True)
        row.update(facts)
        rows.append((kind, row))
        return row['id']

    add('contract', 'contract', unit_price_cents=unit, quantity=quantity,
        payment_terms='Net 30 after acceptance', status='signed',
        contract_reference=f'AGR-{cycle + 1001}')

    if scenario == 'split_approval':
        rows[0][1].pop('unit_price_cents')
        rows[0][1].pop('quantity')
        rows[0][1]['amount_cents'] = 1200000
        add('policy', 'policy', effective_date='2026-01-01', currency='USD',
            threshold_cents=1000000, required_role='controller',
            scope='Aggregate purchases for one vendor and project within 7 days; do not assess each invoice separately.')
        for n in (1, 2):
            add('purchase_order', f'po-{n}', contract_id=contract, project_id=prefix + '-project',
                amount_cents=600000, status='requested')
            add('bill', f'bill-{n}', purchase_order_id=f'{prefix}-po-{n}',
                invoice_number=f'INV-{cycle + 1001}-{n}', amount_cents=600000, status='open')
            add('approval', f'approval-{n}', invoice_id=f'{prefix}-bill-{n}',
                actor_role='department_manager', decision='approved', approved_amount_cents=600000)
        add('message', 'request', project_id=prefix + '-project',
            message='Both orders support the same office move. Please include both in the next payment batch.')
        return rows

    if scenario == 'prepaid_expense':
        rows[0][1].pop('unit_price_cents')
        rows[0][1].pop('quantity')
        rows[0][1]['amount_cents'] = 1200000
        add('contract', 'service-schedule', parent_contract_id=contract,
            service_start='2026-10-01', service_end='2027-09-30', amount_cents=1200000,
            recognition_terms='Recognize in equal monthly amounts over the service term.')
        add('bill', 'bill', contract_id=contract, amount_cents=1200000, status='open',
            description='Annual subscription, October 2026 through September 2027')
        add('journal_entry', 'journal', invoice_id=bill, accounting_date='2026-09-30',
            lines=[{'account': 'software_expense', 'debit_cents': 1200000, 'credit_cents': 0},
                   {'account': 'accounts_payable', 'debit_cents': 0, 'credit_cents': 1200000}])
        add('message', 'close', invoice_id=bill,
            message='September close review: check the expense timing against the attached service schedule.')
        return rows

    add('purchase_order', 'po', contract_id=contract, quantity=quantity,
        unit_price_cents=unit, amount_cents=total, status='approved')
    charged = unit + 2000 if scenario == 'price_and_quantity' else unit
    invoice_total = quantity * charged
    currency = 'EUR' if scenario == 'fx_settlement' else 'USD'
    if scenario == 'fx_settlement':
        for _, row in rows:
            row['currency'] = currency
    add('bill', 'bill', contract_id=contract, purchase_order_id=po,
        invoice_number=f'INV-{cycle + 1001}', quantity=quantity, unit_price_cents=charged,
        amount_cents=invoice_total, currency=currency, status='open')
    if scenario == 'wrong_entity':
        rows[-1][1]['legal_entity'] = config['company_name'] + ' EU Ltd'
    if scenario != 'late_receipt':
        add('goods_receipt', 'receipt', purchase_order_id=po,
            quantity=quantity - 20 if scenario == 'price_and_quantity' else quantity,
            currency=currency, status='accepted')

    if scenario == 'clean':
        add('approval', 'approval', invoice_id=bill, actor_role='controller', decision='approved',
            approved_amount_cents=total)
        add('bank_transaction', 'payment', invoice_id=bill, amount_cents=total,
            direction='outflow', status='posted', bank_reference=prefix + '-transfer')
    elif scenario == 'price_and_quantity':
        add('message', 'supplier', invoice_id=bill,
            message='We can credit the unit-price difference. The remaining shipment is still under discussion.')
        add('vendor_credit', 'credit', invoice_id=bill, amount_cents=quantity * 2000,
            reason='Unit price adjustment', status='issued')
        add('message', 'warehouse', purchase_order_id=po,
            message='No additional units have arrived. We have not agreed a cancellation with the supplier.')
    elif scenario == 'duplicate_invoice':
        add('bill', 'bill-copy', contract_id=contract, purchase_order_id=po,
            invoice_number=f' inv {cycle + 1001} ', quantity=quantity, unit_price_cents=unit,
            amount_cents=total, vendor_display_name='Vendor Accounts Receivable', status='open')
        add('message', 'resend', attachment_id=prefix + '-bill-copy',
            message='Resending our invoice through the shared mailbox because the portal upload timed out.')
        add('bank_transaction', 'payment', invoice_id=bill, amount_cents=total,
            direction='outflow', status='posted')
    elif scenario == 'revised_invoice':
        add('message', 'revision-notice', invoice_id=bill,
            message='Please replace the original invoice with revision R1, which includes the agreed goodwill discount.')
        add('bill', 'bill-r1', replaces_invoice_id=bill, purchase_order_id=po,
            invoice_number=f'INV-{cycle + 1001}-R1', subtotal_cents=total,
            discount_cents=5000, amount_cents=total - 5000, status='open')
        add('statement', 'statement', listed_invoice_ids=[bill, prefix + '-bill-r1'],
            balance_cents=2 * total - 5000, message='Statement generated before invoice replacement was processed.')
    elif scenario == 'bank_change':
        add('vendor_profile', 'vendor', beneficiary_account='SIM-ACCOUNT-OLD',
            verification_status='verified', verified_by='vendor_master_team')
        add('message', 'bank-request', invoice_id=bill, sender='collections@vendor-payments.example',
            requested_beneficiary_account='SIM-ACCOUNT-NEW',
            message='Our banking details changed. Please use the attached account for this payment; it is urgent.')
        add('policy', 'bank-policy', rule='Bank-detail changes require an independent callback to the existing vendor contact and vendor-master approval.')
        add('approval', 'approval', invoice_id=bill, actor_role='budget_owner',
            decision='approved', scope='Invoice amount only', approved_amount_cents=total)
    elif scenario == 'partial_payment':
        paid = total * 3 // 5
        add('bank_transaction', 'payment', invoice_id=bill, amount_cents=paid,
            direction='outflow', status='posted')
        add('remittance', 'remittance', invoice_id=bill, amount_cents=total,
            status='scheduled', message='Batch instruction for full invoice amount; this is not settlement confirmation.')
        add('statement', 'statement', invoice_id=bill, balance_cents=total - paid)
    elif scenario == 'payment_reversal':
        payment = add('bank_transaction', 'payment', invoice_id=bill, amount_cents=total,
                      direction='outflow', status='posted')
        add('journal_entry', 'journal', invoice_id=bill,
            lines=[{'account': 'accounts_payable', 'debit_cents': total, 'credit_cents': 0},
                   {'account': 'cash', 'debit_cents': 0, 'credit_cents': total}])
        add('bank_transaction', 'return', reverses_transaction_id=payment, invoice_id=bill,
            amount_cents=total, direction='inflow', status='posted', reason='Beneficiary account rejected')
    elif scenario == 'misapplied_credit':
        other = add('bill', 'other-bill', invoice_number=f'INV-{cycle + 9001}',
                    amount_cents=10000, status='open', description='Prior service call')
        add('vendor_credit', 'credit', invoice_id=other, amount_cents=10000, status='issued')
        add('payment_proposal', 'proposal', invoice_id=bill, applied_credit_id=prefix + '-credit',
            amount_cents=total - 10000, status='draft')
        add('message', 'credit-terms', invoice_id=other,
            message='This credit is restricted to the prior service-call invoice and cannot be transferred to other purchases.')
    elif scenario == 'late_receipt':
        add('message', 'warehouse', purchase_order_id=po,
            message='The receiving-system upload is delayed. Checking the signed acceptance record.')
        add('goods_receipt', 'receipt', purchase_order_id=po, quantity=quantity,
            status='accepted', occurred_offset=-3, message='Signed receipt uploaded after the invoice.')
        add('approval', 'approval', invoice_id=bill, actor_role='controller',
            decision='approved', approved_amount_cents=total)
    elif scenario == 'fx_settlement':
        usd = (total * 108 + 50) // 100
        add('remittance', 'remittance', invoice_id=bill, currency='EUR', amount_cents=total,
            settlement_currency='USD', settlement_principal_cents=usd, fee_cents=2500,
            exchange_rate='1.08', status='settled')
        add('bank_transaction', 'payment', invoice_id=bill, currency='USD', amount_cents=usd + 2500,
            direction='outflow', status='posted')
    elif scenario == 'tax_mismatch':
        # An explicit fictional contractual rule, not an inferred jurisdictional tax law.
        add('tax_document', 'certificate', contract_id=contract, status='accepted',
            rule='For this synthetic agreement, accepted exemption makes the invoice tax zero.')
        add('bill', 'bill-r1', replaces_invoice_id=bill, purchase_order_id=po,
            subtotal_cents=total, tax_cents=total // 10, amount_cents=total + total // 10,
            invoice_number=f'INV-{cycle + 1001}-R1', status='open')
    elif scenario == 'wrong_entity':
        add('policy', 'entity-policy', rule='Invoices must name the purchasing legal entity before payment approval.')
        add('message', 'supplier', invoice_id=bill,
            message='The invoice was issued to the EU subsidiary. Our sales order names the US entity; billing is reviewing it.')
    return rows


def make_case_event(run, sequence):
    """Shuffle without replacement per deck; variable-length cases preserve causal order."""
    if sequence < 1:
        raise ValueError('sequence must be positive')
    config = run['config']
    selected = config.get('scenarios') or SCENARIOS
    remaining, cycle = sequence - 1, 0
    while True:
        deck = list(selected)
        random.Random(f"{config['seed']}:{cycle // len(selected)}:v2").shuffle(deck)
        scenario = deck[cycle % len(selected)]
        rows = case_events(run, cycle, scenario)
        if remaining < len(rows):
            kind, record = rows[remaining]
            break
        remaining -= len(rows)
        cycle += 1
    occurred_offset = record.pop('occurred_offset', 0)
    start = datetime.fromisoformat(config['start_time'])
    observed = start + timedelta(seconds=(sequence - 1) * config['business_step_seconds'])
    occurred = observed + timedelta(seconds=occurred_offset * config['business_step_seconds'])
    record.update(occurred_at=occurred.isoformat(), observed_at=observed.isoformat())
    source = {'contract': 'drive', 'policy': 'drive', 'tax_document': 'drive',
              'purchase_order': 'procurement', 'goods_receipt': 'procurement',
              'message': 'gmail', 'remittance': 'gmail', 'statement': 'gmail',
              'bank_transaction': 'plaid', 'journal_entry': 'accounting'}.get(kind, 'ramp')
    return dict(event_id=f"{run['id']}:{sequence}", simulation_id=run['id'], sequence=sequence,
                source=source, event_type=kind + '.created', occurred_at=record['occurred_at'],
                source_record_id=record['id'], source_version=1, synthetic=True,
                dataset='sim_' + kind, record=record)
