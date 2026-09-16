import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ApiBudget} from '../api-budget.mjs';
import {AgentsPlanner} from '../agents-planner.mjs';
import {closeAgentSession,assistantFailureMessage,recoveryError} from '../agent-recovery.mjs';
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'agent-recovery-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'budget.json');writeFileSync(path,JSON.stringify({approvedUSD:25,runs:[]}));
  const budget=new ApiBudget(path),id=budget.reserve('agents-decision');
  budget.identifyAgent(id,'owned-session');budget.finishAgent(id,{complete:false,cleaned:false});
  return {budget,id,read:()=>JSON.parse(readFileSync(path)).runs};
}
const http=status=>Object.assign(Error('HTTP failure'),{status});
test('lost deletion response is reconciled by retrieval; no inference is retried',async()=>{
  const calls=[];const result=await closeAgentSession({
    events:{create:async(id,body)=>{assert.equal(id,'owned');assert.equal(body.events[0].type,'agent.session.input.cancel');calls.push('cancel');}},
    delete:async()=>{calls.push('delete');throw Error('connection lost');},
    retrieve:async()=>{calls.push('retrieve');throw http(404);},
  },'owned');
  assert.equal(result.cleaned,true);assert.deepEqual(calls,['cancel','delete','retrieve']);
});
test('fresh planner recovers saved session before reservation, without refunding allowance',async t=>{
  const f=fixture(t),calls=[];
  const planner=new AgentsPlanner({budget:f.budget,client:{beta:{agents:{sessions:{
    retrieve:async id=>{assert.equal(id,'owned-session');calls.push('retrieve');return {status:'idle'};},
    delete:async()=>{calls.push('delete');},
  }}}}});
  await planner.recover();assert.deepEqual(calls,['retrieve','delete']);
  const r=f.read()[0];assert.equal(r.status,'closed');assert.equal(r.complete,false);
  assert.equal(r.estimatedUSD,.5);assert.equal(r.reservedUSD,.5);assert.equal(r.recovery.evidence,'deleted');
  assert.doesNotThrow(()=>f.budget.reserve('agents-decision'));
});
test('offline or active remote sessions remain blocked; repeated attempts are bounded',async t=>{
  const f=fixture(t);let creates=0,deletes=0;
  const planner=new AgentsPlanner({budget:f.budget,client:{beta:{agents:{sessions:{
    retrieve:async()=>({status:'in_progress'}),events:{create:async()=>{}},
    delete:async()=>{deletes++;throw http(409);},create:async()=>{creates++;},
  }}}}});
  await assert.rejects(planner.decide({}),{code:'agent_recovery_required'});
  await assert.rejects(planner.decide({}),{code:'agent_recovery_required'});
  assert.equal(creates,0);assert.equal(deletes,2);assert.equal(f.read()[0].status,'unconfirmed');
  assert.equal(f.read()[0].estimatedUSD,.5);
});
test('missing remote session closes only its own reservation',async t=>{
  const f=fixture(t);let deletes=0;
  const planner=new AgentsPlanner({budget:f.budget,client:{beta:{agents:{sessions:{
    retrieve:async()=>{throw http(404);},delete:async()=>deletes++,
  }}}}});
  await planner.recover();assert.equal(deletes,0);assert.equal(f.read()[0].recovery.evidence,'not_found');
});
test('pending owner or missing ID never triggers remote cancellation',async t=>{
  const f=fixture(t);f.budget.change(b=>{b.runs[0].status='pending';});
  const planner=new AgentsPlanner({budget:f.budget,client:{}});
  await assert.rejects(planner.recover(),{code:'agent_recovery_required'});
  f.budget.change(b=>{b.runs[0].status='unconfirmed';delete b.runs[0].sessionId;});
  await assert.rejects(planner.recover(),{code:'agent_recovery_required'});
});
test('cancellation during recovery prevents any new paid reservation or inference',async t=>{
  const f=fixture(t),controller=new AbortController();let creates=0;
  const planner=new AgentsPlanner({budget:f.budget,client:{beta:{agents:{sessions:{
    retrieve:async()=>({status:'idle'}),delete:async()=>{controller.abort();},create:async()=>creates++,
  }}}}});
  await assert.rejects(planner.decide({},{signal:controller.signal}),/cancelled/);
  assert.equal(creates,0);assert.equal(f.read().length,1);assert.equal(f.read()[0].status,'closed');
});
test('recovery and allowance failures explain why repetition cannot fix the request',()=>{
  assert.match(assistantFailureMessage(recoveryError()),/previous planning session/);
  assert.doesNotMatch(assistantFailureMessage(recoveryError()),/display may have changed|Please try again/);
  assert.match(assistantFailureMessage({code:'test_budget_exhausted'}),/budget review/);
});
