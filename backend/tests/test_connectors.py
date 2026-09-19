import base64
import json
import time
from urllib.parse import urlparse, parse_qs
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from app import auth, main, data_api
from app.store import Store
from app.data_service import DataService, FinancialQuery
from app.database import connections, connection_auth, connection_items, sources
from app.connectors import providers, service, worker
from app.connectors.common import (ConnectorError, ProviderError, Item, Batch, encoded,
                                   now, seal, unseal, digest)
from app.connectors.service import (ConnectionService, GoogleConnect, RampConnect, PlaidConnect,
                                    PlaidExchange, consume_state, google_callback)


class Objects:
    def __init__(self):
        self.values = {}
        self.fail = False

    def put(self, key, body, content_type):
        if self.fail:
            raise RuntimeError('secret storage exception')
        self.values[key] = body

    def read(self, key):
        return self.values[key]


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('CONNECTOR_ENCRYPTION_KEY', Fernet.generate_key().decode())
    monkeypatch.setenv('GOOGLE_CLIENT_ID', 'google-id')
    monkeypatch.setenv('GOOGLE_CLIENT_SECRET', 'google-secret')
    monkeypatch.setenv('CONNECTOR_CALLBACK_BASE_URL', 'http://localhost:8000')
    monkeypatch.setenv('PLAID_CLIENT_ID', 'plaid-id')
    monkeypatch.setenv('PLAID_SECRET', 'plaid-secret')
    monkeypatch.setenv('PLAID_ENV', 'sandbox')
    store = Store(str(tmp_path / 'db'))
    objects = Objects()
    def factory(oid):
        return DataService(store, oid, objects=objects)
    a = ConnectionService(factory(store.workspace('alice')['id']), 'alice')
    b = ConnectionService(factory(store.workspace('bob')['id']), 'bob')
    return store, a, b, factory, objects


def mock_http(monkeypatch, handler):
    def factory():
        return httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(service, 'client', factory)
    monkeypatch.setattr(worker, 'client', factory)
    return factory


def connected(svc, provider='plaid', cursor=None):
    cfg = {'environment': 'sandbox', 'interval_seconds': 300, 'gmail_label_ids': ['INBOX']}
    row = svc.create_pending(provider, 'Test connection', cfg)
    svc.complete(row, 'account-' + row['id'], {'access_token': 'access-secret', 'refresh_token': 'refresh-secret', 'expires_at': now() + 3600000})
    if cursor is not None:
        with svc.engine.begin() as db:
            db.execute(update(connections).where(connections.c.id == row['id']).values(cursor=cursor))
    return row['id']


def response(payload, status=200):
    return httpx.Response(status, json=payload)


def test_google_oauth_pkce_one_use_binding_and_encryption(setup, monkeypatch):
    store, a, b, *_ = setup
    result = a.google_start('gmail', GoogleConnect())
    query = parse_qs(urlparse(result['authorization_url']).query)
    assert query['access_type'] == ['offline']
    assert query['scope'] == [providers.GOOGLE_SCOPES['gmail']]
    assert query['code_challenge_method'] == ['S256']
    state = query['state'][0]
    with pytest.raises(ConnectorError):
        consume_state(store, state, 'gmail', 'bob', b.oid)
    def handler(req):
        if req.url.host == 'oauth2.googleapis.com':
            data = parse_qs(req.content.decode())
            assert data['code_verifier']
            assert data['redirect_uri'] == query['redirect_uri']
            assert data['client_secret'] == ['google-secret']
            return response({'access_token': 'access-secret', 'refresh_token': 'refresh-secret',
                             'scope': providers.GOOGLE_SCOPES['gmail'], 'expires_in': 3600})
        return response({'emailAddress': 'finance@example.test', 'historyId': '1'})
    mock_http(monkeypatch, handler)
    result = google_callback(store, 'gmail', state, 'one-use-code')
    assert result['status'] == 'connected'
    assert 'secret' not in json.dumps(result)
    row = a.get(result['id'], private=True)
    assert 'refresh-secret' not in row['credentials']
    assert unseal(row['credentials'], row['id'])['refresh_token'] == 'refresh-secret'
    with pytest.raises(ConnectorError):
        google_callback(store, 'gmail', state, 'one-use-code')
    with pytest.raises(ConnectorError):
        unseal(row['credentials'], 'other-connection')


def test_expired_denied_oauth_and_missing_key(setup, monkeypatch):
    store, a, *_ = setup
    result = a.google_start('drive', GoogleConnect())
    state = parse_qs(urlparse(result['authorization_url']).query)['state'][0]
    with store.engine.begin() as db:
        db.execute(update(connection_auth).values(expires_at=0))
    with pytest.raises(ConnectorError, match='expired'):
        google_callback(store, 'drive', state, 'code')
    result = a.google_start('drive', GoogleConnect())
    state = parse_qs(urlparse(result['authorization_url']).query)['state'][0]
    with pytest.raises(ConnectorError):
        google_callback(store, 'drive', state, None, 'access_denied')
    assert a.get(result['connection_id'])['status'] == 'authorization_failed'
    monkeypatch.delenv('CONNECTOR_ENCRYPTION_KEY')
    with pytest.raises(ConnectorError):
        a.google_start('drive', GoogleConnect())


def test_plaid_link_exchange_bound_to_initiator(setup, monkeypatch):
    store, a, b, *_ = setup
    paths = []
    def handler(req):
        paths.append(req.url.path)
        body = json.loads(req.content)
        assert body['client_id'] == 'plaid-id'
        if req.url.path == '/link/token/create':
            assert body['products'] == ['transactions']
            return response({'link_token': 'link-secret'})
        assert body['public_token'] == 'public-token'
        return response({'access_token': 'plaid-access-secret', 'item_id': 'item-1'})
    mock_http(monkeypatch, handler)
    result = a.plaid_start(PlaidConnect())
    args = PlaidExchange(state=result['state'], public_token='public-token')
    with pytest.raises(ConnectorError):
        b.plaid_exchange(args)
    connected_row = a.plaid_exchange(args)
    assert connected_row['status'] == 'connected'
    assert 'plaid-access-secret' not in json.dumps(connected_row)
    with pytest.raises(ConnectorError):
        a.plaid_exchange(args)
    assert paths == ['/link/token/create', '/item/public_token/exchange']


def test_ramp_client_credentials_and_safe_pagination(setup, monkeypatch):
    _, a, *_ = setup
    def handler(req):
        if req.url.path.endswith('/token'):
            assert req.headers['authorization'].startswith('Basic ')
            assert parse_qs(req.content.decode())['scope'] == ['bills:read transactions:read']
            return response({'access_token': 'ramp-access', 'expires_in': 3600})
        assert req.url.host == 'demo-api.ramp.com'
        assert req.url.params['start'] == 'next+cursor'
        return response({'data': [{'id': 'b1', 'amount': {'amount': 12000, 'currency_code': 'USD', 'minor_unit_conversion_rate': 100}}], 'page': {'next': None}})
    factory = mock_http(monkeypatch, handler)
    result = a.ramp_connect(RampConnect(client_id='ramp-client', client_secret='ramp-secret'))
    assert result['status'] == 'connected'
    with factory() as http:
        batch = providers.ramp_batch(http, {'access_token': 'x'}, {'environment': 'sandbox'},
            {'next': 'https://demo-api.ramp.com/developer/v1/bills?start=next%2Bcursor'})
        assert batch.items[0].record['amount_minor'] == 12000
        assert batch.cursor == {'resource': 'transactions'}
        with pytest.raises(ConnectorError):
            providers.ramp_batch(http, {'access_token': 'x'}, {'environment': 'sandbox'},
                {'next': 'https://attacker.test/developer/v1/bills?start=x'})


def test_gmail_mime_attachments_history_and_deletion(monkeypatch):
    def b64(value):
        return base64.urlsafe_b64encode(value.encode()).decode()
    def handler(req):
        if req.url.path.endswith('/history'):
            return response({'historyId': '22', 'history': [{'messagesAdded': [{'message': {'id': 'm1'}}],
                'messagesDeleted': [{'message': {'id': 'gone'}}]}]})
        if '/attachments/' in req.url.path:
            return response({'data': b64('invoice_id,amount\na,10.00'), 'size': 28})
        return response({'id': 'm1', 'threadId': 'thread1', 'labelIds': ['INBOX'], 'payload': {
            'headers': [{'name': 'Subject', 'value': 'Supplier invoice'}],
            'parts': [{'partId': '1', 'mimeType': 'text/plain', 'body': {'data': b64('Please review the bill.')}},
                      {'partId': '2', 'filename': 'invoice.csv', 'mimeType': 'text/csv', 'body': {'attachmentId': 'att1'}}]}})
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        batch = providers.gmail_batch(http, {'access_token': 'x'}, {'gmail_label_ids': ['INBOX']}, {'history_id': '10'})
    assert batch.cursor == {'history_id': '22'}
    assert batch.removed_prefixes == ('message/gone',)
    assert len(batch.items) == 2
    assert 'Please review' in batch.items[0].text
    assert batch.items[1].raw.startswith(b'invoice_id')


def test_drive_export_pagination_and_removal():
    seen = []
    def handler(req):
        seen.append(req.url.path)
        if req.url.path.endswith('/changes'):
            assert req.url.params['pageToken'] == 'old'
            return response({'newStartPageToken': 'new', 'changes': [
                {'fileId': 'doc', 'file': {'id': 'doc', 'name': 'Policy', 'mimeType': 'application/vnd.google-apps.document'}},
                {'fileId': 'gone', 'removed': True}]})
        assert req.url.path.endswith('/export')
        assert req.url.params['mimeType'] == 'text/plain'
        return httpx.Response(200, content=b'Invoices require approval.')
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        batch = providers.drive_batch(http, {'access_token': 'x'}, {}, {'change_token': 'old'})
    assert batch.cursor == {'change_token': 'new'}
    assert batch.removed == ['file/gone']
    assert batch.items[0].filename == 'Policy.txt'
    assert batch.items[0].raw == b'Invoices require approval.'


def test_plaid_mutation_restarts_entire_pagination_and_exact_amounts(setup):
    cursors = []
    def handler(req):
        cursor = json.loads(req.content).get('cursor')
        cursors.append(cursor)
        if len(cursors) == 2:
            return response({'error_code': 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'}, 400)
        if cursor == 'old':
            return response({'added': [{'transaction_id': 'p', 'amount': '10.01', 'pending': True}],
                             'modified': [], 'removed': [], 'next_cursor': 'middle', 'has_more': True})
        return response({'added': [{'transaction_id': 'posted', 'amount': '10.01', 'pending': False,
                                    'pending_transaction_id': 'p', 'iso_currency_code': 'USD', 'date': '2026-09-01'}],
                         'modified': [], 'removed': [{'transaction_id': 'p'}], 'next_cursor': 'final', 'has_more': False})
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        batch = providers.plaid_batch(http, {'access_token': 'x'}, {'environment': 'sandbox'}, {'cursor': 'old'})
    assert cursors == ['old', 'middle', 'old', 'middle']
    assert batch.cursor == {'cursor': 'final'}
    assert len(batch.items) == 1
    assert batch.items[0].record['amount_major'] == '10.01'
    assert batch.removed == ['transaction/p']


def test_worker_versions_restore_remove_and_disconnect(setup, monkeypatch):
    store, a, _, factory, objects = setup
    cid = connected(a)
    amount = ['10.01']
    removed = [False]
    def handler(req):
        return response({'added': [] if removed[0] else [{'transaction_id': 't1', 'amount': amount[0], 'date': '2026-09-01', 'iso_currency_code': 'USD', 'pending': False}],
                         'modified': [], 'removed': [{'transaction_id': 't1'}] if removed[0] else [],
                         'next_cursor': 'next', 'has_more': False})
    mock_http(monkeypatch, handler)
    assert worker.run_once(store, factory)
    first = a.items(cid, 50, 0)['items'][0]
    assert first['status'] == 'imported'
    assert a.original(cid, first['item_id'])[1]
    assert not worker.run_once(store, factory)  # interval enforced
    for value in ('20.02', '10.01'):
        amount[0] = value
        a.sync(cid)
        assert worker.run_once(store, factory)
    latest = a.items(cid, 50, 0)['items'][0]
    assert latest['revision'] == 3  # A -> B -> A restores correctly, not an inactive old version
    rows = a.data.query_financials(FinancialQuery(dataset='plaid_transactions'))['rows']
    assert len(rows) == 1 and rows[0]['payload']['amount_major'] == '10.01'
    a.sync(cid)
    worker.run_once(store, factory)
    assert a.items(cid, 50, 0)['items'][0]['revision'] == 3
    removed[0] = True
    a.sync(cid)
    worker.run_once(store, factory)
    assert a.items(cid, 50, 0)['items'][0]['status'] == 'removed'
    with pytest.raises(LookupError):
        a.data.query_financials(FinancialQuery(dataset='plaid_transactions'))
    removed[0] = False
    a.sync(cid)
    worker.run_once(store, factory)
    assert a.items(cid, 50, 0)['items'][0]['revision'] == 4
    a.disconnect(cid)
    assert a.get(cid, True)['credentials'] is None
    with pytest.raises(LookupError):
        a.data.query_financials(FinancialQuery(dataset='plaid_transactions'))
    assert a.original(cid, first['item_id'])[1]  # explicit audit original retained


def test_worker_cursor_failure_recovery_concurrency_and_secrets(setup, monkeypatch):
    store, a, _, factory, objects = setup
    cid = connected(a, cursor={'cursor': 'old'})
    calls = []
    def handler(req):
        calls.append(json.loads(req.content).get('cursor'))
        return response({'added': [{'transaction_id': 'x', 'amount': '0.1', 'date': '2026-09-01', 'iso_currency_code': 'USD'}],
                         'removed': [], 'modified': [], 'next_cursor': 'new', 'has_more': False})
    mock_http(monkeypatch, handler)
    with ThreadPoolExecutor(2) as pool:
        claims = list(pool.map(lambda _: worker.claim(store), range(2)))
    assert sum(c is not None for c in claims) == 1
    with pytest.raises(ConnectorError, match='in flight'):
        a.disconnect(cid)
    with store.engine.begin() as db:
        db.execute(update(connections).where(connections.c.id == cid).values(lease_until=0))
    objects.fail = True
    assert worker.run_once(store, factory)
    assert a.get(cid)['status'] == 'error'
    assert a.get(cid, True)['cursor'] == {'cursor': 'old'}
    assert 'secret storage' not in json.dumps(a.get(cid))
    objects.fail = False
    a.sync(cid)
    assert worker.run_once(store, factory)
    assert calls == ['old', 'old']
    assert a.get(cid, True)['cursor'] == {'cursor': 'new'}


def test_refresh_token_persisted_and_unsupported_original_retained(setup, monkeypatch):
    store, a, _, factory, _ = setup
    cid = connected(a, provider='drive', cursor={'change_token': 'old'})
    with store.engine.begin() as db:
        db.execute(update(connections).where(connections.c.id == cid).values(credentials=seal(
            {'access_token': 'expired', 'refresh_token': 'refresh-secret', 'expires_at': 0}, cid)))
    def handler(req):
        if req.url.host == 'oauth2.googleapis.com':
            assert parse_qs(req.content.decode())['refresh_token'] == ['refresh-secret']
            return response({'access_token': 'refreshed', 'expires_in': 3600})
        assert req.headers['authorization'] == 'Bearer refreshed'
        if req.url.path.endswith('/changes'):
            return response({'newStartPageToken': 'new', 'changes': [{'fileId': 'sheet', 'file':
                {'id': 'sheet', 'name': 'ledger.xlsx', 'mimeType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}}]})
        return httpx.Response(200, content=b'binary-xlsx')
    mock_http(monkeypatch, handler)
    assert worker.run_once(store, factory)
    item = a.items(cid, 50, 0)['items'][0]
    assert item['status'] == 'partial'
    assert a.original(cid, item['item_id'])[1] == b'binary-xlsx'
    assert unseal(a.get(cid, True)['credentials'], cid)['refresh_token'] == 'refresh-secret'


def test_gmail_expired_history_reconciles_deleted_records(setup, monkeypatch):
    store, a, _, factory, _ = setup
    cid = connected(a, provider='gmail', cursor={'history_id': 'expired'})
    row, token, _ = worker.claim(store)
    worker.publish(store, factory(a.oid), row, token, Item('message/old', 'old.json', 'application/json', b'{"old":true}', text='old email'))
    with store.engine.begin() as db:
        db.execute(update(connections).where(connections.c.id == cid).values(lease_until=0))
    def handler(req):
        if req.url.path.endswith('/history'):
            return response({}, 404)
        if req.url.path.endswith('/profile'):
            return response({'historyId': 'new'})
        return response({'messages': []})
    mock_http(monkeypatch, handler)
    assert worker.run_once(store, factory)
    a.sync(cid)
    assert worker.run_once(store, factory)
    assert a.items(cid, 50, 0)['items'][0]['status'] == 'removed'
    assert a.get(cid, True)['cursor'] == {'history_id': 'new'}


def test_api_scope_safe_validation_and_disconnect(setup, monkeypatch):
    store, a, b, factory, _ = setup
    cid = connected(a)
    monkeypatch.setattr(main, 'store', store)
    def verify(token):
        if token not in ('alice', 'bob'):
            raise HTTPException(401)
        return auth.Identity(token, int(time.time()) + 300)
    monkeypatch.setattr(auth, 'verify', verify)
    def data(identity=Depends(auth.current_user)):
        return factory(store.workspace(identity.user_id)['id'])
    main.app.dependency_overrides[data_api.service] = data
    try:
        with TestClient(main.app) as api:
            headers = {'Authorization': 'Bearer alice'}
            assert api.get('/connections').status_code == 401
            assert len(api.get('/connections/providers', headers=headers).json()['providers']) == 4
            for path in (f'/connections/{cid}', f'/connections/{cid}/items', f'/connections/{cid}/syncs'):
                assert api.get(path, headers={'Authorization': 'Bearer bob'}).status_code == 404
            assert api.post(f'/connections/{cid}/disconnect', headers={'Authorization': 'Bearer bob'}).status_code == 404
            bad = api.post('/connections/ramp', headers=headers, json={'client_id': 'abc', 'client_secret': 'do-not-echo', 'environment': 'invalid'})
            assert bad.status_code == 422 and 'do-not-echo' not in bad.text
            extra = api.post('/connections/google/gmail/authorize', headers=headers, json={'organization_id': b.oid})
            assert extra.status_code == 422
            assert 'access-secret' not in api.get('/connections', headers=headers).text
            assert api.post(f'/connections/{cid}/disconnect', headers=headers).status_code == 200
    finally:
        main.app.dependency_overrides.clear()


def test_google_sheet_exports_all_tabs_and_preserves_formulas(setup, monkeypatch):
    import io
    from openpyxl import Workbook
    store, a, _, factory, _ = setup
    workbook = Workbook()
    workbook.active.title = 'Invoices'
    workbook.active.append(['invoice', 'amount'])
    workbook.active.append(['A', 100])
    workbook.create_sheet('Policies').append(['approval threshold', '=100+50'])
    content = io.BytesIO()
    workbook.save(content)
    cid = connected(a, provider='drive', cursor={'change_token': 'old'})
    def handler(req):
        if req.url.path.endswith('/changes'):
            return response({'newStartPageToken': 'new', 'changes': [{'fileId': 'sheet', 'file':
                {'id': 'sheet', 'name': 'Finance', 'mimeType': 'application/vnd.google-apps.spreadsheet'}}]})
        assert req.url.path.endswith('/export')
        assert req.url.params['mimeType'].endswith('spreadsheetml.sheet')
        return httpx.Response(200, content=content.getvalue())
    mock_http(monkeypatch, handler)
    worker.run_once(store, factory)
    item = a.items(cid, 50, 0)['items'][0]
    assert item['status'] == 'imported'
    from app.data_service import SourceQuery
    evidence = a.data.get_source(SourceQuery(source_id=item['source_ids'][0]))['chunks'][0]['content']
    assert 'Invoices' in evidence and 'Policies' in evidence and '=100+50' in evidence


def test_rate_limit_auth_failure_and_expired_member(setup, monkeypatch):
    store, a, _, factory, _ = setup
    cid = connected(a)
    mock_http(monkeypatch, lambda req: httpx.Response(429, headers={'Retry-After': '120'}, json={'error': 'do-not-leak'}))
    before = now()
    worker.run_once(store, factory)
    assert a.get(cid)['next_sync_at'] >= before + 120000
    assert 'do-not-leak' not in a.get(cid)['error']
    a.sync(cid)
    mock_http(monkeypatch, lambda req: response({'error_code': 'ITEM_LOGIN_REQUIRED'}, 400))
    worker.run_once(store, factory)
    assert a.get(cid)['status'] == 'reauth_required'
    result = a.google_start('drive', GoogleConnect())
    state = parse_qs(urlparse(result['authorization_url']).query)['state'][0]
    from app.database import memberships
    from sqlalchemy import delete
    with store.engine.begin() as db:
        db.execute(delete(memberships).where(memberships.c.user_id == 'alice'))
    with pytest.raises(ConnectorError, match='access removed'):
        google_callback(store, 'drive', state, 'code')


def test_stale_worker_cannot_publish_after_disconnect(setup):
    store, a, _, factory, _ = setup
    cid = connected(a)
    row, token, _ = worker.claim(store)
    with store.engine.begin() as db:
        db.execute(update(connections).where(connections.c.id == cid).values(lease_until=0))
    a.disconnect(cid)
    with pytest.raises(ConnectorError, match='lease lost'):
        worker.publish(store, factory(a.oid), row, token, Item('x', 'x.txt', 'text/plain', b'private', text='private'))
    assert not a.data.list_sources()['sources']
