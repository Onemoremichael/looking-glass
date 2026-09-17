import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ApiBudget,budgetAllocation} from '../api-budget.mjs';
import {AgentsPlanner} from '../agents-planner.mjs';
function fixture(t,runs){const dir=mkdtempSync(join(tmpdir(),'glass-budget-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'budget.json');writeFileSync(path,JSON.stringify({approvedUSD:25,runs}));return {budget:new ApiBudget(path),read:()=>JSON.parse(readFileSync(path,'utf8'))};}
test('reported spend replaces covered estimates, retaining every run and unresolved hold',t=>{
  const runs=[{id:'closed',kind:'agents-decision',status:'closed',estimatedUSD:23.5},{id:'unknown',kind:'live-handshake',status:'unconfirmed',reservedUSD:.5}];
  const f=fixture(t,runs);assert.equal(budgetAllocation(f.read()),24);
  assert.deepEqual(f.budget.reconcile({reportedUSD:2,evidence:'User reports dashboard total $2'}),{approvedUSD:25,allocatedUSD:2.5});
  assert.deepEqual(f.read().runs,runs);f.budget.reserve();assert.equal(budgetAllocation(f.read()),3);
});
test('known completed agent usage releases the flat hold but includes tokens and tools',t=>{
  const f=fixture(t,[]),id=f.budget.reserve('agents-decision');
  f.budget.finishAgent(id,{complete:true,cleaned:true,model:'gpt-5.4-mini',webSearchCalls:2,usage:{input_tokens:10000,output_tokens:1000}});
  assert.equal(f.read().runs[0].estimatedUSD,.032);assert.equal(f.read().runs[0].reservedUSD,.5);
  assert.equal(f.read().runs[0].accountingBasis,'usage_estimate');
  f.budget.finishAgent(id,{complete:true,cleaned:true,model:'gpt-5.4-mini',webSearchCalls:0,usage:{input_tokens:1e6,output_tokens:1e6}});
  assert.equal(f.read().runs[0].estimatedUSD,5.25,'Actual estimates may exceed the initial reservation');
});
test('missing usage, invalid counts, unknown prices or incomplete cleanup never release holds',t=>{
  for(const patch of [{usage:null},{usage:{input_tokens:-1,output_tokens:1}},{model:'unknown'},{webSearchCalls:undefined},{complete:false},{cleaned:false}]){
    const f=fixture(t,[]),id=f.budget.reserve('agents-decision');
    f.budget.finishAgent(id,{complete:true,cleaned:true,model:'gpt-5.4-mini',webSearchCalls:0,usage:{input_tokens:1000,output_tokens:100},...patch});
    assert.equal(budgetAllocation(f.read()),.5);assert.equal(f.read().runs[0].accountingBasis,'reservation_hold');
  }
});
test('legacy runs without IDs cannot accidentally cover future anonymous diagnostics',t=>{
  const f=fixture(t,[{status:'closed',estimatedUSD:0}]);f.budget.reconcile({reportedUSD:2,evidence:'Report'});
  const b=f.read();b.runs.push({status:'closed',estimatedUSD:.1});assert.equal(budgetAllocation(b),2.1);
});
test('planner reads nested terminal usage or retrieves it once before cleanup',async()=>{
  for(const mode of ['nested','retrieve','unavailable']){
    const usage={input_tokens:1234,output_tokens:99};let reads=0,settled,deleted=false;
    const decision={status:'answer',outcome:'Reply',message:'Hello',actions:[],options:[],selectedOptionId:null,quickAction:null};
    const stream={controller:{abort(){}},async *[Symbol.asyncIterator](){yield {type:'agent.session.created',session:{id:'s'}};yield {type:'agent.session.turn.output_text.done',text:JSON.stringify({decision})};yield {type:'agent.session.turn.completed',turn_id:'t',turn:{usage:mode==='nested'?usage:null}};}};
    const planner=new AgentsPlanner({client:{beta:{agents:{sessions:{create:async()=>stream,delete:async()=>{deleted=true;},turns:{retrieve:async(id,params,options)=>{reads++;assert.equal(deleted,false);assert.equal(id,'t');assert.equal(params.session_id,'s');assert.equal(options.maxRetries,0);if(mode==='unavailable')throw Error('No usage');return {status:'completed',usage};}}}}}},budget:{reserve:()=>1,finishAgent(id,data){settled=data;}}});
    await planner.decide({});await planner.drain();assert.equal(deleted,true);assert.equal(reads,mode==='nested'?0:1);
    assert.equal(settled.model,'gpt-5.4-mini');assert.equal(settled.webSearchCalls,0);assert.deepEqual(settled.usage,mode==='unavailable'?null:usage);
  }
});
test('pending work blocks reconciliation and invalid reports leave ledger unchanged',t=>{
  const f=fixture(t,[{id:'pending',status:'pending',reservedUSD:.5}]),before=f.read();
  assert.throws(()=>f.budget.reconcile({reportedUSD:2,evidence:'Report'}),/pending/);
  for(const reportedUSD of [-1,NaN,Infinity,'2'])assert.throws(()=>f.budget.reconcile({reportedUSD,evidence:'Report'}));
  assert.deepEqual(f.read(),before);
});
test('new work and later settlement still count, and original limit cannot be bypassed',t=>{
  const f=fixture(t,[{id:'unknown',status:'unconfirmed',reservedUSD:.5}]);
  f.budget.reconcile({reportedUSD:24,evidence:'Report'});
  const id=f.budget.reserve();assert.equal(budgetAllocation(f.read()),25);assert.throws(()=>f.budget.reserve(),/exhausted/);
  f.budget.finish(id,60);assert.equal(budgetAllocation(f.read()),24.55);
  f.budget.finish('unknown',60);assert.equal(budgetAllocation(f.read()),24.1);
  f.budget.reconcile({reportedUSD:24.1,evidence:'Updated report'});assert.equal(f.read().reconciliations.length,2);assert.equal(f.read().approvedUSD,25);
});
