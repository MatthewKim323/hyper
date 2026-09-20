"""Elasticsearch is a rebuildable evidence index; Postgres remains authoritative."""
import os
import json
import httpx

class ElasticSearch:
    graph_aware = True
    def __init__(self):
        self.url = os.getenv('ELASTICSEARCH_URL','http://127.0.0.1:9200').rstrip('/')
        self.index = os.getenv('ELASTICSEARCH_INDEX','hyper-evidence-v1')
        self.inference_id = os.getenv('ELASTIC_INFERENCE_ID','')
        self.search_inference_id = os.getenv('ELASTIC_SEARCH_INFERENCE_ID','')
        self.rerank_id = os.getenv('ELASTIC_RERANK_INFERENCE_ID', '')
        self.mode = ('hybrid' if self.inference_id else 'keyword') + ('+rerank' if self.rerank_id else '')
        self.headers = {}
        if os.getenv('ELASTICSEARCH_API_KEY'):
            self.headers['Authorization']='ApiKey '+os.environ['ELASTICSEARCH_API_KEY']
        self.auth = None
        if not self.headers and os.getenv('ELASTICSEARCH_USERNAME'):
            self.auth=(os.environ['ELASTICSEARCH_USERNAME'],os.environ.get('ELASTICSEARCH_PASSWORD',''))

    def request(self, method, path, **kwargs):
        # One pooled client: a bulk import is thousands of calls to the same host.
        if getattr(self,'_client',None) is None:
            self._client=httpx.Client(timeout=120,headers=self.headers,auth=self.auth,
                verify=os.getenv('ELASTICSEARCH_CA_CERT') or True)
        r=self._client.request(method,self.url+'/'+path.lstrip('/'),**kwargs)
        r.raise_for_status()
        return r.json()

    def ensure_index(self):
        mapping={'dynamic':'strict','properties':{
            'organization_id':{'type':'keyword'},'source_id':{'type':'keyword'},
            'chunk_id':{'type':'keyword'},'dataset':{'type':'keyword'},
            'filename':{'type':'keyword'},'locator':{'type':'keyword'},
            'content':{'type':'text'},
            'source_key':{'type':'keyword'}, 'source_version':{'type':'integer'},
            'content_hash':{'type':'keyword'}, 'observed_at':{'type':'date','format':'epoch_millis'},
            'currency':{'type':'keyword'}, 'document_type':{'type':'keyword'},
            # Knowledge-graph node IDs and bare identifiers this chunk mentions. Exact, never analyzed.
            'entity_ids':{'type':'keyword'}}}
        if self.inference_id:
            mapping['properties']['semantic']={'type':'semantic_text','inference_id':self.inference_id}
            if self.search_inference_id:
                mapping['properties']['semantic']['search_inference_id']=self.search_inference_id
        try:
            existing=self.request('GET',f'{self.index}/_mapping')
        except httpx.HTTPStatusError as e:
            if e.response.status_code!=404:raise
            self.request('PUT',self.index,json={'mappings':mapping})
            return
        if len(existing) != 1:
            raise ValueError('Evidence alias must resolve to one index')
        fields=next(iter(existing.values()))['mappings'].get('properties',{})
        actual=fields.get('semantic',{}).get('inference_id','')
        actual_search=fields.get('semantic',{}).get('search_inference_id',actual)
        if (bool(fields.get('semantic')) != bool(self.inference_id) or (self.inference_id and actual!=self.inference_id)
                or (self.search_inference_id and actual_search!=self.search_inference_id)):
            raise ValueError('Search mapping changed; use a new ELASTICSEARCH_INDEX and reindex sources')
        missing={k:v for k,v in mapping['properties'].items() if k not in fields}
        if missing:self.request('PUT',f'{self.index}/_mapping',json={'properties':missing})

    def index_chunks(self, source, rows):
        lines=[]
        for row in rows:
            document={'organization_id':source['organization_id'],'source_id':source['id'],
                      'chunk_id':row['id'],'dataset':source['dataset'] or '',
                      'source_key':source.get('source_key',source['id']),
                      'source_version':source.get('version',1),'content_hash':source.get('sha256',''),
                      'observed_at':source.get('created_at',0),'currency':source.get('currency') or '',
                      'document_type':source.get('content_type','application/octet-stream'),
                      'filename':source['filename'],'locator':row['locator'],'entity_ids':list(row.get('entity_ids') or []),
                      'content':f"Source: {source['filename']} | Dataset: {source['dataset'] or 'document'} | Currency: {source.get('currency') or 'unspecified'} | {row['locator']}\n"+row['content']}
            # Structured ledger rows use exact SQL/BM25. Embed prose documents, not every debit.
            semantic_datasets={x.strip() for x in os.getenv('ELASTIC_SEMANTIC_DATASETS','').split(',') if x.strip()}
            if self.inference_id and (not source['dataset'] or source['dataset'] in semantic_datasets):
                document['semantic']=document['content']
            lines.extend([json.dumps({'index':{'_index':self.index,'_id':row['id']}}),json.dumps(document)])
        result=self.request('POST','_bulk',content='\n'.join(lines)+'\n',headers={'Content-Type':'application/x-ndjson'})
        if result.get('errors'):
            raise RuntimeError('Elasticsearch rejected one or more chunks; inspect cluster inference/mapping configuration')

    def refresh(self):
        self.request('POST',f'{self.index}/_refresh')

    def search(self, oid, source_ids, query, limit, entities=(), related=None):
        """entities: index terms the query names outright. related: {index term: hops} from the knowledge graph."""
        if not source_ids:return []
        filters=[{'term':{'organization_id':oid}},{'terms':{'source_id':source_ids}}]
        def branch(field):
            return {'standard':{'query':{'bool':{'filter':filters,'must':[{'match':{field:query}}]}}}}
        retrievers=[branch('content')]
        if self.inference_id:
            retrievers.append(branch('semantic'))
            if entities or related:
                # Text gets one vote and the graph gets one. Flat, two text retrievers outvote an exact match
                # (measured: recall@10 0.74 flat against 0.93 without embeddings at all).
                retrievers=[{'rrf':{'retrievers':retrievers,'rank_window_size':max(50,limit)}}]
        if entities or related:
            # Exact identifiers beat graph neighbours, near neighbours beat far ones, documents beat ledger rows.
            # Text relevance only breaks ties, so it can never outvote an exact match.
            linked=[{'constant_score':{'filter':{'terms':{'entity_ids':list(entities)}},'boost':8}}] if entities else []
            for hop in sorted(set((related or {}).values())):
                linked.append({'constant_score':{'filter':{'terms':{'entity_ids':[k for k,v in related.items() if v==hop]}},'boost':4/hop/hop}})
            retrievers.append({'standard':{'query':{'bool':{'filter':filters,
                'must':[{'bool':{'should':linked,'minimum_should_match':1}}],
                'should':[{'constant_score':{'filter':{'term':{'dataset':''}},'boost':2}},
                          {'match':{'content':{'query':query,'boost':0.01}}}]}}}})
        body={'size':limit,'_source':['source_id','chunk_id','locator']}
        if len(retrievers)>1:
            body['retriever']={'rrf':{'retrievers':retrievers,'rank_window_size':max(50,limit)}}
        else:
            body['query']=branch('content')['standard']['query']
        if self.rerank_id:
            candidate=body.pop('retriever',None) or {'standard':{'query':body.pop('query')}}
            body['retriever']={'text_similarity_reranker':{
                'retriever':candidate,'field':'content','inference_id':self.rerank_id,
                'inference_text':query,'rank_window_size':max(50,limit)}}
        result=self.request('POST',f'{self.index}/_search',json=body)
        if result.get('timed_out') or result.get('_shards',{}).get('failed'):
            raise RuntimeError('Search returned incomplete results')
        return result['hits']['hits']
