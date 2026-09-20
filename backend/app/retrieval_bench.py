"""Retrieval benchmark on the Meridian corpus against a live Elasticsearch.

    uv run python -m app.retrieval_bench            # from backend/, compose stack running

The answer key is the `source_refs` each draft document was authored from. It is never indexed. Relationship
questions are keyed by joining the raw JSONL exports here, not by asking the graph what it thinks.
Runs in a throwaway SQLite database and its own index, so it never touches an organization."""
import argparse
import json
import math
import os
import random
import time
from collections import defaultdict
from pathlib import Path
from dotenv import load_dotenv
from .store import Store
from .data_service import DataService, EvidenceQuery
from .ingestion_worker import run_once
from .retrieval import ElasticSearch

ROOT=Path(__file__).resolve().parents[2]/'data/generated'

class NoObjects:
    def put(self,key,body,content_type):pass

def rows(name):
    return [json.loads(x) for x in (ROOT/'visible'/(name+'.jsonl')).read_text().splitlines()]

def questions(documents, seed, per_family):
    rng=random.Random(seed)
    cited=defaultdict(set)
    for d in documents:
        for ref in d['source_refs']:cited[ref].add(d['document_id'])
    out=[]
    ask=['What is the status of {}?','Find the correspondence about {}.','Is anything unresolved on {}?','Who was asked about {} and what did they say?']
    # 1. The question holds an identifier the documents also hold.
    direct=sorted(r for r in cited if r.split('-')[0] in ('AP','AR','PO','CON','RC','VA'))
    for ref in rng.sample(direct,min(per_family,len(direct))):
        out.append({'family':'identifier','query':rng.choice(ask).format(ref),'relevant':sorted(cited[ref])})
    # 2. The question holds only a name. Relevant documents may say the name, or only the ID.
    named=[(r['name'],r[k]) for table,k in (('vendors','vendor_id'),('customers','customer_id')) for r in rows(table) if r[k] in cited]
    for name,ref in rng.sample(named,min(per_family,len(named))):
        out.append({'family':'name','query':rng.choice(ask).format(name),'relevant':sorted(cited[ref])})
    # 3. The question holds an identifier no document mentions. Only a recorded relationship connects them.
    linked=[]
    for r in rows('ap_allocations'):linked.append((r['payment_id'],r['invoice_id'],'payment {}'))
    for r in rows('ar_allocations'):linked.append((r['receipt_id'],r['invoice_id'],'customer receipt {}'))
    for r in rows('journals'):linked.append((r['journal_id'],r['source_id'],'journal entry {}'))
    for r in rows('credit_allocations'):linked.append((r['credit_id'],r['invoice_id'],'credit memo {}'))
    linked=sorted({x for x in linked if x[0] not in cited and x[1] in cited})
    for ref,target,phrase in rng.sample(linked,min(per_family,len(linked))):
        out.append({'family':'linked','query':rng.choice(ask).format(phrase.format(ref)),'relevant':sorted(cited[target])})
    return out

def score(ranked, relevant, k=10):
    relevant=set(relevant);top=ranked[:k]
    gains=[1 if d in relevant else 0 for d in top]
    ideal=sum(1/math.log2(i+2) for i in range(min(len(relevant),k)))
    return {'recall@5':len(set(ranked[:5])&relevant)/min(len(relevant),5),
        'recall@10':len(set(top)&relevant)/min(len(relevant),k),
        'mrr@10':next((1/(i+1) for i,g in enumerate(gains) if g),0.0),
        'ndcg@10':sum(g/math.log2(i+2) for i,g in enumerate(gains))/ideal}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--per-family',type=int,default=60)
    parser.add_argument('--seed',type=int,default=20260919)
    parser.add_argument('--skip',default='',help='Comma-separated datasets to leave out (usage_daily is 65k rows)')
    parser.add_argument('--target',choices=['local','cloud'],default='local',help='cloud reads ELASTIC_CLOUD_URL and ELASTIC_CLOUD_API_KEY')
    parser.add_argument('--embedding',default=None,help='Inference endpoint for semantic_text, e.g. .jina-embeddings-v5-text-small. Default: ELASTIC_INFERENCE_ID')
    parser.add_argument('--rerank',default='',help='Rerank endpoint, e.g. .jina-reranker-v3.5. Adds reranked modes')
    parser.add_argument('--label',default='',help='Names this configuration: its own index, database and result file')
    parser.add_argument('--reuse',action='store_true',help='Keep the database and index from the last run; only ask the questions again')
    parser.add_argument('--out',default=str(Path(__file__).resolve().parents[1]/'benchmarks/retrieval.json'))
    args=parser.parse_args()
    load_dotenv(Path(__file__).resolve().parents[1]/'.env')
    name='retrieval'+('-'+args.label if args.label else '')
    os.environ['ELASTICSEARCH_INDEX']='hyper-bench-'+name+'-v1'
    os.environ['ELASTIC_RERANK_INFERENCE_ID']=''
    if args.target=='cloud':
        os.environ['ELASTICSEARCH_URL']=os.environ['ELASTIC_CLOUD_URL'];os.environ['ELASTICSEARCH_API_KEY']=os.environ['ELASTIC_CLOUD_API_KEY']
    if args.embedding is not None:
        # A dense endpoint embeds documents and queries alike, so there is no separate query endpoint.
        os.environ['ELASTIC_INFERENCE_ID']=args.embedding;os.environ['ELASTIC_SEARCH_INFERENCE_ID']=''
    if args.label and args.out.endswith('benchmarks/retrieval.json'):args.out=args.out.replace('retrieval.json',name+'.json')
    search=ElasticSearch()
    database=Path(__file__).resolve().parents[1]/('var/bench/'+name+'.sqlite')
    if not (args.reuse and database.exists()):
        try:search.request('DELETE',search.index)
        except Exception:pass
        database.parent.mkdir(parents=True,exist_ok=True);database.unlink(missing_ok=True)
    store=Store(str(database))
    svc=DataService(store,store.workspace('bench')['id'],NoObjects(),search)
    started=time.time()
    schema=json.loads((ROOT/'visible/schema.json').read_text())
    for name in schema:
        if name in args.skip.split(','):continue
        path=ROOT/'visible'/(name+'.jsonl')
        svc.ingest(path.name,path.read_bytes(),source_key='demo/'+path.name,dataset=name,currency='USD')
    documents=[json.loads(x) for x in (ROOT/'narratives/documents.jsonl').read_text().splitlines()]
    by_source={}
    for d in documents:
        body=f"{d['kind'].replace('_',' ').title()} | {d['date']}\nSubject: {d['subject']}\n\n{d['body']}\n"
        by_source[svc.ingest(d['document_id']+'.txt',body.encode(),source_key='demo/narratives/'+d['document_id'])['id']]=d['document_id']
    while run_once(store,search):pass
    built=None if args.reuse else round(time.time()-started,1)
    from .graph import Graph
    shape=Graph(store.engine,svc.oid).stats()
    inference=search.inference_id
    modes={'keyword':('',False),'keyword+graph':('',True)}
    if inference:modes.update({'hybrid':(inference,False),'hybrid+graph':(inference,True)})
    if args.rerank:modes.update({k+'+rerank':v for k,v in list(modes.items()) if k in ('hybrid','hybrid+graph')})
    asked=questions(documents,args.seed,args.per_family)
    results={}
    for mode,(inference_id,graph_aware) in modes.items():
        search.inference_id,search.graph_aware=inference_id,graph_aware
        search.rerank_id=args.rerank if mode.endswith('+rerank') else ''
        totals=defaultdict(lambda:defaultdict(list));latency=[]
        for q in asked:
            began=time.perf_counter()
            hits=svc.search_evidence(EvidenceQuery(query=q['query'],documents_only=True,limit=10))['hits']
            latency.append((time.perf_counter()-began)*1000)
            ranked=list(dict.fromkeys(by_source[h['source_id']] for h in hits))
            for family in (q['family'],'all'):
                for metric,value in score(ranked,q['relevant']).items():totals[family][metric].append(value)
        latency.sort()
        results[mode]={'latency_ms':{'p50':round(latency[len(latency)//2]),'p95':round(latency[int(len(latency)*.95)])},
            **{family:{m:round(sum(v)/len(v),3) for m,v in metrics.items()} for family,metrics in totals.items()}}
    report={'corpus':{'documents':len(documents),'structured_rows':sum(v['rows'] for k,v in schema.items() if k not in args.skip.split(',')),
            'graph':{k:shape[k] for k in ('nodes','edges','mentions')},'ingest_index_seconds':built},
        'questions':{f:sum(1 for q in asked if q['family']==f) for f in ('identifier','name','linked')},
        'seed':args.seed,'scope':'documents_only, top 10','target':args.target,'label':args.label or 'local-elser','embedding':inference or None,
        'rerank':args.rerank or None,'results':results,
        'limits':['Documents are synthetic drafts that usually repeat their identifiers, which flatters every lexical mode.',
            'Questions are templated, so this measures entity and relationship recall, not paraphrase understanding.',
            'Relevance is document-level and binary, from authoring metadata.']}
    Path(args.out).write_text(json.dumps(report,indent=1)+'\n')
    for family in ('identifier','name','linked','all'):
        print(f'\n{family}');print(f"{'mode':16}"+''.join(f'{m:>11}' for m in ('recall@5','recall@10','mrr@10','ndcg@10')))
        for mode,r in results.items():print(f'{mode:16}'+''.join(f'{r[family][m]:>11.3f}' for m in ('recall@5','recall@10','mrr@10','ndcg@10')))
    print('\nlatency ms',{m:r['latency_ms'] for m,r in results.items()})

if __name__=='__main__':main()
