"""Clerk JWT validation. No development bypass or client-selected organization."""
import os
from dataclasses import dataclass
from functools import lru_cache
import jwt
from fastapi import HTTPException, Request

@dataclass(frozen=True)
class Identity:
    user_id: str
    expires_at: int

@lru_cache(maxsize=4)
def jwks(issuer):
    return jwt.PyJWKClient(issuer + '/.well-known/jwks.json', cache_jwk_set=True, lifespan=300, timeout=5)

def verify(token: str) -> Identity:
    issuer = os.getenv('CLERK_ISSUER', '').rstrip('/')
    parties = [p.strip() for p in os.getenv('CLERK_AUTHORIZED_PARTIES', '').split(',') if p.strip()]
    if not issuer.startswith('https://') or not parties:
        raise HTTPException(503, 'Clerk authentication is not configured')
    try:
        key = os.getenv('CLERK_JWT_PUBLIC_KEY') or jwks(issuer).get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=['RS256'], issuer=issuer,
                            audience=os.getenv('CLERK_AUDIENCE') or None,
                            options={'require':['sub','exp','iat','nbf','iss','sid'],
                                     'verify_aud':bool(os.getenv('CLERK_AUDIENCE'))})
        if claims.get('azp') not in parties or claims.get('sts') == 'pending' or not claims['sub']:
            raise ValueError('Invalid session')
        return Identity(claims['sub'], int(claims['exp']))
    except (jwt.PyJWTError, ValueError, TypeError):
        raise HTTPException(401, 'Invalid or expired login token') from None

def current_user(request: Request):
    header = request.headers.get('authorization', '')
    if not header.startswith('Bearer '):
        raise HTTPException(401, 'Sign in required')
    return verify(header[7:])
