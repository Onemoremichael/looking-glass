import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Session } from '../session.mjs';
import { VoiceTools, parseVoice } from '../voice-tools.mjs';
import { ApiBudget } from '../api-budget.mjs';
import { Voice } from '../voice.mjs';
import { createApp } from '../server.mjs';
import { Telemetry } from '../telemetry.mjs';

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'glass-voice-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'budget.json');writeFileSync(path,JSON.stringify({approvedUSD:25,runs:[]}));return {dir,path};
}
test('whole-request grammar accepts spoken numbers, rejects corrections and compound requests',()=>{
  assert.deepEqual(parseVoice('Set a timer for two minutes.'),{action:'start_timer',seconds:120});
  assert.deepEqual(parseVoice('Please start a five minute timer.'),{action:'start_timer',seconds:300});
  for(const text of ['Do not set a timer for two minutes','set a timer for two minutes, no three','set a timer for','cancel all timers','set a timer for 0 seconds','set a timer for two minutes and cancel it']) assert.equal(parseVoice(text),null,text);
});
test('voice tools persist receipts, resolve cancel it, refuse ambiguous cancellation',t=>{
  const {dir}=fixture(t),file=join(dir,'state.json');let session=new Session({file});let tools=new VoiceTools(session);
  tools.execute('op1','Set a timer for two minutes.');tools.execute('op1','Set a timer for two minutes.');assert.equal(session.state.timers.length,1);
  session=new Session({file});tools=new VoiceTools(session);tools.execute('op1','Set a timer for two minutes.');assert.equal(session.state.timers.length,1);
  assert.equal(tools.execute('op2','Cancel it.').status,'completed');assert.equal(session.state.timers.length,0);
  session.command('start_timer',{seconds:10});session.command('start_timer',{seconds:20});
  assert.equal(new VoiceTools(session).execute('op3','cancel it').status,'needs_input');assert.equal(session.state.timers.length,2);
});
test('to-do grammar preserves content and refuses incomplete or corrected commands',()=>{
  assert.deepEqual(parseVoice('Add Call Jean-Luc to my to-do list.'),{action:'add_todo',text:'Call Jean-Luc'});
  for(const text of ['add to my todo list','do not add milk to my todo list','add milk to my todo list and show the clock','add milk actually eggs to my todo list','add milk. Go home to my todo list']) assert.equal(parseVoice(text),null,text);
});
test('to-do voice receipts survive restart; dismissing does not cancel a timer',t=>{
  const {dir}=fixture(t),file=join(dir,'todos.json');
  let session=new Session({file}),tools=new VoiceTools(session);
  assert.equal(tools.execute('todo1','Add Call Jean-Luc to my to-do list').status,'completed');
  session=new Session({file});tools=new VoiceTools(session);
  tools.execute('todo1','Add Call Jean-Luc to my to-do list');
  assert.equal(session.state.todos.length,1);assert.equal(session.state.todos[0].text,'Call Jean-Luc');
  tools.execute('timer','set a timer for two minutes');tools.execute('dismiss','dismiss that');
  assert.equal(session.state.panel,'home');assert.equal(session.state.timers.length,1);
  tools.execute('list','show my to-do list');assert.equal(session.state.panel,'todos');
  for(const panel of ['weather','calendar']) {
    const result=tools.execute(panel,'show '+panel);
    assert.equal(session.state.panel,panel);assert.match(result.message,/No provider is connected/);
  }
});
test('reported add-and-show utterance executes once; unrelated compound actions stay rejected',()=>{
  const session=new Session(),tools=new VoiceTools(session);
  const phrase=' Add buy milk to my to-do list and then show me the to-do list';
  assert.deepEqual(parseVoice(phrase),{action:'add_todo',text:'buy milk'});
  assert.equal(tools.execute('reported',phrase).status,'completed');
  tools.execute('reported',phrase);
  assert.equal(session.state.todos.length,1);assert.equal(session.state.todos[0].text,'buy milk');assert.equal(session.state.panel,'todos');
  for(const suffix of [' and then show me the clock',' and then show me the to-do list and cancel it',' and delete everything']) assert.equal(parseVoice('Add buy milk to my to-do list'+suffix),null);
  const fallback=tools.execute('unsupported','do something else');
  assert.equal(fallback.status,'needs_input');assert.doesNotMatch(fallback.message,/timer|prototype/);assert.match(fallback.message,/Nothing was changed/);
});
test('budget retains unresolved reservations and enforces total; WebRTC minimum accounted',t=>{
  const {path}=fixture(t);const budget=new ApiBudget(path);const id=budget.reserve();budget.finish(id,0);
  assert.equal(JSON.parse(readFileSync(path)).runs[0].estimatedUSD,.0125);
  for(let i=0;i<49;i++) budget.reserve();assert.throws(()=>budget.reserve(),/exhausted/);
});
test('agent reservations retain allowance and block overlapping or unconfirmed planning',t=>{
  const {path}=fixture(t),budget=new ApiBudget(path);
  const id=budget.reserve('agents-decision');
  budget.identifyAgent(id,'test-session');
  assert.throws(()=>budget.reserve('agents-decision'),/Prior agent/);
  budget.finishAgent(id,{complete:true,cleaned:false});
  assert.throws(()=>budget.reserve('agents-decision'),/Prior agent/);
  budget.finishAgent(id,{complete:true,cleaned:true});
  const run=JSON.parse(readFileSync(path)).runs[0];
  assert.equal(run.estimatedUSD,.5);assert.equal(run.sessionId,'test-session');
  assert.doesNotThrow(()=>budget.reserve('agents-decision'));
});
class FakeSideband extends EventEmitter {
  constructor() {super();this.socket=new EventEmitter();this.socket.readyState=1;this.sent=[];setImmediate(()=>this.socket.emit('open'));}
  send(e){this.sent.push(e);if(e.type==='session.close')setImmediate(()=>this.emit('event',{type:'session.closed',usage:{seconds:5}}));}
  close(){this.socket.readyState=3;this.socket.emit('close');}
}
test('Live sideband executes once after delegation, then closes with final usage',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const {path}=fixture(t);const session=new Session();let sideband;
  const voice=new Voice({session,budgetPath:path,clientFactory:()=>({live:{create:async()=>({session:{id:'test'},transport:{sdp:'answer'}}),sessions:{hangup:async()=>{}}}}),attachFactory:()=>sideband=new FakeSideband()});
  t.after(()=>voice.stop());const result=await voice.start('v=0\r\n');
  assert.equal(result.transport.sdp,'answer');await assert.rejects(()=>voice.start('v=0'),/active/);
  sideband.emit('event',{type:'session.input_transcript.delta',event_id:'e1',delta:'Set a timer for ',start_ms:0,end_ms:500});
  assert.equal(session.state.timers.length,0);
  sideband.emit('event',{type:'session.input_transcript.delta',event_id:'e2',delta:'two minutes.',start_ms:500,end_ms:1000});
  const event={type:'session.delegation.created',event_id:'e3',delegation:{id:'d1',target:'client'}};
  sideband.emit('event',event);sideband.emit('event',event);
  t.mock.timers.tick(950);assert.equal(session.state.timers.length,1);
  assert.equal(sideband.sent.filter(e=>e.type==='session.commentary.append').length,1);
  await voice.stop(result.token);assert.equal(voice.state.phase,'off');assert.equal(voice.active,null);
  assert.equal(JSON.parse(readFileSync(path)).runs[0].status,'closed');
});
test('async planner is cancelled on correction and terminal session closure; late replies are ignored',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const {path}=fixture(t);let ws;const jobs=[];
  const voice=new Voice({session:new Session(),budgetPath:path,fastTimers:false,
    assistant:{execute:(id,text,{signal})=>new Promise(resolve=>jobs.push({id,text,signal,resolve}))},
    clientFactory:()=>({live:{create:async()=>({session:{id:'test'},transport:{sdp:'answer'}}),sessions:{hangup:async()=>{}}}}),
    attachFactory:()=>ws=new FakeSideband()});
  await voice.start('v=0');
  ws.emit('event',{type:'session.input_transcript.delta',event_id:'u1',delta:'Start a two minute timer'});
  ws.emit('event',{type:'session.delegation.created',event_id:'d1',delegation:{id:'d1',target:'client'}});
  t.mock.timers.tick(900);assert.equal(jobs.length,1);
  ws.emit('event',{type:'session.input_transcript.delta',event_id:'u2',delta:', actually three minutes'});
  assert.equal(jobs[0].signal.aborted,true);
  jobs[0].resolve({status:'completed',message:'Wrong late reply'});await Promise.resolve();
  assert.equal(ws.sent.length,0);
  t.mock.timers.tick(900);assert.equal(jobs.length,2);assert.match(jobs[1].text,/actually three/);
  ws.emit('event',{type:'session.closed',usage:{seconds:3}});
  assert.equal(jobs[1].signal.aborted,true);
  jobs[1].resolve({status:'completed',message:'Another late reply'});await Promise.resolve();
  assert.equal(ws.sent.length,0);assert.equal(voice.active,null);
});
async function controlled(t,{finalUsage=true,assistant,fastTimers=false,telemetry}={}) {
  const {path}=fixture(t);let ws,hangups=0;
  const voice=new Voice({session:new Session(),budgetPath:path,assistant,fastTimers,telemetry,clientFactory:()=>({live:{create:async()=>({session:{id:'test'},transport:{sdp:'answer'}}),sessions:{hangup:async()=>{hangups++;}}}}),attachFactory:()=>{
    ws=new FakeSideband();if(!finalUsage)ws.send=e=>ws.sent.push(e);return ws;
  }});
  const result=await voice.start('v=0');return {voice,ws,result,path,get hangups(){return hangups;}};
}
function delegate(ws,suffix='1'){
  ws.emit('event',{type:'session.input_transcript.delta',event_id:'u'+suffix,delta:'Add milk to my list'});
  ws.emit('event',{type:'session.delegation.created',event_id:'d'+suffix,delegation:{id:'d'+suffix,target:'client'}});
}
function input(ws,text,start=0){ws.emit('event',{type:'session.input_transcript.delta',delta:text,start_ms:start,end_ms:start+100});}
function handoff(ws,id,offset){ws.emit('event',{type:'session.delegation.created',offset_ms:offset,delegation:{id,target:'client'}});}
test('timer fast lane: reported request commits at 700ms without delegation or paid planning',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  let calls=0;const c=await controlled(t,{fastTimers:true,assistant:{execute:()=>{calls++;throw Error('unexpected planning');}}});
  t.after(()=>c.voice.stop());
  input(c.ws,'Can you set a timer for ',0);t.mock.timers.tick(800);
  assert.equal(c.voice.session.state.timers.length,0);
  input(c.ws,'30 seconds',1000);t.mock.timers.tick(699);
  assert.equal(c.voice.session.state.timers.length,0);
  t.mock.timers.tick(1);
  const state=c.voice.session.state;
  assert.equal(state.timers.length,1);assert.equal(state.panel,'timers');
  assert.equal(state.timers[0].endsAt,Date.now()+30000);assert.equal(calls,0);
  assert.equal(c.ws.sent.length,1);assert.equal(c.ws.sent[0].delegation_id,null);
  assert.match(c.ws.sent[0].content,/Started Timer for 30 seconds/);
  assert.equal(state.assistantHistory.at(-1).user,'Can you set a timer for 30 seconds');
  const receipt=state.assistantReceipts[0];
  assert.match(receipt.id,/:timer:0:2$/);
  assert.equal(JSON.parse(readFileSync(c.path)).runs.length,1); // Live only
});
test('recorded Thanks. Now add flow bypasses planning and consumes the full conversational turn',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  let calls=0;const c=await controlled(t,{fastTimers:true,assistant:{execute:()=>{calls++;throw Error('unexpected planning');}}});
  t.after(()=>c.voice.stop());
  // Relative arrival spacing from the owner's 02:36:01.551 UTC recording.
  for(const [gap,text] of [[0,' Thanks'],[383,'. Now'],[397,' add a'],[616,' timer'],[1041,' for'],[215,' thirty'],[777,' seconds']]){
    t.mock.timers.tick(gap);input(c.ws,text,Date.now()-1000);
    assert.equal(c.voice.session.state.timers.length,0);
  }
  t.mock.timers.tick(700);
  assert.equal(c.voice.session.state.timers.length,1);assert.equal(calls,0);
  assert.equal(c.voice.session.state.assistantHistory.at(-1).user,' Thanks. Now add a timer for thirty seconds');
  t.mock.timers.tick(578);handoff(c.ws,'recorded-late');t.mock.timers.tick(900);
  assert.equal(c.voice.session.state.timers.length,1);assert.equal(calls,0);
  assert.equal(c.ws.sent.filter(e=>e.type==='session.commentary.append').length,1);
});
test('explicit duration correction within quiet window starts only the corrected timer',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const c=await controlled(t,{fastTimers:true});t.after(()=>c.voice.stop());
  input(c.ws,'Okay, set thirty seconds');t.mock.timers.tick(650);
  input(c.ws,', actually make it');t.mock.timers.tick(800);
  assert.equal(c.voice.session.state.timers.length,0);
  input(c.ws,' a minute');t.mock.timers.tick(700);
  assert.equal(c.voice.session.state.timers.length,1);
  assert.equal(c.voice.session.state.timers[0].endsAt,Date.now()+60000);
});
test('uncertain timer fallback records a category once at dispatch, not on every fragment',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const telemetry=new Telemetry(),jobs=[];
  const c=await controlled(t,{fastTimers:true,telemetry,assistant:{execute:(id,text)=>{jobs.push(text);return new Promise(()=>{});}}});
  t.after(async()=>{await c.voice.stop();await telemetry.close();});
  input(c.ws,'Thanks, set a timer');input(c.ws,' for two or three minutes');
  assert.equal(telemetry.records.some(r=>r.event==='timer.fast_fallback'),false);
  handoff(c.ws,'uncertain');t.mock.timers.tick(900);
  const events=telemetry.records.filter(r=>r.event==='timer.fast_fallback');
  assert.equal(events.length,1);assert.deepEqual(events[0].attributes,{fallback_reason:'uncertain_language'});
  assert.deepEqual(telemetry.snapshot().timerFallbacks,{uncertain_language:1});
  assert.equal(c.voice.session.state.timers.length,0);assert.equal(jobs.length,1);
  assert.equal(jobs[0],'Thanks, set a timer for two or three minutes');
});
test('early, repeated and late handoffs never duplicate a fast timer or spoken confirmation',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  let calls=0;const c=await controlled(t,{fastTimers:true,assistant:{execute:()=>{calls++;}}});
  t.after(()=>c.voice.stop());input(c.ws,'Start a five minute timer',0);handoff(c.ws,'early',100);
  t.mock.timers.tick(700);assert.equal(c.ws.sent[0].delegation_id,'early');
  handoff(c.ws,'early',100);handoff(c.ws,'late',100);t.mock.timers.tick(900);
  assert.equal(c.voice.session.state.timers.length,1);assert.equal(calls,0);
  assert.equal(c.ws.sent.filter(e=>e.type==='session.commentary.append').length,1);
  assert.equal(c.ws.sent.filter(e=>e.type==='session.thinking.append').length,1);
});
test('handoff before the next transcript is not swallowed; identical new requests remain new actions',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const c=await controlled(t,{fastTimers:true});t.after(()=>c.voice.stop());
  input(c.ws,'Set a timer for 30 seconds',0);t.mock.timers.tick(700);
  handoff(c.ws,'next',2000);t.mock.timers.tick(100);
  input(c.ws,'Set a timer for 30 seconds',2000);t.mock.timers.tick(700);
  assert.equal(c.voice.session.state.timers.length,2);
  assert.equal(c.ws.sent.filter(e=>e.type==='session.commentary.append').length,2);
  assert.equal(c.ws.sent.at(-1).delegation_id,'next');
});
test('old-offset handoff during new speech does not supersede the current request',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const c=await controlled(t,{fastTimers:true});t.after(()=>c.voice.stop());
  input(c.ws,'Set a timer for 30 seconds',0);t.mock.timers.tick(700);
  input(c.ws,'Set a timer for two minutes',2000);handoff(c.ws,'new',2100);handoff(c.ws,'old',100);
  assert.equal(c.voice.active.pending,'new');t.mock.timers.tick(700);
  assert.equal(c.voice.session.state.timers.length,2);assert.equal(c.ws.sent.at(-1).delegation_id,'new');
});
test('uncertain within-window corrections cancel the shortcut and reach the contextual planner intact',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const jobs=[];const c=await controlled(t,{fastTimers:true,assistant:{execute:(id,text)=>{jobs.push(text);return new Promise(()=>{});}}});
  t.after(()=>c.voice.stop());input(c.ws,'Set a timer for 30 seconds');handoff(c.ws,'correction');
  t.mock.timers.tick(650);input(c.ws,', actually make it a few minutes',1000);t.mock.timers.tick(900);
  assert.equal(c.voice.session.state.timers.length,0);
  assert.deepEqual(jobs,['Set a timer for 30 seconds, actually make it a few minutes']);
});
test('stop, stale state and pending clarification prevent speculative timer commits',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const c=await controlled(t,{fastTimers:true});
  input(c.ws,'Set a timer for 30 seconds');t.mock.timers.tick(699);await c.voice.stop();t.mock.timers.tick(1);
  assert.equal(c.voice.session.state.timers.length,0);
  const d=await controlled(t,{fastTimers:true});t.after(()=>d.voice.stop());
  input(d.ws,'Set a timer for 30 seconds');d.voice.session.command('show',{panel:'todos'});t.mock.timers.tick(700);
  assert.equal(d.voice.session.state.timers.length,0);
  d.voice.active.cursor=d.voice.active.transcript.length;
  d.voice.session.state.assistant={status:'clarify'};
  input(d.ws,'Set a timer for 30 seconds',2000);t.mock.timers.tick(700);
  assert.equal(d.voice.session.state.timers.length,0);assert.equal(d.ws.sent.length,0);
});
test('failed persistence does not confirm; failed confirmation does not undo or duplicate committed timer',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const c=await controlled(t,{fastTimers:true});t.after(()=>c.voice.stop());
  c.voice.session.save=()=>{throw Error('disk unavailable');};
  input(c.ws,'Set a timer for 30 seconds');t.mock.timers.tick(700);
  assert.equal(c.voice.session.state.timers.length,0);assert.equal(c.ws.sent.length,0);
  const d=await controlled(t,{fastTimers:true});t.after(()=>d.voice.stop());
  const original=d.ws.send.bind(d.ws);d.ws.send=e=>{if(e.type==='session.commentary.append')throw Error('disconnected');original(e);};
  input(d.ws,'Set a timer for 30 seconds');assert.doesNotThrow(()=>t.mock.timers.tick(700));
  assert.equal(d.voice.session.state.timers.length,1);
  handoff(d.ws,'late');t.mock.timers.tick(900);assert.equal(d.voice.session.state.timers.length,1);
});
test('local timer remains available while prior paid planning cleanup blocks new cloud work',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const c=await controlled(t,{fastTimers:true});t.after(()=>c.voice.stop());
  const budget=new ApiBudget(c.path);budget.reserve('agents-decision');
  assert.throws(()=>budget.reserve('agents-decision'),/Prior agent/);
  input(c.ws,'Set a timer for 30 seconds');t.mock.timers.tick(700);
  assert.equal(c.voice.session.state.timers.length,1);assert.equal(JSON.parse(readFileSync(c.path)).runs.length,2);
});
test('Live acknowledgment suppresses redundant app waiting cue for slower fallback work',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const c=await controlled(t,{assistant:{execute:()=>new Promise(()=>{})}});t.after(()=>c.voice.stop());
  delegate(c.ws);t.mock.timers.tick(900);
  c.ws.emit('event',{type:'session.output_transcript.delta',delta:'Give me a sec.'});t.mock.timers.tick(1500);
  assert.equal(c.ws.sent.length,0);
});
test('fast timer persists receipt and deadline, and emits a separate correlated latency span',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const {dir}=fixture(t),file=join(dir,'state.json'),telemetry=new Telemetry();
  const c=await controlled(t,{fastTimers:true,telemetry});
  t.after(async()=>{await c.voice.stop();await telemetry.close();});
  c.voice.session.file=file;
  input(c.ws,'Set a timer for 30 seconds');t.mock.timers.tick(700);
  const saved=new Session({file}),receipt=saved.state.assistantReceipts[0];
  assert.equal(saved.state.timers.length,1);assert.equal(saved.state.timers[0].endsAt,31700);
  saved.commitDecision(receipt.id,saved.state.revision,{
    status:'execute',outcome:'Start a timer.',message:'Timer requested.',
    actions:[{action:'start_timer',seconds:30,label:'Timer'}],options:[],selectedOptionId:null,
  },'Set a timer for 30 seconds');
  assert.equal(saved.state.timers.length,1);
  const records=telemetry.records.filter(r=>r.name==='voice.timer_fast');
  assert.equal(records.length,2);assert.equal(records[0].attributes.since_last_fragment_ms,700);
  assert.equal(records[1].attributes.outcome,'completed');assert.equal(records[1].attributes.action,'start_timer');
  assert.ok(records[0].parentSpanId);assert.equal(telemetry.records.some(r=>r.name==='agent.planning'),false);
});
test('slow planning sends one interim acknowledgment and later the real result',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  let finish;const c=await controlled(t,{assistant:{execute:()=>new Promise(r=>finish=r)}});
  t.after(()=>c.voice.stop());delegate(c.ws);t.mock.timers.tick(900);
  t.mock.timers.tick(1499);assert.equal(c.ws.sent.length,0);
  t.mock.timers.tick(1);assert.equal(c.ws.sent.length,1);assert.match(c.ws.sent[0].content,/Still working/);
  assert.equal(c.ws.sent[0].delegation_id,'d1');assert.equal(c.voice.active.pending,'d1');
  t.mock.timers.tick(5000);assert.equal(c.ws.sent.length,1);
  finish({status:'completed',message:'Added milk.'});await Promise.resolve();
  assert.equal(c.ws.sent.length,2);assert.equal(c.ws.sent[1].content,'Added milk.');
  assert.equal(c.voice.state.detail,'');
});
test('fast results and cancelled requests never emit a late waiting acknowledgment',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const c=await controlled(t,{assistant:{execute:async()=>({status:'completed',message:'Done.'})}});
  delegate(c.ws);t.mock.timers.tick(900);await Promise.resolve();t.mock.timers.tick(2000);
  assert.equal(c.ws.sent.length,1);assert.equal(c.ws.sent[0].content,'Done.');
  c.voice.assistant={execute:()=>new Promise(()=>{})};delegate(c.ws,'2');t.mock.timers.tick(900);
  await c.voice.stop(c.result.token);t.mock.timers.tick(3000);
  assert.equal(c.ws.sent.filter(e=>e.content?.includes('Still working')).length,0);
});
test('startup supplies listening-first policy and sends no greeting or tutorial',async t=>{
  const {path}=fixture(t);let config,ws;
  const voice=new Voice({session:new Session(),budgetPath:path,
    clientFactory:()=>({live:{create:async args=>{config=args;return {session:{id:'test'},transport:{sdp:'answer'}};},sessions:{hangup:async()=>{}}}}),
    attachFactory:()=>ws=new FakeSideband()});
  t.after(()=>voice.stop());
  await voice.start('v=0');
  assert.match(config.session.instructions,/Start silently and wait for the user to speak/);
  assert.match(config.session.instructions,/Give usage help only when asked/);
  assert.doesNotMatch(config.session.instructions,/three-minute prototype|Supported requests:/);
  assert.deepEqual(ws.sent,[]);
});
test('virtual clock: partial speech is not executed; stop cancels pending delegation',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const {voice,ws,result}=await controlled(t);
  ws.emit('event',{type:'session.input_transcript.delta',event_id:'u',delta:'set a timer for two minutes'});
  ws.emit('event',{type:'session.delegation.created',event_id:'d',delegation:{id:'d',target:'client'}});
  t.mock.timers.tick(899);assert.equal(voice.session.state.timers.length,0);
  const closing=voice.stop(result.token);t.mock.timers.tick(1);assert.equal(voice.session.state.timers.length,0);await closing;
  ws.emit('event',{type:'session.delegation.created',event_id:'late',delegation:{id:'late',target:'client'}});
  t.mock.timers.tick(1000);assert.equal(voice.session.state.timers.length,0);
});
test('virtual clock: missing heartbeat closes session without waiting real seconds',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const {voice}=await controlled(t);t.mock.timers.tick(21000);await voice.active?.stopping;
  assert.equal(voice.active,null);assert.equal(voice.state.phase,'off');
});
test('virtual clock: missing terminal usage attempts hangup, reserves budget and blocks restart',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const c=await controlled(t,{finalUsage:false});const closing=c.voice.stop(c.result.token);t.mock.timers.tick(8000);await closing;
  assert.equal(c.hangups,1);assert.equal(c.voice.blocked,true);assert.equal(c.voice.active,null);
  assert.equal(JSON.parse(readFileSync(c.path)).runs[0].status,'unconfirmed');await assert.rejects(()=>c.voice.start('v=0'));
});
test('terminal event without valid usage is not reported as a successful billing close',async t=>{
  const {voice,ws,path}=await controlled(t);ws.emit('event',{type:'session.closed',usage:{}});
  assert.equal(voice.blocked,true);assert.equal(voice.state.phase,'error');assert.equal(JSON.parse(readFileSync(path)).runs[0].status,'unconfirmed');
});
test('paid routes reject cross-origin, missing token, invalid SDP without network calls',async t=>{
  const origins=[];const app=createApp({origins,voiceOptions:{clientFactory:()=>{throw Error('must not call');}}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;origins.push(base);
  const post=(path,body,origin=base)=>fetch(base+'/api/voice/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('start',{sdp:'v=0'},'https://example.com')).status,403);
  assert.equal((await post('start',{sdp:'bad'})).status,409);
  assert.equal((await post('stop',{token:'wrong'})).status,409);
});
test('Android output does not load modern audio code or require touch',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/display.js',import.meta.url),'utf8');
  assert.doesNotMatch(html,/type="module"|voice-client|getUserMedia/);
  assert.doesNotMatch(js,/\b(?:let|const)\b|=>|\?\.|getUserMedia|RTCPeerConnection/);
});
