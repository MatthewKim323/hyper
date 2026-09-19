"""Opt-in tests against actual Postgres, S3, and Elasticsearch (no provider doubles)."""
import os
import uuid
from decimal import Decimal
from pathlib import Path
import pytest
from dotenv import load_dotenv
from sqlalchemy import select, delete
from sqlalchemy.engine import make_url
from app.store import Store
from app.objects import ObjectStore
from app.retrieval import ElasticSearch
from app.data_service import DataService, FinancialQuery, EvidenceQuery
from app.ingestion_worker import run_once
from app.database import (sources, records, chunks, jobs, memberships, organizations, users,
                          simulations, simulation_events, connections, connection_auth,
                          connection_items, connection_syncs)

pytestmark=pytest.mark.skipif(os.getenv('RUN_DATA_INTEGRATION')!='1',reason='Requires compose services; set RUN_DATA_INTEGRATION=1')

@pytest.fixture
def live():
    load_dotenv(Path(__file__).resolve().parents[1]/'.env.data',override=True)
    admin=Store()
    assert admin.engine.dialect.name=='postgresql'
    marker='integration_'+uuid.uuid4().hex
    # Separate queue/schema prevents the running application worker from claiming test jobs.
    with admin.engine.begin() as db:
        db.exec_driver_sql(f'CREATE SCHEMA "{marker}"')
    url=make_url(os.environ['DATABASE_URL']).update_query_dict({'options':'-csearch_path='+marker})
    store=Store(url.render_as_string(hide_password=False))
    oid=store.workspace(marker)['id']
    objects=ObjectStore()
    search=ElasticSearch()
    search.index='hyper-test-'+uuid.uuid4().hex
    svc=DataService(store,oid,objects,search)
    try:yield store,svc,search
    finally:
        with store.engine.begin() as db:
            keys=db.execute(select(sources.c.object_key).where(sources.c.organization_id==oid)).scalars().all()
            cids=select(connections.c.id).where(connections.c.organization_id==oid)
            keys+=db.execute(select(connection_items.c.object_key).where(connection_items.c.connection_id.in_(cids))).scalars().all()
            for table in (connection_auth,connection_items,connection_syncs):
                db.execute(delete(table).where(table.c.connection_id.in_(cids)))
            db.execute(delete(connections).where(connections.c.organization_id==oid))
            for table in (simulation_events,simulations,jobs,chunks,records,sources,memberships):
                db.execute(delete(table).where(table.c.organization_id==oid))
            db.execute(delete(organizations).where(organizations.c.id==oid))
            db.execute(delete(users).where(users.c.id==marker))
        for key in keys:objects.client.delete_object(Bucket=objects.bucket,Key=key)
        try:search.request('DELETE',search.index)
        except Exception:pass
        store.engine.dispose()
        with admin.engine.begin() as db:
            db.exec_driver_sql(f'DROP SCHEMA "{marker}" CASCADE')

def test_real_ingestion_exact_math_objects_search_and_restart(live):
    store,svc,search=live
    body=b'id,amount,date\na,0.10,2026-09-01\nb,0.20,2026-09-02\nc,9999999999999999.01,2026-09-03\n'
    source=svc.ingest('cost.csv',body,dataset='cost',currency='USD',field_types={'amount':'numeric'})
    assert svc.objects.read(svc.source(source['id'])['object_key'])==body
    assert svc.ingest('cost.csv',body,dataset='cost',currency='USD',field_types={'amount':'numeric'})['deduplicated']
    result=svc.query_financials(FinancialQuery(dataset='cost',operation='sum',field='amount'))
    assert Decimal(result['results'][0]['value'])==Decimal('9999999999999999.31')
    assert result['results'][0]['record_count']==3
    svc.ingest('eur.csv',b'id,amount\nd,25.10\n',dataset='cost',currency='EUR',field_types={'amount':'numeric'})
    grouped=svc.query_financials(FinancialQuery(dataset='cost',operation='sum',field='amount'))
    assert {r['currency'] for r in grouped['results']}=={'USD','EUR'}
    # Worker claims from a shared durable queue; loop until this organization's jobs complete.
    for _ in range(100):
        if svc.job_status(source['id'])['status']=='complete':break
        assert run_once(store,search,svc.oid)
    assert svc.job_status(source['id'])['status']=='complete'
    found=svc.search_evidence(EvidenceQuery(query='amount',dataset='cost'))
    assert any(h['source_id']==source['id'] for h in found['hits'])
    restarted=DataService(Store(store.engine.url.render_as_string(hide_password=False)),svc.oid,svc.objects,search)
    assert restarted.source(source['id'])['index_status']=='ready'
    assert restarted.query_financials(FinancialQuery(dataset='cost',operation='count'))['results']
    if search.inference_id:
        memo=svc.ingest('supplier-terms.md',b'The supplier may end the agreement with thirty days written notice.')
        for _ in range(10):
            if svc.job_status(memo['id'])['status']=='complete':break
            assert run_once(store,search,svc.oid)
        assert svc.job_status(memo['id'])['status']=='complete'
        semantic=svc.search_evidence(EvidenceQuery(query='contract cancellation'))
        assert semantic['mode']=='hybrid'
        assert any(h['source_id']==memo['id'] for h in semantic['hits'])
        # Demonstrate a real semantic match where the same keyword-only query misses.
        search.inference_id=''
        lexical=svc.search_evidence(EvidenceQuery(query='contract cancellation'))
        assert not any(h['source_id']==memo['id'] for h in lexical['hits'])


def test_real_simulator_publication_restart_and_search(live):
    from app.simulator import SimulatorService, CreateSimulation, run_once as simulate
    store, svc, search = live
    sim = SimulatorService(svc)
    sid = sim.create(CreateSimulation(mode='template', max_ticks=2))['id']
    sim.control(sid, 'tick')
    assert simulate(store, lambda oid: svc)
    event = sim.events(sid)['events'][0]
    assert event['status'] == 'published'
    for source_id in event['source_ids']:
        assert svc.objects.read(svc.source(source_id)['object_key'])
    restarted_store = Store(store.engine.url.render_as_string(hide_password=False))
    try:
        restarted = SimulatorService(DataService(restarted_store, svc.oid, svc.objects, search))
        assert restarted.get(sid)['sequence'] == 1
        restarted.control(sid, 'tick')
        assert simulate(restarted_store, lambda oid: svc)
        assert restarted.get(sid)['status'] == 'completed'
        amount = svc.query_financials(FinancialQuery(dataset='sim_purchase_order', operation='sum', field='amount_cents'))
        assert Decimal(amount['results'][0]['value']) > 0
        while run_once(store, search, svc.oid):
            pass
        result = svc.search_evidence(EvidenceQuery(query='SIMULATED SOURCE'))
        assert result['coverage_complete']
        assert result['hits']
    finally:
        restarted_store.engine.dispose()


def test_connector_with_real_storage_and_mocked_provider(live, monkeypatch):
    import httpx
    from cryptography.fernet import Fernet
    from app.connectors import worker
    from app.connectors.service import ConnectionService
    store, svc, search = live
    monkeypatch.setenv('CONNECTOR_ENCRYPTION_KEY', Fernet.generate_key().decode())
    monkeypatch.setenv('PLAID_CLIENT_ID', 'test-client')
    monkeypatch.setenv('PLAID_SECRET', 'test-secret')
    connector = ConnectionService(svc)
    row = connector.create_pending('plaid', 'Storage integration', {'environment': 'sandbox', 'interval_seconds': 300})
    connector.complete(row, 'test-item', {'access_token': 'test-access'})
    def handler(req):
        return httpx.Response(200, json={'added': [{'transaction_id': 'bank-1', 'account_id': 'account-1',
            'amount': '123.45', 'date': '2026-09-01', 'iso_currency_code': 'USD', 'pending': False}],
            'modified': [], 'removed': [], 'next_cursor': 'cursor-1', 'has_more': False})
    monkeypatch.setattr(worker, 'client', lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    assert worker.run_once(store, lambda oid: svc)
    assert connector.get(row['id'])['status'] == 'connected'
    items = connector.items(row['id'], 10, 0)['items']
    assert len(items) == 1 and items[0]['status'] == 'imported'
    assert b'bank-1' in connector.original(row['id'], items[0]['item_id'])[1]
    aggregate = svc.query_financials(FinancialQuery(dataset='plaid_transactions', operation='sum', field='amount_major'))
    assert aggregate['results'][0]['value'] == '123.450000000000'
    connector.sync(row['id'])
    assert worker.run_once(store, lambda oid: svc)
    assert len(connector.items(row['id'], 10, 0)['items']) == 1
    while run_once(store, search, svc.oid):
        pass
    assert svc.search_evidence(EvidenceQuery(query='bank-1'))['hits']
    connector.disconnect(row['id'])
    assert not svc.search_evidence(EvidenceQuery(query='bank-1'))['hits']


def test_real_artifact_snapshot_and_transactional_events(live):
    from app.artifacts import ArtifactService,CreateArtifact,calculate_spec
    from app.orchestrator import AgentService,Page
    store,svc,_=live
    source=svc.ingest('monthly.csv',b'month,revenue\n2026-01,0.10\n2026-01,0.20\n2026-02,10.00\n',
                      dataset='monthly',currency='USD',field_types={'revenue':'numeric','month':'text'})
    row=ArtifactService(svc).create(CreateArtifact(request_key='revenue',prompt='Revenue scenario',unit='major_currency',projection_months=1,
        query=FinancialQuery(dataset='monthly',operation='sum',field='revenue',group_by=['month'])))
    assert Decimal(row['snapshot']['results'][0]['value'])==Decimal('0.30')
    spec=calculate_spec(row['request'],row['snapshot'],{'title':'Revenue','chart':'line','summary':'Gross amounts','growth_percent':'5','assumption':'Hypothetical'})
    assert Decimal(spec['elements']['chart']['props']['points'][-1]['value'])==Decimal('10.50')
    assert any(e['payload'].get('source_id')==source['id'] for e in AgentService(store,svc.oid).list_events(Page())['events'])
