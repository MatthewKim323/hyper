import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCard,approveCard} from './concerns.mjs';
test('Jev must approve all card dimensions',()=>{
  assert.equal(approveCard({grounded:{probability:0.9},distinct:{probability:0.9},authority:{probability:0.9}}),true);
  assert.equal(approveCard({grounded:{probability:0.9}}),false);
  assert.equal(approveCard({grounded:{probability:0.9},distinct:{probability:0.9},authority:{probability:0.5}}),false);
});
test('Card requires three unique complete options',()=>{
  const card={summary:'Concern',options:[1,2,3].map(i=>({id:`option_${i}`,title:'Review',action:'Check evidence',tradeoff:'Takes time',requires_approval:false}))};
  assert.equal(validateCard(card),card);
  card.options[2].id='option_1';
  assert.throws(()=>validateCard(card));
});
