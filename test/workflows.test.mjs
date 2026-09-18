import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {Workflows,validateWorkflowSpec,bindWorkflow,workflowIntent} from '../workflows.mjs';
import {createApp} from '../server.mjs';
import {ImageStudio} from '../image-studio.mjs';
import {SurfaceRegistry} from '../assistant-contract.mjs';
import {Telemetry} from '../telemetry.mjs';
const step=(kind,request,title=request)=>({kind,request,title});
const spec=(steps)=>({title:'Weekend plan',outcome:'Be ready for the weekend',inputs:[],steps});
const decision=(actions,message='Proposed')=>({status:actions.length?'execute':'answer',outcome:'Prepare the requested result',message,actions,options:[],selectedOptionId:null});
const todo=()=>decision([{action:'add_todo',text:'Pack a picnic'}]);
function fixture(t,decide=todo){
  const dir=mkdtempSync(join(tmpdir(),'glass-workflows-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const session=new Session({file:join(dir,'state.json')});let calls=0;
  const telemetry=new Telemetry();t.after(()=>telemetry.close());
  const assistant=new Assistant({session,telemetry,planner:{decide:async c=>{calls++;return decide(c);}}});
  const workflows=new Workflows({session,assistant,telemetry});assistant.workflows=workflows;
  return {dir,session,assistant,workflows,telemetry,calls:()=>calls};
}
async function settle(w){if(w.active)await w.active.promise;}
function create(f,s=spec([step('todos','Add packing items'),step('confirm','Pack your bag')]),values=[]){return f.workflows.handle('create',{action:'create_workflow',spec:s,values,parentId:null});}
test('research lookup exhaustion is actionable without exposing raw provider details',async t=>{
  const f=fixture(t,()=>{throw Object.assign(Error('PRIVATE provider payload'),{code:'research_limit'});});
  const r=create(f,spec([step('research','Find events')]));await settle(f.workflows);
  const run=f.workflows.get(r.runId);assert.equal(run.status,'blocked');assert.match(run.detail,/lookup limit/);assert.doesNotMatch(JSON.stringify(run),/PRIVATE/);
});
test('multi-step run records actual tool results, waits for human confirmation and persists',async t=>{
  const f=fixture(t),r=create(f);await settle(f.workflows);
  let run=f.workflows.get(r.runId);assert.equal(run.status,'needs_input');assert.equal(run.steps[0].status,'completed');assert.equal(run.steps[1].status,'needs_input');
  assert.deepEqual(run.steps[0].evidence.todoIds,[f.session.state.todos[0].id]);assert.equal(f.session.state.reusableViews[0].kind,'workflow');
  assert.throws(()=>f.workflows.handle('confirm',{action:'confirm_workflow_step',runId:run.id,stepId:run.steps[1].id}),/confirmation/);
  f.workflows.handle('confirm',{action:'confirm_workflow_step',runId:run.id,stepId:run.steps[1].id},{utterance:'I packed the bag'});await settle(f.workflows);
  run=new Session({file:f.session.file}).state.workflows[0];assert.equal(run.status,'completed');assert.equal(run.steps[1].evidence.type,'user_confirmation');assert.equal(f.calls(),1);
  assert.equal(f.telemetry.snapshot().metrics['workflow.run'].count,2);
  const records=f.telemetry.snapshot().records,parent=records.find(r=>r.name==='workflow.run'&&r.kind==='start'),child=records.find(r=>r.name==='agent.decision'&&r.kind==='start');
  assert.equal(parent.traceId,child.traceId);assert.equal(parent.spanId,child.parentSpanId);assert.doesNotMatch(JSON.stringify(records),/packed the bag|Pack a picnic|Weekend plan/);
});
test('missing inputs ask once, bind fresh values on reuse, and never replay old completions',async t=>{
  const f=fixture(t,c=>decision([{action:'add_todo',text:'Pack for '+c.workflowContext.inputs[0].value}]));
  const s={...spec([step('todos','Add packing items for {{city}}')]),inputs:[{name:'city',question:'Which city?'}]};
  const r=create(f,s);assert.equal(f.workflows.get(r.runId).status,'needs_input');assert.equal(f.calls(),0);
  f.workflows.handle('inputs',{action:'provide_workflow_inputs',runId:r.runId,values:[{name:'city',value:'Gainesville'}]});await settle(f.workflows);
  const first=f.workflows.get(r.runId),again=f.workflows.handle('again',{action:'reuse_workflow',viewId:first.recipeId,values:[{name:'city',value:'Orlando'}]});await settle(f.workflows);
  assert.notEqual(again.runId,first.id);assert.equal(f.session.state.reusableViews.length,1);assert.equal(f.session.state.todos.length,2);assert.match(f.session.state.todos[1].text,/Orlando/);assert.equal(f.calls(),2);
  assert.deepEqual(workflowIntent('run Weekend plan again',f.session.state),{action:'reuse_workflow',viewId:first.recipeId,values:[]});
  assert.equal(workflowIntent('do not run Weekend plan',f.session.state),null);
});
test('structured plan rejects code-shaped placeholders and malformed or duplicate values',()=>{
  assert.throws(()=>validateWorkflowSpec(spec([])));assert.throws(()=>validateWorkflowSpec({...spec([step('shell','delete files')])}));
  assert.throws(()=>validateWorkflowSpec(spec([step('todos','Use {{unknown}}')])));
  const s={...spec([step('todos','Pack {{city}}')]),inputs:[{name:'city',question:'Where?'}]};
  assert.throws(()=>bindWorkflow(s,[{name:'city',value:'Paris'},{name:'city',value:'London'}]));assert.throws(()=>bindWorkflow(s,[{name:'city',value:'{{secret}}'}]));
  assert.throws(()=>bindWorkflow(s,[{name:'other',value:'Paris'}]));
});
test('multi-turn questions preserve context and receive a new operation ID for the answer',async t=>{
  const f=fixture(t,c=>c.utterance==='For two people'?todo():{...decision([],'How many people?'),status:'clarify',options:[{id:'two',label:'Two people'},{id:'four',label:'Four people'}]});
  const r=create(f,spec([step('todos','Add picnic supplies')]));await settle(f.workflows);let run=f.workflows.get(r.runId),op=run.steps[0].operationId;
  assert.equal(run.status,'needs_input');assert.equal(run.steps[0].options.length,2);
  f.workflows.handle('answer',{action:'continue_workflow',runId:run.id,reply:'For two people'});await settle(f.workflows);run=f.workflows.get(run.id);
  assert.equal(run.status,'completed');assert.notEqual(run.steps[0].operationId,op);assert.equal(f.session.state.todos.length,1);
});
test('scope guards reject recursive plans and unrelated mutations before any tool runs',async t=>{
  for(const action of [{action:'start_timer',seconds:10,label:'bad'},{action:'create_workflow',spec:spec([step('todos','More')]),values:[],parentId:null}]){
    const f=fixture(t,()=>decision([action]));const r=create(f,spec([step('research','Find picnic sites')]));await settle(f.workflows);
    assert.equal(f.workflows.get(r.runId).status,'blocked');assert.equal(f.session.state.timers.length,0);assert.equal(f.session.state.workflows.length,1);
  }
});
test('a completed model answer without a tool result cannot complete a step',async t=>{
  const f=fixture(t,()=>decision([],'All done!'));const r=create(f,spec([step('todos','Add supplies')]));await settle(f.workflows);
  assert.equal(f.workflows.get(r.runId).status,'blocked');assert.equal(f.workflows.get(r.runId).steps[0].evidence,null);assert.equal(f.session.state.todos.length,0);
});
test('restart pauses running work; receipts recover the commit-to-progress crash window without duplication',async t=>{
  const f=fixture(t);const r=create(f,{...spec([step('todos','Add supplies')]),inputs:[{name:'city',question:'Where?'}]});
  const run=f.workflows.get(r.runId),item=run.steps[0];run.inputQuestions=[];run.status='running';item.status='running';item.operationId='committed-before-crash';
  f.session.commitDecision(item.operationId,f.session.state.revision,todo(),'Add supplies');
  f.session.state.assistantReceipts=[];f.session.save(); // The rolling chat window may have expired.
  const session=new Session({file:f.session.file}),assistant=new Assistant({session,planner:{decide(){throw Error('Must not replan committed step');}}}),w=new Workflows({session,assistant});assistant.workflows=w;
  assert.equal(w.get(run.id).status,'paused');assert.equal(w.active,null);
  w.handle('resume',{action:'continue_workflow',runId:run.id,reply:null});await settle(w);
  assert.equal(w.get(run.id).status,'completed');assert.equal(session.state.todos.length,1);
});
test('pause aborts late planning, stale requests do not mutate, and cancellation cannot resume',async t=>{
  let resolve;const f=fixture(t,()=>new Promise(r=>resolve=r));const r=create(f,spec([step('todos','Add supplies')]));await new Promise(r=>setImmediate(r));
  const revision=f.session.state.revision;f.workflows.handle('pause',{action:'pause_workflow',runId:r.runId});resolve(todo());await settle(f.workflows);
  assert.equal(f.session.state.todos.length,0);assert.equal(f.workflows.get(r.runId).status,'paused');
  assert.throws(()=>f.workflows.handle('stale',{action:'continue_workflow',runId:r.runId,reply:null},{revision}),/changed/);
  f.workflows.handle('cancel',{action:'cancel_workflow',runId:r.runId});assert.throws(()=>f.workflows.handle('resume',{action:'continue_workflow',runId:r.runId,reply:null}),/not waiting/);
});
test('artwork acceptance waits for a completed job before progressing',async t=>{
  const f=fixture(t,()=>decision([{action:'generate_image',spec:{title:'Picnic fox',prompt:'A fox',background:'transparent'}}]));let resolve;
  const png=readFileSync(new URL('../public/assets/playroom/elephant-v1.png',import.meta.url));
  const studio=new ImageStudio({session:f.session,directory:f.dir,budget:{reserve:()=>1,finishImage:()=>{}},client:{images:{generate:()=>new Promise(r=>resolve=r)}}});f.assistant.studio=studio;f.workflows.studio=studio;
  const r=create(f,spec([step('artwork','Draw a fox')]));await new Promise(r=>setImmediate(r));
  assert.equal(f.workflows.get(r.runId).status,'running');assert.equal(f.workflows.get(r.runId).steps[0].evidence,null);
  resolve({data:[{b64_json:png.toString('base64')}]});await settle(f.workflows);assert.equal(f.workflows.get(r.runId).status,'completed');assert.equal(f.workflows.get(r.runId).steps[0].evidence.type,'artwork');
});
test('pausing an owned image step stops waiting and never advances on a late result',async t=>{
  const f=fixture(t,()=>decision([{action:'generate_image',spec:{title:'Fox',prompt:'A fox',background:'transparent'}}]));let resolve;
  const png=readFileSync(new URL('../public/assets/playroom/elephant-v1.png',import.meta.url));
  const studio=new ImageStudio({session:f.session,directory:f.dir,budget:{reserve:()=>1,finishImage:()=>{}},client:{images:{generate:()=>new Promise(r=>resolve=r)}}});f.assistant.studio=studio;f.workflows.studio=studio;
  const r=create(f,spec([step('artwork','Draw a fox'),step('todos','Add supplies')]));await new Promise(r=>setImmediate(r));
  f.workflows.handle('pause',{action:'pause_workflow',runId:r.runId});await settle(f.workflows);
  assert.equal(f.workflows.get(r.runId).status,'paused');assert.equal(f.session.state.imageJobs[0].status,'cancelled');
  resolve({data:[{b64_json:png.toString('base64')}]});await studio.active.promise;assert.equal(f.session.state.todos.length,0);assert.equal(f.workflows.get(r.runId).steps[0].evidence,null);
});
test('research evidence stays with the workflow and informs subsequent steps after a different board opens',async t=>{
  const board={spec:{title:'Local parks',query:'Parks for a picnic',layout:'comparison'},summary:'Two picnic choices.',caveat:'Offline fixture.',cards:[{heading:'Oak Park',kicker:'Option A',body:'Bring a picnic blanket.',detail:'Tables available',sourceIds:['city']}],sources:[{id:'city',title:'City parks',url:'https://www.gainesvillefl.gov/parks'}]};
  let f;f=fixture(t,c=>{if(c.workflowContext.steps[0].status!=='completed')return decision([{action:'compose_research',board}]);assert.equal(c.workflowContext.steps[0].evidence.research.cards[0].heading,'Oak Park');return todo();});
  const r=create(f,spec([step('research','Find parks'),step('confirm','Choose Oak Park and confirm'),step('todos','Add items for the chosen park')]));await settle(f.workflows);
  const run=f.workflows.get(r.runId);f.session.command('compose_research',{board:{...board,summary:'Unrelated research',cards:[{...board.cards[0],heading:'A different park'}]}});
  f.workflows.handle('confirm',{action:'confirm_workflow_step',runId:run.id,stepId:run.steps[1].id},{utterance:'Oak Park works'});await settle(f.workflows);
  assert.equal(f.workflows.get(run.id).status,'completed');assert.equal(f.session.state.todos.length,1);
});
test('numbered workflow answers resolve the current visible choice before starting another turn',async t=>{
  let f;f=fixture(t,c=>{
    if(!c.workflowContext)return {...decision([{action:'continue_workflow',runId:f.session.state.workflowId,reply:'the second one'}]),selectedOptionId:'four'};
    if(c.utterance==='Four people')return todo();
    return {...decision([],'How many people?'),status:'clarify',options:[{id:'two',label:'Two people'},{id:'four',label:'Four people'}]};
  });
  const surfaces=new SurfaceRegistry();f.assistant.surfaces=surfaces;f.session.onChange=s=>surfaces.report({clientId:'mirror',surface:'mirror',revision:s.revision,visible:true},s);
  const r=create(f,spec([step('todos','Plan picnic supplies')]));await settle(f.workflows);
  await f.assistant.execute('choice','the second one');await settle(f.workflows);
  assert.equal(f.workflows.get(r.runId).status,'completed');assert.equal(f.workflows.get(r.runId).steps[0].reply,'Four people');
});
test('unavailable weather never completes a forecast step and explicit retry can fetch again',async t=>{
  const f=fixture(t,()=>decision([{action:'get_weather',period:'now',locationId:null}]));const r=create(f,spec([step('weather','Show weather')]));await settle(f.workflows);
  assert.equal(f.workflows.get(r.runId).status,'blocked');assert.equal(f.workflows.get(r.runId).steps[0].evidence,null);
  f.workflows.handle('retry',{action:'continue_workflow',runId:r.runId,reply:null});await settle(f.workflows);assert.equal(f.calls(),0); // Built-in weather route still cannot complete without data.
});
test('failed persistence cannot create a plan or consume a paid planner call',async t=>{
  const f=fixture(t),before=structuredClone(f.session.state);f.session.save=()=>{throw Error('disk full');};
  assert.throws(()=>create(f),/disk full/);assert.deepEqual(f.session.state,before);assert.equal(f.workflows.active,null);assert.equal(f.calls(),0);
});
test('custom capability is a durable blocked step, not fabricated execution; recipe adaptation preserves originals',async t=>{
  const f=fixture(t);const r=create(f,spec([step('custom','Build an interactive packing designer')]));await settle(f.workflows);
  const first=f.workflows.get(r.runId);assert.equal(first.status,'blocked');assert.match(first.detail,/not implemented/);assert.equal(f.calls(),0);
  const adapted=f.workflows.handle('fork',{action:'create_workflow',spec:{...first.spec,title:'Simpler packing',steps:[step('confirm','Pack a bag')]},values:[],parentId:first.recipeId});await settle(f.workflows);
  assert.equal(f.session.state.reusableViews.length,2);assert.equal(f.session.state.reusableViews[1].parentId,first.recipeId);assert.equal(f.workflows.get(adapted.runId).status,'needs_input');
});
test('workflow routes are idempotent, invoke beforeCommit, and local reopening avoids the planner',async t=>{
  let calls=0;const f=fixture(t,()=>{calls++;return decision([{action:'create_workflow',spec:spec([step('confirm','Pack a bag')]),values:[],parentId:null}]);});
  const abort=new AbortController();await assert.rejects(f.assistant.execute('aborted','Make a plan',{signal:abort.signal,beforeCommit:async()=>abort.abort()}),/cancelled/);assert.equal(f.session.state.workflows,undefined);
  const r=await f.assistant.execute('one','Make a plan');await settle(f.workflows);assert.deepEqual(await f.assistant.execute('one','Make a plan'),r);assert.equal(calls,2);
  await f.assistant.execute('open','show Weekend plan workflow');assert.equal(calls,2);assert.equal(f.session.state.workflowId,r.runId);
});
test('workflow renderer is escaped ES5, output-only on mirror, with no more than three steps',async t=>{
  const f=fixture(t);create(f,spec(Array.from({length:8},(_,i)=>step('confirm','Do item '+i,'<script>item '+i+'</script>'))));await settle(f.workflows);
  const source=readFileSync(new URL('../public/workflow-ui.js',import.meta.url),'utf8'),ctx={window:{}};runInNewContext(source,ctx);const html=ctx.window.GlassWorkflow.render(f.session.state,false);
  assert.doesNotMatch(html,/<script>|<button|<input|<form/);assert.match(html,/&lt;script&gt;/);assert.equal((html.match(/<li>/g)||[]).length,3);assert.doesNotMatch(source,/\b(?:let|const)\b|=>/);
});
test('workflow HTTP requires local origin and a validated command; no unconfirmed human completion',async t=>{
  const origins=[],app=createApp({origins});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const origin='http://127.0.0.1:'+app.server.address().port;origins.push(origin);
  const command={action:'create_workflow',spec:spec([step('confirm','Pack the bag')]),values:[],parentId:null};
  const post=(body,valid=true)=>fetch(origin+'/api/workflows',{method:'POST',headers:{'content-type':'application/json',...(valid?{origin}:{})},body:JSON.stringify(body)});
  assert.equal((await post({requestId:'one',command},false)).status,403);
  const res=await post({requestId:'one',command});assert.equal(res.status,200);const {runId}=await res.json();await settle(app.workflows);
  assert.equal((await post({requestId:'bad',command:{...command,bogus:1}})).status,409);
  const stepId=app.workflows.get(runId).steps[0].id;
  assert.equal((await post({requestId:'done',command:{action:'confirm_workflow_step',runId,stepId}})).status,409);
  assert.equal((await post({requestId:'done',confirmed:true,command:{action:'confirm_workflow_step',runId,stepId}})).status,200);await settle(app.workflows);assert.equal(app.workflows.get(runId).status,'completed');
});
