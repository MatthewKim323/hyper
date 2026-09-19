import base64
import hashlib
import os
import secrets
import uuid
from typing import Literal
from urllib.parse import urlencode, urlparse

from pydantic import Field, SecretStr
from sqlalchemy import select, update, delete
from sqlalchemy.exc import IntegrityError
from ..database import connections, connection_auth, connection_items, connection_syncs, sources
from ..data_service import StrictModel
from .common import key, seal, unseal, require, digest, now, client, request, ConnectorError
from .providers import GOOGLE_SCOPES, google_token, ramp_token, plaid


class GoogleConnect(StrictModel):
    label: str = Field(default='Google account', min_length=1, max_length=120)
    interval_seconds: int = Field(default=300, ge=60, le=86400)
    gmail_label_ids: list[str] = Field(default=['INBOX'], min_length=1, max_length=5)
    drive_folder_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{1,200}$')


class RampConnect(StrictModel):
    label: str = Field(default='Ramp business', min_length=1, max_length=120)
    client_id: SecretStr
    client_secret: SecretStr
    environment: Literal['sandbox', 'production'] = 'sandbox'
    interval_seconds: int = Field(default=300, ge=60, le=86400)


class PlaidConnect(StrictModel):
    label: str = Field(default='Bank connection', min_length=1, max_length=120)
    interval_seconds: int = Field(default=300, ge=60, le=86400)


class PlaidExchange(StrictModel):
    state: str = Field(min_length=20, max_length=200)
    public_token: SecretStr


def public(row):
    return {k: v for k, v in row.items() if k not in ('credentials', 'organization_id', 'cursor', 'claim_token', 'lease_until', 'external_id')}


def redirect_uri(provider):
    require('CONNECTOR_CALLBACK_BASE_URL')
    base = os.environ['CONNECTOR_CALLBACK_BASE_URL'].rstrip('/')
    parsed = urlparse(base)
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')):
        raise ConnectorError('OAuth callback must use HTTPS or localhost')
    if parsed.query or parsed.fragment or parsed.username:
        raise ConnectorError('Invalid callback base URL')
    return base + '/connections/oauth/' + provider + '/callback'


def token_values(tokens, previous=None):
    values = {**(previous or {}), **tokens}
    if not values.get('access_token'):
        raise ConnectorError('Provider did not return an access token')
    values['expires_at'] = now() + int(tokens.get('expires_in', 3600)) * 1000
    return values


class ConnectionService:
    def __init__(self, data, user_id=None):
        self.data, self.store, self.engine = data, data.store, data.engine
        self.oid, self.user_id = data.oid, user_id

    def get(self, cid, private=False):
        with self.engine.connect() as db:
            row = db.execute(select(connections).where(connections.c.id == cid,
                connections.c.organization_id == self.oid)).mappings().first()
        if not row:
            raise ConnectorError('Connection not found', 404)
        return dict(row) if private else public(row)

    def list(self, limit, offset):
        with self.engine.connect() as db:
            rows = db.execute(select(connections).where(connections.c.organization_id == self.oid)
                .order_by(connections.c.created_at.desc(), connections.c.id).offset(offset).limit(limit + 1)).mappings().all()
        return {'connections': [public(r) for r in rows[:limit]], 'has_more': len(rows) > limit}

    def create_pending(self, provider, label, config):
        key()  # Fail before creating an unusable row.
        row = dict(id='con_' + uuid.uuid4().hex, organization_id=self.oid, provider=provider,
                   label=label, status='authorizing', credentials=None, external_id=None,
                   config=config, cursor={}, created_at=now(), last_synced_at=None, next_sync_at=0,
                   lease_until=0, claim_token=None, failures=0, error=None)
        with self.engine.begin() as db:
            db.execute(connections.insert().values(**row))
        return row

    def state(self, row, secret):
        token = secrets.token_urlsafe(32)
        with self.engine.begin() as db:
            db.execute(connection_auth.insert().values(state_hash=digest(token), connection_id=row['id'],
                user_id=self.user_id, expires_at=now() + 600000, secret=seal(secret, row['id'])))
        return token

    def complete(self, row, external_id, credentials, label=None):
        try:
            with self.engine.begin() as db:
                changed = db.execute(update(connections).where(connections.c.id == row['id'],
                    connections.c.organization_id == self.oid, connections.c.status == 'authorizing')
                    .values(status='connected', external_id=external_id,
                            credentials=seal(credentials, row['id']), label=label or row['label'], next_sync_at=now()))
                if not changed.rowcount:
                    raise ConnectorError('Connection authorization was cancelled', 409)
        except IntegrityError:
            self.fail_authorization(row['id'])
            raise ConnectorError('This account is already connected to this organization', 409) from None
        return self.get(row['id'])

    def fail_authorization(self, cid):
        with self.engine.begin() as db:
            db.execute(update(connections).where(connections.c.id == cid, connections.c.status == 'authorizing')
                .values(status='authorization_failed', credentials=None, error='Authorization failed; start a new connection'))

    def google_start(self, provider, args):
        if provider not in GOOGLE_SCOPES:
            raise ConnectorError('Unknown Google provider', 404)
        require('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET')
        uri = redirect_uri(provider)
        row = self.create_pending(provider, args.label, args.model_dump())
        verifier = secrets.token_urlsafe(48)
        state = self.state(row, {'verifier': verifier, 'redirect_uri': uri})
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
        url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urlencode({
            'client_id': os.environ['GOOGLE_CLIENT_ID'], 'redirect_uri': uri,
            'response_type': 'code', 'scope': GOOGLE_SCOPES[provider], 'access_type': 'offline',
            'prompt': 'consent', 'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256'})
        return {'connection_id': row['id'], 'authorization_url': url, 'expires_in': 600}

    def ramp_connect(self, args):
        key()
        credentials = {'client_id': args.client_id.get_secret_value(), 'client_secret': args.client_secret.get_secret_value()}
        if not all(credentials.values()):
            raise ConnectorError('Ramp client credentials cannot be empty', 422)
        with client() as http:
            tokens = ramp_token(http, credentials, args.environment)
        row = self.create_pending('ramp', args.label, {'environment': args.environment, 'interval_seconds': args.interval_seconds})
        return self.complete(row, args.environment + ':' + digest(credentials['client_id']), token_values(tokens, credentials))

    def plaid_start(self, args):
        require('PLAID_CLIENT_ID', 'PLAID_SECRET')
        environment = os.getenv('PLAID_ENV', 'sandbox')
        if environment not in ('sandbox', 'production'):
            raise ConnectorError('PLAID_ENV must be sandbox or production')
        key()
        with client() as http:
            result = plaid(http, '/link/token/create', environment,
                user={'client_user_id': digest(self.oid + ':' + self.user_id)},
                client_name='Hyper Finance', products=['transactions'], country_codes=['US'], language='en')
        row = self.create_pending('plaid', args.label, {'environment': environment, 'interval_seconds': args.interval_seconds})
        state = self.state(row, {})
        return {'connection_id': row['id'], 'link_token': result['link_token'], 'state': state, 'expires_in': 600}

    def plaid_exchange(self, args):
        row, _ = consume_state(self.store, args.state, 'plaid', self.user_id, self.oid)
        try:
            with client() as http:
                result = plaid(http, '/item/public_token/exchange', row['config']['environment'],
                               public_token=args.public_token.get_secret_value())
            return self.complete(row, row['config']['environment'] + ':' + result['item_id'],
                                 {'access_token': result['access_token']})
        except Exception:
            self.fail_authorization(row['id'])
            raise

    def sync(self, cid):
        with self.engine.begin() as db:
            if db.dialect.name == 'sqlite':
                db.exec_driver_sql('BEGIN IMMEDIATE')
            row = db.execute(select(connections).where(connections.c.id == cid,
                connections.c.organization_id == self.oid).with_for_update()).mappings().first()
            if not row:
                raise ConnectorError('Connection not found', 404)
            if row['status'] not in ('connected', 'error'):
                raise ConnectorError('Connection must be authorized before syncing', 409)
            if row['lease_until'] > now():
                return public(row)  # Already queued/running; do not invalidate the current lease.
            db.execute(update(connections).where(connections.c.id == cid).values(status='connected', next_sync_at=now(), error=None))
        return self.get(cid)

    def disconnect(self, cid):
        with self.engine.begin() as db:
            if db.dialect.name == 'sqlite':
                db.exec_driver_sql('BEGIN IMMEDIATE')
            row = db.execute(select(connections).where(connections.c.id == cid,
                connections.c.organization_id == self.oid).with_for_update()).mappings().first()
            if not row:
                raise ConnectorError('Connection not found', 404)
            if row['lease_until'] > now():
                raise ConnectorError('Sync is in flight; retry disconnect when it finishes', 409)
            items = db.execute(select(connection_items.c.source_ids).where(connection_items.c.connection_id == cid)).scalars()
            for ids in items:
                db.execute(update(sources).where(sources.c.organization_id == self.oid, sources.c.id.in_(ids)).values(active=False))
            db.execute(update(connections).where(connections.c.id == cid).values(status='disconnected', credentials=None,
                external_id=None, claim_token=None, lease_until=0, error=None))
            db.execute(delete(connection_auth).where(connection_auth.c.connection_id == cid))
        return self.get(cid)

    def items(self, cid, limit, offset):
        self.get(cid)
        with self.engine.connect() as db:
            rows = db.execute(select(connection_items).where(connection_items.c.connection_id == cid)
                .order_by(connection_items.c.item_id).offset(offset).limit(limit + 1)).mappings().all()
        return {'items': [{k: v for k, v in r.items() if k != 'object_key'} for r in rows[:limit]], 'has_more': len(rows) > limit}

    def original(self, cid, iid):
        self.get(cid)
        with self.engine.connect() as db:
            row = db.execute(select(connection_items).where(connection_items.c.connection_id == cid,
                connection_items.c.item_id == iid)).mappings().first()
        if not row or not row['object_key']:
            raise ConnectorError('Original not found', 404)
        return row, self.data.objects.read(row['object_key'])

    def syncs(self, cid, limit=20):
        self.get(cid)
        with self.engine.connect() as db:
            rows = db.execute(select(connection_syncs).where(connection_syncs.c.connection_id == cid)
                .order_by(connection_syncs.c.started_at.desc()).limit(limit)).mappings().all()
        return {'syncs': [dict(r) for r in rows]}


def consume_state(store, state, provider, user_id=None, oid=None):
    with store.engine.begin() as db:
        if db.dialect.name == 'sqlite':
            db.exec_driver_sql('BEGIN IMMEDIATE')
        auth = db.execute(select(connection_auth).where(connection_auth.c.state_hash == digest(state)).with_for_update()).mappings().first()
        if not auth or auth['expires_at'] < now():
            raise ConnectorError('Authorization state expired or already used', 400)
        row = db.execute(select(connections).where(connections.c.id == auth['connection_id'])).mappings().one()
        if row['provider'] != provider or (user_id and auth['user_id'] != user_id) or (oid and row['organization_id'] != oid):
            raise ConnectorError('Authorization state does not match this request', 400)
        from ..database import memberships
        if not db.execute(select(memberships.c.user_id).where(memberships.c.user_id == auth['user_id'],
                memberships.c.organization_id == row['organization_id'])).first():
            raise ConnectorError('Workspace access removed', 403)
        db.execute(delete(connection_auth).where(connection_auth.c.state_hash == digest(state)))
    return dict(row), unseal(auth['secret'], row['id'])


def google_callback(store, provider, state, code, error=None):
    row, secret = consume_state(store, state, provider)
    from ..data_service import DataService
    svc = ConnectionService(DataService(store, row['organization_id']))
    try:
        if error or not code:
            raise ConnectorError('Google authorization was not granted', 400)
        with client() as http:
            tokens = google_token(http, {'grant_type': 'authorization_code', 'code': code,
                'redirect_uri': secret['redirect_uri'], 'code_verifier': secret['verifier']})
            if not tokens.get('refresh_token'):
                raise ConnectorError('Google did not grant offline access; reconnect with consent', 409)
            scopes = tokens.get('scope', '').split()
            if GOOGLE_SCOPES[provider] not in scopes:
                raise ConnectorError('Required Google read scope was not granted', 403)
            headers = {'Authorization': 'Bearer ' + tokens['access_token']}
            if provider == 'gmail':
                identity = request(http, 'GET', 'https://gmail.googleapis.com/gmail/v1/users/me/profile', headers=headers)
                external_id = identity['emailAddress']
            else:
                identity = request(http, 'GET', 'https://www.googleapis.com/drive/v3/about', headers=headers, params={'fields': 'user'})
                external_id = identity['user']['permissionId']
        return svc.complete(row, external_id, token_values(tokens))
    except Exception:
        svc.fail_authorization(row['id'])
        raise
