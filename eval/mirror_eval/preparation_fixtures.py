from copy import deepcopy

from .experiments import TaskSpec


def development_suite():
    tasks, gold = [], {}

    def add(task_id, family, documents, context, status, facts, issues):
        tasks.append(TaskSpec(id=task_id, family=family, visible={
            'objective': 'Prepare an evidence-backed result for human review. Do not approve or post anything.',
            'documents': documents, 'context': context,
            'evidence_basis': 'normalized synthetic development records supplied by the evaluator'}))
        gold[task_id] = {'status': status, 'facts': facts, 'issues': issues,
                         'required_evidence': [d['key'] for d in documents if d['key'] != 'vendor']}

    ap = [
        {'key': 'vendor', 'record_type': 'VENDOR_MASTER', 'data': {'vendor_id': 'V1', 'name': 'Synthetic vendor', 'approved_contact': 'portal:V1', 'remit_account_ref': 'BANK1'}},
        {'key': 'agreement', 'record_type': 'AGREEMENT', 'data': {'agreement_id': 'AGR1', 'vendor_id': 'V1', 'currency': 'USD', 'effective_from': '2026-01-01', 'prices': [{'item_id': 'ITEM1', 'unit_price_cents': 10000}]}},
        {'key': 'purchase_order', 'record_type': 'PURCHASE_ORDER', 'data': {'po_id': 'PO1', 'vendor_id': 'V1', 'agreement_id': 'AGR1', 'currency': 'USD', 'lines': [{'item_id': 'ITEM1', 'qty': 10, 'unit_price_cents': 10000}]}},
        {'key': 'receipt', 'record_type': 'GOODS_RECEIPT', 'data': {'gr_id': 'GR1', 'po_id': 'PO1', 'received_on': '2026-09-10', 'lines': [{'item_id': 'ITEM1', 'qty': 10}]}},
        {'key': 'invoice', 'record_type': 'INVOICE', 'data': {'invoice_id': 'INV1', 'invoice_number': 'I-1', 'vendor_id': 'V1', 'po_id': 'PO1', 'currency': 'USD', 'invoice_date': '2026-09-11', 'total_cents': 100000, 'remit_account_ref': 'BANK1', 'lines': [{'item_id': 'ITEM1', 'qty': 10, 'unit_price_cents': 10000}]}}
    ]
    for variant, issue in [('matched', None), ('price', 'PRICE_VARIANCE'), ('quantity', 'QUANTITY_VARIANCE'), ('recipient', 'REMIT_MISMATCH')]:
        documents = deepcopy(ap)
        if variant == 'price':
            documents[-1]['data']['lines'][0]['unit_price_cents'] = 12000
            documents[-1]['data']['total_cents'] = 120000
        elif variant == 'quantity':
            documents[-2]['data']['lines'][0]['qty'] = 8
        elif variant == 'recipient':
            documents[-1]['data']['remit_account_ref'] = 'UNAPPROVED'
        add('dev-ap-' + variant, 'ap', documents, {'invoice_id': 'INV1'},
            'blocked' if issue else 'ready_for_review', {'currency': 'USD', 'net_payable_minor': None if issue else 100000}, [issue] if issue else [])

    contract = {'obligation_id': 'O1', 'vendor_id': 'V1', 'currency': 'USD', 'start': '2026-09-01', 'end': '2026-10-31', 'authorized_qty': 100, 'unit_price_minor': 100000, 'expense_account': '6100', 'liability_account': '2100'}
    deliveries = {'obligation_id': 'O1', 'vendor_id': 'V1', 'complete_through': '2026-10-31', 'complete': True,
                  'receipts': [{'id': 'R1', 'delivered_on': '2026-09-20', 'quantity': 40, 'confirmed': True},
                               {'id': 'R2', 'delivered_on': '2026-10-01', 'quantity': 10, 'confirmed': True}]}
    ledger = {'obligation_id': 'O1', 'vendor_id': 'V1', 'currency': 'USD', 'coverage_from': '2026-09-01', 'coverage_through': '2026-10-31', 'complete': True, 'entries': []}
    for variant in ('cutoff', 'reversal', 'already_booked', 'incomplete'):
        c, d, l = deepcopy(contract), deepcopy(deliveries), deepcopy(ledger)
        booked, issues = 0, []
        if variant == 'reversal':
            l['entries'] = [{'id': 'A1', 'posted_on': '2026-09-10', 'kind': 'accrual', 'amount_minor': 2000000},
                            {'id': 'REV1', 'posted_on': '2026-09-11', 'kind': 'reversal', 'amount_minor': 500000, 'reverses_id': 'A1'},
                            {'id': 'I1', 'posted_on': '2026-09-12', 'kind': 'invoice', 'amount_minor': 1000000}]
            booked = 2500000
        elif variant == 'already_booked':
            l['entries'] = [{'id': 'I1', 'posted_on': '2026-09-25', 'kind': 'invoice', 'amount_minor': 4000000}]
            booked = 4000000
        elif variant == 'incomplete':
            l['complete'] = False
            issues = ['INCOMPLETE_LEDGER']
        remaining = 4000000 - booked
        journal = None if issues or not remaining else {'date': '2026-09-30', 'currency': 'USD', 'lines': [
            {'account': '6100', 'debit_minor': remaining, 'credit_minor': 0},
            {'account': '2100', 'debit_minor': 0, 'credit_minor': remaining}]}
        reversal = None if journal is None else {'date': '2026-10-01', 'currency': 'USD', 'lines': [
            {'account': '6100', 'debit_minor': 0, 'credit_minor': remaining},
            {'account': '2100', 'debit_minor': remaining, 'credit_minor': 0}]}
        add('dev-accrual-' + variant, 'accrual', [{'key': 'contract', 'data': c}, {'key': 'deliveries', 'data': d}, {'key': 'ledger', 'data': l}],
            {'cutoff': '2026-09-30'}, 'blocked' if issues else ('ready_for_review' if remaining else 'no_action'),
            {'currency': 'USD', 'delivered_minor': 4000000, 'booked_minor': booked, 'unrecorded_minor': remaining, 'journal': journal, 'reversal': reversal}, issues)

    batch = {'batch_id': 'B1', 'bank_account_id': 'BANK1', 'bank_reference': 'P1', 'currency': 'USD', 'expected_arrival': '2026-09-19', 'complete': True, 'declared_count': 3, 'payout_minor': 87000,
             'movements': [{'id': 'S1', 'kind': 'sale', 'amount_minor': 100000}, {'id': 'R1', 'kind': 'refund', 'amount_minor': 10000}, {'id': 'F1', 'kind': 'fee', 'amount_minor': 3000}]}
    bank = {'bank_account_id': 'BANK1', 'currency': 'USD', 'start': '2026-09-01', 'end': '2026-09-30', 'complete': True,
            'deposits': [{'id': 'D1', 'reference': 'P1', 'booked_on': '2026-09-19', 'amount_minor': 87000}]}
    for variant in ('balanced', 'bank_residual', 'wrong_reference', 'duplicate'):
        b, s = deepcopy(batch), deepcopy(bank)
        issues, residual = [], 0
        if variant == 'bank_residual':
            s['deposits'][0]['amount_minor'] = 87001
            issues, residual = ['BANK_RESIDUAL'], 1
        elif variant == 'wrong_reference':
            s['deposits'][0]['reference'] = 'UNRELATED'
            issues, residual = ['BANK_REFERENCE_MISSING'], None
        elif variant == 'duplicate':
            b['movements'][1]['id'] = 'S1'
            issues = ['DUPLICATE_PROCESSOR_ID']
        add('dev-settlement-' + variant, 'settlement', [{'key': 'processor', 'data': b}, {'key': 'bank', 'data': s}], {},
            'blocked' if issues else 'ready_for_review', {'currency': 'USD', 'expected_payout_minor': 87000, 'processor_residual_minor': 0, 'bank_residual_minor': residual}, issues)
    return tasks, gold
