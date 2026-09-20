"""Shared relational schema. PostgreSQL in deployment; SQLite for offline tests."""
import os
from pathlib import Path
from sqlalchemy import (MetaData, Table, Column, Text, Integer, BigInteger, Boolean,
                        ForeignKey, UniqueConstraint, Index, JSON, create_engine, event, inspect)
from sqlalchemy.dialects.postgresql import JSONB, insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

metadata = MetaData()
# Simulated counterparties and the adversary that schedules them. `facts` is private: it holds what
# each party knows and the expected outcome, and is never returned by an agent tool or a user route.
counterparty_scenarios = Table('counterparty_scenarios', metadata,
    Column('id', Text, primary_key=True), Column('organization_id', Text, nullable=False),
    Column('family', Text, nullable=False), Column('title', Text, nullable=False),
    Column('invoice_id', Text, nullable=False), Column('vendor_id', Text, nullable=False),
    Column('facts', JSON().with_variant(JSONB, 'postgresql'), nullable=False),
    Column('state', JSON().with_variant(JSONB, 'postgresql'), nullable=False),
    Column('status', Text, nullable=False), Column('outcome', Text), Column('difficulty', Integer, nullable=False),
    Column('created_by', Text, nullable=False), Column('created_at', BigInteger, nullable=False),
    Column('scored_at', BigInteger), UniqueConstraint('organization_id','invoice_id'))
counterparty_messages = Table('counterparty_messages', metadata,
    Column('sequence', Integer, primary_key=True, autoincrement=True), Column('id', Text, unique=True, nullable=False),
    Column('organization_id', Text, nullable=False), Column('scenario_id', Text, ForeignKey('counterparty_scenarios.id'), nullable=False),
    Column('direction', Text, nullable=False), Column('party', Text, nullable=False), Column('kind', Text, nullable=False),
    Column('request_key', Text), Column('body', Text, nullable=False),
    Column('payload', JSON().with_variant(JSONB, 'postgresql'), nullable=False),
    Column('source_ids', JSON().with_variant(JSONB, 'postgresql'), nullable=False),
    Column('status', Text, nullable=False), Column('deliver_at', BigInteger, nullable=False), Column('created_at', BigInteger, nullable=False),
    UniqueConstraint('organization_id','request_key'))
Index('counterparty_due', counterparty_messages.c.status, counterparty_messages.c.deliver_at)
adversary_controls = Table('adversary_controls', metadata,
    Column('organization_id', Text, primary_key=True), Column('enabled', Boolean, nullable=False),
    Column('interval_seconds', Integer, nullable=False), Column('max_open', Integer, nullable=False),
    Column('next_spawn_at', BigInteger, nullable=False), Column('seed', Integer, nullable=False),
    Column('spawned', Integer, nullable=False))
agent_lessons = Table('agent_lessons', metadata,
    Column('id', Text, primary_key=True), Column('organization_id', Text, nullable=False),
    Column('family', Text, nullable=False), Column('lesson', Text, nullable=False),
    Column('scenario_id', Text, nullable=False), Column('created_at', BigInteger, nullable=False),
    UniqueConstraint('organization_id','scenario_id'))
accounting_evidence = Table('accounting_evidence', metadata,
    Column('organization_id', Text, primary_key=True), Column('source_id', Text, primary_key=True),
    Column('row_number', Integer, primary_key=True), Column('record_type', Text, nullable=False),
    Column('original_record_id', Text, nullable=False), Column('doc_id', Text, nullable=False),
    Column('source_sha256', Text, nullable=False), Column('verified_by', Text, nullable=False))
json_type = JSON().with_variant(JSONB, 'postgresql')
learned_skills = Table('learned_skills', metadata,
    Column('id', Text, primary_key=True), Column('organization_id', Text, nullable=False),
    Column('name', Text, nullable=False), Column('version', Integer, nullable=False),
    Column('description', Text, nullable=False), Column('status', Text, nullable=False),
    Column('package_hash', Text, nullable=False), Column('object_key', Text, nullable=False),
    Column('evidence', json_type, nullable=False), Column('created_at', BigInteger, nullable=False),
    Column('activated_by', Text), Column('activation', json_type), UniqueConstraint('organization_id','name','version'))
learned_skill_runs = Table('learned_skill_runs', metadata,
    Column('sequence', Integer, primary_key=True, autoincrement=True), Column('id', Text, unique=True, nullable=False),
    Column('organization_id', Text, nullable=False), Column('skill_id', Text, ForeignKey('learned_skills.id'), nullable=False),
    Column('request_key', Text, nullable=False), Column('outcome', Text, nullable=False),
    Column('report', json_type, nullable=False), Column('created_at', BigInteger, nullable=False),
    UniqueConstraint('organization_id','request_key'))
Index('learned_skill_discovery', learned_skills.c.organization_id, learned_skills.c.status)
accrual_runs = Table('accrual_runs', metadata,
    Column('id', Text, primary_key=True), Column('organization_id', Text, nullable=False),
    Column('result_hash', Text, nullable=False), Column('result', json_type, nullable=False),
    Column('approved_by', Text), Column('approved_at', BigInteger), UniqueConstraint('organization_id','result_hash'))
accrual_followups = Table('accrual_followups', metadata,
    Column('sequence', Integer, primary_key=True, autoincrement=True),
    Column('organization_id', Text, nullable=False), Column('accrual_id', Text, ForeignKey('accrual_runs.id'), nullable=False),
    Column('result', json_type, nullable=False))
settlement_runs = Table('settlement_runs', metadata,
    Column('id', Text, primary_key=True), Column('organization_id', Text, nullable=False),
    Column('result_hash', Text, nullable=False), Column('result', json_type, nullable=False),
    Column('verified_by', Text), UniqueConstraint('organization_id','result_hash'))
users = Table('users', metadata, Column('id', Text, primary_key=True))
organizations = Table('organizations', metadata,
    Column('id', Text, primary_key=True), Column('name', Text, nullable=False),
    Column('context', Text, nullable=False, server_default='{}'),
    Column('context_version', Integer, nullable=False, server_default='0'),
    Column('onboarding_complete', Integer, nullable=False, server_default='0'))
memberships = Table('memberships', metadata,
    Column('user_id', Text, ForeignKey('users.id'), primary_key=True),
    Column('organization_id', Text, ForeignKey('organizations.id'), primary_key=True),
    Column('role', Text, nullable=False, server_default='member'))
sessions = Table('sessions', metadata,
    Column('id', Text, primary_key=True), Column('token', Text), Column('state', Text),
    Column('organization_id', Text), Column('created_by', Text),
    Column('created_at', BigInteger, nullable=False, server_default='0'))
Index('session_org', sessions.c.organization_id)
sources = Table('sources', metadata,
    Column('id', Text, primary_key=True),
    Column('organization_id', Text, ForeignKey('organizations.id'), nullable=False),
    Column('source_key', Text, nullable=False), Column('version', Integer, nullable=False),
    Column('filename', Text, nullable=False), Column('content_type', Text, nullable=False),
    Column('object_key', Text, nullable=False), Column('sha256', Text, nullable=False),
    Column('import_fingerprint', Text, nullable=False),
    Column('size_bytes', BigInteger, nullable=False), Column('dataset', Text),
    Column('currency', Text), Column('schema', json_type, nullable=False),
    Column('record_count', Integer, nullable=False),
    Column('created_at', BigInteger, nullable=False),
    Column('active', Boolean, nullable=False, default=True),
    Column('index_status', Text, nullable=False, default='pending'),
    Column('index_error', Text),
    UniqueConstraint('organization_id','source_key','version'),
    UniqueConstraint('organization_id','source_key','import_fingerprint'))
Index('source_org_active', sources.c.organization_id, sources.c.active)
records = Table('financial_records', metadata,
    Column('source_id', Text, ForeignKey('sources.id'), primary_key=True),
    Column('row_number', Integer, primary_key=True),
    Column('organization_id', Text, nullable=False),
    Column('dataset', Text, nullable=False),
    Column('record_id', Text, nullable=False),
    Column('payload', json_type, nullable=False))
Index('record_org_dataset', records.c.organization_id, records.c.dataset)
Index('record_lookup', records.c.organization_id, records.c.dataset, records.c.record_id)
chunks = Table('evidence_chunks', metadata,
    Column('id', Text, primary_key=True), Column('source_id', Text, ForeignKey('sources.id'), nullable=False),
    Column('organization_id', Text, nullable=False), Column('ordinal', Integer, nullable=False),
    Column('locator', Text, nullable=False), Column('content', Text, nullable=False))
Index('chunk_source', chunks.c.source_id)
connections = Table('connections', metadata,
    Column('id', Text, primary_key=True),
    Column('organization_id', Text, ForeignKey('organizations.id'), nullable=False),
    Column('provider', Text, nullable=False), Column('external_id', Text),
    Column('label', Text, nullable=False), Column('status', Text, nullable=False),
    Column('credentials', Text), Column('config', json_type, nullable=False),
    Column('cursor', json_type, nullable=False, default=dict),
    Column('created_at', BigInteger, nullable=False), Column('last_synced_at', BigInteger),
    Column('next_sync_at', BigInteger, nullable=False, default=0),
    Column('lease_until', BigInteger, nullable=False, default=0), Column('claim_token', Text),
    Column('failures', Integer, nullable=False, default=0), Column('error', Text),
    UniqueConstraint('organization_id', 'provider', 'external_id'))
connection_auth = Table('connection_auth', metadata,
    Column('state_hash', Text, primary_key=True),
    Column('connection_id', Text, ForeignKey('connections.id'), nullable=False),
    Column('user_id', Text, nullable=False), Column('expires_at', BigInteger, nullable=False),
    Column('secret', Text, nullable=False))
connection_items = Table('connection_items', metadata,
    Column('connection_id', Text, ForeignKey('connections.id'), primary_key=True),
    Column('item_id', Text, primary_key=True), Column('remote_id', Text, nullable=False),
    Column('filename', Text, nullable=False), Column('content_type', Text, nullable=False),
    Column('sha256', Text, nullable=False), Column('object_key', Text),
    Column('revision', Integer, nullable=False), Column('source_ids', json_type, nullable=False),
    Column('status', Text, nullable=False), Column('error', Text),
    Column('scan_id', Text),
    Column('updated_at', BigInteger, nullable=False))
connection_syncs = Table('connection_syncs', metadata,
    Column('id', Text, primary_key=True),
    Column('connection_id', Text, ForeignKey('connections.id'), nullable=False),
    Column('started_at', BigInteger, nullable=False), Column('finished_at', BigInteger),
    Column('status', Text, nullable=False), Column('error', Text))
simulations = Table('simulations', metadata,
    Column('id', Text, primary_key=True),
    Column('organization_id', Text, ForeignKey('organizations.id'), nullable=False),
    Column('config', json_type, nullable=False),
    Column('status', Text, nullable=False),
    Column('created_at', BigInteger, nullable=False),
    Column('next_run_at', BigInteger, nullable=False),
    Column('sequence', Integer, nullable=False, default=0),
    Column('lease_until', BigInteger, nullable=False, default=0),
    Column('claim_token', Text), Column('error', Text))
Index('simulation_due', simulations.c.status, simulations.c.next_run_at)
simulation_events = Table('simulation_events', metadata,
    Column('id', Text, primary_key=True),
    Column('simulation_id', Text, ForeignKey('simulations.id'), nullable=False),
    Column('organization_id', Text, nullable=False),
    Column('sequence', Integer, nullable=False),
    Column('status', Text, nullable=False),
    Column('attempts', Integer, nullable=False, default=0),
    Column('created_at', BigInteger, nullable=False),
    Column('published_at', BigInteger),
    Column('payload', json_type), Column('document', Text),
    Column('source_ids', json_type, nullable=False, default=list),
    Column('error', Text),
    UniqueConstraint('simulation_id', 'sequence'))
jobs = Table('ingestion_jobs', metadata,
    Column('id', Text, primary_key=True), Column('source_id', Text, ForeignKey('sources.id'), nullable=False, unique=True),
    Column('organization_id', Text, nullable=False),
    Column('status', Text, nullable=False, default='pending'),
    Column('attempts', Integer, nullable=False, default=0),
    Column('lease_until', BigInteger, nullable=False, default=0),
    Column('claim_token', Text), Column('error', Text),
    Column('created_at', BigInteger, nullable=False))

# Knowledge graph derived from active sources. Rebuildable: sources and records stay authoritative.
# Every row names the source that produced it so a superseded import removes exactly its own facts.
graph_nodes = Table('graph_nodes', metadata,
    Column('organization_id', Text, primary_key=True), Column('id', Text, primary_key=True),
    Column('type', Text, nullable=False), Column('key', Text, nullable=False),
    Column('label', Text, nullable=False), Column('props', json_type, nullable=False),
    Column('source_id', Text, nullable=False), Column('row_number', Integer, nullable=False))
Index('graph_node_type', graph_nodes.c.organization_id, graph_nodes.c.type)
Index('graph_node_source', graph_nodes.c.source_id)
graph_edges = Table('graph_edges', metadata,
    Column('sequence', Integer, primary_key=True, autoincrement=True),
    Column('organization_id', Text, nullable=False), Column('src', Text, nullable=False),
    Column('dst', Text, nullable=False), Column('type', Text, nullable=False),
    Column('props', json_type, nullable=False), Column('method', Text, nullable=False),
    Column('confidence', Integer, nullable=False),
    Column('source_id', Text, nullable=False), Column('row_number', Integer, nullable=False))
Index('graph_edge_src', graph_edges.c.organization_id, graph_edges.c.src)
Index('graph_edge_dst', graph_edges.c.organization_id, graph_edges.c.dst)
Index('graph_edge_source', graph_edges.c.source_id)
graph_aliases = Table('graph_aliases', metadata,
    Column('sequence', Integer, primary_key=True, autoincrement=True),
    Column('organization_id', Text, nullable=False), Column('alias', Text, nullable=False),
    Column('kind', Text, nullable=False), Column('node_id', Text, nullable=False),
    Column('source_id', Text, nullable=False))
Index('graph_alias_lookup', graph_aliases.c.organization_id, graph_aliases.c.alias)
Index('graph_alias_source', graph_aliases.c.source_id)
graph_mentions = Table('graph_mentions', metadata,
    Column('chunk_id', Text, primary_key=True), Column('node_id', Text, primary_key=True),
    Column('organization_id', Text, nullable=False), Column('source_id', Text, nullable=False),
    Column('method', Text, nullable=False), Column('confidence', Integer, nullable=False))
Index('graph_mention_node', graph_mentions.c.organization_id, graph_mentions.c.node_id)
Index('graph_mention_source', graph_mentions.c.source_id)

def make_engine(location=None):
    location = location or os.getenv('DATABASE_URL') or os.getenv('DATABASE_PATH','var/onboarding.sqlite')
    if location.startswith('postgres://'):
        location = 'postgresql+psycopg://' + location[len('postgres://'):]
    elif location.startswith('postgresql://'):
        location = 'postgresql+psycopg://' + location[len('postgresql://'):]
    if '://' not in location:
        Path(location).parent.mkdir(parents=True, exist_ok=True)
        location = 'sqlite:///' + str(location)
    engine = create_engine(location, pool_pre_ping=True,
        **({'connect_args':{'check_same_thread':False,'timeout':10}} if location.startswith('sqlite') else {}))
    if engine.dialect.name == 'sqlite':
        @event.listens_for(engine, 'connect')
        def pragmas(dbapi_connection, _):
            dbapi_connection.execute('PRAGMA foreign_keys=ON')
    return engine

def initialize(engine):
    # Additive upgrade from the earlier SQLite session store. Legacy rows remain unowned.
    existing = inspect(engine)
    if 'sessions' in existing.get_table_names():
        names = {c['name'] for c in existing.get_columns('sessions')}
        with engine.begin() as db:
            for name, sqltype in [('organization_id','TEXT'),('created_by','TEXT'),('created_at','BIGINT NOT NULL DEFAULT 0')]:
                if name not in names:
                    db.exec_driver_sql(f'ALTER TABLE sessions ADD COLUMN {name} {sqltype}')
    metadata.create_all(engine)
    if engine.dialect.name=='sqlite':
        with engine.begin() as db:
            db.exec_driver_sql('UPDATE sessions SET created_at=rowid WHERE created_at=0')

def insert_ignore(db, table, values):
    insert = pg_insert if db.dialect.name == 'postgresql' else sqlite_insert
    return db.execute(insert(table).values(**values).on_conflict_do_nothing())

concerns = Table('concerns', metadata,
    Column('id', Text, primary_key=True),
    Column('organization_id', Text, ForeignKey('organizations.id'), nullable=False),
    Column('request_key', Text, nullable=False), Column('request', json_type, nullable=False),
    Column('status', Text, nullable=False), Column('card', json_type),
    Column('decision', json_type), Column('resolution', json_type),
    Column('claim_token', Text), Column('lease_until', BigInteger, nullable=False, default=0),
    Column('created_at', BigInteger, nullable=False), Column('updated_at', BigInteger, nullable=False),
    UniqueConstraint('organization_id', 'request_key'))
Index('concern_queue', concerns.c.organization_id, concerns.c.status)

artifacts = Table('financial_artifacts', metadata,
    Column('id', Text, primary_key=True), Column('organization_id', Text, nullable=False),
    Column('request_key', Text, nullable=False), Column('request', json_type, nullable=False),
    Column('snapshot', json_type, nullable=False), Column('status', Text, nullable=False),
    Column('spec', json_type), Column('html', Text), Column('evaluation', json_type),
    Column('error', Text), Column('lease_until', BigInteger, nullable=False, default=0),
    Column('claim_token', Text), Column('created_at', BigInteger, nullable=False),
    UniqueConstraint('organization_id', 'request_key'))
agent_events = Table('agent_events', metadata,
    Column('id', Text, primary_key=True), Column('organization_id', Text, nullable=False),
    Column('event_key', Text, nullable=False), Column('kind', Text, nullable=False),
    Column('payload', json_type, nullable=False), Column('acknowledged', Boolean, nullable=False, default=False),
    Column('created_at', BigInteger, nullable=False), UniqueConstraint('organization_id', 'event_key'))
agent_controllers = Table('agent_controllers', metadata,
    Column('organization_id', Text, primary_key=True), Column('enabled', Boolean, nullable=False, default=False),
    Column('session_id', Text), Column('launch_key', Text), Column('credential_hash', Text),
    Column('credential_expires', BigInteger, nullable=False, default=0), Column('checkpoint', json_type, nullable=False, default=dict),
    Column('status', Text, nullable=False), Column('error', Text),
    Column('lease_until', BigInteger, nullable=False, default=0), Column('claim_token', Text),
    Column('next_poll_at', BigInteger, nullable=False, default=0),
    Column('launch_count', Integer, nullable=False, default=0))
agent_cases = Table('agent_cases', metadata,
    Column('id', Text, primary_key=True), Column('organization_id', Text, nullable=False),
    Column('case_key', Text, nullable=False), Column('title', Text, nullable=False),
    Column('state', json_type, nullable=False), Column('version', Integer, nullable=False),
    Column('updated_at', BigInteger, nullable=False), UniqueConstraint('organization_id', 'case_key'))
agent_case_updates = Table('agent_case_updates', metadata,
    Column('id', Text, primary_key=True), Column('case_id', Text, nullable=False),
    Column('version', Integer, nullable=False), Column('state', json_type, nullable=False),
    Column('created_at', BigInteger, nullable=False), UniqueConstraint('case_id', 'version'))
agent_tasks = Table('agent_tasks', metadata,
    Column('id', Text, primary_key=True), Column('organization_id', Text, nullable=False),
    Column('case_id', Text, nullable=False), Column('request_key', Text, nullable=False),
    Column('objective', Text, nullable=False), Column('status', Text, nullable=False),
    Column('session_id', Text), Column('launch_key', Text), Column('credential_hash', Text),
    Column('credential_expires', BigInteger, nullable=False, default=0), Column('result', json_type),
    Column('created_at', BigInteger, nullable=False), Column('error', Text),
    Column('lease_until', BigInteger, nullable=False, default=0), Column('claim_token', Text),
    Column('next_poll_at', BigInteger, nullable=False, default=0),
    UniqueConstraint('organization_id', 'request_key'))
agent_attempts = Table('agent_attempts', metadata,
    Column('id', Text, primary_key=True), Column('organization_id', Text, nullable=False),
    Column('target_id', Text, nullable=False), Column('operation', Text, nullable=False),
    Column('status', Text, nullable=False), Column('details', json_type, nullable=False),
    Column('created_at', BigInteger, nullable=False))

elastic_investigations = Table('elastic_investigations', metadata,
    Column('id', Text, primary_key=True),
    Column('organization_id', Text, ForeignKey('organizations.id'), nullable=False),
    Column('request_key', Text, nullable=False), Column('source_id', Text, nullable=False),
    Column('question', Text, nullable=False), Column('status', Text, nullable=False),
    Column('created_at', BigInteger, nullable=False), Column('updated_at', BigInteger, nullable=False),
    Column('lease_until', BigInteger, nullable=False, default=0), Column('claim_token', Text),
    Column('execution_id', Text), Column('context', json_type), Column('result', json_type),
    Column('concern_id', Text), Column('error', Text),
    UniqueConstraint('organization_id', 'request_key'))
