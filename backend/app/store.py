import hashlib
import json
import secrets
import sqlite3
from pathlib import Path


class Store:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token TEXT, state TEXT)')

    def connect(self):
        return sqlite3.connect(self.path)

    def create(self, demo=False):
        sid, token = secrets.token_urlsafe(18), secrets.token_urlsafe(32)
        state = dict(id=sid, revision=0, transcript=[], context={}, readiness={'status': 'collecting'}, demo=demo)
        with self.connect() as db:
            db.execute('INSERT INTO sessions VALUES (?,?,?)', (sid, hashlib.sha256(token.encode()).hexdigest(), json.dumps(state)))
        return state, token

    def get(self, sid, token):
        with self.connect() as db:
            row = db.execute('SELECT token,state FROM sessions WHERE id=?', (sid,)).fetchone()
        if not row or not secrets.compare_digest(row[0], hashlib.sha256(token.encode()).hexdigest()):
            return None
        return json.loads(row[1])

    def save(self, state):
        with self.connect() as db:
            db.execute('UPDATE sessions SET state=? WHERE id=?', (json.dumps(state), state['id']))
