"""Carry the exception loop's history from one database to another.

The loop's record (graded cases, the threads with the simulated parties, the lessons the worker wrote,
the adversary's settings, the CFO's narration of it all, metered usage) lives in a database. A laptop's
record does not reach production on its own. This writes it to one gzipped JSON file and reads it back.

    uv run --directory backend python -m app.loop_history export benchmarks/history/loop-history.json.gz hyper-lab hyper-lab-control demo-meridian
    uv run --directory backend python -m app.loop_history import benchmarks/history/loop-history.json.gz [--adversary-off]

Import is safe to repeat: every row keeps its id and an existing row is never overwritten. It carries
the history that the scoreboard, the memory comparison, the learning page and the timeline read. It
does not carry the accounting engine's own records for those simulated invoices or their stored
documents, so an imported case can be read and counted but not reopened. Cases still open at export
are left out: a case with no engine records behind it could never be finished on the other side.
The adversary arrives switched off with --adversary-off, so nothing spends until someone turns it on.
"""
import argparse
import gzip
import json
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

from sqlalchemy import func, select, update  # noqa: E402

from .database import (adversary_controls, agent_lessons, agent_usage, cfo_narrations, counterparty_messages,  # noqa: E402
                       counterparty_scenarios, insert_ignore, organizations, workflow_events, workflow_stream_heads)
from .store import Store  # noqa: E402

# Parents before children. Each entry: table, how to pick an organization's rows.
TABLES = [('counterparty_scenarios', counterparty_scenarios), ('counterparty_messages', counterparty_messages), ('agent_lessons', agent_lessons),
          ('adversary_controls', adversary_controls), ('workflow_stream_heads', workflow_stream_heads), ('workflow_events', workflow_events),
          ('cfo_narrations', cfo_narrations), ('agent_usage', agent_usage)]
SECRET = re.compile(r'sk-[A-Za-z0-9_-]{20,}|agt_[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|ApiKey\s+[A-Za-z0-9=+/]{20,}')


def export(store, path, orgs):
    bundle = {'format': 1, 'organizations': [], 'tables': {}}
    with store.engine.connect() as db:
        bundle['organizations'] = [dict(r) for r in db.execute(select(organizations.c.id, organizations.c.name).where(organizations.c.id.in_(orgs))).mappings()]
        closed = set(db.execute(select(counterparty_scenarios.c.id).where(counterparty_scenarios.c.organization_id.in_(orgs), counterparty_scenarios.c.status == 'scored')).scalars())
        for name, table in TABLES:
            rows = [dict(r) for r in db.execute(select(table).where(table.c.organization_id.in_(orgs))).mappings()]
            if name == 'counterparty_scenarios': rows = [r for r in rows if r['id'] in closed]
            if name in ('counterparty_messages', 'agent_lessons'): rows = [r for r in rows if r['scenario_id'] in closed]
            bundle['tables'][name] = rows
    text = json.dumps(bundle, default=str, separators=(',', ':'))
    if found := SECRET.search(text): raise SystemExit(f'refusing to write: something that looks like a credential is in the data ({found.group(0)[:12]}...)')
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, 'wt', encoding='utf-8') as out: out.write(text)
    return {name: len(rows) for name, rows in bundle['tables'].items()}


def load(store, path, adversary_off=False):
    with gzip.open(path, 'rt', encoding='utf-8') as source: bundle = json.load(source)
    if bundle.get('format') != 1: raise SystemExit('unknown bundle format')
    counts = {}
    with store.engine.begin() as db:
        for org in bundle['organizations']: insert_ignore(db, organizations, dict(id=org['id'], name=org['name']))
        # A company's event stream is numbered by the database it lives in, one number per event, no repeats.
        # Where this database already has events for a company, the arriving ones go after them in their own order.
        # Keeping the laptop's numbers would collide, and leaving the counter behind would make the next live event throw.
        present = set(db.execute(select(workflow_events.c.id)).scalars())
        shift = {}
        for org in {r['organization_id'] for r in bundle['tables'].get('workflow_events', []) if r['id'] not in present}:
            shift[org] = db.execute(select(func.coalesce(func.max(workflow_events.c.sequence), 0)).where(workflow_events.c.organization_id == org)).scalar()
        for name, table in TABLES:
            if name == 'workflow_stream_heads': continue
            columns, added = {c.name for c in table.columns}, 0
            rows = bundle['tables'].get(name, [])
            if name == 'workflow_events': rows = sorted(rows, key=lambda r: (r['organization_id'], r['sequence']))
            for row in rows:
                row = {k: v for k, v in row.items() if k in columns}
                if name == 'adversary_controls' and adversary_off: row['enabled'] = False
                if name == 'workflow_events' and row['id'] not in present and shift.get(row['organization_id']):
                    row['sequence'] += shift[row['organization_id']]
                    row['event'] = {**row['event'], 'sequence': row['sequence']}
                added += insert_ignore(db, table, row).rowcount or 0
            counts[name] = added
        # The counter ends at the last number in use, whatever was there before.
        for org, last in db.execute(select(workflow_events.c.organization_id, func.max(workflow_events.c.sequence)).group_by(workflow_events.c.organization_id)).all():
            insert_ignore(db, workflow_stream_heads, {'organization_id': org, 'sequence': 0})
            db.execute(update(workflow_stream_heads).where(workflow_stream_heads.c.organization_id == org, workflow_stream_heads.c.sequence < last).values(sequence=last))
    return counts


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['export', 'import'])
    parser.add_argument('path')
    parser.add_argument('organizations', nargs='*')
    parser.add_argument('--adversary-off', action='store_true')
    args = parser.parse_args()
    store = Store()
    if args.action == 'export':
        if not args.organizations: sys.exit('name the organizations to export')
        print('exported', export(store, args.path, args.organizations), '->', args.path, f'({Path(args.path).stat().st_size / 1e6:.1f} MB)')
    else: print('imported (new rows only)', load(store, args.path, args.adversary_off))
