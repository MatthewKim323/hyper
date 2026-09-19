// Experimental fast path: select a complete app-owned chart card in one evaluation.
// Consume only with trusted/validated financial snapshots. This selects presentation;
// it does not certify accounting facts or replace the artifact's content review.
import {defineCatalog, experimental_composeSpec, experimental_createEvaluator} from '@json-render/core';
import {schema} from '@json-render/react/schema';
import {z} from 'zod';
import {catalog as artifactCatalog} from './artifacts.mjs';

const propsSchema=artifactCatalog.data.components.FinanceChart.props.extend({
  notes:z.string().max(12000),
}).strict();
export const compositionCatalog=defineCatalog(schema,{components:{
  FinancialArtifactCard:{props:propsSchema,description:'Complete financial chart card: title, chart, units, exact-value table, actual/projected legend and required notes.'},
},actions:{}});

export async function* composeFinancialCard({prompt,chartProps,notes,evaluate,signal}) {
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>2000)throw new Error('Prompt must contain 1–2000 characters');
  const prepared=propsSchema.parse({...chartProps,notes});
  const candidates=['line','bar'].map(chart=>({
    id:chart+'Card',resource:'financial-chart',
    description:chart==='line'?'Line chart card: emphasize changes over ordered periods.':'Bar chart card: compare magnitudes across periods.',
    element:{type:'FinancialArtifactCard',props:{...prepared,chart,points:{$state:'/points'},notes:{$state:'/notes'}}},
  }));
  const evaluator=evaluate??experimental_createEvaluator({
    model:'typesafe-ai/jev',apiKey:process.env.AI_GATEWAY_API_KEY,timeoutMs:5000,
  });
  yield* experimental_composeSpec({catalog:compositionCatalog,candidates,prompt,evaluate:evaluator,
    initialState:{points:prepared.points,notes:prepared.notes},
    context:{pointCount:prepared.points.length,hasProjections:prepared.points.some(p=>p.kind==='projected'),
      allowedPurpose:'Select chart presentation only; all numbers and notes are fixed by the application.'},
    strategy:'batch',maxSteps:1,maxElements:1,maxDepth:1,
    signal:signal??AbortSignal.timeout(6000),
  });
}

export async function composeArtifactResponse(input, options={}) {
  const started=performance.now();
  let complete;
  for await(const event of composeFinancialCard({...input,...options})) {
    if(event.type==='complete')complete=event;
  }
  if(complete?.stopReason!=='finish'||!complete.spec)throw new Error('Composition did not finish');
  const spec=complete.spec;
  const element=spec.elements[spec.root];
  if(Object.keys(spec.elements).length!==1||element?.type!=='FinancialArtifactCard')throw new Error('Unexpected composition');
  const chart=element.props.chart;
  if(!['line','bar'].includes(chart))throw new Error('Unsupported chart');
  // Static export remains available; the interactive client consumes the card spec.
  const {renderArtifact}=await import('./artifacts.mjs');
  const html=renderArtifact({root:'root',elements:{
    root:{type:'Stack',props:{},children:['chart','notes']},
    chart:{type:'FinanceChart',props:{...input.chartProps,chart},children:[]},
    notes:{type:'Notes',props:{text:input.notes},children:[]},
  }});
  return {spec,html,chart,evaluation:{model:'typesafe-ai/jev',purpose:'presentation_selection',
    stop_reason:complete.stopReason,evaluations:complete.steps.length,elapsed_ms:Math.round(performance.now()-started)}};
}
