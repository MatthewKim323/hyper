"""Leased incremental ingestion; run separately from the API."""
import argparse
import time
import uuid
from pathlib import Path

from dotenv import load_dotenv
from pypdf.errors import PdfReadError
from sqlalchemy import select, update, and_
from ..database import connections, connection_items, connection_syncs, sources
from ..data_service import DataService
from ..store import Store
from .common import client, now, unseal, seal, digest, encoded, ConnectorError, ProviderError
from .providers import FETCH, google_token, ramp_token, spreadsheet_text
from .service import token_values

LEASE_MS = 300000


def claim(store):
    timestamp, token = now(), uuid.uuid4().hex
    with store.engine.begin() as db:
        if db.dialect.name == 'sqlite':
            db.exec_driver_sql('BEGIN IMMEDIATE')
        row = db.execute(select(connections).where(connections.c.status.in_(['connected', 'error']),
            connections.c.next_sync_at <= timestamp, connections.c.lease_until <= timestamp)
            .order_by(connections.c.next_sync_at).limit(1).with_for_update(skip_locked=True)).mappings().first()
        if not row:
            return None
        # Mark abandoned log entries before taking over their work.
        db.execute(update(connection_syncs).where(connection_syncs.c.connection_id == row['id'],
            connection_syncs.c.status == 'running').values(status='interrupted', finished_at=timestamp))
        db.execute(update(connections).where(connections.c.id == row['id']).values(
            claim_token=token, lease_until=timestamp + LEASE_MS))
        run_id = 'sync_' + uuid.uuid4().hex
        db.execute(connection_syncs.insert().values(id=run_id, connection_id=row['id'],
            started_at=timestamp, status='running'))
    return dict(row), token, run_id


def fence(row, token):
    return and_(connections.c.id == row['id'], connections.c.claim_token == token,
                connections.c.status.in_(['connected', 'error']))


def renew(store, row, token):
    with store.engine.begin() as db:
        if not db.execute(update(connections).where(fence(row, token)).values(lease_until=now() + LEASE_MS)).rowcount:
            raise ConnectorError('Sync lease lost', 409)


class LeasedClient:
    def __init__(self, http, store, row, token):
        self.http, self.store, self.row, self.token = http, store, row, token

    def stream(self, *args, **kwargs):
        renew(self.store, self.row, self.token)
        return self.http.stream(*args, **kwargs)


def deactivate(store, row, token, remote_ids=(), prefixes=(), unseen_scan=None):
    with store.engine.begin() as db:
        if not db.execute(select(connections.c.id).where(fence(row, token)).with_for_update()).first():
            raise ConnectorError('Sync lease lost', 409)
        q = select(connection_items).where(connection_items.c.connection_id == row['id'])
        # Remote IDs are data; never interpolate them into SQL LIKE expressions.
        for item in db.execute(q).mappings():
            matched = item['remote_id'] in remote_ids or any(
                item['remote_id'] == p or item['remote_id'].startswith(p + '/') for p in prefixes)
            if unseen_scan is not None:
                matched = item['scan_id'] != unseen_scan
            if not matched:
                continue
            db.execute(update(sources).where(sources.c.organization_id == row['organization_id'],
                sources.c.id.in_(item['source_ids'])).values(active=False))
            db.execute(update(connection_items).where(connection_items.c.connection_id == row['id'],
                connection_items.c.item_id == item['item_id']).values(status='removed', updated_at=now()))


def publish(store, data, row, token, item, scan_id=None):
    renew(store, row, token)
    iid, sha = digest(item.remote_id), digest(item.raw)
    where = and_(connection_items.c.connection_id == row['id'], connection_items.c.item_id == iid)
    with store.engine.begin() as db:
        previous = db.execute(select(connection_items).where(where)).mappings().first()
        unchanged = previous and previous['sha256'] == sha and previous['filename'] == item.filename[:255] and previous['content_type'] == item.content_type
        if unchanged and previous['status'] in ('imported', 'partial'):
            db.execute(update(connection_items).where(where).values(scan_id=scan_id, updated_at=now()))
            return
        revision = 1 if not previous else previous['revision'] + int(not unchanged or previous['status'] == 'removed')
        object_key = f"organizations/{row['organization_id']}/connections/{row['id']}/{iid}/{sha}"
        values = dict(remote_id=item.remote_id, filename=item.filename[:255], content_type=item.content_type,
                      sha256=sha, object_key=object_key, revision=revision, status='publishing',
                      source_ids=previous['source_ids'] if previous else [], error=None, scan_id=scan_id, updated_at=now())
        if previous:
            db.execute(update(connection_items).where(where).values(**values))
        else:
            db.execute(connection_items.insert().values(connection_id=row['id'], item_id=iid, **values))
    data.objects.put(object_key, item.raw, item.content_type)
    base = f"connection/{row['id']}/{iid}"
    def guard(db):
        if not db.execute(select(connections.c.id).where(fence(row, token)).with_for_update()).first():
            raise ConnectorError('Sync lease lost', 409)
    def ingest(*args, **kwargs):
        return data.ingest(*args, **kwargs, transaction_guard=guard)
    ids = []
    if item.record is not None:
        record = {**item.record, 'id': row['id'] + ':' + item.record['id'], 'connection_id': row['id']}
        source = ingest('record.jsonl', encoded(record), source_key=base + '/record',
            dataset=item.dataset, currency=item.currency, field_types=item.field_types, id_field='id', import_revision=revision)
        ids.append(source['id'])
    warning = item.warning
    try:
        if item.parse_original:
            if item.filename.lower().endswith(('.xlsx', '.xlsm')):
                try:
                    content = spreadsheet_text(item.raw).encode()
                except Exception:
                    raise ValueError('Workbook extraction unavailable') from None
                source = ingest('workbook.txt', content, source_key=base + '/evidence', import_revision=revision)
            else:
                source = ingest(item.filename, item.raw, source_key=base + '/evidence', import_revision=revision)
        else:
            content = item.text.encode() if item.text is not None else item.raw
            source = ingest('evidence.txt' if item.text is not None else 'evidence.json', content,
                                 source_key=base + '/evidence', import_revision=revision)
    except (ValueError, UnicodeError, PdfReadError):
        # Keep the original even when it is scanned/unsupported; surface a searchable manifest, not fabricated OCR.
        warning = 'original_saved_but_not_text_extracted'
        source = ingest('manifest.txt', f'{item.filename}\nSource: {row["provider"]}\nRemote ID: {item.remote_id}\nOriginal saved. Text extraction unavailable.'.encode(),
                             source_key=base + '/evidence', import_revision=revision)
    ids.append(source['id'])
    with store.engine.begin() as db:
        if not db.execute(update(connections).where(fence(row, token)).values(lease_until=now() + LEASE_MS)).rowcount:
            raise ConnectorError('Sync lease lost', 409)
        db.execute(update(connection_items).where(where).values(source_ids=ids,
            status='partial' if warning else 'imported', error=warning, updated_at=now()))


def run_once(store, data_factory=None):
    claimed = claim(store)
    if not claimed:
        return False
    row, token, run_id = claimed
    try:
        credentials = unseal(row['credentials'], row['id'])
        cursor = dict(row['cursor'])
        if row['provider'] in ('gmail', 'drive') and not (cursor.get('history_id') or cursor.get('change_token')):
            if not cursor.get('scan_id'):
                cursor['scan_id'] = uuid.uuid4().hex
                with store.engine.begin() as db:
                    db.execute(update(connections).where(fence(row, token)).values(cursor=cursor))
        with client() as http:
            leased = LeasedClient(http, store, row, token)
            if row['provider'] != 'plaid' and credentials.get('expires_at', 0) <= now() + 60000:
                if row['provider'] in ('gmail', 'drive'):
                    tokens = google_token(leased, {'grant_type': 'refresh_token', 'refresh_token': credentials['refresh_token']})
                else:
                    tokens = ramp_token(leased, credentials, row['config']['environment'])
                credentials = token_values(tokens, credentials)
                with store.engine.begin() as db:
                    db.execute(update(connections).where(fence(row, token)).values(credentials=seal(credentials, row['id'])))
            batch = FETCH[row['provider']](leased, credentials, row['config'], cursor)
        data = data_factory(row['organization_id']) if data_factory else DataService(store, row['organization_id'])
        for item in batch.items:
            publish(store, data, row, token, item, cursor.get('scan_id'))
        renew(store, row, token)
        deactivate(store, row, token, batch.removed, batch.removed_prefixes)
        if cursor.get('scan_id') and not batch.has_more:
            deactivate(store, row, token, unseen_scan=cursor['scan_id'])
        with store.engine.begin() as db:
            changed = db.execute(update(connections).where(fence(row, token)).values(
                cursor=batch.cursor, status='connected', failures=0, error=None,
                last_synced_at=now() if not batch.has_more else row['last_synced_at'],
                next_sync_at=now() + (1000 if batch.has_more else row['config']['interval_seconds'] * 1000),
                claim_token=None, lease_until=0))
            if changed.rowcount:
                db.execute(update(connection_syncs).where(connection_syncs.c.id == run_id).values(status='complete', finished_at=now()))
    except Exception as exc:
        needs_auth = isinstance(exc, ProviderError) and (exc.code in ('invalid_grant', 'ITEM_LOGIN_REQUIRED', 'INVALID_ACCESS_TOKEN') or exc.provider_status == 401)
        error = 'Provider authorization needs renewal; disconnect and reconnect' if needs_auth else f'{type(exc).__name__}: sync failed; originals and cursor retained for retry'
        failures = row['failures'] + 1
        delay = max(getattr(exc, 'retry_after', 60), min(3600, 60 * 2 ** min(failures - 1, 6)))
        with store.engine.begin() as db:
            changed = db.execute(update(connections).where(fence(row, token)).values(status='reauth_required' if needs_auth else 'error',
                error=error, failures=failures, next_sync_at=now() + delay * 1000, claim_token=None, lease_until=0))
            if changed.rowcount:
                db.execute(update(connection_syncs).where(connection_syncs.c.id == run_id).values(status='failed', finished_at=now(), error=error))
    return True


def main():
    load_dotenv(Path(__file__).resolve().parents[2] / '.env')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    store = Store()
    while True:
        worked = run_once(store)
        if args.once:
            break
        if not worked:
            time.sleep(2)


if __name__ == '__main__':
    main()
