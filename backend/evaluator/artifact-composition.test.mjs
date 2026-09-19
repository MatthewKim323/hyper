import test from 'node:test';
import assert from 'node:assert/strict';
import {experimental_createEvaluator} from '@json-render/core';
import {composeFinancialCard} from './artifact-composition.mjs';

const chartProps={title:'Demo cash balance',chart:'line',currency:'USD',unit:'major_currency',points:[
  {period:'2026-07',value:'100.10',kind:'actual'},
  {period:'2026-08',value:'90.20',kind:'actual'},
  {period:'2026-09',value:'80.30',kind:'projected'},
]};
const notes='Synthetic fixture. September is a hypothetical scenario, not a forecast.';

function transport({choose='lineCard',fail=false}={}) {
  const calls=[];
  const evaluate=experimental_createEvaluator({apiKey:'test-only-not-a-real-key',model:'typesafe-ai/jev',
    fetch:async(url,init)=>{
      const body=JSON.parse(init.body);calls.push({url,body});
      if(fail)return new Response('{}',{status:503});
      const answers=Object.fromEntries(Object.entries(body.questions).map(([key,q])=>[
        key,{type:'choice',choice:Object.hasOwn(q.criteria,choose)?choose:Object.hasOwn(q.criteria,'use:'+choose)?'use:'+choose:'omit'},
      ]));
      return Response.json({answers,providerMetadata:{typesafe:{confidence:{root:0.9}}},usage:{inputTokens:100}});
    }});
  return {calls,evaluate};
}

for(const choose of ['lineCard','barCard'])test('one evaluation emits a complete '+choose,async()=>{
  const {calls,evaluate}=transport({choose});
  const events=[];
  for await(const e of composeFinancialCard({prompt:'Show the cash trend',chartProps,notes,evaluate}))events.push(e);
  assert.deepEqual(events.map(e=>e.type),['step','complete']);
  assert.equal(calls.length,1);
  assert.equal(events[1].stopReason,'finish');
  const spec=events[0].spec;
  assert.equal(spec.elements[spec.root].type,'FinancialArtifactCard');
  assert.equal(spec.elements[spec.root].props.chart,choose==='lineCard'?'line':'bar');
  assert.deepEqual(spec.state.points,chartProps.points);
  assert.equal(spec.state.notes,notes);
  assert.equal(JSON.stringify(calls).includes('100.10'),false,'raw amounts should stay in state, outside evaluator payload');
  assert.equal(JSON.stringify(calls).includes(notes),false);
  assert.equal(calls[0].url,'https://ai-gateway.vercel.sh/v4/ai/evaluation-model');
});

test('provider failure is not reported as a complete chart',async()=>{
  const {evaluate}=transport({fail:true});
  await assert.rejects(async()=>{for await(const e of composeFinancialCard({prompt:'cash',chartProps,notes,evaluate}))void e;},/HTTP 503/);
});

test('invalid financial values are rejected before a model call',async()=>{
  const {calls,evaluate}=transport();
  await assert.rejects(async()=>{
    for await(const e of composeFinancialCard({prompt:'cash',notes,evaluate,
      chartProps:{...chartProps,points:[{period:'now',value:'NaN',kind:'actual'}]}}))void e;
  });
  assert.equal(calls.length,0);
});

test('tool response returns a complete spec, static export and selection metadata',async()=>{
  const {composeArtifactResponse}=await import('./artifact-composition.mjs');
  const {evaluate,calls}=transport();
  const result=await composeArtifactResponse({prompt:'Show cash trend',chartProps,notes},{evaluate});
  assert.equal(result.evaluation.stop_reason,'finish');
  assert.equal(result.evaluation.purpose,'presentation_selection');
  assert.equal(result.evaluation.evaluations,1);
  assert.equal(calls.length,1);
  assert.match(result.html,/<svg/);
  assert.match(result.html,/100.10/);
  assert.equal(result.spec.state.notes,notes);
});
