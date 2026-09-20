"""Deterministic anomaly scanners over ingested records. Findings persist and can escalate to concerns."""
import hashlib
import json
import time
import uuid
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from typing import Literal
from pydantic import Field
from sqlalchemy import select, insert, update
from .data_service import StrictModel, DataService
from .database import sources, records, settlement_runs, anomaly_scans, anomaly_findings, insert_ignore
from .accounting import Accounting
from .settlements import Identifier
from .concerns import ConcernService, RaiseConcern

VENDOR = ('vendor_id', 'vendor')
INVOICE_NUMBER = ('invoice_number', 'invoice_id', 'number')
AMOUNT = ('amount_minor', 'amount')
DATE = ('invoice_date', 'date')
PO = ('po_id', 'purchase_order')
PRICE = ('unit_price_minor', 'unit_price')
BANK = ('bank_account', 'iban', 'routing', 'swift', 'bank_details')
VENDOR_MASTER = ('vendor_name', 'name', 'contact', 'email', 'tax_id')
KIND_FIELD = ('kind', 'type', 'record_type')
INVOICE_KINDS = {'invoice', 'bill', 'invoice_line'}
PO_KINDS = {'purchase_order', 'po'}
KINDS = ('duplicate_invoice', 'vendor_bank_change', 'price_variance', 'unmatched_invoice', 'settlement_residual')


def field(payload, names):
    for name in names:
        value = payload.get(name)
        if value is not None and value != '':
            return value
    return None


def norm(value):
    return str(value).strip().lower()


def minor(value):
    """Exact minor units only; a fractional or nonnumeric amount means the row is malformed."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite() or number != number.to_integral_value():
        return None
    return int(number)


def is_invoice(payload):
    kind = norm(field(payload, KIND_FIELD) or '')
    return field(payload, INVOICE_NUMBER) is not None or kind in INVOICE_KINDS


def is_po(payload):
    kind = norm(field(payload, KIND_FIELD) or '')
    return field(payload, PO) is not None and (kind in PO_KINDS or not is_invoice(payload))


def locator(row):
    return {'source_id': row['source_id'], 'row_number': row['row_number'], 'record_id': row['record_id'],
            'locator': f"{row['source_id']}:{row['row_number']}:{row['record_id']}"}


def fingerprint(kind, locators):
    return hashlib.sha256((kind + '|' + '|'.join(sorted(locators))).encode()).hexdigest()


def stats(scanned, skipped, reasons):
    return {'scanned': scanned, 'skipped': skipped, 'reasons': dict(reasons)}


def detect_duplicate_invoice(db, oid, rows):
    scanned = skipped = 0
    reasons = Counter()
    candidates = []
    for row in rows:
        p = row['payload']
        if field(p, INVOICE_NUMBER) is None:
            continue
        vendor = field(p, VENDOR)
        if vendor is None:
            skipped += 1
            reasons['missing vendor identifier'] += 1
            continue
        scanned += 1
        amount, day = field(p, AMOUNT), field(p, DATE)
        candidates.append({'row': row, 'vendor': norm(vendor), 'invoice': norm(field(p, INVOICE_NUMBER)),
                           'amount': minor(amount), 'date': None if day is None else str(day).strip()})
    findings = []
    for i in range(len(candidates)):
        for j in range(i + 1, len(candidates)):
            a, b = candidates[i], candidates[j]
            if a['vendor'] != b['vendor']:
                continue
            matched = 'invoice_number' if a['invoice'] == b['invoice'] else (
                'amount_and_date' if a['amount'] is not None and a['amount'] == b['amount']
                and a['date'] and a['date'] == b['date'] else None)
            if not matched:
                continue
            cited = [locator(a['row']), locator(b['row'])]
            findings.append({'severity': 'high',
                'summary': f"Vendor {a['vendor']} has two records colliding on {matched}: "
                           f"{a['row']['record_id']} and {b['row']['record_id']}",
                'locators': [c['locator'] for c in cited],
                'evidence': {'source_ids': sorted({c['source_id'] for c in cited}), 'records': cited,
                             'vendor': a['vendor'], 'matched_on': matched, 'invoice_number': a['invoice'],
                             'amount_minor': a['amount'], 'invoice_date': a['date'],
                             'locators': [c['locator'] for c in cited]}})
    return findings, stats(scanned, skipped, reasons)


def detect_vendor_bank_change(db, oid, rows):
    scanned = skipped = 0
    reasons = Counter()
    groups = defaultdict(list)
    for row in rows:
        p = row['payload']
        bank = {name: norm(p[name]) for name in BANK if p.get(name) not in (None, '')}
        vendor = field(p, VENDOR)
        if not bank and not (vendor is not None and field(p, VENDOR_MASTER) is not None):
            continue
        if vendor is None:
            skipped += 1
            reasons['missing vendor identifier'] += 1
            continue
        if not bank:
            skipped += 1
            reasons['missing bank fields'] += 1
            continue
        scanned += 1
        groups[norm(vendor)].append((row, bank))
    findings = []
    for vendor, entries in groups.items():
        if len({json.dumps(b, sort_keys=True) for _, b in entries}) < 2:
            continue
        cited = [locator(r) for r, _ in entries]
        for c, (_, bank) in zip(cited, entries):
            c['bank'] = bank
        findings.append({'severity': 'high',
            'summary': f"Vendor {vendor} has {len(entries)} records with conflicting bank details",
            'locators': [c['locator'] for c in cited],
            'evidence': {'source_ids': sorted({c['source_id'] for c in cited}), 'records': cited,
                         'vendor': vendor, 'locators': [c['locator'] for c in cited]}})
    return findings, stats(scanned, skipped, reasons)


def detect_price_variance(db, oid, rows):
    scanned = skipped = 0
    reasons = Counter()
    lines, orders = [], defaultdict(list)
    for row in rows:
        p = row['payload']
        po, price = field(p, PO), field(p, PRICE)
        if po is None and price is None:
            continue
        if po is None or price is None:
            skipped += 1
            reasons['missing po_id' if po is None else 'missing unit_price'] += 1
            continue
        amount = minor(price)
        if amount is None:
            skipped += 1
            reasons['non-integer unit_price'] += 1
            continue
        scanned += 1
        if is_invoice(p):
            lines.append((row, norm(po), amount))
        else:
            orders[norm(po)].append((row, amount))
    findings = []
    for row, po, price in lines:
        for po_row, po_price in orders.get(po, []):
            if price == po_price:
                continue
            delta = price - po_price
            bps = Decimal(delta) * 10000 / Decimal(po_price) if po_price else None
            delta_bps = None if bps is None else (
                int(bps) if bps == bps.to_integral_value() else float(round(bps, 4)))
            cited = [locator(row), locator(po_row)]
            findings.append({'severity': 'medium',
                'summary': f"Invoice line {row['record_id']} unit price {price} differs from "
                           f"purchase order {po} price {po_price} by {delta} minor",
                'locators': [c['locator'] for c in cited],
                'evidence': {'source_ids': sorted({c['source_id'] for c in cited}), 'records': cited,
                             'po_id': po, 'invoice_unit_price_minor': price,
                             'po_unit_price_minor': po_price, 'delta_minor': delta, 'delta_bps': delta_bps,
                             'locators': [c['locator'] for c in cited]}})
    return findings, stats(scanned, skipped, reasons)


def detect_unmatched_invoice(db, oid, rows):
    po_ids = {norm(field(r['payload'], PO)) for r in rows if is_po(r['payload'])}
    scanned = skipped = 0
    reasons = Counter()
    findings = []
    for row in rows:
        p = row['payload']
        if not is_invoice(p):
            continue
        po = field(p, PO)
        if po is None:
            skipped += 1
            reasons['missing po_id'] += 1
            continue
        scanned += 1
        if norm(po) in po_ids:
            continue
        cited = [locator(row)]
        findings.append({'severity': 'medium',
            'summary': f"Invoice {row['record_id']} references purchase order {po} with no matching PO record",
            'locators': [c['locator'] for c in cited],
            'evidence': {'source_ids': sorted({c['source_id'] for c in cited}), 'records': cited,
                         'po_id': str(po), 'locators': [c['locator'] for c in cited]}})
    return findings, stats(scanned, skipped, reasons)


def detect_settlement_residual(db, oid, rows):
    scanned = skipped = 0
    reasons = Counter()
    findings = []
    runs = db.execute(select(settlement_runs).where(settlement_runs.c.organization_id == oid)).mappings().all()
    for run in runs:
        result = run['result'] or {}
        if 'processor_residual_minor' not in result and 'bank_residual_minor' not in result:
            skipped += 1
            reasons['missing residual fields'] += 1
            continue
        scanned += 1
        processor = result.get('processor_residual_minor') or 0
        bank = result.get('bank_residual_minor') or 0
        if run['verified_by'] is not None or (processor == 0 and bank == 0):
            continue
        cited = f"settlement_run:{run['id']}"
        sids = sorted({e['source_id'] for e in result.get('evidence', [])
                       if isinstance(e, dict) and e.get('source_id')})
        findings.append({'severity': 'medium',
            'summary': f"Reconciliation {run['id']} has unverified residuals "
                       f"(processor {processor}, bank {bank})",
            'locators': [cited],
            'evidence': {'reconciliation_id': run['id'], 'processor_residual_minor': processor,
                         'bank_residual_minor': bank, 'source_ids': sids, 'locators': [cited]}})
    return findings, stats(scanned, skipped, reasons)


DETECTORS = {'duplicate_invoice': detect_duplicate_invoice, 'vendor_bank_change': detect_vendor_bank_change,
             'price_variance': detect_price_variance, 'unmatched_invoice': detect_unmatched_invoice,
             'settlement_residual': detect_settlement_residual}


class RunScan(StrictModel):
    request_key: Identifier
    kinds: list[Literal['duplicate_invoice', 'vendor_bank_change', 'price_variance',
                        'unmatched_invoice', 'settlement_residual']] | None = None
    limit: int = Field(default=100, ge=1, le=500)


class ListFindings(StrictModel):
    kind: str | None = None
    status: str | None = None
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


class FindingID(StrictModel):
    finding_id: Identifier


class Escalate(FindingID):
    request_key: Identifier


class ProposeDismissal(FindingID):
    request_key: Identifier
    reason: str = Field(min_length=10, max_length=2000)


class Dismiss(StrictModel):
    finding_id: Identifier
    attestation: Literal['I reviewed this finding and accept the residual risk']


TOOL_MODELS = {'run_anomaly_scan': RunScan, 'list_anomaly_findings': ListFindings,
               'get_anomaly_finding': FindingID, 'escalate_anomaly': Escalate,
               'propose_anomaly_dismissal': ProposeDismissal}
DESCRIPTIONS = {
    'run_anomaly_scan': 'Run deterministic anomaly detectors over the organization\'s active financial records and settlement runs. Persists findings by stable fingerprint so repeat scans refresh rather than duplicate them; previously dismissed fingerprints are reported as suppressed. Requires a stable request_key. Read only over evidence; never guesses missing fields.',
    'list_anomaly_findings': 'List persisted anomaly findings with optional kind and status filters and pagination.',
    'get_anomaly_finding': 'Read one anomaly finding with its evidence citations, status and linked concern ID.',
    'escalate_anomaly': 'Escalate an open anomaly finding into a persistent concern card for owner decision. Idempotent by fingerprint; a second call returns the existing escalation.',
    'propose_anomaly_dismissal': 'Propose dismissing an open anomaly finding with a recorded reason. Takes effect only after an owner confirms through the dismiss endpoint; the finding stays visible until then.',
}


def now():
    return int(time.time() * 1000)


class Anomalies:
    def __init__(self, store, oid, concerns=None):
        self.store, self.oid = store, oid
        self._concerns = concerns

    def concern_service(self):
        if self._concerns is None:
            from .retrieval import ElasticSearch
            self._concerns = ConcernService(DataService(self.store, self.oid, search=ElasticSearch()))
        return self._concerns

    def owned(self, db, finding_id):
        row = db.execute(select(anomaly_findings).where(anomaly_findings.c.id == finding_id,
            anomaly_findings.c.organization_id == self.oid)).mappings().first()
        if not row:
            raise LookupError('Finding not found')
        return row

    def public(self, row):
        return {k: v for k, v in dict(row).items() if k != 'organization_id'}

    def execute(self, name, args):
        body = TOOL_MODELS[name].model_validate(args)
        if name == 'run_anomaly_scan':
            return self.scan(body)
        if name == 'list_anomaly_findings':
            return self.list_findings(body)
        if name == 'get_anomaly_finding':
            with Accounting(self.store, self.oid).transaction() as db:
                return self.public(self.owned(db, body.finding_id))
        if name == 'escalate_anomaly':
            return self.escalate(body)
        return self.propose_dismissal(body)

    def scan(self, body):
        with Accounting(self.store, self.oid).transaction() as db:
            insert_ignore(db, anomaly_scans, dict(id='scan_' + uuid.uuid4().hex, organization_id=self.oid,
                                                request_key=body.request_key, result={}, created_at=now()))
            stored = db.execute(select(anomaly_scans).where(anomaly_scans.c.organization_id == self.oid,
                anomaly_scans.c.request_key == body.request_key)).mappings().one()
            if stored['result']:
                return dict(stored['result'])
            scan_id = stored['id']
            rows = [dict(r) for r in db.execute(
                select(records.c.source_id, records.c.row_number, records.c.record_id,
                       records.c.dataset, records.c.payload)
                .select_from(records.join(sources, records.c.source_id == sources.c.id))
                .where(records.c.organization_id == self.oid, sources.c.active.is_(True))
                .order_by(records.c.source_id, records.c.row_number)).mappings().all()]
            result = {'scan_id': scan_id, 'records_scanned': len(rows), 'kinds': {}, 'notes': []}
            for kind in (body.kinds or KINDS):
                found, s = DETECTORS[kind](db, self.oid, rows)
                counts = {'scanned_rows': s['scanned'], 'skipped_rows': s['skipped'],
                          'skipped_reasons': s['reasons'], 'detected': len(found),
                          'new': 0, 'refreshed': 0, 'suppressed': 0, 'persisted': 0}
                for finding in found:
                    finding['fingerprint'] = fingerprint(kind, finding['locators'])
                for finding in sorted(found, key=lambda f: f['fingerprint'])[:body.limit]:
                    existing = db.execute(select(anomaly_findings).where(
                        anomaly_findings.c.organization_id == self.oid,
                        anomaly_findings.c.fingerprint == finding['fingerprint'])).mappings().first()
                    if existing:
                        if existing['status'] == 'dismissed':
                            counts['suppressed'] += 1
                        else:
                            db.execute(update(anomaly_findings).where(
                                anomaly_findings.c.id == existing['id']).values(scan_id=scan_id))
                            counts['refreshed'] += 1
                            counts['persisted'] += 1
                        continue
                    db.execute(insert(anomaly_findings).values(
                        id='finding_' + uuid.uuid4().hex, organization_id=self.oid, scan_id=scan_id,
                        fingerprint=finding['fingerprint'], kind=kind, severity=finding['severity'],
                        summary=finding['summary'], evidence=finding['evidence'], status='open',
                        concern_id=None, created_at=now()))
                    counts['new'] += 1
                    counts['persisted'] += 1
                if len(found) > body.limit:
                    result['notes'].append(f"{kind}: {len(found) - body.limit} detected findings "
                                           f"exceeded the scan limit and were not persisted")
                if s['skipped']:
                    detail = '; '.join(f"{reason}: {n}" for reason, n in s['reasons'].items())
                    result['notes'].append(f"{kind}: {s['skipped']} rows skipped ({detail})")
                result['kinds'][kind] = counts
            db.execute(update(anomaly_scans).where(anomaly_scans.c.id == scan_id).values(result=result))
            return result

    def list_findings(self, body):
        with Accounting(self.store, self.oid).transaction() as db:
            query = select(anomaly_findings).where(anomaly_findings.c.organization_id == self.oid)
            if body.kind:
                query = query.where(anomaly_findings.c.kind == body.kind)
            if body.status:
                query = query.where(anomaly_findings.c.status == body.status)
            rows = db.execute(query.order_by(anomaly_findings.c.created_at, anomaly_findings.c.id)
                              .offset(body.offset).limit(body.limit + 1)).mappings().all()
            return {'findings': [self.public(r) for r in rows[:body.limit]],
                    'has_more': len(rows) > body.limit,
                    'next_offset': body.offset + min(len(rows), body.limit)}

    def escalate(self, body):
        with Accounting(self.store, self.oid).transaction() as db:
            row = self.owned(db, body.finding_id)
        if row['status'] == 'escalated' and row['concern_id']:
            return {'finding': self.public(row), 'concern_id': row['concern_id'],
                    'concern': self.concern_service().get(row['concern_id'])}
        if row['status'] != 'open':
            raise ValueError('Only an open finding can be escalated')
        evidence = dict(row['evidence'])
        source_ids = list(dict.fromkeys(evidence.get('source_ids', [])))[:12]
        if not source_ids:
            raise ValueError('Finding evidence has no source citations to escalate')
        description = (f"{row['summary']}\n\nkind: {row['kind']}\nfingerprint: {row['fingerprint']}\n"
                       f"evidence: {json.dumps(evidence, sort_keys=True)}")[:8000]
        concern = self.concern_service().raise_concern(RaiseConcern(
            request_key='anomaly:' + row['fingerprint'], title=row['summary'][:160],
            description=description, severity=row['severity'], source_ids=source_ids))
        with Accounting(self.store, self.oid).transaction() as db:
            current = self.owned(db, body.finding_id)
            values = {'concern_id': concern['id'], 'status': 'escalated'}
            db.execute(update(anomaly_findings).where(anomaly_findings.c.id == current['id']).values(**values))
            return {'finding': self.public(dict(current, **values)),
                    'concern_id': concern['id'], 'concern': concern}

    def propose_dismissal(self, body):
        with Accounting(self.store, self.oid).transaction() as db:
            row = self.owned(db, body.finding_id)
            evidence = dict(row['evidence'])
            proposal = evidence.get('dismissal_proposal')
            if row['status'] == 'dismissal_proposed':
                if proposal and proposal.get('request_key') == body.request_key:
                    return self.public(row)
                raise ValueError('A different dismissal proposal is already pending')
            if row['status'] != 'open':
                raise ValueError('Only an open finding can be proposed for dismissal')
            evidence['dismissal_proposal'] = {'request_key': body.request_key, 'reason': body.reason,
                                              'proposed_by': 'agent'}
            values = {'status': 'dismissal_proposed', 'evidence': evidence}
            db.execute(update(anomaly_findings).where(anomaly_findings.c.id == row['id']).values(**values))
            return self.public(dict(row, **values))

    def dismiss(self, body, actor):
        with Accounting(self.store, self.oid).transaction() as db:
            row = self.owned(db, body.finding_id)
            if row['status'] == 'dismissed':
                return self.public(row)
            if row['status'] not in ('open', 'dismissal_proposed'):
                raise ValueError('Finding cannot be dismissed in its current status')
            evidence = dict(row['evidence'])
            proposal = evidence.pop('dismissal_proposal', None) or {}
            evidence['dismissal'] = {'confirmed_by': actor, 'attestation': body.attestation}
            if proposal.get('reason'):
                evidence['dismissal']['reason'] = proposal['reason']
            values = {'status': 'dismissed', 'evidence': evidence}
            db.execute(update(anomaly_findings).where(anomaly_findings.c.id == row['id']).values(**values))
            return self.public(dict(row, **values))
