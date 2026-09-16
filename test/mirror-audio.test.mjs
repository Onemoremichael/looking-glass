import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once,EventEmitter} from 'node:events';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MirrorAudio} from '../mirror-audio.mjs';
import {Voice} from '../voice.mjs';
import {Session} from '../session.mjs';
const frame=(type,payload)=>{const b=Buffer.from(payload),h=Buffer.alloc(5);h[0]=type;h.writeUInt32BE(b.length,1);return Buffer.concat([h,b]);};
const wait=()=>new Promise(r=>setTimeout(r,20));
test('USB bridge is inert until started, validates framing, and stops on disconnect',async t=>{
  const bridge=new MirrorAudio();await bridge.listen(0);t.after(()=>bridge.close());
  const socket=net.connect(bridge.server.address().port,'127.0.0.1');socket.on('error',()=>{});await once(socket,'connect');socket.on('data',()=>{});t.after(()=>socket.destroy());
  const hello=frame(1,JSON.stringify({version:1,rate:16000}));socket.write(hello.subarray(0,3));socket.write(hello.subarray(3));await wait();
  assert.equal(bridge.status().connected,true);assert.equal(bridge.active,false);
  let count=0;bridge.on('audio',()=>count++);socket.write(frame(2,Buffer.alloc(640)));await wait();assert.equal(count,0);
  bridge.start();socket.write(frame(2,Buffer.alloc(640)));await wait();assert.equal(count,1);
  bridge.stop();socket.write(frame(2,Buffer.alloc(640)));await wait();assert.equal(count,1);
  const disconnected=once(bridge,'disconnect');socket.end();await disconnected;assert.equal(bridge.status().connected,false);
});
test('oversized USB frame disconnects before allocation',async t=>{
  const bridge=new MirrorAudio();await bridge.listen(0);t.after(()=>bridge.close());
  const socket=net.connect(bridge.server.address().port,'127.0.0.1');socket.on('error',()=>{});await once(socket,'connect');
  const gone=once(bridge,'disconnect'),header=Buffer.alloc(5);header.writeUInt32BE(999999,1);socket.write(header);await gone;socket.destroy();assert.equal(bridge.active,false);
});
test('native drain target counts 20ms blocks including cues, and fresh stats are timestamped',async t=>{
  const bridge=new MirrorAudio();await bridge.listen(0);t.after(()=>bridge.close());
  const socket=net.connect(bridge.server.address().port,'127.0.0.1');socket.on('error',()=>{});socket.on('data',()=>{});await once(socket,'connect');t.after(()=>socket.destroy());
  socket.write(frame(1,JSON.stringify({version:1,rate:16000,wake:true})));await wait();
  assert.equal(bridge.output(Buffer.alloc(640).toString('base64')),undefined);
  bridge.start();assert.equal(bridge.chime(Buffer.alloc(9600).toString('base64')),15);
  assert.equal(bridge.output(Buffer.alloc(1282).toString('base64')),18);
  const before=Date.now();socket.write(frame(3,JSON.stringify({capturing:true,playing:false,outputFrames:18})));await wait();
  assert.equal(bridge.status().outputFrames,18);assert.ok(bridge.status().receivedAt>=before);
  bridge.start();assert.equal(bridge.output(Buffer.alloc(640).toString('base64')),1);assert.equal(bridge.status().receivedAt,undefined);
});
test('standby has a separate local-only route; old PCM cannot cross into conversation before fresh-capture acknowledgment',async t=>{
  const bridge=new MirrorAudio();await bridge.listen(0);t.after(()=>bridge.close());
  const socket=net.connect(bridge.server.address().port,'127.0.0.1');socket.on('error',()=>{});socket.on('data',()=>{});await once(socket,'connect');t.after(()=>socket.destroy());
  socket.write(frame(1,JSON.stringify({version:1,rate:16000,wake:true})));await wait();
  let local=0,cloud=0;bridge.on('standby-audio',()=>local++);bridge.on('audio',()=>cloud++);
  bridge.standby();socket.write(frame(2,Buffer.alloc(640)));await wait();assert.equal(local,1);assert.equal(cloud,0);
  bridge.connecting();socket.write(frame(2,Buffer.alloc(640)));await wait();assert.equal(local,1);assert.equal(cloud,0);
  bridge.start();socket.write(frame(2,Buffer.alloc(640)));await wait();assert.equal(cloud,0);
  socket.write(frame(6,Buffer.alloc(0)));socket.write(frame(2,Buffer.alloc(640)));await wait();assert.equal(cloud,1);
  bridge.stop();socket.write(frame(2,Buffer.alloc(640)));await wait();assert.equal(cloud,1);
});
class Primary extends EventEmitter {
  constructor(){super();this.sent=[];this.socket=new EventEmitter();this.socket.readyState=1;}
  send(e){this.sent.push(e);if(e.type==='session.start')setImmediate(()=>this.emit('event',{type:'session.started',session:{id:'native-test'}}));if(e.type==='session.close')setImmediate(()=>this.emit('event',{type:'session.closed',usage:{seconds:3}}));}
  close(){this.socket.readyState=3;this.socket.emit('close');}
}
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'mirror-voice-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'budget.json');writeFileSync(path,JSON.stringify({approvedUSD:25,runs:[]}));
  const mirror=new EventEmitter();Object.assign(mirror,{active:false,status:()=>({connected:true}),start(){this.active=true;},stop(){this.active=false;},output(data){this.lastOutput=data;}});
  const voice=new Voice({session:new Session(),budgetPath:path,clientFactory:()=>({live:{sessions:{hangup:async()=>{}}}})});let primary;voice.primaryFactory=()=>primary=new Primary();t.after(()=>voice.stop());
  return {voice,mirror,primary:()=>primary};
}
test('native voice waits for provider readiness, routes PCM, preserves closure accounting',async t=>{
  const f=fixture(t),result=await f.voice.start(null,f.mirror),p=f.primary();
  assert.equal(result.device,'mirror');assert.equal(f.mirror.active,true);assert.equal(p.sent[0].session.audio.format.rate,16000);
  f.mirror.emit('audio',Buffer.alloc(640));assert.equal(p.sent.at(-1).type,'session.input_audio.append');
  p.emit('event',{type:'session.output_audio.delta',delta:'AA=='});assert.equal(f.mirror.lastOutput,'AA==');
  await f.voice.stop(result.token);assert.equal(f.mirror.active,false);assert.equal(f.voice.state.phase,'off');assert.equal(f.voice.blocked,undefined);assert.equal(f.mirror.listenerCount('audio'),0);
});
test('USB loss ends native capture and finalizes the paid session',async t=>{
  const f=fixture(t);await f.voice.start(null,f.mirror);f.mirror.emit('disconnect');await wait();assert.equal(f.voice.active,null);assert.equal(f.mirror.active,false);
});
test('missing Mirror fails before paid session creation',async t=>{
  const f=fixture(t);f.mirror.status=()=>({connected:false});await assert.rejects(()=>f.voice.start(null,f.mirror),/not connected/);assert.equal(f.voice.active,null);
});
test('adult playroom voice uses isolated instructions, suppresses transcripts and reacts to real audio',async t=>{
  const f=fixture(t);f.voice.session.startPlayroom('bear');let logged=0;
  f.voice.telemetry={start:()=>({event(){},end(){}}),transcript(){logged++;}};
  await f.voice.start(null,f.mirror);const p=f.primary();
  assert.match(p.sent[0].session.instructions,/pretend bear/);assert.match(p.sent[0].session.instructions,/Current game state/);
  assert.doesNotMatch(p.sent[0].session.instructions,/Open-Meteo/);
  p.emit('event',{type:'session.input_transcript.delta',delta:'private rehearsal answer'});
  p.emit('event',{type:'session.output_transcript.delta',delta:'private rehearsal reply'});
  assert.equal(logged,0);
  const audio=Buffer.alloc(640);audio.writeInt16LE(1000,0);
  p.emit('event',{type:'session.output_audio.delta',delta:audio.toString('base64')});
  assert.equal(f.voice.state.phase,'speaking');await f.voice.stop();assert.equal(f.voice.active,null);
});
test('wake-owned Live session has no browser lease; standalone spoken end closes with final usage',async t=>{
  const f=fixture(t);await f.voice.start(null,f.mirror,{owner:'wake'});
  assert.match(f.primary().sent[0].session.instructions,/opened by local Hey Mirror/);
  assert.equal(f.voice.state.owner,'wake');assert.ok(f.voice.active.readyAt);
  f.voice.active.lastBeat=Date.now()-100000;
  // A real watchdog tick: still active without a companion heartbeat.
  await new Promise(r=>setTimeout(r,1050));assert.ok(f.voice.active);
  f.primary().emit('event',{type:'session.input_transcript.delta',delta:"That's all."});
  await new Promise(r=>setTimeout(r,650));assert.equal(f.voice.active,null);assert.equal(f.voice.state.stopReason,'spoken_end');assert.equal(f.voice.blocked,undefined);
});
