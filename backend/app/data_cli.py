"""Local administrative setup, demo import, migration, and reindex commands."""
import argparse
import json
import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import select, update
from .store import Store
from .objects import ObjectStore
from .data_service import DataService
from .database import sources, jobs, users, organizations, memberships, sessions, insert_ignore

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--env-file',default='.env')
    commands=parser.add_subparsers(dest='command',required=True)
    commands.add_parser('init')
    demo=commands.add_parser('import-demo')
    owner=demo.add_mutually_exclusive_group()
    owner.add_argument('--user-id',help='Actual Clerk user ID (never an email)')
    owner.add_argument('--organization-id',default=None,help='Existing organization; defaults to isolated demo-meridian')
    demo.add_argument('--visible-dir',default=str(Path(__file__).resolve().parents[2]/'data/generated/visible'))
    demo.add_argument('--narratives',default=str(Path(__file__).resolve().parents[2]/'data/generated/narratives/documents.jsonl'),
        help='Draft correspondence, one source per document; pass an empty string to skip')
    graph=commands.add_parser('graph',help='Rebuild the knowledge graph from active sources and print its shape')
    graph.add_argument('--organization-id',default='demo-meridian')
    graph.add_argument('--stats-only',action='store_true')
    retry=commands.add_parser('reindex')
    retry.add_argument('--user-id',required=True)
    migrate=commands.add_parser('migrate-sqlite')
    migrate.add_argument('--path',required=True)
    args=parser.parse_args()
    load_dotenv(args.env_file)
    store=Store()
    if args.command=='init':
        objects=ObjectStore()
        try:objects.check()
        except Exception:
            kwargs={'Bucket':objects.bucket}
            region=os.getenv('AWS_REGION','us-east-1')
            if region!='us-east-1':kwargs['CreateBucketConfiguration']={'LocationConstraint':region}
            objects.client.create_bucket(**kwargs)
        from .retrieval import ElasticSearch
        search=ElasticSearch();search.ensure_index()
        print(json.dumps({'database':store.engine.dialect.name,'bucket':objects.bucket,'search_mode':search.mode}))
    elif args.command=='import-demo':
        visible=Path(args.visible_dir).resolve()
        # Explicit allowlist: top-level structured exports, company metadata, and visible fixture cases.
        schema=json.loads((visible/'schema.json').read_text())
        if args.user_id:
            oid=store.workspace(args.user_id)['id']
        else:
            oid=args.organization_id or 'demo-meridian'
            with store.engine.begin() as db:
                if oid=='demo-meridian':insert_ignore(db,organizations,dict(id=oid,name='Meridian Demo'))
                if not db.execute(select(organizations.c.id).where(organizations.c.id==oid)).scalar():
                    raise ValueError('Organization does not exist')
        svc=DataService(store,oid)
        for name,definition in schema.items():
            path=visible/(name+'.jsonl')
            fields={k:'numeric' if v in ('INTEGER','REAL','NUMERIC') else 'text' for k,v in definition['fields'].items()}
            for key in fields:
                if key=='date' or key.endswith('_date'):fields[key]='date'
            result=svc.ingest(path.name,path.read_bytes(),source_key='demo/'+path.name,
                dataset=name,currency='USD',field_types=fields)
            print(json.dumps({'dataset':name,'source_id':result['id'],'records':result['record_count'],'deduplicated':result['deduplicated']}),flush=True)
        docs=[visible/'company.json']+sorted((visible/'cases').glob('*.json'))
        for path in docs:
            svc.ingest(path.name,path.read_bytes(),source_key='demo/'+str(path.relative_to(visible)))
        if args.narratives and Path(args.narratives).exists():
            # Authoring metadata (source_refs, packet) stays out of the text: it is the benchmark's answer key.
            for line in Path(args.narratives).read_text().splitlines():
                doc=json.loads(line)
                body=f"{doc['kind'].replace('_',' ').title()} | {doc['date']}\nSubject: {doc['subject']}\n\n{doc['body']}\n"
                svc.ingest(doc['document_id']+'.txt',body.encode(),source_key='demo/narratives/'+doc['document_id'])
        print(json.dumps({'organization_id':oid,'status':'imported; start worker to index evidence'}))
    elif args.command=='graph':
        from .graph import Graph
        graph=Graph(store.engine,args.organization_id)
        built=None if args.stats_only else graph.rebuild()
        print(json.dumps({'built':built,**graph.stats()},indent=1))
    elif args.command=='reindex':
        oid=store.workspace(args.user_id)['id']
        with store.engine.begin() as db:
            db.execute(update(jobs).where(jobs.c.organization_id==oid,jobs.c.status!='running')
                .values(status='pending',attempts=0,error=None,lease_until=0,claim_token=None))
            db.execute(update(sources).where(sources.c.organization_id==oid,
                sources.c.id.in_(select(jobs.c.source_id).where(jobs.c.status=='pending')))
                .values(index_status='pending',index_error=None))
        print('Queued organization sources for indexing')
    elif args.command=='migrate-sqlite':
        if store.engine.dialect.name!='postgresql':raise ValueError('Target DATABASE_URL must be Postgres')
        old=Store(args.path)
        if old.engine.dialect.name!='sqlite':raise ValueError('Source must be SQLite')
        with old.engine.connect() as src,store.engine.begin() as dst:
            # Preserve IDs and memberships exactly; never infer ownership of legacy sessions.
            for table in (users,organizations,memberships,sessions):
                for row in src.execute(select(table)).mappings():
                    insert_ignore(dst,table,dict(row))
        print('Copied identity and onboarding rows; existing target IDs were preserved')

if __name__=='__main__':main()
