"""What happens after AP: an approved payable, packaged for the teams downstream of it.

We resolve the exception; we do not run payments, keep the ledger, close the books or forecast cash.
Each of those systems needs something specific from a resolved payable, so this assembles exactly that,
from the approved proposal and its verified evidence. Read only: nothing here pays, posts or books.
"""
from datetime import date, timedelta
from sqlalchemy import select
from mirror_resolve import store as ledger, casework, proposals
from mirror_resolve.ingest import get_record
from .accounting import Accounting
from .database import accounting_evidence, records, sources

BOUNDARY = 'prepared_not_posted'

def _iso(value):
    return value.isoformat() if hasattr(value, 'isoformat') else value

def _payment_terms(db, oid, vendor_id):
    """Payment terms live in the imported vendor list, not in the verified vendor master. Optional."""
    rows = db.execute(select(records.c.payload).join(sources, sources.c.id == records.c.source_id).where(
        records.c.organization_id == oid, sources.c.active.is_(True), sources.c.dataset == 'vendors')).scalars()
    for row in rows:
        if isinstance(row, dict) and row.get('vendor_id') == vendor_id and str(row.get('terms_days', '')).strip().lstrip('-').isdigit():
            return int(row['terms_days'])
    return None

def packet(store, oid, proposal_id):
    svc = Accounting(store, oid)
    with svc.transaction() as db:
        prop = proposals.get_proposal(db, proposal_id)
        case = svc.owned_case(db, prop['case_id'])
        payload = prop['payload']
        approval = db.execute(select(ledger.approvals).where(ledger.approvals.c.proposal_id == proposal_id)
                              .order_by(ledger.approvals.c.requested_at.desc())).mappings().first()
        checks = proposals.validate_proposal(db, proposal_id) if prop['status'] == 'DRAFT' else []
        committed = db.execute(select(ledger.economic_events).where(ledger.economic_events.c.proposal_id == proposal_id)).mappings().first()
        approved = bool(approval and approval['status'] == 'APPROVED' and approval['proposal_hash'] == prop['hash'])
        # A draft must still pass every check; a committed one was checked at commit and is final.
        ready = approved and (bool(committed) or all(c['ok'] for c in checks))

        invoice = get_record(db, oid, payload['invoice_id'])
        vendor = get_record(db, oid, payload['recipient']['vendor_id'])
        inv = (invoice or {}).get('data', {})
        vendor_id = svc.display(payload['recipient']['vendor_id'])
        terms = _payment_terms(db, oid, vendor_id)
        invoice_date = inv.get('invoice_date')
        due = None
        if invoice_date and terms is not None:
            due = (date.fromisoformat(str(invoice_date)) + timedelta(days=terms)).isoformat()

        issues = casework.list_issues(db, prop['case_id'])
        evaluation = casework.evaluate_case(db, prop['case_id'])
        doc_ids = {ref['doc_id'] for ref in evaluation['match']['sources']} | {c['doc_id'] for c in evaluation['verified_credits']}
        evidence = [dict(r) for r in db.execute(select(accounting_evidence).where(
            accounting_evidence.c.organization_id == oid, accounting_evidence.c.doc_id.in_(doc_ids))).mappings()]

        entries = payload['accounting']
        debits = sum(e['debit_cents'] for e in entries)
        credits_total = sum(c['amount_cents'] for c in payload['credits'])
        billed = payload['invoice_face_cents']
        net = payload['net_payable_cents']
        reference = svc.display(payload['invoice_id'])

        return svc.display({
            'proposal_id': proposal_id, 'case_id': prop['case_id'], 'hash': prop['hash'],
            'ready': ready, 'boundary': BOUNDARY,
            'state': 'committed' if committed else 'approved' if approved else (approval['status'].lower() if approval else 'not_requested'),
            'payment': {
                'vendor_id': payload['recipient']['vendor_id'], 'vendor_name': (vendor or {}).get('data', {}).get('name'),
                'remit_account_ref': payload['recipient']['remit_account_ref'],
                'amount_cents': net, 'currency': payload['currency'],
                'invoice_id': payload['invoice_id'], 'invoice_number': inv.get('invoice_number'), 'invoice_date': _iso(invoice_date),
                'terms_days': terms, 'due_date': due,
                # The remit account is the one on the owner-verified vendor master, checked against the invoice.
                'remit_verified': any(c.get('check') == 'recipient_is_current_vendor_master' and c['ok'] for c in checks) or bool(committed),
            },
            'ledger': {
                'type': 'AP_RECOGNITION', 'reference': reference, 'currency': payload['currency'],
                'entries': entries, 'balanced': debits == sum(e['credit_cents'] for e in entries) == net,
                'econ_id': committed['econ_id'] if committed else None, 'committed_at': _iso(committed['committed_at']) if committed else None,
            },
            'close': {
                'invoice_id': payload['invoice_id'], 'case_revision': prop['based_on_revision'],
                'issues': [{'type': i['type'], 'status': i['status'], 'blocking': bool(i['blocking']), 'description': i['description']} for i in issues],
                'credits_applied': payload['credits'],
                'approval': None if not approval else {'status': approval['status'], 'decided_by': approval['decided_by'], 'decided_at': _iso(approval['decided_at']), 'proposal_hash': approval['proposal_hash']},
                'evidence': [{'record_type': e['record_type'], 'original_record_id': e['original_record_id'], 'source_id': e['source_id'],
                              'row_number': e['row_number'], 'source_sha256': e['source_sha256'], 'verified_by': e['verified_by']} for e in evidence],
                'checks': [{'name': c.get('check'), 'ok': bool(c['ok'])} for c in checks],
            },
            'forecast': {
                'currency': payload['currency'], 'cash_out_cents': net, 'expected_date': due,
                'billed_cents': billed, 'avoided_cents': billed - net, 'credits_cents': credits_total,
                'basis': 'invoice_date_plus_vendor_terms' if due else 'no_payment_terms_on_file',
            },
            'work_status': case['work_status'], 'payment_status': case['payment_status'],
        })

def commit(store, oid, proposal_id, proposal_hash, user_id):
    """Owner records the approved payable as recognised AP. Idempotent on the proposal hash; moves no cash."""
    svc = Accounting(store, oid)
    with svc.transaction() as db:
        prop = proposals.get_proposal(db, proposal_id)
        svc.owned_case(db, prop['case_id']); svc.current_evidence(db)
        if prop['hash'] != proposal_hash: raise ValueError('Proposal hash mismatch')
        return proposals.commit_proposal(db, proposal_id, actor='human:' + user_id, idempotency_key='ap:' + prop['hash'])
