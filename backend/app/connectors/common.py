import hashlib
import json
import os
import time
from dataclasses import dataclass

import httpx
from cryptography.fernet import Fernet
from ..parsing import MAX_BYTES


class ConnectorError(Exception):
    def __init__(self, message, status=503, retry_after=60):
        self.message, self.status, self.retry_after = message, status, retry_after
        super().__init__(message)


class ProviderError(ConnectorError):
    def __init__(self, status, code='', retry_after=60):
        self.provider_status, self.code = status, code
        super().__init__('Provider request failed; check credentials, access and sync status',
                         502, retry_after)


def now():
    return int(time.time() * 1000)


def key():
    try:
        return Fernet(os.environ['CONNECTOR_ENCRYPTION_KEY'].encode())
    except (KeyError, ValueError):
        raise ConnectorError('CONNECTOR_ENCRYPTION_KEY is not configured', 503) from None


def seal(value, context):
    return key().encrypt(json.dumps({'context': context, 'value': value}).encode()).decode()


def unseal(value, context):
    decoded = json.loads(key().decrypt(value.encode()))
    if decoded['context'] != context:
        raise ConnectorError('Credential context mismatch')
    return decoded['value']


def require(*names):
    if any(not os.getenv(name) for name in names):
        raise ConnectorError('Missing server configuration: ' + ', '.join(names), 503)


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def request(client, method, url, *, binary=False, **kwargs):
    # Do not follow arbitrary provider redirect URLs with credentials attached.
    with client.stream(method, url, **kwargs) as response:
        content = bytearray()
        for piece in response.iter_bytes():
            content.extend(piece)
            if len(content) > MAX_BYTES:
                raise ConnectorError('Provider object exceeds 20 MiB', 422)
        if not 200 <= response.status_code < 300:
            try:
                body = json.loads(content)
                code = body.get('error_code', '') or (body.get('error') if isinstance(body.get('error'), str) else '')
            except (ValueError, AttributeError):
                code = ''
            retry = response.headers.get('retry-after', '60')
            raise ProviderError(response.status_code, code,
                                max(1, min(int(retry), 3600)) if retry.isdigit() else 60)
        return bytes(content) if binary else json.loads(content, parse_float=str)


def client():
    return httpx.Client(timeout=httpx.Timeout(30, connect=10), follow_redirects=False)


@dataclass
class Item:
    remote_id: str
    filename: str
    content_type: str
    raw: bytes
    text: str | None = None
    record: dict | None = None
    dataset: str | None = None
    currency: str | None = None
    field_types: dict | None = None
    parse_original: bool = False
    warning: str | None = None


@dataclass
class Batch:
    items: list
    removed: list
    cursor: dict
    has_more: bool = False
    # A prefix removal includes attachments of deleted messages.
    removed_prefixes: tuple = ()
