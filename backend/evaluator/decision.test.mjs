import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide, questions} from './decision.mjs';
const good = () => Object.fromEntries(Object.keys(questions).map(k => [k, {type:'boolean', probability:0.95}]));
test('all dimensions must pass', () => assert.equal(decide(good()).ready, true));
test('one missing dimension blocks completion', () => {const x=good(); delete x.evidence; assert.equal(decide(x).ready,false);});
test('uncertainty blocks completion', () => {const x=good(); x.ambiguity.probability=0.5; assert.equal(decide(x).ready,false);});
test('invalid probabilities fail closed', () => {for (const p of [NaN, Infinity, 1.1, '0.99']) {const x=good(); x.ready.probability=p; assert.equal(decide(x).ready,false);}});
