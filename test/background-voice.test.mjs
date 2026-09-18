import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Voice,wakeIdle} from '../voice.mjs';
import {Wake} from '../wake.mjs';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
class Primary extends EventEmitter{
  constructor(){super();this.sent=[];this.socket=new EventEmitter();this.socket.readyState=1;}
  send(e){this.sent.push(e);
    if(e.type==='session.start')queueMicrotask(()=>this.emit('event',{type:'session.started',session:{id:'test'}}));
    if(e.type==='session.close'&&!this.missingUsage)queueMicrotask(()=>this.emit('event',{type:'session.closed',usage:{seconds:12}}));
  }
  close(){this.socket.readyState=3;this.socket.emit('close');}
}
async function fixture(t){
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:10000});
  const dir=mkdtempSync(join(tmpdir(),'glass-background-')),budgetPath=join(dir,'budget.json');
  writeFileSync(budgetPath,JSON.stringify({approvedUSD:25,runs:[]}));
  const mirror=new EventEmitter();Object.assign(mirror,{status:()=>({connected:true,wakeCapable:true,playing:false}),start(){this.mode='conversation';},stop(){this.mode='off';},standby(){this.mode='standby';},connecting(){this.mode='connecting';},mute(){},chime(){}});
  const detector=new EventEmitter();Object.assign(detector,{start:async()=>{},feed(){},reset(){},close(){}});Object.defineProperty(detector,'lastProgress',{get:()=>Date.now()});
  const pending=[],sockets=[];
  const voice=new Voice({session:new Session(),budgetPath,fastTimers:false,assistant:{execute:(id,text,options)=>new Promise((resolve,reject)=>pending.push({id,text,...options,resolve,reject}))},clientFactory:()=>({live:{sessions:{hangup:async()=>{}}}})});
  voice.primaryFactory=()=>{const p=new Primary();sockets.push(p);return p;};
  const wake=new Wake({voice,mirror,detectorFactory:()=>detector});
  t.after(async()=>{await wake.close();await voice.stop(undefined,'shutdown');rmSync(dir,{recursive:true,force:true});});
  await wake.enable();await wake.trigger();
  const f={voice,wake,mirror,pending,sockets,budgetPath,
    async advance(ms){t.mock.timers.tick(ms);await flush();},
    async request(text='Research the three largest stadiums'){
      const p=sockets.at(-1);p.emit('event',{type:'session.input_transcript.delta',delta:text});
      p.emit('event',{type:'session.delegation.created',delegation:{id:'d'+pending.length,target:'client'}});
      await this.advance(900);return pending.at(-1);
    },
    async detach(){await voice.stop(undefined,'idle_timeout');assert.equal(voice.active,null);},
    async finish(job,result={status:'completed',message:'Verified research is ready.'}){await job.beforeCommit();job.resolve(result);await flush();await this.advance(250);}
  };return f;
}
const results=p=>p.sent.filter(e=>e.type==='session.commentary.append'&&e.content.includes('background_result'));

test('10s idle releases native voice but keeps one task; completion starts one session without replay',async t=>{
  const f=await fixture(t),job=await f.request();
  // Initial expectation cue is the only progress cue for backgroundable work.
  await f.advance(1800);assert.match(f.sockets[0].sent.at(-1).content,/let the user know/);
  for(let i=0;i<11;i++)await f.advance(1000);
  assert.equal(f.voice.active,null);assert.equal(job.signal.aborted,false);
  assert.equal(f.voice.state.background.running,1);
  assert.equal(JSON.parse(readFileSync(f.budgetPath)).runs[0].status,'closed');
  await f.finish(job);assert.equal(f.sockets.length,2);assert.equal(f.pending.length,1);
  const messages=results(f.sockets[1]);assert.equal(messages.length,1);assert.equal(messages[0].delegation_id,null);
  assert.match(f.sockets[1].sent[0].session.instructions,/completed background task/);
  assert.equal(wakeIdle(f.voice.active,Date.now()+9999),false);
  await f.advance(3000);assert.equal(results(f.sockets[1]).length,1);
  assert.equal(f.voice.state.background.running,0);assert.equal(f.voice.state.background.waitingToAnnounce,0);
});
test('failed background task announces failure through a fresh session, not silent disappearance',async t=>{
  const f=await fixture(t),job=await f.request();await f.detach();
  job.reject(Error('research failed'));await flush();await f.advance(250);
  const message=JSON.parse(results(f.sockets[1])[0].content);
  assert.equal(message.result.status,'needs_input');assert.match(message.result.message,/could not complete/);
  assert.equal(f.pending.length,1);
});
test('large research result resumes with a compact receipt and distinct acceptance/audio evidence',async t=>{
  const f=await fixture(t),job=await f.request();await f.detach();
  await f.finish(job,{status:'completed',message:'Your stadium research is ready.',researchArtifact:{cards:Array(6).fill({body:'Very long report '.repeat(500)})}});
  const p=f.sockets[1],sent=results(p)[0];
  assert.ok(Buffer.byteLength(sent.content)<=480);assert.ok(sent.event_id);
  assert.doesNotMatch(sent.content,/researchArtifact|Very long report/);
  const events=[];f.voice.active.trace.event=name=>events.push(name);f.mirror.output=()=>1;
  p.emit('event',{type:'session.commentary.appended',client_event_id:'unrelated'});
  assert.deepEqual(events,[]);
  p.emit('event',{type:'session.commentary.appended',client_event_id:sent.event_id});
  p.emit('event',{type:'session.output_audio.delta',delta:Buffer.alloc(640).toString('base64')});
  assert.deepEqual(events,['background.accepted']);
  const pcm=Buffer.alloc(640);pcm.writeInt16LE(1000,0);
  p.emit('event',{type:'session.output_audio.delta',delta:pcm.toString('base64')});
  p.emit('event',{type:'session.output_audio.delta',delta:pcm.toString('base64')});
  assert.deepEqual(events,['background.accepted','background.audio_started']);
});
test('stop while detached cancels task and prevents late writes or automatic reconnect',async t=>{
  const f=await fixture(t),job=await f.request();await f.detach();
  await f.voice.stop();assert.equal(job.signal.aborted,true);await assert.rejects(job.beforeCommit,/cancelled/);
  job.resolve({status:'completed',message:'Late'});await flush();await f.advance(1000);
  assert.equal(f.sockets.length,1);assert.equal(f.voice.state.background.waitingToAnnounce,0);
});
test('mute permits silent completion, but unmuting does not revive the suppressed announcement',async t=>{
  const f=await fixture(t),job=await f.request();f.voice.mute(f.voice.active.token,true);
  assert.equal(job.signal.aborted,false);await f.detach();
  await f.finish(job);assert.equal(f.sockets.length,1);assert.equal(f.voice.state.background.running,0);
});
test('disarm/rearm cannot resurrect an old announcement',async t=>{
  const f=await fixture(t),job=await f.request();await f.detach();await f.wake.disable();await f.wake.enable();
  assert.equal(job.signal.aborted,true);job.resolve({status:'completed',message:'Late'});await flush();await f.advance(250);
  assert.equal(f.sockets.length,1);
});
test('uses an existing conversation after a quiet gap; never interrupts its pending turn',async t=>{
  const f=await fixture(t),job=await f.request();await f.detach();
  await f.advance(500);await f.advance(4000);await f.wake.trigger();assert.equal(f.sockets.length,2);
  const second=await f.request('Show me a different report');
  await f.finish(job);assert.equal(results(f.sockets[1]).length,0);
  second.resolve({status:'completed',message:'Second report ready.'});await flush();
  await f.advance(2999);assert.equal(results(f.sockets[1]).length,0);
  await f.advance(251);assert.equal(results(f.sockets[1]).length,1);assert.equal(f.sockets.length,2);
});
test('no reconnect without final usage; one failed startup is not automatically retried',async t=>{
  const f=await fixture(t),job=await f.request();f.sockets[0].missingUsage=true;
  const stopping=f.voice.stop(undefined,'idle_timeout');await f.advance(8000);await stopping;
  assert.equal(f.voice.blocked,true);await f.finish(job);assert.equal(f.sockets.length,1);
});
test('completion arriving during voice close waits for terminal usage before reconnect',async t=>{
  const f=await fixture(t),job=await f.request();f.sockets[0].missingUsage=true;
  const stopping=f.voice.stop(undefined,'idle_timeout');await f.finish(job);assert.equal(f.sockets.length,1);
  f.sockets[0].emit('event',{type:'session.closed',usage:{seconds:12}});await stopping;
  await f.advance(250);assert.equal(f.sockets.length,2);assert.equal(results(f.sockets[1]).length,1);
});
test('failed reconnect is attempted once, with no unbounded paid retry loop',async t=>{
  const f=await fixture(t),job=await f.request();await f.detach();let attempts=0;
  f.voice.resumeBackground=async()=>{attempts++;throw Error('startup failed');};
  await f.finish(job);await f.advance(5000);assert.equal(attempts,1);assert.equal(f.sockets.length,1);
});
test('stop during reconnect suppresses the receipt, even when startup resolves late',async t=>{
  const f=await fixture(t),job=await f.request();await f.detach();let release;
  f.voice.resumeBackground=async()=>{await f.voice.start(null,f.mirror,{owner:'wake',resuming:true});await new Promise(r=>release=r);return true;};
  await f.finish(job);assert.ok(release);await f.voice.stop();release();await flush();
  assert.equal(results(f.sockets[1]).length,0);assert.equal(f.voice.active,null);
});
test('expired wake arming cannot open a background-completion session',async t=>{
  const f=await fixture(t),job=await f.request();await f.detach();
  f.wake.state.expiresAt=Date.now()-1;await f.finish(job);assert.equal(f.sockets.length,1);
});
test('manual Mirror tasks can release audio and announce without enabling wake standby',async t=>{
  const f=await fixture(t);await f.wake.disable();
  await f.voice.start(null,f.mirror);const job=await f.request();await f.detach();await f.finish(job);
  assert.equal(f.wake.state.enabled,false);assert.equal(f.sockets.length,3);assert.equal(results(f.sockets[2]).length,1);
});
test('stale display revision still rejects a background commit after other commands',async t=>{
  const f=await fixture(t);let decide;
  f.voice.assistant=new Assistant({session:f.voice.session,planner:{decide:()=>new Promise(r=>decide=r)}});
  await f.request();await f.detach();f.voice.session.command('show',{panel:'home'});
  decide({status:'execute',outcome:'Show time',message:'Shown',actions:[{action:'show',panel:'clock'}],options:[],selectedOptionId:null});
  await flush();await f.advance(250);
  assert.equal(f.voice.session.state.panel,'home');assert.match(results(f.sockets[1])[0].content,/could not complete/);
});
test('idle still waits for unresolved input, games and playback; result delivery gets a response window',()=>{
  const base={owner:'wake',mirror:{},readyAt:1000,lastInput:1000,lastOutput:1000,job:{backgroundEligible:true},pending:'id'};
  assert.equal(wakeIdle(base,11000),true);
  for(const patch of [{job:{backgroundEligible:true,inputGate:Promise.resolve()}},{job:{backgroundEligible:false}},{finishing:{}},{lastAudible:5000},{responsePendingAt:5000}])assert.equal(wakeIdle({...base,...patch},11000),false);
});
