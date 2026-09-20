"""Durable, leased index jobs. Run separately: python -m app.ingestion_worker."""
import argparse
import logging
import os
import time
import uuid
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import select, update, or_, and_
from .database import sources, chunks, jobs
from .store import Store
from .retrieval import ElasticSearch
from .graph import Graph, index_terms

log=logging.getLogger(__name__)

def run_once(store, search, organization_id=None):
    now=int(time.time())
    token=uuid.uuid4().hex
    with store.engine.begin() as db:
        eligible=or_(jobs.c.status=='pending',
            and_(jobs.c.status=='running',jobs.c.lease_until<now))
        q=select(jobs).where(eligible).order_by(jobs.c.created_at).limit(1)
        if organization_id:
            q=q.where(jobs.c.organization_id==organization_id)
        if db.dialect.name=='postgresql':
            q=q.with_for_update(skip_locked=True)
        else:
            db.exec_driver_sql('BEGIN IMMEDIATE')
        job=db.execute(q).mappings().first()
        if not job:return False
        db.execute(update(jobs).where(jobs.c.id==job['id']).values(
            status='running',lease_until=now+600,claim_token=token,attempts=jobs.c.attempts+1,error=None))
        source=dict(db.execute(select(sources).where(sources.c.id==job['source_id'])).mappings().one())
        db.execute(update(sources).where(sources.c.id==source['id']).values(index_status='indexing',index_error=None))
    skipped={x.strip() for x in os.getenv('ELASTIC_SKIP_ORGS','').split(',') if x.strip()}
    if source['organization_id'] in skipped:
        # Sandbox organizations never search their evidence. Indexing it would only cost inference and storage.
        with store.engine.begin() as db:
            if db.execute(update(jobs).where(jobs.c.id==job['id'],jobs.c.claim_token==token)
                    .values(status='complete',lease_until=0,claim_token=None)).rowcount:
                db.execute(update(sources).where(sources.c.id==source['id']).values(index_status='skipped',index_error=None))
        return True
    try:
        search.ensure_index()
        # Graph first: the index stores which entities each chunk mentions.
        graph=Graph(store.engine,source['organization_id'])
        graph.build_source(source)
        after=-1
        semantic_datasets={x.strip() for x in os.getenv('ELASTIC_SEMANTIC_DATASETS','').split(',') if x.strip()}
        semantic = bool(getattr(search,'inference_id','')) and (not source['dataset'] or source['dataset'] in semantic_datasets)
        # Keep inference queues short so interactive retrieval is not starved by uploads.
        batch_size=1 if semantic else 100
        while True:
            with store.engine.connect() as db:
                rows=db.execute(select(chunks).where(chunks.c.source_id==source['id'],
                    chunks.c.organization_id==source['organization_id'],chunks.c.ordinal>after)
                    .order_by(chunks.c.ordinal).limit(batch_size)).mappings().all()
            if not rows:break
            named=graph.chunk_entities([r['id'] for r in rows])
            rows=[{**r,'entity_ids':index_terms(named[r['id']])} for r in rows]
            search.index_chunks(source,rows)
            after=rows[-1]['ordinal']
            with store.engine.begin() as db:
                result=db.execute(update(jobs).where(jobs.c.id==job['id'],jobs.c.claim_token==token)
                    .values(lease_until=int(time.time())+600))
                if not result.rowcount:return True
        search.refresh()
        with store.engine.begin() as db:
            result=db.execute(update(jobs).where(jobs.c.id==job['id'],jobs.c.claim_token==token)
                .values(status='complete',lease_until=0,claim_token=None))
            if result.rowcount:
                db.execute(update(sources).where(sources.c.id==source['id']).values(index_status='ready',index_error=None))
                from .agent_events import emit
                emit(db,source['organization_id'],'indexed:'+source['id'],'source.indexed',{'source_id':source['id']})
    except Exception as exc:
        # Do not expose provider response bodies, credentials, or document text.
        error=f'{type(exc).__name__}: indexing failed; check search configuration and retry'
        log.warning('Index job %s failed (%s)',job['id'],type(exc).__name__)
        with store.engine.begin() as db:
            result=db.execute(update(jobs).where(jobs.c.id==job['id'],jobs.c.claim_token==token)
                .values(status='failed',error=error,lease_until=0,claim_token=None))
            if result.rowcount:
                db.execute(update(sources).where(sources.c.id==source['id']).values(index_status='failed',index_error=error))
    return True

def main():
    load_dotenv(Path(__file__).resolve().parents[1]/'.env')
    parser=argparse.ArgumentParser()
    parser.add_argument('--once',action='store_true')
    args=parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    store=Store();search=ElasticSearch()
    while True:
        # A database blip must not kill the loop: the job-claim block inside run_once sits
        # outside its own handler, so a transient OperationalError would end the process
        # and leave queued work leased to nobody. Same guard as elastic_worker.
        try: worked=run_once(store,search)
        except Exception as exc:
            logging.warning('%s unavailable (%s)', 'ingestion_worker', type(exc).__name__)
            worked=False
        if args.once:break
        if not worked:time.sleep(2)

if __name__=='__main__':main()
