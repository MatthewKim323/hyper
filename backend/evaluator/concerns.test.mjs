import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCard,approveCard,concernCard,concernCardSchema,selectionBoundary} from './concerns.mjs';
test('Jev must approve all card dimensions',()=>{
  assert.equal(approveCard({grounded:{probability:0.9},distinct:{probability:0.9},authority:{probability:0.9}}),true);
  assert.equal(approveCard({grounded:{probability:0.9}}),false);
  assert.equal(approveCard({grounded:{probability:0.9},distinct:{probability:0.9},authority:{probability:0.5}}),false);
});

const exampleCard = () => ({summary:'Invoice quantity needs review.',options:[1,2,3].map(i=>({
  id:`option_${i}`,title:`Review approach ${i}`,action:'Compare the invoice with the purchase order.',
  tradeoff:'Requires manual review.',requires_approval:false,
}))});
const state = {concern:{summary:'Invoice and PO differ'},evidence:[{id:'source_1',text:'Invoice: 12. PO: 10.'}]};

test('Structured drafting uses bounded output and sends the exact validated card to Jev',async()=>{
  const prior=process.env.CONCERN_MODEL;
  process.env.CONCERN_MODEL='openai/gpt-5-mini';
  try {
    const generated=exampleCard();
    const reviewedCard={...generated,summary:generated.summary+' '+selectionBoundary};
    let reviewed=false;
    const result=await concernCard(state,{
      generateText:async request=>{
        assert.equal(request.model,'openai/gpt-5-mini');
        assert.equal(request.reasoning,'low');
        assert.equal(request.maxOutputTokens,8000);
        assert.ok(request.output);
        assert.deepEqual(JSON.parse(request.prompt),state);
        // A free-text response must never become the source of the card.
        return {output:generated,text:'{"summary":"unterminated'};
      },
      evaluate:async request=>{
        reviewed=true;
        assert.equal(request.model,'typesafe-ai/jev');
        assert.deepEqual(request.state,{...state,card:reviewedCard});
        assert.equal(request.providerOptions.gateway.zeroDataRetention,true);
        return {answers:{grounded:{probability:0.95},distinct:{probability:0.97},authority:{probability:0.96}}};
      },
    });
    assert.equal(reviewed,true);
    assert.equal(result.approved,true);
    assert.equal(result.evaluation.model,'typesafe-ai/jev');
    assert.deepEqual(result.card,reviewedCard);
  } finally {if(prior===undefined)delete process.env.CONCERN_MODEL;else process.env.CONCERN_MODEL=prior;}
});

test('Incomplete, oversized, or duplicate structured cards never reach review',async()=>{
  const prior=process.env.CONCERN_MODEL;
  process.env.CONCERN_MODEL='test-model';
  try {
    const oversized=exampleCard();oversized.options[0].action='x'.repeat(701);
    const duplicate=exampleCard();duplicate.options[2].id='option_1';
    const short=exampleCard();short.options.pop();
    for(const card of [undefined,oversized,duplicate,short]){
      await assert.rejects(concernCard(state,{
        generateText:async()=>({output:card,text:JSON.stringify(exampleCard())}),
        evaluate:async()=>assert.fail('Invalid draft reached Jev'),
      }));
    }
    assert.equal(concernCardSchema.safeParse(oversized).success,false);
  } finally {if(prior===undefined)delete process.env.CONCERN_MODEL;else process.env.CONCERN_MODEL=prior;}
});

test('A valid draft still fails closed when Jev rejects or is unavailable',async()=>{
  const prior=process.env.CONCERN_MODEL;
  process.env.CONCERN_MODEL='test-model';
  try {
    const generateText=async()=>({output:exampleCard()});
    const rejected=await concernCard(state,{generateText,evaluate:async()=>({answers:{
      grounded:{probability:0.99},distinct:{probability:0.99},authority:{probability:0.84},
    }})});
    assert.equal(rejected.approved,false);
    await assert.rejects(concernCard(state,{generateText,evaluate:async()=>{throw new Error('Review unavailable');}}),/Review unavailable/);
  } finally {if(prior===undefined)delete process.env.CONCERN_MODEL;else process.env.CONCERN_MODEL=prior;}
});
test('Card requires three unique complete options',()=>{
  const card={summary:'Concern',options:[1,2,3].map(i=>({id:`option_${i}`,title:'Review',action:'Check evidence',tradeoff:'Takes time',requires_approval:false}))};
  assert.equal(validateCard(card),card);
  card.options[2].id='option_1';
  assert.throws(()=>validateCard(card));
});

test('One rejected review can repair the failed dimensions, then requires fresh Jev approval',async()=>{
  const prior=process.env.CONCERN_MODEL;process.env.CONCERN_MODEL='test-model';
  try {
    const requests=[];let reviews=0;
    const result=await concernCard(state,{
      generateText:async request=>{requests.push(request);return {output:exampleCard()};},
      evaluate:async request=>{
        assert.equal(request.abortSignal,requests[0].abortSignal);
        assert.equal(request.model,'typesafe-ai/jev');
        reviews++;
        return {answers:{grounded:{probability:reviews===1?0.82:0.95},distinct:{probability:0.95},authority:{probability:0.95}}};
      },
    });
    assert.equal(result.approved,true);
    assert.equal(result.evaluation.threshold,0.85);
    assert.equal(result.evaluation.attempts,2);
    assert.equal(reviews,2);
    assert.equal(requests.length,2);
    assert.equal(requests[1].abortSignal,requests[0].abortSignal);
    const prompt=JSON.parse(requests[1].prompt);
    assert.deepEqual(prompt.evidence,state.evidence);
    assert.deepEqual(prompt.review_feedback.failed_dimensions,['grounded']);
    assert.match(prompt.review_feedback.corrections[0],/source records/);
    assert.equal(prompt.review_feedback.previous_card.summary.endsWith(selectionBoundary),true);
  } finally {if(prior===undefined)delete process.env.CONCERN_MODEL;else process.env.CONCERN_MODEL=prior;}
});

test('A second rejection stays rejected; there is no unbounded regeneration',async()=>{
  const prior=process.env.CONCERN_MODEL;process.env.CONCERN_MODEL='test-model';
  try {
    let drafts=0,reviews=0;
    const result=await concernCard(state,{
      generateText:async()=>{drafts++;return {output:exampleCard()};},
      evaluate:async()=>{reviews++;return {answers:{grounded:{probability:0.84},distinct:{probability:0.95},authority:{probability:0.95}}};},
    });
    assert.equal(drafts,2);assert.equal(reviews,2);
    assert.equal(result.approved,false);assert.equal(result.evaluation.attempts,2);
  } finally {if(prior===undefined)delete process.env.CONCERN_MODEL;else process.env.CONCERN_MODEL=prior;}
});

test('Repair is skipped when the shared request deadline has insufficient time',async()=>{
  const prior=process.env.CONCERN_MODEL;process.env.CONCERN_MODEL='test-model';
  try {
    let drafts=0,clock=0;
    const result=await concernCard(state,{
      now:()=>{const time=clock;clock=66000;return time;},
      generateText:async()=>{drafts++;return {output:exampleCard()};},
      evaluate:async()=>({answers:{grounded:{probability:0.84},distinct:{probability:0.95},authority:{probability:0.95}}}),
    });
    assert.equal(drafts,1);assert.equal(result.approved,false);assert.equal(result.evaluation.attempts,1);
  } finally {if(prior===undefined)delete process.env.CONCERN_MODEL;else process.env.CONCERN_MODEL=prior;}
});

test('An authority repair cannot replace a previously grounded summary with new claims',async()=>{
  const prior=process.env.CONCERN_MODEL;process.env.CONCERN_MODEL='test-model';
  try {
    let drafts=0,reviews=0;
    const result=await concernCard(state,{
      generateText:async()=>({output:{...exampleCard(),summary:++drafts===1?'The invoice lists 12 units.':'No other invoice exists anywhere.'}}),
      evaluate:async request=>{
        reviews++;
        assert.equal(request.state.card.summary,'The invoice lists 12 units. '+selectionBoundary);
        return {answers:{grounded:{probability:0.95},distinct:{probability:0.95},authority:{probability:reviews===1?0.8:0.95}}};
      },
    });
    assert.equal(result.approved,true);assert.equal(reviews,2);
  } finally {if(prior===undefined)delete process.env.CONCERN_MODEL;else process.env.CONCERN_MODEL=prior;}
});
