import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {Session} from '../session.mjs';
import {LocalPlayroom,playLocalPCM} from '../local-playroom.mjs';
import {wavePCM} from '../local-speech.mjs';
import {createApp} from '../server.mjs';

class Recognizer extends EventEmitter {
  lastProgress=Date.now();
  async start(){}
  reset(){this.lastProgress=Date.now();}
  feed(){this.frames=(this.frames||0)+1;}
  close(){this.closed=true;}
}
class Mirror extends EventEmitter {
  mode='off';stops=0;
  status(){return {connected:true,mode:this.mode,capturing:this.mode!=='off'};}
  start(){this.mode='conversation';}
  stop(){this.mode='off';this.stops++;}
  close(){}
}
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(t,options={}){
  const session=new Session(),mirror=new Mirror(),recognizer=new Recognizer();session.startPlayroom('animals');
  const local=new LocalPlayroom({session,mirror,recognizerFactory:()=>recognizer,synthesize:async()=>Buffer.alloc(640),play:async()=>{},...options});
  t.after(()=>{local.close();session.close();});return {session,mirror,recognizer,local};
}
test('local game ignores unrelated and malformed speech, advances valid answers and stops on completion',async t=>{
  const {session,mirror,recognizer,local}=fixture(t);await local.start();await flush();
  assert.equal(local.state.phase,'listening');const initial=structuredClone(session.state.playroom);
  for(const answer of [null,'','not an elephant','talking to my wife'])await local.answer(local.active,answer);
  assert.deepEqual(session.state.playroom,initial);assert.equal(local.state.ignored,2);
  mirror.emit('audio',Buffer.alloc(640));assert.equal(recognizer.frames,1);
  for(const answer of ['elephant','giraffe','penguin','bear'])await local.answer(local.active,answer);
  assert.equal(session.state.playroom.phase,'complete');assert.equal(local.state.accepted,4);
  assert.equal(local.state.phase,'off');assert.equal(mirror.mode,'off');assert.equal(recognizer.closed,true);
  assert.deepEqual(session.state.assistantHistory,[]);
});
test('local game handles hints, known wrong answers, bear choices and explicit stop',async t=>{
  const {session,local}=fixture(t);session.startPlayroom('bear');await local.start();await flush();
  for(const answer of ['the second one','a kite','squeak'])await local.answer(local.active,answer);
  assert.deepEqual(session.state.playroom.choices,['ocean','kite','squeak']);assert.equal(local.active,null);
  session.startPlayroom('animals');await local.start();await flush();
  await local.answer(local.active,'dog');assert.equal(session.state.playroom.feedback,'try_again');
  await local.answer(local.active,'hint');assert.equal(session.state.playroom.feedback,'hint');
  await local.answer(local.active,'stop');assert.equal(local.active,null);
});
test('answer-shaped unclear speech asks for a retry without grading; negation stays ignored',async t=>{
  const {session,local}=fixture(t);await local.start();await flush();
  await local.answer(local.active,'a pendwin');
  assert.equal(session.state.playroom.feedback,'uncertain');assert.equal(session.state.playroom.index,0);
  assert.equal(session.state.playroom.found,0);assert.match(session.state.playroom.prompt,/didn’t quite catch/);
  const turn=session.state.playroom.turn;
  for(const text of ['it is not an elephant','an elephant or giraffe','my wife says elephant'])await local.answer(local.active,text);
  assert.equal(session.state.playroom.turn,turn);assert.equal(local.state.ignored,3);
});
test('stopping during model startup prevents subsequent capture',async t=>{
  let ready;const recognizer=new Recognizer();recognizer.start=()=>new Promise(r=>ready=r);
  const {local,mirror}=fixture(t,{recognizerFactory:()=>recognizer});const starting=local.start();
  local.stop();ready();await starting;assert.equal(mirror.mode,'off');assert.equal(local.active,null);
});
test('speaker echo and late answers cannot advance game; disconnect stops capture',async t=>{
  let finish;const {local,session,mirror}=fixture(t,{play:()=>new Promise(r=>finish=r)});
  await local.start();await flush();const active=local.active;assert.equal(local.state.phase,'speaking');
  await local.answer(active,'elephant');assert.equal(session.state.playroom.index,0);
  mirror.emit('disconnect');finish();await flush();await local.answer(active,'elephant');
  assert.equal(local.active,null);assert.equal(session.state.playroom.index,0);assert.equal(mirror.mode,'off');
});
test('capture watchdog, accepted-answer idle limit and absolute limit stop local mic',async t=>{
  for(const reason of ['capture','idle','limit']){
    let now=Date.now();const {local,mirror}=fixture(t,{now:()=>now,idleMs:100,maxMs:1000});await local.start();await flush();
    if(reason==='capture'){local.maxMs=10000;now+=6000;}
    else if(reason==='idle')now+=101;
    else now+=1001;
    local.tick();assert.equal(local.active,null);assert.equal(mirror.mode,'off');
    assert.equal(local.state.phase,reason==='capture'?'error':'off');
  }
});
test('local synthesis failure stops mic and playback honors cancellation',async t=>{
  const {local,mirror}=fixture(t,{synthesize:async()=>{throw Error('unavailable');}});
  await local.start();await flush();assert.equal(local.state.phase,'error');assert.equal(mirror.mode,'off');
  const controller=new AbortController();controller.abort();
  await assert.rejects(playLocalPCM({status:()=>({capturing:true})},Buffer.alloc(640),{signal:controller.signal}),{name:'AbortError'});
});
test('WAV parser accepts mono PCM16 16kHz and rejects wrong format or truncation',()=>{
  const wav=Buffer.alloc(48);wav.write('RIFF');wav.writeUInt32LE(40,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);
  assert.equal(wavePCM(wav).length,4);assert.throws(()=>wavePCM(wav.subarray(0,46)),/Truncated/);
  wav.writeUInt16LE(2,22);assert.throws(()=>wavePCM(wav),/mono/);
});
test('local controls exist and require same-origin adult rehearsal; voice cannot share ownership',async t=>{
  const html=readFileSync(new URL('../public/remote.html',import.meta.url),'utf8');
  for(const id of ['playroom-local-start','playroom-local-stop'])assert.ok(html.includes('id="'+id+'"'));
  const origins=[],mirror=new Mirror();const app=createApp({origins,mirrorAudio:mirror,localPlayroomOptions:{recognizerFactory:()=>new Recognizer(),synthesize:async()=>Buffer.alloc(640),play:async()=>{}}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const origin='http://127.0.0.1:'+app.server.address().port;
  origins.push(origin);
  const post=(path,body,site=origin)=>fetch(origin+path,{method:'POST',headers:{origin:site,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/api/playroom-audio',{action:'start',adultRehearsal:true},'http://evil.example')).status,403);
  assert.equal((await post('/api/playroom-audio',{action:'start'})).status,409);
  assert.equal((await post('/api/playroom-audio',{action:'start',adultRehearsal:true})).status,409);
  app.session.startPlayroom('animals');
  assert.equal((await post('/api/playroom-audio',{action:'start',adultRehearsal:true})).status,200);
  assert.equal((await post('/api/playroom-audio',{action:'start',adultRehearsal:true})).status,409);
  assert.equal((await post('/api/voice/start',{device:'mirror'})).status,409);
  assert.equal((await post('/api/wake/enable',{})).status,409);
  assert.equal((await post('/api/playroom',{action:'stop'})).status,200);assert.equal(app.localPlayroom.active,null);assert.equal(mirror.mode,'off');
});
