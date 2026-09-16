import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {validateDecision,matches,plannerDecisionSchema} from '../assistant-contract.mjs';
import {analyzeQuickAction,promoteQuickAction} from '../quick-actions.mjs';
import {Telemetry} from '../telemetry.mjs';
const decision=(actions,extra={})=>({status:'execute',outcome:'Manage timer',message:'Done',actions,options:[],selectedOptionId:null,quickAction:'cancel_only_timer',...extra});
const timer=s=>{s.command('start_timer',{seconds:30});return s.state.timers.at(-1).id;};

test('explicit single-timer cancellation accepts framing and checks current context',()=>{
  const s=new Session(),id=timer(s);
  for(const phrase of ['clear the timer','Cancel my timer.','Thanks. Now stop the timer please','Could you remove the timer for me?']){
    assert.deepEqual(analyzeQuickAction(phrase,s.state).action,{action:'cancel_timer',id},phrase);
  }
  for(const phrase of ['do not clear the timer','maybe clear the timer','clear the timer and show time','clear the second timer','cancel it','clear the timer card','hide the timer','clear my tea timer','I wish you would clear the timer','if it rings clear the timer'])assert.equal(analyzeQuickAction(phrase,s.state).action,null,phrase);
  s.state.assistant={status:'clarify'};assert.equal(analyzeQuickAction('clear the timer',s.state).reason,'pending_clarification');
  s.state.assistant=null;timer(s);assert.equal(analyzeQuickAction('clear the timer',s.state).reason,'ambiguous_target');
  s.state.timers=[];assert.equal(analyzeQuickAction('clear the timer',s.state).action,null);
});

test('successful model nomination learns once, survives restart, and resolves a NEW timer ID',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'glass-quick-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'state.json'),s=new Session({file}),oldId=timer(s),telemetry=new Telemetry();
  t.after(()=>telemetry.close());let calls=0;
  const assistant=new Assistant({session:s,telemetry,planner:{decide:async()=>{calls++;return decision([{action:'cancel_timer',id:'timer_1'}]);}}});
  assert.equal(analyzeQuickAction('get rid of the timer',s.state).action,null);
  await assistant.execute('learn','get rid of the timer');
  await assistant.execute('learn','get rid of the timer');
  assert.equal(calls,1);assert.equal(s.state.timers.length,0);assert.equal(s.state.quickActions.length,1);
  assert.equal(JSON.stringify(s.state.quickActions).includes(oldId),false);
  const events=telemetry.records.filter(r=>r.event==='quick_action.promoted');
  assert.equal(events.length,1);assert.deepEqual(events[0].attributes,{template:'cancel_only_timer',source:'learned'});
  const reloaded=new Session({file}),newId=timer(reloaded);
  const route=analyzeQuickAction('Please get rid of the timer.',reloaded.state);
  assert.equal(route.source,'learned');assert.deepEqual(route.action,{action:'cancel_timer',id:newId});assert.notEqual(oldId,newId);
  assert.equal(analyzeQuickAction('get rid of the timer',reloaded.state,{learned:false}).action,null);
  timer(reloaded);assert.equal(analyzeQuickAction('get rid of the timer',reloaded.state).action,null);
});

test('promotion is a constrained nomination, not a model-authored executable or arbitrary target cache',()=>{
  const s=new Session(),id=timer(s),base=decision([{action:'cancel_timer',id}]);
  assert.ok(promoteQuickAction(s.state,base,'ditch the timer',1000));
  for(const [d,text] of [
    [{...base,quickAction:null},'ditch the timer'],
    [{...base,quickAction:'show_panel'},'ditch the timer'],
    [{...base,actions:[...base.actions,{action:'show',panel:'home'}]},'ditch the timer'],
    [{...base,selectedOptionId:id},'ditch the timer'],
    [{...base,actions:[{action:'cancel_timer',id:'old-id'}]},'ditch the timer'],
    [base,'ditch it'],[base,'ditch the timer card'],[base,'ditch the tea timer'],[base,'do not ditch the timer'],
  ])assert.equal(promoteQuickAction(s.state,d,text,1000),null,text);
  assert.throws(()=>validateDecision({...base,quickAction:'run_code'}));
  assert.throws(()=>validateDecision({...base,quickAction:{code:'anything'}}));
  assert.equal(matches(plannerDecisionSchema,base),true);
  const {quickAction,...legacy}=base;assert.equal(matches(plannerDecisionSchema,legacy),false);assert.doesNotThrow(()=>validateDecision(legacy));
  s.state.assistant={status:'clarify'};assert.equal(promoteQuickAction(s.state,base,'ditch the timer',1000),null);
});

test('eligible panel navigation learns only matching supported destinations',()=>{
  const s=new Session();
  for(const [phrase,panel] of [['pull up my to-do list','todos'],['bring up the clock','time'],['open home','home'],['show timer list','timers']]){
    const d=decision([{action:'show',panel}],{quickAction:'show_panel'});
    s.commitDecision(phrase,s.state.revision,d,phrase);
    assert.deepEqual(analyzeQuickAction(phrase,s.state).action,{action:'show',panel});
  }
  assert.equal(promoteQuickAction(s.state,decision([{action:'show',panel:'todos'}],{quickAction:'show_panel'}),'show the clock',1),null);
  assert.equal(promoteQuickAction(s.state,decision([{action:'show',panel:'weather'}],{quickAction:'show_panel'}),'show weather',1),null);
});

test('failed storage, stale decisions and disabled learning do not leave promotions behind',()=>{
  const s=new Session(),id=timer(s),d=decision([{action:'cancel_timer',id}]);
  assert.throws(()=>s.commitDecision('stale',0,d,'ditch the timer'),/changed/);
  s.save=()=>{throw Error('disk unavailable');};
  assert.throws(()=>s.commitDecision('disk',s.state.revision,d,'ditch the timer'),/disk/);
  assert.equal(s.state.timers.length,1);assert.equal(s.state.quickActions,undefined);
  const off=new Session({learnQuickActions:false}),offId=timer(off);
  off.commitDecision('off',off.state.revision,decision([{action:'cancel_timer',id:offId}]),'ditch the timer');
  assert.equal(off.state.timers.length,0);assert.equal(off.state.quickActions,undefined);
});

test('cancelled and stale model work never promotes, even with a valid nomination',async()=>{
  const s=new Session();timer(s);let finish;
  const a=new Assistant({session:s,planner:{decide:()=>new Promise(r=>finish=r)}});
  const controller=new AbortController(),first=a.execute('cancel','ditch the timer',{signal:controller.signal});
  controller.abort();finish(decision([{action:'cancel_timer',id:'timer_1'}]));await assert.rejects(first,/cancelled/);
  const second=a.execute('stale','ditch the timer');s.command('show',{panel:'time'});
  finish(decision([{action:'cancel_timer',id:'timer_1'}]));await assert.rejects(second,/changed/);
  assert.equal(s.state.quickActions,undefined);assert.equal(s.state.timers.length,1);
});

test('repertoire is bounded, deduplicated, and incompatible template versions cannot run',()=>{
  const s=new Session();
  s.state.quickActions=Array.from({length:64},(_,i)=>({version:0,phrase:'old '+i,template:'show_panel',panel:'time'}));
  const d=decision([{action:'show',panel:'time'}],{quickAction:'show_panel'});
  s.commitDecision('one',s.state.revision,d,'bring up the clock');
  s.commitDecision('two',s.state.revision,d,'bring up the clock');
  assert.equal(s.state.quickActions.length,64);assert.equal(s.state.quickActions.filter(e=>e.phrase==='bring up the clock').length,1);
  s.state.quickActions.at(-1).version=0;assert.equal(analyzeQuickAction('bring up the clock',s.state).action,null);
});
