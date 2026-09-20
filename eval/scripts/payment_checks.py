import argparse
from collections import defaultdict
import csv
from datetime import date, timedelta
from decimal import Decimal
import hashlib
import json
from pathlib import Path


def decimal_value(value):
    if not isinstance(value, (str, Decimal, int)) or isinstance(value, bool):
        raise ValueError('Amounts must be decimal strings or exact integers')
    result = Decimal(value)
    if not result.is_finite():
        raise ValueError('Non-finite amount')
    return result


def payment_month(year, day_of_year):
    year, day_of_year = int(year), int(day_of_year)
    result = date(year, 1, 1) + timedelta(days=day_of_year - 1)
    if day_of_year < 1 or result.year != year:
        raise ValueError('Invalid day of year')
    return result.strftime('%Y-%m')


def fraud_report(rows, group_fields):
    groups = defaultdict(lambda: {'transactions': 0, 'fraud_transactions': 0,
                                  'volume_eur': Decimal(0), 'fraud_volume_eur': Decimal(0)})
    seen = set()
    for row in rows:
        identity = row['psp_reference']
        if not identity or identity in seen:
            raise ValueError('Missing or duplicate payment ID')
        seen.add(identity)
        fraud = row['has_fraudulent_dispute']
        if fraud not in ('True', 'False'):
            raise ValueError('Invalid fraud flag')
        value = decimal_value(row['eur_amount'])
        if value < 0:
            raise ValueError('Signed refund amounts require a separate policy')
        group = tuple(payment_month(row['year'], row['day_of_year']) if field == 'month' else row[field]
                      for field in group_fields)
        result = groups[group]
        result['transactions'] += 1
        result['volume_eur'] += value
        if fraud == 'True':
            result['fraud_transactions'] += 1
            result['fraud_volume_eur'] += value
    return [{**dict(zip(group_fields, group)), **values,
             'count_fraud_fraction': Decimal(values['fraud_transactions']) / values['transactions'],
             'volume_fraud_fraction': values['fraud_volume_eur'] / values['volume_eur'] if values['volume_eur'] else None}
            for group, values in sorted(groups.items())]


def category_matches(rule, value, empty_list_wildcard=False):
    if rule is None:
        return True
    if isinstance(rule, list):
        return value in rule or (not rule and empty_list_wildcard)
    return rule == value


def assess_fine(fraud_fraction, threshold=None, policy_source=None):
    if threshold is None or not policy_source or fraud_fraction is None:
        return {'status': 'insufficient_policy_evidence', 'fine_risk': None}
    fraction, threshold = decimal_value(fraud_fraction), decimal_value(threshold)
    if not 0 <= fraction <= 1 or not 0 <= threshold <= 1:
        raise ValueError('Expected fractions between zero and one')
    return {'status': 'evaluated_against_supplied_threshold', 'fine_risk': fraction > threshold,
            'policy_source': policy_source, 'comparison': 'strictly_greater'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('payments', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    with args.payments.open(newline='') as stream:
        rows = list(csv.DictReader(stream))
    countries = fraud_report(rows, ['ip_country'])
    report = {'kind': 'VISIBLE_INPUT_DIAGNOSTIC_NOT_AGENT_SCORE',
              'input_sha256': hashlib.sha256(args.payments.read_bytes()).hexdigest(),
              'countries': countries, 'merchant_months': fraud_report(rows, ['merchant', 'month']),
              'rankings': {metric: [row['ip_country'] for row in sorted(
                  countries, key=lambda row: row[metric] if row[metric] is not None else Decimal(-1), reverse=True)]
                  for metric in ('fraud_transactions', 'fraud_volume_eur', 'count_fraud_fraction', 'volume_fraud_fraction')},
              'limitations': ['No answer keys, grading or agent-output replacement.',
                  'A fee pricing tier is not an established fine threshold.',
                  'Counts, amount-weighted fractions and month scopes are reported separately.']}
    with args.output.open('x') as stream:
        json.dump(report, stream, default=str, indent=2)
        stream.write('\n')
    print(json.dumps({'rankings': report['rankings'], 'countries': countries}, default=str, indent=2))


if __name__ == '__main__':
    main()
