#!/usr/bin/env python3
"""Bounded, resumable 102-session Luna corpus generator. Stdlib only."""
import argparse, concurrent.futures, hashlib, json, os, re, signal, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SCHEMA={"type":"object","properties":{"packet_id":{"type":"string"},"documents":{"type":"array","minItems":6,"maxItems":6,"items":{"type":"object","properties":{"document_id":{"type":"string"},"kind":{"type":"string"},"date":{"type":"string"},"subject":{"type":"string"},"body":{"type":"string"},"source_refs":{"type":"array","items":{"type":"string"}}},"required":["document_id","kind","date","subject","body","source_refs"],"additionalProperties":False}}},"required":["packet_id","documents"],"additionalProperties":False}
PROMPT='''You are a synthetic company document author, one of 102 independent Luna agents. Do not use tools, browse, read files, or spawn agents. Return only the requested JSON. All people and transactions are fictional.
Write exactly six distinct documents, each 60-100 words, from the supplied immutable company packet: supplier/customer email, internal chat, operational note, contract/service excerpt, reconciliation question, and follow-up. Use professional capitalization. Vary voice naturally. The packet is the ONLY factual authority. Do not invent amounts, dates, named people, payments, approvals, commercial terms, legal claims, or resolved outcomes. Questions and uncertainty are allowed. Preserve source identifiers exactly. Monetary fields ending _cents or _minor are integer hundredths of USD, not dollars. Convert them exactly if mentioning dollar amounts; do not calculate new totals in prose. Source refs must use IDs occurring in the packet. Do not reveal generator machinery, fixture answers, mutation names or evaluation labels in document bodies. Do not assert transaction purpose beyond the packet. If facts are sparse, elaborate questions and next steps, not new facts. Dates must equal packet date; these are same-day draft artifacts, not fabricated historical confirmations. Document IDs must be packet_id + '-doc-' + 1..6. All artifacts are synthetic drafts and will be labeled outside their body.\nPACKET:\n'''
def check(result, packet):
    assert result['packet_id']==packet['packet_id'], 'wrong packet'
    assert len(result['documents'])==6, 'document count'
    seen=set()
    def ids(value):
        if isinstance(value,dict):
            return {str(v) for k,v in value.items() if k.endswith('_id') and isinstance(v,(str,int))} | set().union(*(ids(v) for v in value.values()))
        if isinstance(value,list): return set().union(*(ids(v) for v in value))
        return {value} if isinstance(value,str) and re.fullmatch(r'(?:AR|AP|CUS|CON|VEN|PO|RC|VA|EMP|PAY|MERIDIAN|SIM|packet)-[A-Za-z0-9-]+',value) else set()
    permitted=ids(packet)
    for d in result['documents']:
        assert d['document_id'] not in seen, 'duplicate document id'
        seen.add(d['document_id'])
        assert d['date']==packet['date'], 'wrong date'
        assert len(d['body'].split())>=35, 'body too short'
        assert d['source_refs'] and all(ref in permitted for ref in d['source_refs']), 'ungrounded reference'
    return result

def run_one(packet, out, work):
    pid=packet['packet_id']
    if not re.fullmatch(r'packet-[0-9]{3}',pid): raise ValueError('Invalid packet id')
    dest=out/f'{pid}.json'
    work=work/pid; work.mkdir(parents=True,exist_ok=True)
    workspace=work/'workspace'; workspace.mkdir(exist_ok=True)
    meta=work/'metadata.json'
    prompt=PROMPT+json.dumps(packet,ensure_ascii=False)
    digest=hashlib.sha256(prompt.encode()).hexdigest()
    if dest.exists() and meta.exists():
        prior=json.loads(meta.read_text())
        if prior.get('prompt_sha256')==digest and prior.get('status')=='completed':
            assert hashlib.sha256(dest.read_bytes()).hexdigest()==prior['output_sha256'], 'Cached output hash changed'
            check(json.loads(dest.read_text()),packet); return prior
    (work/'task.txt').write_text(prompt)
    (workspace/'packet.json').write_text(json.dumps(packet,indent=2)+'\n')
    schema=work/'schema.json'; schema.write_text(json.dumps(SCHEMA))
    cmd=['codex','-a','never','exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','-m','gpt-5.6-luna','-s','read-only','-C',str(workspace),'--json','--output-schema',str(schema),'-o',str(work/f'{pid}.raw.json'),'-']
    started=time.time(); record={'packet_id':pid,'model':'gpt-5.6-luna','prompt_sha256':digest,'status':'failed'}
    # No automatic retries: a repeated run is an explicit operator decision.
    try:
        with (work/f'{pid}.events.jsonl').open('w') as log,(work/f'{pid}.stderr.log').open('w') as err:
            proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,text=True,stdout=log,stderr=err,start_new_session=True)
            record['pid']=proc.pid
            try: proc.communicate(prompt,timeout=240)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid,signal.SIGTERM)
                try: proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid,signal.SIGKILL); proc.wait()
                raise RuntimeError('240 second timeout; process group terminated')
        record['returncode']=proc.returncode
        events=[]
        for line in (work/f'{pid}.events.jsonl').read_text().splitlines():
            try: events.append(json.loads(line))
            except ValueError: pass
        record['session_ids']=[e['thread_id'] for e in events if e.get('type')=='thread.started']
        record['usage']=[e.get('usage') for e in events if e.get('type')=='turn.completed']
        assert proc.returncode==0, 'CLI failed; see stderr'
        assert not any(e.get('type')=='item.started' and e.get('item',{}).get('type') in ('command_execution','mcp_tool_call') for e in events), 'unexpected tool use'
        result=check(json.loads((work/f'{pid}.raw.json').read_text()),packet)
        result['synthetic']=True; result['review_status']='structurally_validated_semantics_not_independently_certified'
        dest.write_text(json.dumps(result,indent=2)+'\n')
        record.update(status='completed',document_count=6,output_sha256=hashlib.sha256(dest.read_bytes()).hexdigest())
    except Exception as exc: record['error']=str(exc)
    record['elapsed_seconds']=round(time.time()-started,2)
    meta.write_text(json.dumps(record,indent=2)+'\n'); return record

def main():
    p=argparse.ArgumentParser(); p.add_argument('--workers',type=int,default=8); p.add_argument('--limit',type=int,default=102); args=p.parse_args()
    if not 1<=args.workers<=12: p.error('workers must be 1..12')
    if not 1<=args.limit<=102: p.error('limit must be 1..102')
    packets=[json.loads(x) for x in (ROOT/'generated/private/narrative_packets.jsonl').read_text().splitlines()][:args.limit]
    out=ROOT/'generated/narratives'; out.mkdir(parents=True,exist_ok=True)
    work=ROOT/'swarm/runs'; work.mkdir(parents=True,exist_ok=True); (work/'schema.json').write_text(json.dumps(SCHEMA))
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for future in concurrent.futures.as_completed([pool.submit(run_one,x,out,work) for x in packets]):
            r=future.result(); results.append(r); print(json.dumps({'completed_jobs':len(results),'total':len(packets),**r}),flush=True)
            (work/'summary.json').write_text(json.dumps({'requested':len(packets),'completed':sum(x['status']=='completed' for x in results),'failed':sum(x['status']!='completed' for x in results),'runs':sorted(results,key=lambda x:x['packet_id'])},indent=2)+'\n')
    return int(any(x['status']!='completed' for x in results))
if __name__=='__main__': raise SystemExit(main())
