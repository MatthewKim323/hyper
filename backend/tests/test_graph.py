import json
import pytest
from app.store import Store
from app.data_service import DataService, EvidenceQuery
from app.graph import Graph, EntityQuery, ExploreQuery, PathQuery, EntityEvidenceQuery, index_terms, squash
from app.ingestion_worker import run_once
from app.retrieval import ElasticSearch
from app.elastic_setup import definitions

class MemoryObjects:
    def put(self,key,body,content_type):pass

class GraphSearch:
    mode='keyword';graph_aware=True
    def __init__(self):self.docs={};self.calls=[]
    def ensure_index(self):pass
    def refresh(self):pass
    def index_chunks(self,source,rows):
        for r in rows:self.docs[r['id']]=dict(r)
    def search(self,oid,ids,query,limit,entities=(),related=None):
        self.calls.append({'entities':list(entities),'related':dict(related or {})})
        return [{'_source':{'chunk_id':k},'_score':1} for k,r in self.docs.items()
                if r['organization_id']==oid and set(r['entity_ids'])&(set(entities)|set(related or {}))][:limit]

DATA={
    'vendors':[{'vendor_id':'VEN-001','name':'Northstar Cloud','contact':'ap@northstar.example','approved_recipient':'REMIT-1'},
               {'vendor_id':'VEN-002','name':'Granite Legal','contact':'ap@granite.example','approved_recipient':'REMIT-2'}],
    'employees':[{'employee_id':'EMP-005','name':'Casey Ledger','department':'Finance'}],
    'purchase_orders':[{'po_id':'PO-00062','vendor_id':'VEN-002','agreement_id':'VA-1','amount_cents':100}],
    'service_receipts':[{'receipt_id':'RC-AP-00062','po_id':'PO-00062','accepted_by':'EMP-005'}],
    'ap_invoices':[{'invoice_id':'AP-00062','vendor_id':'VEN-002','po_id':'PO-00062','amount_cents':100}],
    'ap_payments':[{'payment_id':'APPAY-00009','vendor_id':'VEN-002','account':'1000','amount_cents':100}],
    'journals':[{'journal_id':'J-000001','source_id':'AP-00062','description':'Vendor invoice'}],
    'aging':[{'aging_id':'AGE-1','side':'ap','invoice_id':'AP-00062'}],
}

def load(svc,name,rows,key=None):
    body='\n'.join(json.dumps(r) for r in rows).encode()
    return svc.ingest(name+'.jsonl',body,source_key=key or name,dataset=name,currency='USD')

@pytest.fixture
def world(tmp_path):
    store=Store(str(tmp_path/'db'));search=GraphSearch()
    svc=DataService(store,store.workspace('alice')['id'],MemoryObjects(),search)
    for name,rows in DATA.items():load(svc,name,rows)
    note=svc.ingest('note.txt',b'Casey Ledger asked whether the receipt RC-AP-00062 was accepted before INV-9999 arrived.',source_key='note')
    while run_once(store,search):pass
    return store,svc,search,Graph(store.engine,svc.oid),note

def test_foreign_keys_become_typed_cited_edges(world):
    _,_,_,graph,_=world
    found=graph.explore(ExploreQuery(entity='AP-00062'))
    edges={(e['from'],e['type'],e['to']) for e in found['edges']}
    assert ('ap_invoice:AP-00062','INVOICED_BY','vendor:VEN-002') in edges
    assert ('ap_invoice:AP-00062','BILLS','purchase_order:PO-00062') in edges
    # Untyped journals.source_id is typed by prefix; aging.invoice_id by its side column.
    assert ('journal:J-000001','POSTS','ap_invoice:AP-00062') in edges
    assert ('aging_snapshot:AGE-1','AGES','ap_invoice:AP-00062') in edges
    assert all(e['citation']['chunk_id'].startswith(e['citation']['source_id']) for e in found['edges'])
    unrecorded=[n for n in graph.explore(ExploreQuery(entity='PO-00062'))['nodes'] if not n['recorded']]
    assert [n['id'] for n in unrecorded]==['vendor_agreement:VA-1']

def test_names_resolve_and_lookalikes_are_only_candidates(world):
    _,_,_,graph,_=world
    assert graph.card(EntityQuery(entity='granite legal'))['entity']['id']=='vendor:VEN-002'
    assert graph.card(EntityQuery(entity='ap@granite.example'))['entity']['id']=='vendor:VEN-002'
    loose=graph.card(EntityQuery(entity=' po 62 '))
    assert loose['resolved'] is False and squash(' po 62 ')==squash('PO-00062')
    assert [(c['id'],c['reason']) for c in loose['candidates']]==[('purchase_order:PO-00062','similar_identifier')]

def test_longest_alias_wins(world):
    _,_,_,graph,_=world
    found={x['id'] for x in graph.scan('Receipt RC-AP-00062 only')}
    assert 'service_receipt:RC-AP-00062' in found and 'ap_invoice:AP-00062' not in found

def test_path_crosses_tables_but_never_a_ledger_account(world):
    _,svc,_,graph,_=world
    route=graph.path(PathQuery(from_entity='Casey Ledger',to_entity='Granite Legal'))
    assert route['found'] and [n['type'] for n in route['nodes']]==['employee','service_receipt','purchase_order','vendor']
    load(svc,'ap_payments',[{'payment_id':'APPAY-00010','vendor_id':'VEN-001','account':'1000','amount_cents':5}],key='more-payments')
    graph.rebuild()
    # VEN-001 and VEN-002 share only the bank account both were paid from.
    assert graph.path(PathQuery(from_entity='VEN-001',to_entity='VEN-002'))['found'] is False

def test_documents_are_linked_and_unknown_identifiers_stay_findable(world):
    _,_,search,graph,note=world
    chunk=note['id']+':0'
    assert {'employee:EMP-005','service_receipt:RC-AP-00062','identifier:INV-9999','identifier:RC-AP-00062'}<=set(search.docs[chunk]['entity_ids'])
    assert [h['id'] for h in graph.evidence(EntityEvidenceQuery(entity='EMP-005'))['hits']]==[chunk]
    orphan=graph.evidence(EntityEvidenceQuery(entity='INV-9999'))
    assert orphan['resolved'] is False and [h['id'] for h in orphan['hits']]==[chunk]
    assert {m['id'] for m in graph.card(EntityQuery(entity='EMP-005'))['mentioned_with']}=={'service_receipt:RC-AP-00062'}

def test_search_reaches_documents_through_the_graph(world):
    _,svc,search,_,note=world
    # The note never names the vendor. It is two hops away: vendor <- purchase order <- receipt.
    result=svc.search_evidence(EvidenceQuery(query='anything outstanding with Granite Legal?'))
    call=search.calls[-1]
    assert 'vendor:VEN-002' in call['entities'] and call['related']['service_receipt:RC-AP-00062']==2
    assert result['mode']=='keyword+graph' and result['query_entities'][0]['id']=='vendor:VEN-002'
    hit=next(h for h in result['hits'] if h['id']==note['id']+':0')
    assert 'employee:EMP-005' in hit['entities']

def test_hub_relations_are_not_sampled_into_search(world):
    _,svc,_,graph,_=world
    load(svc,'service_receipts',DATA['service_receipts']+[{'receipt_id':f'RC-AP-1{i:04d}','po_id':f'PO-1{i:04d}','accepted_by':'EMP-005'} for i in range(40)])
    graph.rebuild()
    assert not [k for k in graph.related(['employee:EMP-005']) if k.startswith('service_receipt:')]
    assert 'service_receipt:RC-AP-00062' in graph.related(['purchase_order:PO-00062'])

def test_superseded_source_leaves_no_facts_and_tenants_are_separate(world):
    store,svc,search,graph,_=world
    load(svc,'ap_invoices',[{'invoice_id':'AP-00062','vendor_id':'VEN-001','po_id':'PO-00062','amount_cents':100}])
    while run_once(store,search):pass
    targets={e['to'] for e in graph.explore(ExploreQuery(entity='AP-00062',edge_types=['INVOICED_BY']))['edges']}
    assert targets=={'vendor:VEN-001'}
    other=Graph(store.engine,store.workspace('bob')['id'])
    assert other.card(EntityQuery(entity='VEN-002'))['resolved'] is False and other.stats()['nodes']==0

def test_unknown_datasets_link_by_lookup(world):
    store,svc,search,graph,_=world
    load(svc,'ramp_bills',[{'id':'bill_1','vendor_id':'VEN-002','invoice_number':'AP-00062','memo_id':'nothing-known'}])
    while run_once(store,search):pass
    edges={(e['type'],e['to'],e['method']) for e in graph.explore(ExploreQuery(entity='ramp_bills:bill_1'))['edges']}
    assert edges=={('REFERS_TO_VENDOR','vendor:VEN-002','id_lookup')}

def test_entity_retriever_is_filtered_and_ranks_exact_over_related(monkeypatch):
    monkeypatch.delenv('ELASTIC_INFERENCE_ID',raising=False)
    es=ElasticSearch();captured={}
    es.request=lambda method,path,**kwargs:captured.update(kwargs['json']) or {'hits':{'hits':[]}}
    es.search('org-1',['s1'],'granite',5,entities=['vendor:VEN-002'],related={'purchase_order:PO-1':1,'service_receipt:RC-1':2})
    branches=captured['retriever']['rrf']['retrievers']
    assert len(branches)==2
    for branch in branches:
        assert branch['standard']['query']['bool']['filter']==[{'term':{'organization_id':'org-1'}},{'terms':{'source_id':['s1']}}]
    boosts=[c['constant_score']['boost'] for c in branches[1]['standard']['query']['bool']['must'][0]['bool']['should']]
    assert boosts==sorted(boosts,reverse=True) and boosts[0]==8
    # With embeddings, text is fused first so BM25 and semantic together get one vote against the graph's one.
    monkeypatch.setenv('ELASTIC_INFERENCE_ID','test-embedding')
    es=ElasticSearch();es.request=lambda method,path,**kwargs:captured.update(kwargs['json']) or {'hits':{'hits':[]}}
    es.search('org-1',['s1'],'granite',5,entities=['vendor:VEN-002'])
    text,linked=captured['retriever']['rrf']['retrievers']
    assert len(text['rrf']['retrievers'])==2 and 'entity_ids' in json.dumps(linked) and 'entity_ids' not in json.dumps(text)

def test_index_terms_and_remote_tool_scope():
    assert index_terms(['vendor:VEN-002','gl_account:1000'])==['gl_account:1000','identifier:VEN-002','vendor:VEN-002']
    tool=next(t for t in definitions('org-a','hyper-evidence-v1','connector')['tools'] if t['id'].endswith('entity_evidence'))
    assert 'organization_id == "org-a"' in tool['configuration']['query'] and list(tool['configuration']['params'])==['entity']

def test_graph_routes_are_scoped_to_the_signed_in_user(world,monkeypatch):
    from fastapi.testclient import TestClient
    from app import auth, main
    store,_,_,_,_=world
    monkeypatch.setattr(main,'store',store)
    who={'id':'alice'}
    main.app.dependency_overrides[auth.current_user]=lambda:type('I',(),{'user_id':who['id']})()
    try:
        client=TestClient(main.app)
        assert client.get('/graph/stats').json()['nodes']>0
        assert client.post('/graph/path',json={'from_entity':'Casey Ledger','to_entity':'VEN-002'}).json()['hops']==3
        who['id']='bob'
        assert client.get('/graph/stats').json()['nodes']==0
        assert client.post('/graph/entity',json={'entity':'VEN-002'}).json()['resolved'] is False
    finally:main.app.dependency_overrides.clear()

def test_skipped_organizations_are_not_indexed_and_do_not_break_coverage(world,monkeypatch):
    store,svc,search,_,_=world
    monkeypatch.setenv('ELASTIC_SKIP_ORGS',svc.oid)
    extra=svc.ingest('later.txt',b'A later note about VEN-002.',source_key='later')
    while run_once(store,search):pass
    assert svc.source(extra['id'])['index_status']=='skipped' and extra['id']+':0' not in search.docs
    assert svc.search_evidence(EvidenceQuery(query='Granite Legal'))['coverage_complete'] is True
