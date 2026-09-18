import test from 'node:test';
import assert from 'node:assert/strict';
import {Session} from '../session.mjs';
import {SurfaceRegistry} from '../assistant-contract.mjs';
import {WakeShortcuts} from '../wake-shortcuts.mjs';
import {Wake} from '../wake.mjs';
import {EventEmitter} from 'node:events';

function fixture(){
  let now=1000;const session=new Session({now:()=>now}),surfaces=new SurfaceRegistry(()=>now);
  session.command('compose_research',{board:{spec:{title:'Local test',query:'test research',layout:'briefing'},summary:'Summary',caveat:'',
    cards:Array.from({length:6},(_,i)=>({heading:'Finding '+i,kicker:'',body:'Test',detail:'',sourceIds:['one']})),
    sources:[{id:'one',title:'Source',url:'https://example.com'}]}});
  const report=(surface='mirror',visible=true,revision=session.state.revision)=>surfaces.report({clientId:surface,surface,visible,revision},session.state);
  const shortcuts=new WakeShortcuts({session,surfaces,now:()=>now,deadline:()=>1801000});
  return {session,surfaces,shortcuts,report,advance(ms){now+=ms;},event(command='next_page'){return {command,generation:shortcuts.profile.generation};}};
}
test('local page shortcuts commit directly, expose only available directions, debounce and reject old generations',()=>{
  const f=fixture();f.report();let p=f.shortcuts.sync(true);assert.deepEqual(p.commands,['next_page']);
  const old=f.event();assert.equal(f.shortcuts.act(old,true),true);assert.equal(f.session.state.research.page,1);
  assert.equal(f.shortcuts.profile.mask,0,'wait for display render acknowledgement');
  f.report();p=f.shortcuts.sync(true);assert.deepEqual(p.commands,['next_page','previous_page']);
  assert.equal(f.shortcuts.act(old,true),false);assert.equal(f.shortcuts.act(f.event(),true),false,'debounce');
  f.advance(1500);assert.equal(f.shortcuts.act(f.event(),true),true);f.report();p=f.shortcuts.sync(true);
  assert.deepEqual(p.commands,['previous_page']);assert.equal(f.session.state.research.page,2);
  f.advance(1500);assert.equal(f.shortcuts.act(f.event('previous_page'),true),true);assert.equal(f.session.state.research.page,1);
});
test('shortcuts require explicit arming and a fresh, visible, current mirror, not just companion',()=>{
  const f=fixture();f.report('companion');assert.equal(f.shortcuts.sync(true).mask,0);
  f.report();assert.equal(f.shortcuts.sync(false).mask,0);assert.equal(f.shortcuts.sync(true).mask,1);
  const old=f.event();f.report('mirror',false);assert.equal(f.shortcuts.act(old,true),false);
  f.report();f.shortcuts.sync(true);f.advance(15001);assert.equal(f.shortcuts.act(f.event(),true),false);
  f.report();f.shortcuts.sync(true);f.session.command('research_page',{direction:'next'});
  assert.equal(f.shortcuts.act(f.event(),true),false,'stale render revision');
});
test('reading beyond two minutes retains shortcuts but never extends the explicit arming deadline',()=>{
  const f=fixture();f.report();assert.equal(f.shortcuts.sync(true).expiresAt,1801000);
  f.advance(600000);f.report();assert.equal(f.shortcuts.sync(true).mask,1);
  f.session.command('research_page',{direction:'next'});f.report();assert.equal(f.shortcuts.sync(true).mask,3);
  f.advance(1200000);f.report();assert.equal(f.shortcuts.sync(true).mask,0);
  assert.equal(f.shortcuts.act(f.event(),true),false);
  f.session.command('research_page',{direction:'previous'});f.report();assert.equal(f.shortcuts.sync(true).mask,0);
});
test('panel changes, clarification, disarm and unknown commands fail closed without mutation',()=>{
  const f=fixture();f.report();f.shortcuts.sync(true);const old=f.event();
  assert.equal(f.shortcuts.act({command:'delete_everything',generation:old.generation},true),false);
  assert.equal(f.shortcuts.act(old,false),false);assert.equal(f.session.state.research.page,0);
  f.shortcuts.sync(true);f.session.state.assistant={status:'clarify'};assert.equal(f.shortcuts.act(f.event(),true),false);
  f.session.state.assistant=null;f.shortcuts.sync(true);f.session.command('show',{panel:'home'});f.report();assert.equal(f.shortcuts.act(f.event(),true),false);
  f.shortcuts.clear();assert.equal(f.shortcuts.profile.mask,0);
});
test('detector shortcut turns the page without starting voice; disarm and test-only mode cannot execute it',async t=>{
  const f=fixture(),detector=new EventEmitter(),mirror=new EventEmitter();
  Object.assign(detector,{lastProgress:Date.now(),start:async()=>{},reset(){},close(){},setShortcuts(mask,generation){this.profile={mask,generation};}});
  Object.assign(mirror,{status:()=>({wakeCapable:true}),standby(){},stop(){}});
  const voice={session:f.session,state:{phase:'off'},active:null,calls:0,start(){this.calls++;}};
  const wake=new Wake({voice,mirror,surfaces:f.surfaces,detectorFactory:()=>detector});t.after(()=>wake.close());
  f.report();await wake.enable();assert.equal(detector.profile.mask,1);
  detector.emit('shortcut',{command:'next_page',generation:detector.profile.generation});
  assert.equal(f.session.state.research.page,1);assert.equal(voice.calls,0);
  await wake.disable();f.report();detector.emit('shortcut',{command:'next_page',generation:detector.profile.generation});assert.equal(f.session.state.research.page,1);
  await wake.enable({test:true});assert.equal(wake.state.shortcuts.length,0);
});
