import json
import sqlite3
import time
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from fastapi import HTTPException
from app import auth
from app.store import Store

@pytest.fixture
def token_factory(monkeypatch):
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    public=key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    monkeypatch.setenv('CLERK_ISSUER','https://test.clerk.accounts.dev')
    monkeypatch.setenv('CLERK_AUTHORIZED_PARTIES','http://localhost:8000')
    monkeypatch.setenv('CLERK_JWT_PUBLIC_KEY',public)
    monkeypatch.delenv('CLERK_AUDIENCE',raising=False)
    def token(**overrides):
        now=int(time.time())
        claims=dict(sub='user_1',sid='session_1',iss='https://test.clerk.accounts.dev',azp='http://localhost:8000',iat=now,nbf=now-1,exp=now+60)
        claims.update(overrides)
        return jwt.encode(claims,key,algorithm='RS256')
    return token

def test_valid_signed_identity(token_factory):
    assert auth.verify(token_factory()).user_id=='user_1'

@pytest.mark.parametrize('overrides',[
    {'exp':1},{'nbf':9999999999},{'iss':'https://evil.example'},
    {'azp':'https://evil.example'},{'sts':'pending'},{'sub':''}
])
def test_invalid_claims_rejected(token_factory,overrides):
    with pytest.raises(HTTPException) as e: auth.verify(token_factory(**overrides))
    assert e.value.status_code==401

def test_forged_signature_rejected(token_factory):
    token=token_factory()
    header,body,_=token.split('.')
    with pytest.raises(HTTPException):auth.verify(header+'.'+body+'.'+'A'*342)

def test_unconfigured_fails_closed(monkeypatch):
    monkeypatch.delenv('CLERK_ISSUER',raising=False)
    with pytest.raises(HTTPException) as e:auth.verify('anything')
    assert e.value.status_code==503

def test_persistence_isolation_and_new_task(tmp_path):
    path=str(tmp_path/'db')
    store=Store(path)
    state=store.create('alice')
    state['context']={'company':'Meridian','facts':[{'statement':'USD reporting'}],'objective':'Review payables'}
    state['readiness']={'status':'ready'}
    state['transcript']=[{'role':'user','text':'My company is Meridian'}]
    assert store.save_context(state)
    restarted=Store(path)
    org=restarted.workspace('alice')
    assert org['onboarding_complete']
    assert org['latest_session_id']==state['id']
    assert restarted.get(state['id'],'alice')['transcript']==state['transcript']
    assert restarted.get(state['id'],'bob') is None
    new=restarted.create('alice')
    assert new['context']['company']=='Meridian'
    assert 'objective' not in new['context']
    assert new['readiness']['status']=='collecting'
    assert restarted.save_context(new)
    assert restarted.workspace('alice')['onboarding_complete']

def test_team_and_revocation(tmp_path,monkeypatch):
    monkeypatch.setenv('DEMO_USER_IDS','alice,bob')
    store=Store(str(tmp_path/'db'))
    a=store.create('alice')
    assert store.workspace('bob')['id']==a['organization_id']
    assert store.get(a['id'],'bob')
    with store.connect() as db:db.exec_driver_sql('DELETE FROM memberships WHERE user_id=?',('bob',))
    assert not store.member('bob',a['organization_id'])
    assert store.get(a['id'],'bob') is None
    with pytest.raises(PermissionError):store.workspace('bob')

def test_old_session_cannot_replace_new_memory(tmp_path):
    store=Store(str(tmp_path/'db'))
    old=store.create('alice');new=store.create('alice')
    new['context']={'company':'Current'}
    assert store.save_context(new)
    old['context']={'company':'Stale'};old['readiness']={'status':'ready'}
    assert not store.save_context(old)
    org=store.workspace('alice')
    assert org['context']['company']=='Current'
    assert not org['onboarding_complete']

def test_legacy_sessions_remain_unclaimed(tmp_path):
    path=str(tmp_path/'db')
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE sessions (id TEXT PRIMARY KEY,token TEXT,state TEXT)')
        db.execute('INSERT INTO sessions VALUES (?,?,?)',('legacy','oldsecret',json.dumps({'id':'legacy'})))
    store=Store(path);store.workspace('alice')
    assert store.get('legacy','alice') is None
    with store.connect() as db:assert db.exec_driver_sql('SELECT COUNT(*) FROM sessions').fetchone()[0]==1
