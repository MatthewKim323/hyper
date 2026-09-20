from __future__ import annotations

from contextlib import contextmanager
import hashlib
import hmac
import json
from pathlib import Path
import secrets
import sqlite3
import time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


Arm = Literal['baseline', 'backend', 'backend_skills']
TERMINAL_LAUNCH_STATES = frozenset({'finished', 'waiting_for_user', 'waiting_for_approval', 'usage_limit_exceeded', 'failed', 'error', 'exit', 'stopped', 'cancelled', 'prelaunch_failed'})


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


class Conflict(ValueError):
    pass


class BudgetExceeded(ValueError):
    pass


class TaskSpec(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,100}$')
    family: Literal['ap', 'accrual', 'settlement', 'external']
    visible: dict


class Experiment(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,100}$')
    model: str = Field(min_length=1)
    prompt_version: str = Field(min_length=1)
    tools_version: str = Field(min_length=1)
    grader_version: str = Field(min_length=1)
    gold_sha256: str | None = Field(default=None, min_length=64, max_length=64)
    tasks: list[TaskSpec] = Field(min_length=1)
    arms: list[Arm] = Field(min_length=1)
    trials: int = Field(default=1, ge=1, le=100, strict=True)
    wall_seconds: int = Field(default=600, ge=1, le=86400, strict=True)
    max_tool_calls: int = Field(default=100, ge=1, le=10000, strict=True)
    per_task_acu: int = Field(default=5, ge=1, le=100, strict=True)
    max_active: int = Field(default=2, ge=1, le=16, strict=True)
    seed: int = 0
    skill_pins: dict[str, str] = Field(default_factory=dict)
    training_task_ids: list[str] = Field(default_factory=list)
    split: Literal['development', 'operator_held_out'] = 'development'

    @model_validator(mode='after')
    def coherent(self):
        ids = [task.id for task in self.tasks]
        if len(set(ids)) != len(ids) or len(set(self.arms)) != len(self.arms):
            raise ValueError('Duplicate tasks or arms')
        if set(ids) & set(self.training_task_ids):
            raise ValueError('Training and evaluation tasks overlap')
        if 'backend_skills' in self.arms and (not self.skill_pins or not self.training_task_ids):
            raise ValueError('Skill arm needs pinned packages and declared separate training tasks')
        if any(len(value) != 64 or any(c not in '0123456789abcdef' for c in value) for value in self.skill_pins.values()):
            raise ValueError('Skill pins must be SHA-256 hashes')
        canonical(self.model_dump())
        return self


class Journal:
    def __init__(self, path: Path, spec: Experiment, clock=time.time):
        self.path, self.spec, self.clock = Path(path), spec, clock
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.transaction() as db:
            db.execute('CREATE TABLE IF NOT EXISTS manifest (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, arm TEXT NOT NULL, trial INTEGER NOT NULL, state TEXT NOT NULL, token_hash TEXT, deadline REAL, binding TEXT, output TEXT, calls INTEGER NOT NULL DEFAULT 0, failure TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY, job_id TEXT NOT NULL, request_key TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created_at REAL NOT NULL, UNIQUE(job_id,request_key))')
            db.execute('CREATE TABLE IF NOT EXISTS calls (job_id TEXT NOT NULL, request_key TEXT NOT NULL, name TEXT NOT NULL, args_hash TEXT NOT NULL, result TEXT, PRIMARY KEY(job_id,request_key))')
            db.execute('CREATE TABLE IF NOT EXISTS launches (job_id TEXT PRIMARY KEY, acu_cap INTEGER NOT NULL, session_id TEXT UNIQUE, status TEXT NOT NULL, reported_acu REAL)')
            expected = canonical(spec.model_dump())
            existing = db.execute('SELECT body FROM manifest WHERE id=1').fetchone()
            if existing and existing['body'] != expected:
                raise Conflict('Experiment manifest is immutable')
            if not existing:
                db.execute('INSERT INTO manifest VALUES (1,?)', (expected,))
                run_nonce = secrets.token_hex(16)
                for task in spec.tasks:
                    for arm in spec.arms:
                        for trial in range(spec.trials):
                            identity = fingerprint([expected, run_nonce, task.id, arm, trial])
                            db.execute('INSERT INTO jobs(id,task_id,arm,trial,state) VALUES(?,?,?,?,?)',
                                       (identity, task.id, arm, trial, 'planned'))

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def decode(self, row):
        result = dict(row)
        result.pop('token_hash', None)
        for key in ('binding', 'output'):
            if key in result and result[key] is not None:
                result[key] = json.loads(result[key])
        return result

    def jobs(self):
        with self.transaction() as db:
            return [self.decode(row) for row in db.execute('SELECT * FROM jobs ORDER BY task_id,arm,trial')]

    def job(self, job_id):
        with self.transaction() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row:
                raise LookupError('Unknown job')
            return self.decode(row)

    def start(self, job_id, binding):
        token = secrets.token_urlsafe(32)
        with self.transaction() as db:
            changed = db.execute("UPDATE jobs SET state='running',token_hash=?,deadline=?,binding=? WHERE id=? AND state='planned'",
                (hashlib.sha256(token.encode()).hexdigest(), self.clock()+self.spec.wall_seconds, canonical(binding), job_id)).rowcount
            if changed != 1:
                raise Conflict('Task already started or unknown; do not relaunch automatically')
        return token

    def authenticate(self, db, job_id, token):
        row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        if not row or not row['token_hash'] or not hmac.compare_digest(row['token_hash'], hashlib.sha256(token.encode()).hexdigest()):
            raise PermissionError('Invalid task capability')
        return row

    def authorize(self, job_id, token):
        expired = False
        with self.transaction() as db:
            row = self.authenticate(db, job_id, token)
            expired = row['state'] == 'running' and self.clock() > row['deadline']
            if expired:
                db.execute("UPDATE jobs SET state='timed_out',failure='wall_limit' WHERE id=?", (job_id,))
            result = self.decode(row)
        if expired or result['state'] == 'timed_out':
            raise BudgetExceeded('Task wall limit reached')
        if result['state'] != 'running':
            raise Conflict('Task is no longer running')
        return result

    def reserve_call(self, job_id, token, request_key, name, args):
        self.authorize(job_id, token)
        with self.transaction() as db:
            row = self.authenticate(db, job_id, token)
            if row['state'] != 'running' or self.clock() > row['deadline']:
                raise BudgetExceeded('Task is closed or expired')
            previous = db.execute('SELECT * FROM calls WHERE job_id=? AND request_key=?', (job_id, request_key)).fetchone()
            if previous:
                if previous['name'] != name or previous['args_hash'] != fingerprint(args):
                    raise Conflict('Tool request key reused with different inputs')
                if previous['result'] is None:
                    raise Conflict('Tool execution uncertain; operator reconciliation required')
                return json.loads(previous['result'])
            if row['calls'] >= self.spec.max_tool_calls:
                raise BudgetExceeded('Tool-call limit reached')
            db.execute('INSERT INTO calls(job_id,request_key,name,args_hash) VALUES(?,?,?,?)',
                       (job_id, request_key, name, fingerprint(args)))
            db.execute('UPDATE jobs SET calls=calls+1 WHERE id=?', (job_id,))
        return None

    def finish_call(self, job_id, request_key, result):
        with self.transaction() as db:
            changed = db.execute('UPDATE calls SET result=? WHERE job_id=? AND request_key=? AND result IS NULL',
                                 (canonical(result), job_id, request_key)).rowcount
            if changed != 1:
                raise Conflict('Call already completed or not reserved')

    def submit(self, job_id, token, request_key, output, final):
        body = canonical(output)
        if len(body.encode()) > 1_000_000:
            raise ValueError('Output exceeds 1 MB')
        kind = 'final' if final else 'checkpoint'
        with self.transaction() as db:
            row = self.authenticate(db, job_id, token)
            previous = db.execute('SELECT * FROM events WHERE job_id=? AND request_key=?', (job_id, request_key)).fetchone()
            if previous:
                if previous['kind'] != kind or previous['body'] != body:
                    raise Conflict('Submission key reused with different content')
                return self.decode(row)
            if row['state'] != 'running':
                raise Conflict('Final task result cannot be replaced')
            if self.clock() > row['deadline']:
                raise BudgetExceeded('Task wall limit reached')
            db.execute('INSERT INTO events(job_id,request_key,kind,body,created_at) VALUES(?,?,?,?,?)',
                       (job_id, request_key, kind, body, self.clock()))
            if final:
                db.execute("UPDATE jobs SET state='submitted',output=? WHERE id=?", (body, job_id))
            result = self.decode(db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone())
        return result

    def reserve_launch(self, job_id, authorized_acu):
        with self.transaction() as db:
            row = db.execute('SELECT state FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row or row['state'] != 'planned' or db.execute('SELECT 1 FROM launches WHERE job_id=?', (job_id,)).fetchone():
                raise Conflict('Launch already reserved or task not planned')
            launches = db.execute('SELECT status,acu_cap FROM launches').fetchall()
            if sum(row['status'] not in TERMINAL_LAUNCH_STATES for row in launches) >= self.spec.max_active:
                raise BudgetExceeded('Concurrent session reservation limit reached')
            reserved = sum(row['acu_cap'] for row in launches)
            if reserved + self.spec.per_task_acu > authorized_acu:
                raise BudgetExceeded('Authorized total ACU reservation exhausted')
            db.execute('INSERT INTO launches(job_id,acu_cap,status) VALUES(?,?,?)',
                       (job_id, self.spec.per_task_acu, 'creation_pending'))

    def abort_before_create(self, job_id, reason):
        with self.transaction() as db:
            row = db.execute('SELECT session_id,status FROM launches WHERE job_id=?', (job_id,)).fetchone()
            if not row or row['session_id'] or row['status'] != 'creation_pending':
                raise Conflict('Cannot classify an attached launch as a prelaunch failure')
            db.execute("UPDATE launches SET status='prelaunch_failed' WHERE job_id=?", (job_id,))
            db.execute("UPDATE jobs SET state='failed',failure=? WHERE id=? AND state IN ('planned','running')", (reason, job_id))

    def attach_session(self, job_id, session_id):
        if not isinstance(session_id, str) or not 1 <= len(session_id) <= 200:
            raise ValueError('Invalid provider session ID')
        with self.transaction() as db:
            if db.execute("UPDATE launches SET session_id=?,status='created' WHERE job_id=? AND session_id IS NULL AND status='creation_pending'",
                          (session_id, job_id)).rowcount != 1:
                raise Conflict('Session already attached or launch not reserved')

    def launches(self):
        with self.transaction() as db:
            return [dict(row) for row in db.execute('SELECT * FROM launches ORDER BY job_id')]

    def observe_session(self, job_id, status, reported_acu=None):
        with self.transaction() as db:
            db.execute('UPDATE launches SET status=?,reported_acu=? WHERE job_id=?', (status, reported_acu, job_id))

    def fail(self, job_id, reason):
        with self.transaction() as db:
            db.execute("UPDATE jobs SET state='failed',failure=? WHERE id=? AND state='running'", (reason, job_id))

    def expire(self):
        with self.transaction() as db:
            db.execute("UPDATE jobs SET state='timed_out',failure='wall_limit' WHERE state='running' AND deadline<?", (self.clock(),))

    def events(self, job_id):
        with self.transaction() as db:
            return [dict(row) for row in db.execute('SELECT * FROM events WHERE job_id=? ORDER BY sequence', (job_id,))]
