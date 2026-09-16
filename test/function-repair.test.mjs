import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {CustomFunctions,FunctionCheckError} from '../custom-functions.mjs';
import {canRepairFunction,validateFunctionRepair} from '../function-repair.mjs';
import {AgentsPlanner} from '../agents-planner.mjs';
import {Telemetry} from '../telemetry.mjs';
import {assistantFailureMessage} from '../agent-recovery.mjs';
import {trackTaskProgress} from '../task-progress.mjs';
import {ApiBudget} from '../api-budget.mjs';

export const calculation=()=>({action:'create_function',parentId:null,inputJSON:'{"people":6}',spec:{
  title:'Picnic snacks',outcome:'Pack two snacks for each person',inputs:[{name:'people',label:'People',type:'number'}],
  code:'input => ({snacks: input.people * 3})',
  tests:[{inputJSON:'{"people":4}',expectedJSON:'{"snacks":8}'},{inputJSON:'{"people":0}',expectedJSON:'{"snacks":0}'}],
  layout:{accent:'peach',blocks:[{kind:'metric',label:'Snacks',key:'snacks',unit:'pieces'}]},
}});
const decision=action=>({status:'execute',outcome:'Pack snacks',message:'Requested',actions:[action],options:[],selectedOptionId:null,quickAction:null});
const corrected=action=>({...action,spec:{...action.spec,code:'input => ({snacks: input.people * 2})'}});
function fixture(t,{first=calculation(),repair,functionsOptions={}}={}){
  const dir=mkdtempSync(join(tmpdir(),'glass-repair-')),session=new Session({file:join(dir,'state.json')}),telemetry=new Telemetry({file:join(dir,'trace.jsonl')});
  const functions=new CustomFunctions({session,telemetry,...functionsOptions}),contexts=[];
  const assistant=new Assistant({session,telemetry,planner:{decide:async context=>{contexts.push(structuredClone(context));return contexts.length===1?decision(first):repair?repair(context):decision(corrected(context.functionRepair.original));}}});assistant.functions=functions;
  t.after(async()=>{await functions.close();await telemetry.close();session.close();rmSync(dir,{recursive:true,force:true});});
  return {session,telemetry,functions,assistant,contexts,dir};
}
test('failed model code receives real checker feedback, repairs once, then saves and reuses with new inputs',async t=>{
  const f=fixture(t),stages=[];const r=await f.assistant.execute('build','Pack snacks for six people',{onProgress:p=>stages.push(p.stage)});
  assert.equal(r.functionVerified,true);assert.equal(r.functionOutput.snacks,12);assert.equal(f.contexts.length,2);
  const context=f.contexts[1];assert.deepEqual(Object.keys(context).sort(),['customFunctions','functionRepair']);
  assert.deepEqual(context.functionRepair.diagnostic,{check:'example_mismatch',caseIndex:0,actual:{snacks:12}});
  assert.ok(stages.includes('repairing_function'));assert.ok(stages.includes('testing_function'));
  assert.equal(f.session.state.reusableViews.length,1);assert.equal(f.session.state.assistantReceipts.length,1);
  assert.equal(f.session.state.reusableViews[0].spec.code,corrected(calculation()).spec.code);
  await f.assistant.execute('build','Pack snacks for six people');assert.equal(f.contexts.length,2);
  const reused=await f.assistant.execute('fresh','Pack snacks for nine people');assert.equal(reused.functionOutput.snacks,18);assert.equal(f.contexts.length,2);
  const events=f.telemetry.records.filter(r=>r.event==='function.repair');assert.deepEqual(events.map(r=>r.attributes.repair_state),['started','verified']);
  assert.doesNotMatch(readFileSync(join(f.dir,'trace.jsonl'),'utf8'),/input.people|snacks|expectedJSON/);
});
test('sandbox syntax and layout failures qualify for one code-only repair',async t=>{
  for(const code of ['input => (','input => ({snacks: []})']){
    const first=calculation();first.spec.code=code;const f=fixture(t,{first});
    const r=await f.assistant.execute('build','Pack snacks for six people');assert.equal(r.functionOutput.snacks,12);
    assert.ok(['runtime_rejected','output_contract'].includes(f.contexts[1].functionRepair.diagnostic.check));
    assert.equal(f.contexts[1].functionRepair.diagnostic.actual,undefined);
  }
});
test('verified estimate wording promotes a fresh-value route without accepting negation',async t=>{
  const f=fixture(t);await f.assistant.execute('build','Estimate snacks for six people');
  assert.equal((await f.assistant.execute('again','Estimate snacks for nine people')).functionOutput.snacks,18);
  assert.equal(f.contexts.length,2);
  f.assistant.planner.decide=()=>{throw Error('Planner fallback expected');};
  await assert.rejects(f.assistant.execute('negated','Do not estimate snacks for ten people'),/Planner fallback/);
  assert.equal(f.session.state.customView.output.snacks,18);
});
test('repair cannot weaken tests, change inputs/layout/parent, or perform unrelated actions',async t=>{
  const variants=[a=>{a.spec.tests[0].expectedJSON='{"snacks":12}';},a=>{a.inputJSON='{"people":1}';},a=>{a.spec.layout.blocks[0].label='Other';},a=>{a.parentId='another';},a=>{a.spec.outcome='Different task';}];
  for(const change of variants){const f=fixture(t,{repair:c=>{const a=corrected(c.functionRepair.original);change(a);return decision(a);}});
    await assert.rejects(f.assistant.execute('build','Build picnic portions'),{code:'function_repair_invalid'});
    assert.equal(f.session.state.reusableViews.length,0);assert.equal(f.session.state.customView,undefined);assert.equal(f.contexts.length,2);
  }
  for(const candidate of [{action:'add_todo',text:'Unrelated'},calculation()])assert.throws(()=>validateFunctionRepair(calculation(),decision(candidate)),{code:'function_repair_invalid'});
});
test('second failed implementation ends without a third paid planning attempt or saved result',async t=>{
  const f=fixture(t,{repair:c=>decision({...c.functionRepair.original,spec:{...c.functionRepair.original.spec,code:'input => ({snacks: input.people * 4})'}})});
  let error;try{await f.assistant.execute('build','Build picnic portions');}catch(e){error=e;}
  assert.equal(error.code,'function_check_failed');assert.equal(f.contexts.length,2);assert.equal(f.session.state.reusableViews.length,0);
  assert.match(assistantFailureMessage(error),/not saved any changes/);
});
test('existing recipe failure, host failures and cancellation never qualify for paid repair',()=>{
  const check=new FunctionCheckError('check',{check:'runtime_rejected'});
  assert.equal(canRepairFunction({action:'run_function'},check),false);
  for(const error of [Error('disk full'),Error('Function exceeded its execution limit'),Object.assign(Error('fake'),{code:'function_check_failed',diagnostic:{check:'runtime_rejected'}})])assert.equal(canRepairFunction(calculation(),error),false);
});
test('successful first implementation needs no repair, and persistence failure never calls the model again',async t=>{
  const f=fixture(t,{first:corrected(calculation())});await f.assistant.execute('good','Pack snacks for six people');assert.equal(f.contexts.length,1);
  const g=fixture(t,{first:corrected(calculation())});g.session.save=()=>{throw Error('disk full');};
  await assert.rejects(g.assistant.execute('disk','Pack snacks for six people'),/disk full/);assert.equal(g.contexts.length,1);assert.equal(g.session.state.reusableViews.length,0);
});
test('input and specification failures do not start a repair turn',async t=>{
  for(const invalid of [{...calculation(),inputJSON:'{"people":"six"}'},{...calculation(),spec:{...calculation().spec,tests:[calculation().spec.tests[0],calculation().spec.tests[0]]}}]){
    const f=fixture(t,{first:invalid});await assert.rejects(f.assistant.execute('invalid','Build picnic portions'));assert.equal(f.contexts.length,1);
  }
});
test('budget or provider failure on repair preserves current result and has no automatic retry',async t=>{
  const f=fixture(t,{repair:()=>{throw Object.assign(Error('allowance'),{code:'test_budget_exhausted'});}});
  const before=structuredClone(f.session.state);
  await assert.rejects(f.assistant.execute('build','Build picnic portions'),{code:'test_budget_exhausted'});
  assert.equal(f.contexts.length,2);assert.deepEqual(f.session.state,before);
});
test('navigation or cancellation after checker failure prevents a repair planning call',async t=>{
  for(const cancel of [false,true]){
    const f=fixture(t),controller=new AbortController();let boundaries=0;
    await assert.rejects(f.assistant.execute('build','Build picnic portions',{signal:controller.signal,beforeCommit:async()=>{
      if(++boundaries===2){if(cancel)controller.abort();else f.session.command('show',{panel:'home'});}
    }}));
    assert.equal(f.contexts.length,1);assert.equal(f.session.state.reusableViews.length,0);
  }
});
test('correction during repair cannot commit its late code and does not mutate its original contract',async t=>{
  let release,entered;const ready=new Promise(r=>entered=r);
  const f=fixture(t,{repair:c=>{entered();return new Promise(r=>release=()=>r(decision(corrected(c.functionRepair.original))));}});
  const controller=new AbortController(),work=f.assistant.execute('build','Build picnic portions',{signal:controller.signal});
  const rejected=assert.rejects(work,/cancelled/);await ready;controller.abort();release();await rejected;
  assert.equal(f.session.state.reusableViews.length,0);assert.equal(f.contexts[1].functionRepair.original.spec.code,calculation().spec.code);
});
test('repair uses the ordinary Agents budget but has no web tools or environment',async()=>{
  let creates=0,reserves=0,closes=0;
  const d=decision(corrected(calculation()));
  const planner=new AgentsPlanner({client:{beta:{agents:{sessions:{create:async body=>{
    creates++;assert.deepEqual(body.agent.tools,[]);assert.equal(body.environment.type,'none');assert.match(body.agent.instructions,/one code-only repair/);
    return {controller:{abort(){}},async *[Symbol.asyncIterator](){yield {type:'agent.session.turn.output_text.done',text:JSON.stringify({decision:d}),session_id:'repair-fixture'};yield {type:'agent.session.turn.completed'};}};
  },delete:async()=>{closes++;}}}}},budget:{reserve:()=>{reserves++;return 'reservation';},finishAgent(){}}});
  await planner.decide({functionRepair:{attempt:1}});await planner.drain();assert.equal(creates,1);assert.equal(reserves,1);assert.equal(closes,1);
});
test('the real allowance prevents a second provider call when first generation uses the last reservation',async t=>{
  const f=fixture(t),path=join(f.dir,'budget.json');writeFileSync(path,JSON.stringify({approvedUSD:25,runs:[]}));
  const budget=new ApiBudget(path);for(let i=0;i<49;i++)budget.reserve('other-fixture');let calls=0;
  const planner=new AgentsPlanner({budget,client:{beta:{agents:{sessions:{
    create:async()=>{calls++;return {controller:{abort(){}},async *[Symbol.asyncIterator](){
      yield {type:'agent.session.turn.output_text.done',text:JSON.stringify({decision:decision(calculation())}),session_id:'fixture'};
      yield {type:'agent.session.turn.completed'};
    }};},delete:async()=>{},
  }}}}});f.assistant.planner=planner;
  await assert.rejects(f.assistant.execute('build','Build picnic portions'),{code:'test_budget_exhausted'});await planner.drain();
  assert.equal(calls,1);assert.equal(f.session.state.reusableViews.length,0);
  const ledger=JSON.parse(readFileSync(path));assert.equal(ledger.approvedUSD,25);assert.equal(ledger.runs.length,50);
  assert.equal(ledger.runs.at(-1).status,'closed');
});
test('waiting speech receives honest testing and repair stages, not a completion claim',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});const events=[];
  const tracker=trackTaskProgress({send:s=>events.push(JSON.parse(s)),isCurrent:()=>true});
  tracker.update({stage:'testing_function'});t.mock.timers.tick(1800);assert.equal(events[0].stage,'testing_function');
  tracker.update({stage:'repairing_function'});t.mock.timers.tick(8200);assert.equal(events[1].stage,'repairing_function');assert.equal(events[1].resultReady,false);tracker.stop();
});
