import argparse
from collections import defaultdict
import csv
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re

from score_remaining import allocation_metrics


def scope(row, side):
    return tuple(row[side + '_' + key] for key in ('currencyCode', 'account', 'valueDate'))


def amount(row, side):
    value = Decimal(row[side + '_amount'])
    if not value.is_finite():
        raise ValueError('Non-finite amount')
    return value


def references(row, side):
    return {t for t in re.findall(r'[A-Z0-9]+', row.get(side + '_transactionReferences', '').upper())
            if len(t) >= 8 and any(c.isdigit() for c in t) and len(set(t)) > 2}


def match(rows, policy):
    if policy not in ('unique-total', 'reference-conserved'):
        raise ValueError('Unknown policy')
    allocations = {}
    bank = {}
    for row in rows:
        if row.get('A_transactionType') == 'A':
            key = row['A_allocation']
            if not key:
                raise ValueError('Missing allocation')
            group = allocations.setdefault(key, {'scope': scope(row, 'A'), 'total': Decimal(0), 'refs': set()})
            if group['scope'] != scope(row, 'A'):
                raise ValueError('Allocation spans different scopes')
            group['total'] += amount(row, 'A')
            group['refs'].update(references(row, 'A'))
        if row.get('B_transactionType') == 'B':
            key = row['B_id']
            if not key or key in bank:
                raise ValueError('Missing or duplicate bank ID')
            bank[key] = row
    totals = defaultdict(list)
    bank_totals = defaultdict(list)
    token_index = defaultdict(set)
    for key, group in allocations.items():
        totals[(group['scope'], group['total'])].append(key)
        for token in group['refs']:
            token_index[(group['scope'], token)].add(key)
    for key, row in bank.items():
        bank_totals[(scope(row, 'B'), amount(row, 'B'))].append(key)
    candidates = defaultdict(list)
    for key, row in bank.items():
        identity = scope(row, 'B')
        value = amount(row, 'B')
        if policy == 'unique-total':
            choices = totals[(identity, value)] if len(bank_totals[(identity, value)]) == 1 else []
        else:
            choices = set()
            for token in references(row, 'B'):
                choices.update(token_index[(identity, token)])
        if len(choices) == 1:
            allocation = next(iter(choices))
            if value != 0 and (value > 0) == (allocations[allocation]['total'] > 0):
                candidates[allocation].append(key)
    predictions = dict.fromkeys(bank, '')
    for allocation, keys in candidates.items():
        if sum((amount(bank[key], 'B') for key in keys), Decimal(0)) == allocations[allocation]['total']:
            for key in keys:
                predictions[key] = allocation
    return [{'B_id': key, 'targetAllocation': value} for key, value in predictions.items()]


def conservation_filter(rows, predictions):
    ledger = defaultdict(list)
    bank = {}
    ledger_ids = set()
    for row in rows:
        if row.get('A_transactionType') == 'A':
            if not row['A_id'] or row['A_id'] in ledger_ids:
                raise ValueError('Missing or duplicate ledger ID')
            ledger_ids.add(row['A_id'])
            ledger[row['A_allocation']].append(row)
        if row.get('B_transactionType') == 'B':
            if not row['B_id'] or row['B_id'] in bank:
                raise ValueError('Missing or duplicate bank ID')
            bank[row['B_id']] = row
    ids = [row['B_id'] for row in predictions]
    if len(set(ids)) != len(ids) or set(ids) != set(bank):
        raise ValueError('Predictions must cover each bank ID exactly once')
    assigned = defaultdict(list)
    for row in predictions:
        if row['targetAllocation']:
            assigned[row['targetAllocation']].append(row['B_id'])
    accepted = {}
    for allocation, keys in assigned.items():
        if allocation not in ledger:
            continue
        identities = {scope(row, 'A')[:2] for row in ledger[allocation]}
        identities.update(scope(bank[key], 'B')[:2] for key in keys)
        if len(identities) != 1:
            continue
        ledger_total = sum((amount(row, 'A') for row in ledger[allocation]), Decimal(0))
        bank_total = sum((amount(bank[key], 'B') for key in keys), Decimal(0))
        if ledger_total != 0 and ledger_total == bank_total:
            accepted.update(dict.fromkeys(keys, allocation))
    return [{'B_id': row['B_id'], 'targetAllocation': accepted.get(row['B_id'], '')} for row in predictions]


def normalize_reference(rows):
    normalized = []
    for row in rows:
        value = json.loads(row['targetAllocation'])
        if not isinstance(value, list) or len(value) > 1 or any(not isinstance(item, str) for item in value):
            raise ValueError('Reference predictions must be zero or one allocation per bank row')
        normalized.append({'B_id': row['B_id'], 'targetAllocation': value[0] if value else ''})
    return normalized


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reference-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--submission', type=Path, action='append', default=[])
    parser.add_argument('--reference-submission', type=Path)
    args = parser.parse_args()
    source = args.reference_root / 'benchrec/workspace/BenchRec_cash_v1.0_eval.csv'
    with source.open(newline='') as stream:
        rows = list(csv.DictReader(stream))
    predictions = {policy: match(rows, policy) for policy in ('unique-total', 'reference-conserved')}
    hashes = {}
    for submission in args.submission:
        label = str(submission)
        with submission.open(newline='') as stream:
            prediction = list(csv.DictReader(stream))
        predictions['raw:' + label] = prediction
        predictions['conservation-gated:' + label] = conservation_filter(rows, prediction)
        hashes[label] = hashlib.sha256(submission.read_bytes()).hexdigest()
    if args.reference_submission:
        with args.reference_submission.open(newline='') as stream:
            predictions['distributed-reference-unknown-model'] = normalize_reference(list(csv.DictReader(stream)))
        hashes[str(args.reference_submission)] = hashlib.sha256(args.reference_submission.read_bytes()).hexdigest()
    with (args.reference_root / 'benchrec/private/BenchRec_cash_v1.0_solution.csv').open(newline='') as stream:
        gold = list(csv.DictReader(stream))
    report = {'kind': 'LOCAL_RULES_BASELINE_AND_DEVELOPMENT_ABLATION', 'input_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'code_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'submission_sha256': hashes,
              'protocol': 'Fixed rules with no gold-based tuning. Conservation gate developed after observing aggregate worker scores; not preregistered or held out. Rejects rather than invents assignments. Balance is necessary, not proof of identity.',
              'policies': {policy: allocation_metrics(prediction, gold) for policy, prediction in predictions.items()}}
    with args.output.open('x') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
