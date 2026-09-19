import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {experimental_evaluate as evaluate} from 'ai';
import {questions, decide} from './decision.mjs';
const secret = process.env.EVALUATOR_SECRET;
if (!secret) throw new Error('EVALUATOR_SECRET is required');
const server = createServer(async (req, res) => {
  const respond = (status, body) => {res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(body));};
  if(req.method !== 'POST' || req.url !== '/evaluate') return respond(404, {error:'Not found'});
  const actual = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if(actual.length !== expected.length || !timingSafeEqual(actual, expected)) return respond(401, {error:'Unauthorized'});
  try {
    let size = 0; const chunks = [];
    for await (const chunk of req) {size += chunk.length; if(size > 1_600_000) return respond(413, {error:'Context too large; transcript not truncated'}); chunks.push(chunk);}
    const state = JSON.parse(Buffer.concat(chunks).toString());
    if(!Array.isArray(state.transcript) || !state.context) return respond(400, {error:'Transcript and context required'});
    const result = await evaluate({model:'typesafe-ai/jev', state, questions, maxRetries: 1, abortSignal: AbortSignal.timeout(25000), providerOptions:{gateway:{zeroDataRetention:true}}});
    respond(200, {...decide(result.answers), revision:state.revision, usage:result.usage});
  } catch {respond(503, {error:'Evaluation unavailable'});}
});
server.listen(Number(process.env.EVALUATOR_PORT ?? 8001), '127.0.0.1');
