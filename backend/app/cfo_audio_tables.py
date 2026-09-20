"""Private playback claims. Audio bytes and provider secrets are never persisted."""
from sqlalchemy import Table, Column, Text, BigInteger, Integer, UniqueConstraint, Index
from .database import metadata

cfo_audio_leases = Table('cfo_audio_leases', metadata,
    Column('organization_id', Text, primary_key=True), Column('user_id', Text, primary_key=True),
    Column('token', Text, nullable=False), Column('client_id', Text, nullable=False),
    Column('utterance_id', Text, nullable=False), Column('expires_at', BigInteger, nullable=False))
cfo_audio_deliveries = Table('cfo_audio_deliveries', metadata,
    Column('id', Text, primary_key=True), Column('organization_id', Text, nullable=False),
    Column('user_id', Text, nullable=False), Column('event_id', Text, nullable=False),
    Column('request_id', Text, nullable=False), Column('client_id', Text, nullable=False),
    Column('lease_token', Text, nullable=False), Column('text_hash', Text, nullable=False),
    Column('characters', Integer, nullable=False), Column('created_at', BigInteger, nullable=False),
    Column('state', Text, nullable=False), Column('sample_count', Integer, nullable=False, default=0),
    Column('played_samples', Integer, nullable=False, default=0),
    UniqueConstraint('organization_id', 'user_id', 'request_id'))
Index('cfo_audio_event', cfo_audio_deliveries.c.organization_id, cfo_audio_deliveries.c.user_id, cfo_audio_deliveries.c.event_id)
Index('cfo_audio_usage', cfo_audio_deliveries.c.organization_id, cfo_audio_deliveries.c.created_at)
