import json
import time
import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select, insert
from app.anomalies import Anomalies, Dismiss
from app.concerns import ConcernService
from app.database import anomaly_findings, settlement_runs, concerns
from test_simulator import setup

ATTEST = 'I reviewed this finding and accept the residual risk'


def upload(data, key, rows, dataset='ledger_docs'):
    return data.ingest(key + '.json', json.dumps(rows).encode(),
                       dataset=dataset, source_key=key, id_field='id')['id']


def scan(store, oid, key='scan-1', **kw):
    return Anomalies(store, oid).execute('run_anomaly_scan', {'request_key': key, **kw})


def findings(store, oid, **kw):
    return Anomalies(store, oid).execute('list_anomaly_findings', kw)['findings']


def plant_runs(store, oid, rows):
    with store.engine.begin() as db:
        for rid, result, verified in rows:
            db.execute(insert(settlement_runs).values(id=rid, organization_id=oid,
                result_hash='hash-' + rid, result=result, verified_by=verified))


def test_duplicate_invoice_collisions_and_skips(setup):
    store, a, _, _, _ = setup
    sid = upload(a.data, 'inv', [
        {'id': 'r1', 'vendor_id': 'Acme', 'invoice_number': 'INV-1', 'amount_minor': 5000, 'invoice_date': '2026-09-01'},
        {'id': 'r2', 'vendor_id': 'acme', 'invoice_number': ' inv-1 ', 'amount_minor': 7000, 'invoice_date': '2026-09-05'},
        {'id': 'r3', 'vendor_id': 'acme', 'invoice_number': 'INV-9', 'amount_minor': 100, 'invoice_date': '2026-09-02'},
        {'id': 'r4', 'vendor_id': 'acme', 'invoice_number': 'INV-8', 'amount_minor': 100, 'invoice_date': '2026-09-02'},
        {'id': 'r5', 'invoice_number': 'INV-7'}])
    counts = scan(store, a.oid)['kinds']['duplicate_invoice']
    assert counts['new'] == 2 and counts['scanned_rows'] == 4
    assert counts['skipped_rows'] == 1
    assert counts['skipped_reasons'] == {'missing vendor identifier': 1}
    rows = findings(store, a.oid, kind='duplicate_invoice')
    assert {f['evidence']['matched_on'] for f in rows} == {'invoice_number', 'amount_and_date'}
    for f in rows:
        assert f['severity'] == 'high' and f['status'] == 'open'
        assert len(f['evidence']['records']) == 2
        assert all(r['source_id'] == sid for r in f['evidence']['records'])
        assert {r['row_number'] for r in f['evidence']['records']} != set()


def test_vendor_bank_change(setup):
    store, a, _, _, _ = setup
    upload(a.data, 'vendors', [
        {'id': 'v1', 'vendor_id': 'acme', 'vendor_name': 'Acme Corp', 'bank_account': '111'},
        {'id': 'v2', 'vendor_id': 'acme', 'vendor_name': 'Acme Corp', 'bank_account': '222'},
        {'id': 'v3', 'vendor_id': 'acme', 'vendor_name': 'Acme Corp'},
        {'id': 'v4', 'vendor_id': 'other', 'vendor_name': 'Other', 'iban': 'X', 'swift': 'Y'},
        {'id': 'v5', 'vendor_name': 'No vendor id', 'iban': 'Z'}])
    counts = scan(store, a.oid)['kinds']['vendor_bank_change']
    assert counts['new'] == 1 and counts['scanned_rows'] == 3
    assert counts['skipped_reasons'] == {'missing bank fields': 1, 'missing vendor identifier': 1}
    f = findings(store, a.oid, kind='vendor_bank_change')[0]
    assert f['severity'] == 'high'
    assert {r['record_id'] for r in f['evidence']['records']} == {'v1', 'v2'}
    assert {r['bank']['bank_account'] for r in f['evidence']['records']} == {'111', '222'}


def test_price_variance_exact_delta(setup):
    store, a, _, _, _ = setup
    upload(a.data, 'po-lines', [
        {'id': 'po1', 'po_id': 'PO-1', 'unit_price': 1000},
        {'id': 'l1', 'po_id': 'PO-1', 'unit_price': 1050, 'invoice_number': 'INV-1'},
        {'id': 'l2', 'po_id': 'PO-1', 'unit_price': 1000, 'invoice_number': 'INV-2'},
        {'id': 'l3', 'po_id': 'PO-1', 'invoice_number': 'INV-3'},
        {'id': 'l4', 'unit_price': 100, 'invoice_number': 'INV-4'},
        {'id': 'l5', 'po_id': 'PO-1', 'unit_price': 'abc', 'invoice_number': 'INV-5'}])
    counts = scan(store, a.oid)['kinds']['price_variance']
    assert counts['new'] == 1 and counts['scanned_rows'] == 3
    assert counts['skipped_reasons'] == {'missing unit_price': 1, 'missing po_id': 1,
                                        'non-integer unit_price': 1}
    f = findings(store, a.oid, kind='price_variance')[0]
    assert f['severity'] == 'medium'
    assert f['evidence']['delta_minor'] == 50 and f['evidence']['delta_bps'] == 500
    assert f['evidence']['po_id'] == 'po-1'


def test_unmatched_invoice(setup):
    store, a, _, _, _ = setup
    upload(a.data, 'bills', [
        {'id': 'i1', 'invoice_number': 'INV-1', 'po_id': 'PO-X', 'vendor_id': 'acme'},
        {'id': 'i2', 'invoice_number': 'INV-2', 'vendor_id': 'acme'},
        {'id': 'p1', 'po_id': 'PO-1', 'unit_price': 10}])
    counts = scan(store, a.oid)['kinds']['unmatched_invoice']
    assert counts['new'] == 1 and counts['scanned_rows'] == 1
    assert counts['skipped_reasons'] == {'missing po_id': 1}
    f = findings(store, a.oid, kind='unmatched_invoice')[0]
    assert f['evidence']['po_id'] == 'PO-X'
    upload(a.data, 'po-fix', [{'id': 'p2', 'po_id': 'PO-X', 'unit_price': 10}])
    assert scan(store, a.oid, key='scan-2')['kinds']['unmatched_invoice']['new'] == 0


def test_settlement_residual(setup):
    store, a, _, _, _ = setup
    sid = upload(a.data, 'evidence-src', [{'id': 'e1', 'invoice_number': 'INV-1'}])
    evidence = [{'source_id': sid, 'sha256': 'x', 'row_number': 1}]
    plant_runs(store, a.oid, [
        ('recon-1', {'processor_residual_minor': 25, 'bank_residual_minor': 0, 'evidence': evidence}, None),
        ('recon-2', {'processor_residual_minor': 0, 'bank_residual_minor': 10, 'evidence': evidence}, 'alice'),
        ('recon-3', {'processor_residual_minor': 0, 'bank_residual_minor': 0, 'evidence': evidence}, None),
        ('recon-4', {'status': 'balanced_unverified'}, None)])
    counts = scan(store, a.oid)['kinds']['settlement_residual']
    assert counts['new'] == 1 and counts['scanned_rows'] == 3
    assert counts['skipped_reasons'] == {'missing residual fields': 1}
    f = findings(store, a.oid, kind='settlement_residual')[0]
    assert f['severity'] == 'medium'
    assert f['evidence']['reconciliation_id'] == 'recon-1'
    assert f['evidence']['source_ids'] == [sid]


def test_repeat_scan_refreshes_without_duplicates(setup):
    store, a, _, _, _ = setup
    upload(a.data, 'inv', [
        {'id': 'r1', 'vendor_id': 'acme', 'invoice_number': 'INV-1'},
        {'id': 'r2', 'vendor_id': 'acme', 'invoice_number': 'INV-1'}])
    first = scan(store, a.oid)
    assert first['kinds']['duplicate_invoice']['new'] == 1
    again = scan(store, a.oid, key='scan-2')
    counts = again['kinds']['duplicate_invoice']
    assert counts['new'] == 0 and counts['refreshed'] == 1 and counts['suppressed'] == 0
    assert len(findings(store, a.oid)) == 1
    with store.engine.connect() as db:
        f = db.execute(select(anomaly_findings)).mappings().one()
        assert f['scan_id'] == again['scan_id']


def test_dismissal_proposal_confirmation_and_suppression(setup):
    store, a, _, _, _ = setup
    upload(a.data, 'inv', [
        {'id': 'r1', 'vendor_id': 'acme', 'invoice_number': 'INV-1'},
        {'id': 'r2', 'vendor_id': 'acme', 'invoice_number': 'INV-1'}])
    scan(store, a.oid)
    svc = Anomalies(store, a.oid)
    fid = findings(store, a.oid)[0]['id']
    with pytest.raises(ValidationError):
        svc.execute('propose_anomaly_dismissal', {'finding_id': fid, 'request_key': 'd0', 'reason': 'too short'})
    proposed = svc.execute('propose_anomaly_dismissal',
        {'finding_id': fid, 'request_key': 'd1', 'reason': 'confirmed duplicate already refunded'})
    assert proposed['status'] == 'dismissal_proposed'
    assert proposed['evidence']['dismissal_proposal']['reason'] == 'confirmed duplicate already refunded'
    assert svc.execute('propose_anomaly_dismissal',
        {'finding_id': fid, 'request_key': 'd1', 'reason': 'confirmed duplicate already refunded'})['id'] == fid
    with pytest.raises(ValueError):
        svc.execute('propose_anomaly_dismissal',
            {'finding_id': fid, 'request_key': 'd2', 'reason': 'different request key conflicts'})
    dismissed = svc.dismiss(Dismiss(finding_id=fid, attestation=ATTEST), 'human:alice')
    assert dismissed['status'] == 'dismissed'
    assert dismissed['evidence']['dismissal']['reason'] == 'confirmed duplicate already refunded'
    counts = scan(store, a.oid, key='scan-2')['kinds']['duplicate_invoice']
    assert counts['suppressed'] == 1 and counts['new'] == 0 and counts['refreshed'] == 0
    assert findings(store, a.oid, status='open') == []
    assert len(findings(store, a.oid, status='dismissed')) == 1


def test_escalation_creates_real_concern_idempotently(setup, monkeypatch):
    store, a, _, _, _ = setup
    upload(a.data, 'inv', [
        {'id': 'r1', 'vendor_id': 'acme', 'invoice_number': 'INV-1'},
        {'id': 'r2', 'vendor_id': 'acme', 'invoice_number': 'INV-1'}])
    scan(store, a.oid)
    finding = findings(store, a.oid)[0]
    real = httpx.Client
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(200, json={'approved': True, 'evaluation': {'model': 'jev'},
            'card': {'summary': 'Duplicate invoice.', 'options': [
                {'id': f'option_{i}', 'title': f'Choice {i}', 'action': f'Step {i}',
                 'tradeoff': 'Review.', 'requires_approval': False} for i in range(1, 4)]}})
    monkeypatch.setattr(httpx, 'Client', lambda **kw: real(transport=httpx.MockTransport(respond), **kw))
    svc = Anomalies(store, a.oid, concerns=ConcernService(a.data))
    out = svc.execute('escalate_anomaly', {'finding_id': finding['id'], 'request_key': 'esc-1'})
    assert out['concern']['status'] == 'awaiting_response'
    assert out['finding']['status'] == 'escalated'
    assert out['finding']['concern_id'] == out['concern']['id']
    with store.engine.connect() as db:
        row = db.execute(select(concerns).where(concerns.c.id == out['concern_id'])).mappings().one()
        assert row['request_key'] == 'anomaly:' + finding['fingerprint']
        assert row['request']['severity'] == 'high'
        assert row['request']['source_ids'] == finding['evidence']['source_ids']
    again = svc.execute('escalate_anomaly', {'finding_id': finding['id'], 'request_key': 'esc-2'})
    assert again['concern_id'] == out['concern_id'] and len(calls) == 1
    assert findings(store, a.oid)[0]['status'] == 'escalated'


def test_tenant_isolation_and_request_key_idempotency(setup):
    store, a, b, _, _ = setup
    upload(a.data, 'inv', [
        {'id': 'r1', 'vendor_id': 'acme', 'invoice_number': 'INV-1'},
        {'id': 'r2', 'vendor_id': 'acme', 'invoice_number': 'INV-1'}])
    first = scan(store, a.oid)
    assert scan(store, a.oid) == first  # same request_key returns the stored scan
    fid = findings(store, a.oid)[0]['id']
    other = Anomalies(store, b.oid)
    assert other.execute('list_anomaly_findings', {})['findings'] == []
    with pytest.raises(LookupError):
        other.execute('get_anomaly_finding', {'finding_id': fid})
    with pytest.raises(LookupError):
        other.execute('escalate_anomaly', {'finding_id': fid, 'request_key': 'e1'})
    with pytest.raises(LookupError):
        other.execute('propose_anomaly_dismissal',
            {'finding_id': fid, 'request_key': 'd1', 'reason': 'cross tenant attempt'})
    result = scan(store, b.oid, key='b-scan')
    assert all(c['new'] == 0 for c in result['kinds'].values())


def test_scan_kinds_subset_and_limits(setup):
    store, a, _, _, _ = setup
    upload(a.data, 'inv', [
        {'id': 'r1', 'vendor_id': 'acme', 'invoice_number': 'INV-1'},
        {'id': 'r2', 'vendor_id': 'acme', 'invoice_number': 'INV-1'}])
    result = scan(store, a.oid, kinds=['duplicate_invoice'])
    assert list(result['kinds']) == ['duplicate_invoice']
    with pytest.raises(ValidationError):
        scan(store, a.oid, key='bad', limit=501)
    with pytest.raises(ValidationError):
        scan(store, a.oid, key='bad', kinds=['not_a_kind'])


def test_http_permissions_on_standalone_app(setup, monkeypatch):
    store, a, _, _, _ = setup
    upload(a.data, 'inv', [
        {'id': 'r1', 'vendor_id': 'acme', 'invoice_number': 'INV-1'},
        {'id': 'r2', 'vendor_id': 'acme', 'invoice_number': 'INV-1'}])
    fid = findings(store, a.oid)
    scan(store, a.oid)
    fid = findings(store, a.oid)[0]['id']
    from app import main, auth
    from app.anomaly_api import router
    monkeypatch.setattr(main, 'store', store)
    def verify(token):
        if token not in ('alice', 'teammate', 'bob'):
            raise HTTPException(401)
        return auth.Identity(token, int(time.time()) + 300)
    monkeypatch.setattr(auth, 'verify', verify)
    store.add_member('teammate', a.oid)
    app = FastAPI()
    app.include_router(router)
    alice = {'Authorization': 'Bearer alice'}
    teammate = {'Authorization': 'Bearer teammate'}
    bob = {'Authorization': 'Bearer bob'}
    with TestClient(app) as client:
        assert client.get('/accounting/anomalies/findings').status_code == 401
        assert client.get('/accounting/anomalies/findings', headers=alice).status_code == 200
        assert client.get('/accounting/anomalies/findings/' + fid, headers=alice).json()['id'] == fid
        assert client.get('/accounting/anomalies/findings/' + fid, headers=bob).status_code == 404
        assert client.post('/accounting/anomalies/scans', json={'request_key': 'http-1'},
                           headers=teammate).status_code == 200
        body = {'finding_id': fid, 'attestation': ATTEST}
        assert client.post(f'/accounting/anomalies/findings/{fid}/dismiss',
                           json=body, headers=teammate).status_code == 403
        assert client.post(f'/accounting/anomalies/findings/{fid}/dismiss',
                           json=body, headers=alice).json()['status'] == 'dismissed'
        assert client.post(f'/accounting/anomalies/findings/{fid}/dismiss',
                           json={'finding_id': 'other', 'attestation': ATTEST},
                           headers=alice).status_code == 422
