"""Shared relational schema. PostgreSQL in deployment; SQLite for offline tests."""
import os
from pathlib import Path
from sqlalchemy import (MetaData, Table, Column, Text, Integer, BigInteger, Boolean,
                        ForeignKey, UniqueConstraint, Index, JSON, create_engine, event, inspect)
from sqlalchemy.dialects.postgresql import JSONB, insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

metadata = MetaData()
json_type = JSON().with_variant(JSONB, 'postgresql')
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
