import contextlib
import json
import os
import time
import uuid
from contextlib import contextmanager
from sqlalchemy import select, update, case
from .database import make_engine, initialize, users, organizations, memberships, sessions, insert_ignore

class Store:
    def __init__(self, path=None):
        self.path = path
        self.engine = make_engine(path)
        initialize(self.engine)
        from mirror_resolve.store import md as accounting_metadata
        accounting_metadata.create_all(self.engine)

    @contextmanager
    def connect(self):
        with self.engine.begin() as db:
            yield db

    def workspace(self, user_id):
        with self.connect() as db:
            # Serialize initial provisioning for this user, including across API workers.
            if db.dialect.name == 'postgresql':
                from sqlalchemy import text
                db.execute(text('SELECT pg_advisory_xact_lock(hashtext(:key))'),{'key':'user:'+user_id})
            else:
                db.exec_driver_sql('BEGIN IMMEDIATE')
            oid = db.execute(select(memberships.c.organization_id).where(
                memberships.c.user_id==user_id).order_by(memberships.c.organization_id).limit(1)).scalar()
            if not oid:
                if db.execute(select(users.c.id).where(users.c.id==user_id)).scalar():
                    raise PermissionError('Workspace membership removed')
                shared = user_id in {x.strip() for x in os.getenv('DEMO_USER_IDS','').split(',') if x.strip()}
                oid = 'demo-meridian' if shared else 'org_' + uuid.uuid4().hex
                insert_ignore(db, organizations, dict(id=oid,name='Meridian Demo' if shared else 'My company'))
                db.execute(users.insert().values(id=user_id))
                db.execute(memberships.insert().values(user_id=user_id,organization_id=oid,role='member' if shared else 'owner'))
            org = dict(db.execute(select(organizations).where(organizations.c.id==oid)).mappings().one())
            latest = db.execute(select(sessions.c.id).where(sessions.c.organization_id==oid)
                                .order_by(sessions.c.created_at.desc(),sessions.c.id.desc()).limit(1)).scalar()
        org['context'] = json.loads(org['context'])
        org['onboarding_complete'] = bool(org['onboarding_complete'])
        org['latest_session_id'] = latest
        return org

    def member(self, user_id, oid):
        with self.connect() as db:
            return db.execute(select(memberships.c.user_id).where(
                memberships.c.user_id==user_id,memberships.c.organization_id==oid)).scalar() is not None

    def claim_stream(self, sid):
        """Take the single-writer claim for a session across API workers, or return None.

        The in-process `active` set only guards one process. Under multiple workers two
        tabs land on different workers, both pass that check, and both bridges write the
        same session row through save() -- last write wins and transcript turns are lost.
        A Postgres advisory *session* lock spans workers and is released if the backend
        dies, so no stale claim can lock a session out. SQLite runs one process, where the
        in-process set is already sufficient.
        """
        if self.engine.dialect.name != 'postgresql':
            return None
        from sqlalchemy import text
        connection = self.engine.connect()
        try:
            taken = connection.execute(text('SELECT pg_try_advisory_lock(hashtext(:key))'),
                                       {'key': 'stream:' + sid}).scalar()
        except Exception:
            connection.close()
            raise
        if not taken:
            connection.close()
            raise PermissionError('This session is already open in another window')
        return connection

    @staticmethod
    def release_stream(claim):
        if claim is not None:
            # Closing the connection drops every advisory lock it holds.
            with contextlib.suppress(Exception):
                claim.close()

    def create(self, user_id, demo=False):
        org = self.workspace(user_id)
        state = dict(id=uuid.uuid4().hex,organization_id=org['id'],created_by=user_id,
                     organization_context_version=org['context_version'],revision=0,transcript=[],
                     context={k:org['context'][k] for k in ('company','facts') if k in org['context']},
                     readiness={'status':'collecting'},demo=demo)
        with self.connect() as db:
            db.execute(sessions.insert().values(id=state['id'],state=json.dumps(state),
                organization_id=org['id'],created_by=user_id,created_at=time.time_ns()//1000))
        return state

    def get(self, sid, user_id):
        with self.connect() as db:
            value = db.execute(select(sessions.c.state).join(memberships,
                memberships.c.organization_id==sessions.c.organization_id).where(
                sessions.c.id==sid,memberships.c.user_id==user_id)).scalar()
        state = json.loads(value) if value else None
        if state and state.get('mode') == 'dashboard' and state['created_by'] != user_id:
            return None
        return state

    def dashboard(self, user_id):
        """One durable private conversation per member and organization."""
        org = self.workspace(user_id)
        sid = uuid.uuid5(uuid.NAMESPACE_URL, json.dumps(['hyper-dashboard', org['id'], user_id])).hex
        state = dict(id=sid, mode='dashboard', organization_id=org['id'], created_by=user_id,
                     organization_context_version=org['context_version'], revision=0, transcript=[],
                     context=org['context'], readiness={'status':'not_applicable'}, demo=False)
        with self.connect() as db:
            insert_ignore(db, sessions, dict(id=sid, state=json.dumps(state), organization_id=org['id'],
                                            created_by=user_id, created_at=time.time_ns()//1000))
        state = self.get(sid, user_id)
        if state is None:
            raise PermissionError('Workspace access removed')
        # Refresh company memory without overwriting an active conversation's transcript.
        state['context'] = org['context']
        state['organization_context_version'] = org['context_version']
        return state

    def save(self, state):
        with self.connect() as db:
            db.execute(update(sessions).where(sessions.c.id==state['id'],
                sessions.c.organization_id==state['organization_id']).values(state=json.dumps(state)))

    def save_context(self, state):
        with self.connect() as db:
            ready = int(state['readiness'].get('status')=='ready')
            result = db.execute(update(organizations).where(organizations.c.id==state['organization_id'],
                organizations.c.context_version==state['organization_context_version']).values(
                    context=json.dumps(state['context']),context_version=organizations.c.context_version+1,
                    onboarding_complete=case((organizations.c.onboarding_complete==1,1),else_=ready)))
            if result.rowcount != 1:
                return False
            state['organization_context_version'] += 1
            db.execute(update(sessions).where(sessions.c.id==state['id'],
                sessions.c.organization_id==state['organization_id']).values(state=json.dumps(state)))
        return True

    def add_member(self, user_id, oid):
        with self.connect() as db:
            insert_ignore(db,users,dict(id=user_id))
            insert_ignore(db,memberships,dict(user_id=user_id,organization_id=oid,role='member'))
