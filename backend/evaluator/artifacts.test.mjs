import test from 'node:test';
import assert from 'node:assert/strict';
import {renderArtifact} from './artifacts.mjs';
const spec=()=>({root:'root',elements:{root:{type:'Stack',props:{},children:['chart','notes']},chart:{type:'FinanceChart',props:{title:'Revenue <script>alert(1)</script>',chart:'line',currency:'USD',unit:'major_currency',points:[{period:'2026-01',value:'100',kind:'actual'},{period:'2026-02',value:'110',kind:'projected'}]},children:[]},notes:{type:'Notes',props:{text:'Hypothetical 10% growth'},children:[]}}});
test('json-render produces chart and accessible exact-value table, escapes text',()=>{
 const html=renderArtifact(spec()); assert.match(html,/<svg/);assert.match(html,/<table/);assert.match(html,/projected/);assert.ok(!html.includes('<script>'));
});
test('unknown components and dynamic execution rejected',()=>{
 const s=spec();s.elements.chart.type='iframe';assert.throws(()=>renderArtifact(s));
 const action=spec();action.elements.chart.on={click:{action:'pay'}};assert.throws(()=>renderArtifact(action));
});
