"""The same bounded operations serve HTTP clients and the Deepgram agent."""
from .data_service import DataService, FinancialQuery, EvidenceQuery, SourceQuery
from .retrieval import ElasticSearch
from .artifacts import ArtifactService,CreateArtifact,ArtifactID
from .concerns import ConcernService, RaiseConcern, ConcernID, Finish, ListConcerns, Renew

from .elastic_investigations import InvestigationService, Investigate, InvestigationID, ElasticCloud

from .fast_artifacts import ComposeArtifact, compose
from fastapi.encoders import jsonable_encoder

TOOL_MODELS={'compose_financial_artifact':ComposeArtifact,'investigate_financial_evidence':Investigate,'get_evidence_investigation':InvestigationID,'renew_concern_claim':Renew,'create_financial_artifact':CreateArtifact,'get_financial_artifact':ArtifactID,'list_concerns':ListConcerns,'raise_concern':RaiseConcern,'get_concern':ConcernID,'claim_concern':ConcernID,'resolve_concern':Finish,'query_financials':FinancialQuery,'search_evidence':EvidenceQuery,'get_source':SourceQuery}
DESCRIPTIONS={
    'compose_financial_artifact':'Quickly create and save a historical financial chart using one Jev presentation selection. Provide request_key, prompt, grouped aggregate query and unit. Returns artifact ID, status and FinancialArtifactCard json-render spec. No projections. Only status ready is renderable; retry failed with the same request_key.',
    'investigate_financial_evidence':'Delegate a read-only evidence investigation to the Elastic search specialist (A2A when configured). Use for exploratory, multi-step retrieval rather than known-ID lookups or exact financial totals. Requires an indexed source. Requires source_id, question and stable request_key. Returns an investigation ID, not an immediate finding.',
    'get_evidence_investigation':'Read a saved Elastic investigation and its cited finding or concern ID. Only complete means processing finished; inspect concern status separately.',
    'renew_concern_claim':'Renew a still-valid concern resolution claim for 15 minutes using its claim token.',
    'create_financial_artifact':'Queue a saved json-render financial chart with Jev review. Supply a complete aggregate query, units and optional scenario projection months; returns artifact ID and pending status.',
    'get_financial_artifact':'Read artifact generation status and validated chart specification. Ready artifacts have an authenticated /artifacts/{id}/html view.',
    'list_concerns':'List organization concerns; filter status queued to find user-selected work, or resolving to recover expired claims.',
    'raise_concern':'Raise a persistent financial anomaly concern with source IDs and a stable request_key. Generates three Jev-evaluated response choices for the user. Do not claim a card succeeded unless status is awaiting_response.',
    'get_concern':'Read a concern, user-selected instructions and resolution status. Never infer approval from silence.',
    'claim_concern':'Claim a user-selected queued concern for investigation for 15 minutes. Returns a claim_token needed to resolve. Does not authorize external actions.',
    'resolve_concern':'Report the actual investigation result with supporting source IDs and your claim_token. Use needs_input for blockers. Never claim external actions happened without evidence.',

    'list_datasets':'Discover imported financial datasets, column schemas, source IDs, currencies, and units before querying.',
    'query_financials':'Read financial rows or calculate exact aggregates over all matching active records. Use filters and pagination; never total search snippets. Monetary results remain in imported units and separate currencies. No arbitrary SQL.',
    'search_evidence':'Find cited evidence using Elasticsearch keyword/semantic search, widened by the company knowledge graph: identifiers and names in the query also reach documents about directly related records. query_entities shows what was recognized; each hit lists the entities it mentions. Set documents_only for correspondence, contracts and notes without ledger rows. Every hit says its origin: company is the organization\'s own books and correspondence, sandbox is a simulated counterparty\'s message about one exception case. Set origin to search one or the other; leaving it unset searches both. Results are samples, not complete transaction populations. Check coverage_complete before concluding evidence is absent.',
    'get_source':'Read paginated original extracted source content using a source_id from another tool. Returns row/page citations and an authenticated download URL.',
}

from . import accounting, settlements, accruals, learned_skills, counterparty, graph, posting, anomalies, skill_extraction, processor_adapters
TOOL_MODELS.update(graph.TOOL_MODELS)
DESCRIPTIONS.update(graph.DESCRIPTIONS)
TOOL_MODELS.update(counterparty.TOOL_MODELS)
DESCRIPTIONS.update(counterparty.DESCRIPTIONS)
TOOL_MODELS.update(learned_skills.TOOL_MODELS)
DESCRIPTIONS.update(learned_skills.DESCRIPTIONS)
TOOL_MODELS.update(accruals.TOOL_MODELS)
DESCRIPTIONS.update(accruals.DESCRIPTIONS)
TOOL_MODELS.update(settlements.TOOL_MODELS)
DESCRIPTIONS.update(settlements.DESCRIPTIONS)
TOOL_MODELS.update(accounting.TOOL_MODELS)
DESCRIPTIONS.update(accounting.DESCRIPTIONS)
TOOL_MODELS.update(posting.TOOL_MODELS)
DESCRIPTIONS.update(posting.DESCRIPTIONS)
TOOL_MODELS.update(anomalies.TOOL_MODELS)
DESCRIPTIONS.update(anomalies.DESCRIPTIONS)
TOOL_MODELS.update(skill_extraction.TOOL_MODELS)
DESCRIPTIONS.update(skill_extraction.DESCRIPTIONS)
TOOL_MODELS.update(processor_adapters.TOOL_MODELS)
DESCRIPTIONS.update(processor_adapters.DESCRIPTIONS)
DESCRIPTIONS['list_accounting_records'] = 'List owner-verified structured accounting records and their original IDs/source citations. Unverified raw uploads are not accounting authority.'

def tool_definitions():
    result=[]
    for name,description in DESCRIPTIONS.items():
        model=TOOL_MODELS.get(name)
        schema=model.model_json_schema() if model else {'type':'object','properties':{},'additionalProperties':False}
        definitions=schema.pop('$defs',{})
        def inline(value):
            if isinstance(value,dict):
                if '$ref' in value:return inline(definitions[value['$ref'].split('/')[-1]])
                return {k:inline(v) for k,v in value.items()}
            return [inline(v) for v in value] if isinstance(value,list) else value
        result.append({'name':name,'description':description,'parameters':inline(schema),'defer_until_eot':True})
    return result

def execute(store, oid, name, args):
    if name in counterparty.TOOL_MODELS:
        return jsonable_encoder(counterparty.Counterparties(DataService(store,oid,search=ElasticSearch())).execute(name,args))
    if name in graph.TOOL_MODELS:
        return jsonable_encoder(graph.Graph(store.engine,oid).execute(name,args))
    if name in learned_skills.TOOL_MODELS:
        return learned_skills.Skills(store,oid).execute(name,args)
    if name in accruals.TOOL_MODELS:
        return accruals.Accruals(store,oid).execute(name,args)
    if name in settlements.TOOL_MODELS:
        return settlements.Settlements(store,oid).execute(name,args)
    if name == 'list_accounting_records':
        if args:raise ValueError('No arguments expected')
        return jsonable_encoder(accounting.Accounting(store,oid).inventory())
    if name in accounting.TOOL_MODELS:
        return jsonable_encoder(accounting.Accounting(store,oid).execute(name,args))
    if name in posting.TOOL_MODELS:
        return jsonable_encoder(posting.Posting(store,oid).execute(name,args))
    if name in anomalies.TOOL_MODELS:
        return jsonable_encoder(anomalies.Anomalies(store,oid).execute(name,args))
    if name in skill_extraction.TOOL_MODELS:
        return jsonable_encoder(skill_extraction.Extractions(store,oid).execute(name,args))
    svc=DataService(store,oid,search=ElasticSearch())
    if name in processor_adapters.TOOL_MODELS:
        return jsonable_encoder(processor_adapters.Adapters(svc).execute(name,args))
    if name=='list_datasets':
        if args:raise ValueError('list_datasets takes no arguments')
        return svc.catalog()
    model=TOOL_MODELS[name]
    parsed=model.model_validate(args)
    if name=='investigate_financial_evidence':
        ElasticCloud().require(oid)
        return InvestigationService(svc).create(parsed)
    if name=='get_evidence_investigation':return InvestigationService(svc).get(parsed.investigation_id)
    if name=='compose_financial_artifact':return compose(svc,parsed)
    if name=='create_financial_artifact':return ArtifactService(svc).create(parsed)
    if name=='get_financial_artifact':return ArtifactService(svc).get(parsed.artifact_id)
    if name in ('renew_concern_claim','list_concerns','raise_concern','get_concern','claim_concern','resolve_concern'):
        concerns=ConcernService(svc)
        if name=='renew_concern_claim':return concerns.renew(parsed)
        if name=='list_concerns':return concerns.list(parsed.status,parsed.limit,parsed.offset)
        if name=='raise_concern':return concerns.raise_concern(parsed)
        if name=='get_concern':return concerns.get(parsed.concern_id)
        if name=='claim_concern':return concerns.claim(parsed.concern_id)
        return concerns.finish(parsed)
    return getattr(svc,name)(parsed)
