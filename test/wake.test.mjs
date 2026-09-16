import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Wake,readyChime} from '../wake.mjs';
import {isConversationEnd,wakeIdle} from '../voice.mjs';
import {createApp} from '../server.mjs';

function fixture(t){
  let now=1000;
  const detector=new EventEmitter();Object.assign(detector,{lastProgress:now,feeds:0,resets:0,start:async()=>{},feed(){this.feeds++;},reset(){this.resets++;this.lastProgress=now;},close(){this.closed=true;}});
  const mirror=new EventEmitter();Object.assign(mirror,{status:()=>({connected:true,wakeCapable:true}),standby(){this.mode='standby';},connecting(){this.mode='connecting';},start(){this.mode='conversation';},stop(){this.mode='off';},mute(value){this.muted=value;},chime(value){this.outputValue=value;}});
  const voice={state:{phase:'off'},calls:0,active:null,async start(sdp,audio,{owner}){this.calls++;this.active={owner,token:'private'};audio.start();return {};},async stop(token,reason){this.active=null;this.state.stopReason=reason;mirror.stop();}};
  const wake=new Wake({voice,mirror,detectorFactory:()=>detector,now:()=>now});
  t.after(()=>wake.close());return {wake,voice,mirror,detector,advance(ms){now+=ms;wake.tick();}};
}
test('wake starts disarmed; standby PCM only reaches the local detector, never a paid session',async t=>{
  const f=fixture(t);f.mirror.emit('standby-audio',Buffer.alloc(640));assert.equal(f.detector.feeds,0);
  await f.wake.enable();f.mirror.emit('standby-audio',Buffer.alloc(640));assert.equal(f.detector.feeds,1);assert.equal(f.voice.calls,0);assert.equal(f.mirror.mode,'standby');
  await f.wake.disable();f.mirror.emit('standby-audio',Buffer.alloc(640));assert.equal(f.detector.feeds,1);assert.equal(f.mirror.mode,'off');
});
test('one wake starts one session; no standby audio or additional triggers during conversation; benign end rearms after cooldown',async t=>{
  const f=fixture(t);await f.wake.enable();await f.wake.trigger();await f.wake.trigger();
  assert.equal(f.voice.calls,1);assert.equal(f.voice.active.owner,'wake');assert.equal(f.wake.state.phase,'conversation');
  f.mirror.emit('standby-audio',Buffer.alloc(640));assert.equal(f.detector.feeds,0);assert.ok(f.mirror.outputValue);
  await f.voice.stop(null,'idle_timeout');f.advance(500);assert.equal(f.wake.state.phase,'cooldown');
  await f.wake.trigger();assert.equal(f.voice.calls,1);f.advance(4000);assert.equal(f.wake.state.phase,'standby');
});
test('test-only mode chimes locally and cannot create an API session',async t=>{
  const f=fixture(t);await f.wake.enable({test:true});await f.wake.trigger();assert.equal(f.voice.calls,0);assert.ok(f.mirror.outputValue);f.advance(4000);assert.equal(f.wake.state.phase,'standby');
});
test('spoken stop listening disables standby instead of silently reopening the microphone',async t=>{
  const f=fixture(t);await f.wake.enable();await f.wake.trigger();await f.voice.stop(null,'spoken_disable');f.advance(500);
  assert.equal(f.wake.state.enabled,false);assert.equal(f.mirror.mode,'off');f.advance(4000);assert.equal(f.mirror.mode,'off');
});
test('disarm during in-flight startup closes late session and cannot unmute or rearm',async t=>{
  const f=fixture(t);let resolve;f.voice.start=async()=>{f.voice.active={owner:'wake'};await new Promise(r=>resolve=r);};
  await f.wake.enable();const pending=f.wake.trigger();await f.wake.disable();resolve();await pending;
  assert.equal(f.voice.active,null);assert.equal(f.wake.state.enabled,false);assert.equal(f.mirror.mode,'off');
});
test('audio/model errors, disconnect, startup failure, unexpected closure fail closed without retries',async t=>{
  for(const event of ['fault','disconnect']){const f=fixture(t);await f.wake.enable();f.mirror.emit(event);assert.equal(f.wake.state.enabled,false);assert.equal(f.voice.calls,0);}
  const f=fixture(t);await f.wake.enable();f.detector.emit('fault');assert.equal(f.wake.state.enabled,false);
  const g=fixture(t);g.voice.start=async()=>{throw Error('budget limit');};await g.wake.enable();await g.wake.trigger();assert.equal(g.wake.state.enabled,false);
  const h=fixture(t);await h.wake.enable();await h.wake.trigger();h.voice.active=null;h.advance(500);assert.equal(h.wake.state.enabled,false);
});
test('missing updated hardware, manual session or accounting block prevents arming',async t=>{
  const f=fixture(t);f.mirror.status=()=>({connected:true});await assert.rejects(()=>f.wake.enable(),/updated/);
  f.voice.active={};await assert.rejects(()=>f.wake.enable(),/End/);f.voice.active=null;f.voice.blocked=true;await assert.rejects(()=>f.wake.enable(),/accounting/);
});
test('finite arming, stalled audio and wake count limits',async t=>{
  const f=fixture(t);await f.wake.enable();f.advance(6000);assert.equal(f.wake.state.reason,'audio_or_detector_stalled');
  const g=fixture(t);await g.wake.enable();g.advance(30*60000);assert.equal(g.wake.state.reason,'arming_expired');
  const h=fixture(t);await h.wake.enable({test:true});h.wake.state.count=9;await h.wake.trigger();h.advance(4000);assert.equal(h.wake.state.reason,'wake_limit');
});
test('conversation end is whole utterance only; idle ignores ongoing work and recent actual playback',()=>{
  for(const text of ["That's all.",'Thank you, that’s all','End conversation','Stop listening','Goodbye mirror'])assert.equal(isConversationEnd(text),true,text);
  for(const text of ["Don't stop listening",'What does goodbye mean?',"That's all I need for my timer",'Goodbye and show the weather'])assert.equal(isConversationEnd(text),false,text);
  const a={owner:'wake',readyAt:1000,lastInput:1000,lastOutput:1000};
  assert.equal(wakeIdle(a,10999),false);assert.equal(wakeIdle(a,11000),true);
  for(const extra of [{owner:'companion'},{readyAt:0},{job:{}},{pending:'work'},{lastAudible:10500},{lastInput:10500},{lastOutput:10500}])assert.equal(wakeIdle({...a,...extra},11000),false);
  const pcm=Buffer.from(readyChime(),'base64');assert.equal(pcm.length,9600);assert.notEqual(pcm.compare(Buffer.alloc(9600)),0);
});
test('wake routes require same-origin JSON and manual start is excluded while armed',async t=>{
  const f=fixture(t),origins=[];const app=createApp({origins,mirrorAudio:f.mirror,wakeOptions:{detectorFactory:()=>f.detector}});
  f.mirror.close=()=>{};t.after(()=>app.close());await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;origins.push(base);
  const post=(path,body,origin=base)=>fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/api/wake/enable',{},'https://other.test')).status,403);
  assert.equal((await post('/api/wake/enable',{test:'yes'})).status,409);
  assert.equal((await post('/api/wake/enable',{test:true})).status,200);
  assert.equal((await post('/api/voice/start',{device:'mirror'})).status,409);
  const state=await (await fetch(base+'/api/wake')).json();assert.equal(state.test,true);assert.equal(state.token,undefined);
  assert.equal((await post('/api/wake/disable',{})).status,200);assert.equal(f.mirror.mode,'off');
});
