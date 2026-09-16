import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {ImageStudio,IMAGE_MODEL,imageIntent,validatePng} from '../image-studio.mjs';
import {ApiBudget} from '../api-budget.mjs';
import {createApp} from '../server.mjs';
const spec={title:'Moon fox',prompt:'A felt fox sitting on a crescent moon, isolated.',background:'transparent'};
const png=readFileSync(new URL('../public/assets/playroom/elephant-v1.png',import.meta.url));
function fixture(t,generate){
  const dir=mkdtempSync(join(tmpdir(),'glass-studio-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const session=new Session({file:join(dir,'state.json')}),path=join(dir,'budget.json');
  writeFileSync(path,JSON.stringify({approvedUSD:25,runs:[]}));const budget=new ApiBudget(path);
  let calls=0;const client={images:{generate:async(...args)=>{calls++;return generate?generate(...args):{data:[{b64_json:png.toString('base64')}],usage:{input_tokens:40,output_tokens:2000}};}}};
  const studio=new ImageStudio({session,budget,client,directory:dir,timeoutMs:1000});
  return {dir,session,budget,studio,client,calls:()=>calls};
}
test('image jobs complete, persist art and recipe, deduplicate and reopen for free',async t=>{
  const f=fixture(t,(body,options)=>{assert.equal(body.model,IMAGE_MODEL);assert.equal(body.n,1);assert.equal(body.moderation,'auto');assert.equal(options.maxRetries,0);return {data:[{b64_json:png.toString('base64')}]};});
  const accepted=f.studio.start('one',spec);assert.match(accepted.message,/not finished/);
  assert.equal(f.studio.start('one',spec).jobId,accepted.jobId);
  await f.studio.active.promise;
  assert.equal(f.calls(),1);assert.equal(f.session.state.imageJobs[0].status,'completed');assert.deepEqual(f.studio.read(accepted.jobId),png);
  assert.equal(f.studio.start('two',spec).jobId,accepted.jobId);assert.equal(f.calls(),1);
  const restored=new Session({file:join(f.dir,'state.json')});assert.equal(restored.state.imageJobs[0].spec.prompt,spec.prompt);
  assert.deepEqual(imageIntent('show moon fox',restored.state),{action:'open_image',jobId:accepted.jobId});
  assert.equal(imageIntent('do not show moon fox',restored.state),null);
  assert.throws(()=>f.studio.read('../../.env'));
});
test('cancellation ignores late results, preserves allowance and never restarts on load',async t=>{
  let resolve;const f=fixture(t,()=>new Promise(r=>resolve=r));
  const j=f.studio.start('one',spec);await new Promise(r=>setImmediate(r));
  f.studio.cancel(j.jobId);resolve({data:[{b64_json:png.toString('base64')}]});await f.studio.active.promise;
  assert.equal(f.session.state.imageJobs[0].status,'cancelled');assert.throws(()=>f.studio.read(j.jobId));
  f.session.state.imageJobs[0].status='generating';f.session.save();
  const restored=new Session({file:f.session.file});new ImageStudio({session:restored,budget:f.budget,directory:f.dir,client:f.client});
  assert.equal(restored.state.imageJobs[0].status,'interrupted');assert.equal(f.calls(),1);
});
test('failed generation has no automatic retry, exhaustion prevents calls, storage rolls back',async t=>{
  const f=fixture(t,()=>{throw Error('provider unavailable');});f.studio.start('one',spec);await f.studio.active.promise;
  assert.equal(f.calls(),1);assert.equal(f.session.state.imageJobs[0].status,'failed');
  f.studio.start('one',spec);assert.equal(f.calls(),1);
  f.budget.reserve=()=>{throw Object.assign(Error('budget'),{code:'test_budget_exhausted'});};
  f.studio.start('two',{...spec,prompt:'A different fox.'});await f.studio.active.promise;assert.equal(f.calls(),1);
  assert.match(f.session.state.imageJobs[1].detail,/No image was requested/);
  const before=structuredClone(f.session.state);f.session.save=()=>{throw Error('disk full');};
  assert.throws(()=>f.studio.start('three',{...spec,prompt:'Another fox.'}),/disk full/);assert.deepEqual(f.session.state,before);
});
test('strict image payload and specification reject URLs, traversal, overlarge and malformed values',async t=>{
  const f=fixture(t,()=>({data:[{url:'http://127.0.0.1/private'}]}));
  assert.throws(()=>f.studio.start('x',{...spec,url:'file:///etc/passwd'}));
  assert.throws(()=>f.studio.start('x',{...spec,prompt:'x'.repeat(1201)}));
  assert.throws(()=>validatePng(Buffer.from('<svg onload=evil>')));
  f.studio.start('one',spec);await f.studio.active.promise;assert.equal(f.session.state.imageJobs[0].status,'failed');
  f.session.startPlayroom('animals');assert.throws(()=>f.studio.start('two',spec),/Exit playroom/);
});
test('async completion does not steal a newer panel; planner starts once and saved route bypasses it',async t=>{
  const f=fixture(t);let plans=0;
  const a=new Assistant({session:f.session,studio:f.studio,planner:{decide:async()=>{plans++;return {status:'execute',outcome:'Create art',message:'Starting',actions:[{action:'generate_image',spec}],options:[],selectedOptionId:null};}}});
  const result=await a.execute('voice-one','draw a fox');f.session.command('show',{panel:'todos'});
  if(f.studio.active)await f.studio.active.promise;
  assert.equal(f.session.state.panel,'todos');assert.equal(result.jobId,f.session.state.imageJobs[0].id);
  await a.execute('voice-two','show moon fox');assert.equal(f.session.state.panel,'studio');assert.equal(plans,1);
});
test('image accounting never refunds reservations and includes higher reported token spend',t=>{
  const f=fixture(t),id=f.budget.reserve('image-generation');
  f.budget.finishImage(id,{received:true,usage:{input_tokens:100,output_tokens:50000}});
  const b=JSON.parse(readFileSync(f.budget.path));assert.equal(b.runs[0].estimatedUSD,1.5005);assert.equal(b.runs[0].status,'closed');
});
test('studio renderer escapes prompts, uses only local assets and no controls on mirror',()=>{
  const src=readFileSync(new URL('../public/studio-ui.js',import.meta.url),'utf8'),ctx={window:{}};runInNewContext(src,ctx);
  const j={id:'12345678-1234-1234-1234-123456789012',status:'completed',spec:{...spec,title:'<script>bad</script>'}};
  const html=ctx.window.GlassStudio.render({imageJobId:j.id,imageJobs:[j]},false);
  assert.match(html,/&lt;script&gt;/);assert.match(html,/\/artwork\//);assert.doesNotMatch(html,/<(?:button|input|a |script)/);assert.doesNotMatch(src,/\b(?:let|const)\b|=>/);
});
test('studio HTTP enforces origin, persists and serves PNGs, rejects secret paths',async t=>{
  const f=fixture(t),origins=[],app=createApp({origins,studioOptions:{client:f.client,budget:f.budget,directory:f.dir}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const origin='http://127.0.0.1:'+app.server.address().port;origins.push(origin);
  const body=JSON.stringify({action:'generate',requestId:'http-one',spec});
  assert.equal((await fetch(origin+'/api/studio',{method:'POST',headers:{'content-type':'application/json'},body})).status,403);
  const r=await fetch(origin+'/api/studio',{method:'POST',headers:{origin,'content-type':'application/json'},body});assert.equal(r.status,202);const job=await r.json();
  if(app.studio.active)await app.studio.active.promise;
  const image=await fetch(origin+'/artwork/'+job.jobId+'.png');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
  assert.equal((await fetch(origin+'/.env')).status,404);
});
