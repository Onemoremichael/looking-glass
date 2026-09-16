import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {Workflows} from '../workflows.mjs';
import {createApp} from '../server.mjs';
import {Telemetry} from '../telemetry.mjs';
import {matches,plannerResponseSchema,presentation} from '../assistant-contract.mjs';
import {CustomFunctions,evaluateFunction,validateFunctionSpec,functionInput,validateFunctionOutput,functionIntent} from '../custom-functions.mjs';
const spec=()=>({title:'Party portions',outcome:'Calculate snacks without extra shopping',inputs:[{name:'people',label:'People',type:'number'}],code:'input => ({portions: Math.max(0, Math.ceil(input.people * 2)), note: "Two snacks each"})',tests:[{inputJSON:'{"people":4}',expectedJSON:'{"portions":8,"note":"Two snacks each"}'},{inputJSON:'{"people":0}',expectedJSON:'{"portions":0,"note":"Two snacks each"}'}],layout:{accent:'peach',blocks:[{kind:'metric',label:'Snacks to pack',key:'portions',unit:'pieces'},{kind:'note',label:'The plan',key:'note'}]}});
const create=(s=spec(),input={people:6})=>({action:'create_function',spec:s,inputJSON:JSON.stringify(input),parentId:null});
const decision=action=>({status:'execute',outcome:'Prepare snacks',message:'Requested',actions:[action],options:[],selectedOptionId:null,quickAction:null});
function fixture(t,options={}){const directory=mkdtempSync(join(tmpdir(),'glass-functions-'));const session=new Session({file:join(directory,'state.json')}),telemetry=new Telemetry({file:join(directory,'trace.jsonl')});const functions=new CustomFunctions({session,telemetry,...options});t.after(async()=>{await functions.close();await telemetry.close();session.close();rmSync(directory,{recursive:true,force:true});});return {session,functions,telemetry,directory};}
test('real sandbox computes input values; saved recipe reruns locally with new inputs after restart',async t=>{
  const f=fixture(t);const first=await f.functions.handle('build',create());
  assert.equal(first.functionVerified,true);assert.equal(f.session.state.customView.output.portions,12);assert.equal(f.session.state.reusableViews.length,1);
  assert.deepEqual(await f.functions.handle('build',create()),first);
  const session=new Session({file:join(f.directory,'state.json')}),functions=new CustomFunctions({session});t.after(()=>functions.close());
  await functions.handle('again',{action:'run_function',viewId:first.functionId,inputJSON:'{"people":9}'});
  assert.equal(session.state.customView.output.portions,18);assert.equal(session.state.reusableViews.length,1);
  assert.equal(presentation(session.state).customFunction.functionId,first.functionId);
  assert.ok(f.telemetry.snapshot().records.some(r=>r.name==='function.execute'));
});
test('QuickJS exposes no host IO, imports, secrets, clock, random, or browser runtime',async()=>{
  const code='input => ({environment: [typeof process,typeof require,typeof fetch,typeof window,typeof document,typeof parentPort,typeof Date,typeof Math.random].join(",")})';
  assert.deepEqual(await evaluateFunction(code,[{}]),[{environment:Array(8).fill('undefined').join(',')}]);
  for(const code of ['()=>process.env','()=>require("node:fs")','async()=>import("node:fs")','()=>Function("return process")()','()=>({then(){}})'])await assert.rejects(evaluateFunction(code,[{}]),/sandbox/);
});
test('CPU, memory, recursion and oversized output fail closed; following work still runs',async()=>{
  for(const code of ['()=>{while(true){}}','()=>{const a=[];while(true)a.push("x".repeat(100000));}','()=>{function f(){return f()}return f()}','()=>({text:"x".repeat(13000)})'])await assert.rejects(evaluateFunction(code,[{}]),/sandbox|limit/);
  assert.deepEqual(await evaluateFunction('()=>({value:3})',[{}]),[{value:3}]);
});
test('runtime globals do not survive between calls or example tests',async()=>{
  assert.deepEqual(await evaluateFunction('()=>({value:globalThis.marker=(globalThis.marker||0)+1})',[{},{},{}]),[{value:1},{value:1},{value:1}]);
});
test('strict specs require bounded inputs, distinct examples and trusted component bindings',()=>{
  assert.doesNotThrow(()=>validateFunctionSpec(spec()));
  for(const change of [{code:''},{inputs:[{name:'constructor',label:'bad',type:'text'}]},{tests:[spec().tests[0],spec().tests[0]]},{layout:{accent:'url(https://example.com)',blocks:spec().layout.blocks}},{layout:{accent:'sky',blocks:[{kind:'html',label:'bad',key:'html'}]}}])assert.throws(()=>validateFunctionSpec({...spec(),...change}));
  for(const input of ['{"people":1,"extra":2}','{"people":"1"}','{"people":1e100}','null','[]'])assert.throws(()=>functionInput(spec(),input));
  for(const output of [{portions:NaN,note:'x'},{portions:3,note:{html:'x'}},{portions:[],note:'x'},{portions:1,note:'x',hidden:{html:'x'}}])assert.throws(()=>validateFunctionOutput(output,spec().layout));
  assert.equal(matches(plannerResponseSchema,{decision:decision(create())}),true);
});
test('failed examples and mismatched runtime layouts do not save or replace any result',async t=>{
  const f=fixture(t);await f.functions.handle('good',create());const before=structuredClone(f.session.state);
  await assert.rejects(f.functions.handle('bad',create({...spec(),code:'()=>({portions:99,note:"Wrong"})'})),/example test/);
  assert.deepEqual(f.session.state,before);
  await assert.rejects(f.functions.handle('shape',create({...spec(),code:'()=>({portions:[],note:"Wrong"})'})),/layout/);
  assert.deepEqual(f.session.state,before);
});
test('cancellation and revision changes cannot save late results; request conflict does not start a second worker',async t=>{
  let release,calls=0;const f=fixture(t,{evaluate:()=>{calls++;return new Promise(r=>release=r);}}),controller=new AbortController();
  const work=f.functions.handle('late',create(),{signal:controller.signal});const rejected=assert.rejects(work,/cancelled/);
  await assert.rejects(f.functions.handle('second',create()),/already/);controller.abort();
  release([{portions:8,note:'Two snacks each'},{portions:0,note:'Two snacks each'},{portions:12,note:'Two snacks each'},{portions:12,note:'Two snacks each'}]);await rejected;
  assert.equal(calls,1);assert.equal(f.session.state.reusableViews.length,0);
  const next=f.functions.handle('stale',create());const stale=assert.rejects(next,/Display changed/);f.session.command('show',{panel:'time'});
  release([{portions:8,note:'Two snacks each'},{portions:0,note:'Two snacks each'},{portions:12,note:'Two snacks each'},{portions:12,note:'Two snacks each'}]);await stale;assert.equal(f.session.state.reusableViews.length,0);
});
test('actual worker cancellation and shutdown terminate work without committing',async t=>{
  const f=fixture(t),controller=new AbortController(),s={...spec(),code:'()=>{while(true){}}'};
  const work=f.functions.handle('loop',create(s),{signal:controller.signal}),rejected=assert.rejects(work,/cancelled/);controller.abort();await rejected;
  const closing=f.functions.handle('close',create(s)),closed=assert.rejects(closing,/cancelled/);await f.functions.close();await closed;assert.equal(f.session.state.reusableViews.length,0);
});
test('storage failure rolls back results and library additions; full repertoire fails honestly',async t=>{
  const f=fixture(t),before=structuredClone(f.session.state),save=f.session.save.bind(f.session);f.session.save=()=>{throw Error('disk full');};
  await assert.rejects(f.functions.handle('disk',create()),/disk full/);assert.deepEqual(f.session.state,before);f.session.save=save;
  f.session.state.reusableViews=Array.from({length:64},(_,i)=>({id:String(i),kind:'weather',scope:'x',spec:{}}));
  await assert.rejects(f.functions.handle('full',create()),/library is full/);assert.equal(f.session.state.customView,undefined);
});
test('adaptations preserve the original and parent; local opening requests fresh values instead of replaying old inputs',async t=>{
  const f=fixture(t),first=await f.functions.handle('one',create());
  const second=await f.functions.handle('fork',{...create({...spec(),title:'Picnic snacks'}),parentId:first.functionId});
  assert.notEqual(second.functionId,first.functionId);assert.equal(f.session.state.reusableViews[1].parentId,first.functionId);
  const assistant=new Assistant({session:f.session,planner:{decide:()=>{throw Error('No inference expected');}}});assistant.functions=f.functions;
  const result=await assistant.execute('open','Open party portions');assert.equal(result.status,'needs_input');assert.equal(f.session.state.customView.output,null);assert.equal(f.session.state.customView.input,null);
  assert.equal(functionIntent('Do not open Party portions',f.session.state),null);
});
test('custom workflow step uses actual function evidence, not a model claim; replay survives rolling receipts',async t=>{
  const f=fixture(t),assistant=new Assistant({session:f.session,planner:{decide:async()=>decision(create())}});assistant.functions=f.functions;
  const workflows=new Workflows({session:f.session,assistant});assistant.workflows=workflows;t.after(()=>workflows.close());
  const r=workflows.handle('plan',{action:'create_workflow',spec:{title:'Pack enough',outcome:'Prepare snacks',inputs:[],steps:[{kind:'custom',title:'Calculate portions',request:'Calculate two snacks per person for six people'}]},values:[],parentId:null});
  await workflows.active.promise;const run=workflows.get(r.runId);assert.equal(run.status,'completed');assert.equal(run.steps[0].evidence.functionOutput.portions,12);assert.equal(run.steps[0].receipt.functionVerified,true);
  f.session.state.assistantReceipts=[];run.status='paused';run.steps[0].status='running';run.steps[0].evidence=null;
  assistant.planner.decide=()=>{throw Error('Must not repeat inference');};workflows.handle('resume',{action:'continue_workflow',runId:run.id,reply:null});await workflows.active.promise;assert.equal(run.status,'completed');
});
test('provider-proposed function goes through tests before application commit and excludes unrelated actions',async t=>{
  const f=fixture(t),assistant=new Assistant({session:f.session,planner:{decide:async()=>decision(create())}});assistant.functions=f.functions;
  assert.equal((await assistant.execute('spoken','Calculate my party portions')).functionVerified,true);
  assistant.planner.decide=async()=>({...decision(create()),actions:[create(),{action:'add_todo',text:'Unexpected'}]});
  await assert.rejects(assistant.execute('mixed','Make a function'),/one available/);assert.equal(f.session.state.todos.length,0);
});
test('function renderer escapes text, pages two blocks, preserves zero, and has no mirror controls',async t=>{
  const f=fixture(t);await f.functions.handle('render',create(spec(),{people:0}));const state=structuredClone(f.session.state);
  state.customView.spec.title='<img src=x onerror=bad>';state.customView.spec.layout.blocks.push({kind:'note',label:'Extra',key:'note'});
  const context={window:{}};runInNewContext(readFileSync(new URL('../public/function-ui.js',import.meta.url),'utf8'),context);
  const mirror=context.window.GlassFunction.render(state,false),remote=context.window.GlassFunction.render(state,true);
  assert.match(mirror,/&lt;img/);assert.match(mirror,/>0<span/);assert.doesNotMatch(mirror,/<form|<button|<input|onerror=bad>/);assert.doesNotMatch(mirror,/>Extra</);assert.match(remote,/Calculate locally/);
  state.customView.page=1;assert.match(context.window.GlassFunction.render(state,false),/>Extra</);
  assert.doesNotMatch(readFileSync(new URL('../public/function-ui.js',import.meta.url),'utf8'),/\b(?:const|let)\b|=>/);
});
test('companion controls submit typed values and recover after request failure',()=>{
  const handlers={},requests=[],status={textContent:''};
  function XHR(){requests.push(this);this.open=()=>{};this.setRequestHeader=()=>{};this.send=body=>{this.body=JSON.parse(body);};}
  runInNewContext(readFileSync(new URL('../public/function-controls.js',import.meta.url),'utf8'),{
    window:{addEventListener:(name,fn)=>{handlers[name]=fn;}},
    document:{addEventListener:(name,fn)=>{handlers[name]=fn;},getElementById:()=>status},XMLHttpRequest:XHR,
  });
  handlers['workflow-state']({detail:{revision:7,customView:{spec:spec()}}});
  const event={preventDefault(){},target:{hasAttribute:()=>true,getAttribute:()=> 'saved-function',elements:{people:{value:'9'}}}};
  handlers.submit(event);assert.equal(requests.length,1);assert.equal(requests[0].body.revision,7);
  assert.equal(requests[0].body.command.inputJSON,'{"people":9}');
  handlers.submit(event);assert.equal(requests.length,1);
  requests[0].status=409;requests[0].responseText='{"error":"State changed"}';requests[0].onload();assert.equal(status.textContent,'State changed');
  handlers.submit(event);assert.equal(requests.length,2);requests[1].status=200;requests[1].onload();assert.equal(status.textContent,'');
});
test('function HTTP endpoint requires loopback same-origin JSON and rejects unrelated operations',async t=>{
  const origins=[],app=createApp({origins});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const origin='http://127.0.0.1:'+app.server.address().port;origins.push(origin);
  const body={requestId:'http',command:create()};
  assert.equal((await fetch(origin+'/api/functions',{method:'POST',body:JSON.stringify(body)})).status,403);
  const result=await fetch(origin+'/api/functions',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(result.status,200);const receipt=await result.json();assert.equal(receipt.functionVerified,true);
  const invalid=await fetch(origin+'/api/functions',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:'bad',command:{action:'add_todo',text:'not here'}})});assert.equal(invalid.status,409);assert.equal(app.session.state.todos.length,0);
  app.session.state.playroom={kind:'animals'};await assert.rejects(app.functions.handle('child',create()),/unavailable/);
});
