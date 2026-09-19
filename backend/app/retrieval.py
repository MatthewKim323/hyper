"""Elasticsearch is a rebuildable evidence index; Postgres remains authoritative."""
import os
import json
import httpx

class ElasticSearch:
    def __init__(self):
        self.url = os.getenv('ELASTICSEARCH_URL','http://127.0.0.1:9200').rstrip('/')
        self.index = os.getenv('ELASTICSEARCH_INDEX','hyper-evidence-v1')
        self.inference_id = os.getenv('ELASTIC_INFERENCE_ID','')
        self.search_inference_id = os.getenv('ELASTIC_SEARCH_INFERENCE_ID','')
        self.mode = 'hybrid' if self.inference_id else 'keyword'
        self.headers = {}
        if os.getenv('ELASTICSEARCH_API_KEY'):
            self.headers['Authorization']='ApiKey '+os.environ['ELASTICSEARCH_API_KEY']
        self.auth = None
        if not self.headers and os.getenv('ELASTICSEARCH_USERNAME'):
            self.auth=(os.environ['ELASTICSEARCH_USERNAME'],os.environ.get('ELASTICSEARCH_PASSWORD',''))

    def request(self, method, path, **kwargs):
        with httpx.Client(timeout=120,headers=self.headers,auth=self.auth,
                          verify=os.getenv('ELASTICSEARCH_CA_CERT') or True) as client:
            r=client.request(method,self.url+'/'+path.lstrip('/'),**kwargs)
            r.raise_for_status()
            return r.json()

    def ensure_index(self):
        mapping={'dynamic':'strict','properties':{
            'organization_id':{'type':'keyword'},'source_id':{'type':'keyword'},
            'chunk_id':{'type':'keyword'},'dataset':{'type':'keyword'},
            'filename':{'type':'keyword'},'locator':{'type':'keyword'},
            'content':{'type':'text'}}}
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
        fields=existing[self.index]['mappings'].get('properties',{})
        actual=fields.get('semantic',{}).get('inference_id','')
        actual_search=fields.get('semantic',{}).get('search_inference_id',actual)
        if (bool(fields.get('semantic')) != bool(self.inference_id) or (self.inference_id and actual!=self.inference_id)
                or (self.search_inference_id and actual_search!=self.search_inference_id)):
            raise ValueError('Search mapping changed; use a new ELASTICSEARCH_INDEX and reindex sources')

    def index_chunks(self, source, rows):
        lines=[]
        for row in rows:
            document={'organization_id':source['organization_id'],'source_id':source['id'],
                      'chunk_id':row['id'],'dataset':source['dataset'] or '',
                      'filename':source['filename'],'locator':row['locator'],
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

    def search(self, oid, source_ids, query, limit):
        filters=[{'term':{'organization_id':oid}},{'terms':{'source_id':source_ids}}]
        def branch(field):
            return {'standard':{'query':{'bool':{'filter':filters,'must':[{'match':{field:query}}]}}}}
        body={'size':limit,'_source':['source_id','chunk_id','locator']}
        if self.inference_id:
            body['retriever']={'rrf':{'retrievers':[branch('content'),branch('semantic')],'rank_window_size':50}}
        else:
            body['query']=branch('content')['standard']['query']
        result=self.request('POST',f'{self.index}/_search',json=body)
        if result.get('timed_out') or result.get('_shards',{}).get('failed'):
            raise RuntimeError('Search returned incomplete results')
        return result['hits']['hits']
