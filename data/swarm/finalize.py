#!/usr/bin/env python3
"""Normalize grounded reference metadata without rewriting model text; preserve raw logs."""
import hashlib,json,re
from decimal import Decimal
from pathlib import Path
from run import check
ROOT=Path(__file__).resolve().parents[1]
ID=re.compile(r'^(?:AR|AP|CUS|CON|VEN|PO|RC|VA|EMP|PAY|MERIDIAN|SIM|packet)-[A-Za-z0-9-]+$')
def values(value):
 if isinstance(value,dict):return [z for v in value.values() for z in values(v)]
 if isinstance(value,list):return [z for v in value for z in values(v)]
 return [value]
def monetary(value):
 if isinstance(value,dict):return {v for k,v in value.items() if k.endswith('_cents') and type(v)is int}|set().union(*(monetary(v) for v in value.values()))
 if isinstance(value,list):return set().union(*(monetary(v) for v in value))
 return set()
def main():
 packets=[json.loads(x) for x in (ROOT/'generated/private/narrative_packets.jsonl').read_text().splitlines()];results=[];warnings=[]
 for p in packets:
  pid=p['packet_id'];folder=ROOT/'swarm/runs'/pid;record=json.loads((folder/'metadata.json').read_text());raw=folder/(pid+'.raw.json')
  try:
   if record.get('returncode')!=0:raise ValueError('Process did not succeed')
   obj=json.loads(raw.read_text());atoms={x for x in values(p) if isinstance(x,str)};allowed={x for x in atoms if ID.fullmatch(x)};removed=[]
   for d in obj['documents']:
    if any(ref not in atoms for ref in d['source_refs']):raise ValueError('Invented source reference')
    removed += [ref for ref in d['source_refs'] if ref not in allowed]
    d['source_refs']=[ref for ref in d['source_refs'] if ref in allowed]
    if not d['source_refs']:raise ValueError('No record reference')
    for dollars in re.findall(r'\$([\d,]+(?:\.\d{1,2})?)|([\d,]+\.\d{2})\s+USD',d['body']):
     amount=int(Decimal(next(x for x in dollars if x).replace(',',''))*100)
     if amount not in monetary(p):warnings.append({'document_id':d['document_id'],'amount_cents':amount,'reason':'Dollar amount not a supplied monetary field; review required'})
   # accepted_by is also a source identifier, although its key does not end in _id.
   augmented=dict(p,reference_ids=[{'source_id':x} for x in allowed]);check(obj,augmented)
   obj.update(synthetic=True,review_status='structurally_validated_semantics_not_independently_certified',normalization={'removed_grounded_non_id_references':removed,'body_modified':False})
   dest=ROOT/'generated/narratives'/f'{pid}.json';dest.write_text(json.dumps(obj,indent=2)+'\n')
   record.update(status='completed',document_count=len(obj['documents']),output_sha256=hashlib.sha256(dest.read_bytes()).hexdigest(),normalization=obj['normalization'],initial_validation_error=record.pop('error',None))
  except Exception as exc:record.update(status='failed',error=str(exc))
  (folder/'metadata.json').write_text(json.dumps(record,indent=2)+'\n')
  results.append(record)
 report={'requested':len(packets),'completed':sum(r['status']=='completed' for r in results),'failed':sum(r['status']!='completed' for r in results),'documents':sum(r.get('document_count',0) for r in results if r['status']=='completed'),'distinct_sessions':len({x for r in results for x in r.get('session_ids',[])}),'model':'gpt-5.6-luna','total_usage':{k:sum(u.get(k,0) for r in results for u in r.get('usage',[])) for k in ('input_tokens','cached_input_tokens','output_tokens')},'amount_review_flags':warnings,'runs':results}
 with (ROOT/'generated/narratives/documents.jsonl').open('w') as corpus:
  for r in results:
   if r['status']!='completed':continue
   obj=json.loads((ROOT/'generated/narratives'/f"{r['packet_id']}.json").read_text())
   for doc in obj['documents']:corpus.write(json.dumps({**doc,'synthetic':True,'status':'draft','packet_id':r['packet_id'],'semantic_review':'not_independently_certified'})+'\n')
 (ROOT/'generated/private/swarm-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='runs'},indent=2))
 return report['failed']>0
if __name__=='__main__':raise SystemExit(main())
