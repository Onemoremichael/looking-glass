import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Session} from '../session.mjs';
import {Voice,wakeIdle} from '../voice.mjs';
import {Assistant} from '../assistant.mjs';
import {createApp} from '../server.mjs';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
async function fixture(t,{native=false,fast=true,finalUsage=true,kind='bear'}={}){
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1000});
  const dir=mkdtempSync(join(tmpdir(),'game-live-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'budget.json');writeFileSync(path,JSON.stringify({approvedUSD:25,runs:[]}));
  const session=new Session();session.startPlayroom(kind);let config,hangups=0;
  class Socket extends EventEmitter{
    constructor(){super();this.sent=[];this.socket=new EventEmitter();this.socket.readyState=1;setImmediate(()=>this.socket.emit('open'));}
    send(e){this.sent.push(e);if(e.type==='session.start'){config=e.session;setImmediate(()=>this.emit('event',{type:'session.started',session:{id:'fixture'}}));}
      if(e.type==='session.close'&&finalUsage)queueMicrotask(()=>this.emit('event',{type:'session.closed',usage:{seconds:10}}));}
    close(){this.socket.readyState=3;this.socket.emit('close');}
  }
  const ws=new Socket(),stats={connected:true},mirror=new EventEmitter();
  Object.assign(mirror,{active:false,muted:false,status:()=>stats,start(){this.active=true;},stop(){this.active=false;},mute(v){this.muted=v;},output(){}});
  const voice=new Voice({session,budgetPath:path,fastTimers:fast,
    assistant:new Assistant({session,planner:{decide(){throw Error('No planner allowed');}}}),
    clientFactory:()=>({live:{create:async({session})=>{config=session;return {session:{id:'fixture'},transport:{sdp:'answer'}};},sessions:{hangup:async()=>{hangups++;}}}}),attachFactory:()=>ws});
  voice.primaryFactory=()=>ws;
  const started=await voice.start(native?null:'v=0',native?mirror:null);
  t.after(async()=>{if(voice.active){const p=voice.stop();t.mock.timers.tick(8000);await p;}});
  const say=async text=>{
    ws.emit('event',{type:'session.input_transcript.delta',delta:text});
    if(!fast)ws.emit('event',{type:'session.delegation.created',delegation:{id:'turn-'+session.state.playroom.turn,target:'client'}});
    t.mock.timers.tick(fast?700:900);await flush();
  };
  const beat=speaking=>voice.heartbeat(started.token,{ready:true,speaking});
  return {voice,ws,session,mirror,stats,path,say,beat,get config(){return config;},get hangups(){return hangups;}};
}
test('both Live transports preserve Marin and send structured verified game context',async t=>{
  const f=await fixture(t);assert.equal(f.config.model,'gpt-live-1');assert.equal(f.config.audio.output.voice,'marin');
  assert.equal(f.config.store,false);assert.match(f.config.instructions,/game_turn receipts/);
  await f.say('ocean');
  const r=JSON.parse(f.ws.sent.find(e=>e.type==='session.commentary.append').content);
  assert.equal(r.type,'game_turn');assert.deepEqual(r.game.choices,['ocean']);
  assert.deepEqual(r.game.options,['picnic','kite','drum']);assert.equal(f.voice.active.finishing,undefined);
});
test('WebRTC completion mutes first, freezes game and waits for observed playback plus quiet',async t=>{
  const f=await fixture(t);await f.say('ocean');await f.say('kite');await f.say('squeak');
  const a=f.voice.active;assert.ok(a.finishing);assert.equal(f.voice.state.finishing,true);
  const tail=f.ws.sent.slice(-2);assert.equal(tail[0].type,'session.input_audio.mute');assert.equal(JSON.parse(tail[1].content).game.phase,'complete');
  assert.equal(wakeIdle({...a,owner:'wake',readyAt:1},999999),false);
  await f.say('play again');assert.equal(f.session.state.playroom.phase,'complete');assert.equal(f.session.state.playroom.turn,3);
  f.ws.emit('event',{type:'session.delegation.created',delegation:{id:'late',target:'client'}});assert.equal(a.pending,null);
  f.beat(false);t.mock.timers.tick(4000);assert.ok(f.voice.active,'no speech is not proof of a played farewell');
  f.beat(true);t.mock.timers.tick(2000);f.beat(false);t.mock.timers.tick(750);assert.ok(f.voice.active);
  assert.equal(f.voice.state.phase,'speaking');
  t.mock.timers.tick(500);await flush();assert.equal(f.voice.active,null);assert.equal(f.voice.state.stopReason,'game_complete');
  assert.equal(f.voice.state.finishing,false);assert.equal(JSON.parse(readFileSync(f.path)).runs[0].status,'closed');
  const count=JSON.parse(readFileSync(f.path)).runs.length;
  await assert.rejects(()=>f.voice.start('v=0'),/Start a new game/);assert.equal(JSON.parse(readFileSync(f.path)).runs.length,count);
});
test('native farewell blocks PCM upload and waits for fresh speaker drain evidence',async t=>{
  const f=await fixture(t,{native:true});assert.equal(f.config.audio.output.voice,'marin');
  await f.say('ocean');await f.say('kite');await f.say('squeak');assert.equal(f.mirror.muted,true);
  f.mirror.emit('audio',Buffer.alloc(640));assert.equal(f.ws.sent.some(e=>e.type==='session.input_audio.append'),false);
  const pcm=Buffer.alloc(640);pcm.writeInt16LE(1000,0);
  f.ws.emit('event',{type:'session.output_audio.delta',delta:pcm.toString('base64')});
  t.mock.timers.tick(3250);assert.ok(f.voice.active,'missing playback report');
  Object.assign(f.stats,{receivedAt:Date.now(),playing:false,outputFrames:0});t.mock.timers.tick(250);assert.ok(f.voice.active,'queued output not played');
  Object.assign(f.stats,{receivedAt:1,outputFrames:1});t.mock.timers.tick(250);assert.ok(f.voice.active,'stale report');
  Object.assign(f.stats,{receivedAt:Date.now(),playing:true});t.mock.timers.tick(250);assert.ok(f.voice.active,'speakers still playing');
  Object.assign(f.stats,{receivedAt:Date.now(),playing:false});t.mock.timers.tick(250);await flush();
  assert.equal(f.voice.active,null);assert.equal(f.mirror.active,false);assert.equal(f.mirror.listenerCount('audio'),0);
});
test('delegated game completion also wraps; user stop is immediate and cancels wrap timers',async t=>{
  const f=await fixture(t,{fast:false});await f.say('moon');await f.say('drum');await f.say('hum');
  assert.ok(f.voice.active.finishing);await f.voice.stop();assert.equal(f.voice.active,null);
  t.mock.timers.tick(40000);assert.equal(f.ws.sent.filter(e=>e.type==='session.close').length,1);
});
test('spoken game stop closes immediately without soliciting a final answer',async t=>{
  const f=await fixture(t);await f.say('stop the game');await flush();assert.equal(f.voice.active,null);
  assert.equal(f.voice.state.stopReason,'game_stopped');assert.equal(f.ws.sent.some(e=>e.type==='session.commentary.append'),false);
});
test('animal final correct answer enters farewell without exposing a new question',async t=>{
  const f=await fixture(t,{kind:'animals'});
  for(const word of ['elephant','giraffe','penguin','bear'])await f.say(word);
  const receipt=JSON.parse(f.ws.sent.at(-1).content).game;
  assert.equal(receipt.phase,'complete');assert.equal(receipt.feedback,'correct');assert.equal(receipt.completed,4);
  assert.equal(receipt.total,4);assert.deepEqual(receipt.options,[]);assert.ok(f.voice.active.finishing);
});
test('completed-session cleanup cannot close a new game session later',async t=>{
  const f=await fixture(t);await f.say('forest');await f.say('picnic');await f.say('roar');
  await f.voice.stop();f.session.startPlayroom('animals');
  // A new fake transport opens asynchronously just as the real attachment does.
  f.voice.attachFactory=()=>{f.ws.socket.readyState=1;setImmediate(()=>f.ws.socket.emit('open'));return f.ws;};
  const next=await f.voice.start('v=0');
  for(let i=0;i<35;i++){f.voice.heartbeat(next.token,{ready:true});t.mock.timers.tick(1000);}
  assert.ok(f.voice.active);assert.equal(f.voice.active.finishing,undefined);assert.equal(f.voice.state.finishing,false);
});
test('missing speech closes at bounded deadline without inventing playback success',async t=>{
  const f=await fixture(t);await f.say('forest');await f.say('picnic');await f.say('roar');
  for(let i=0;i<30;i++){f.beat(false);t.mock.timers.tick(1000);}await flush();
  assert.equal(f.voice.active,null);assert.equal(f.voice.state.stopReason,'game_wrap_timeout');
});
test('wrap-up still requires terminal provider usage, not a socket close',async t=>{
  const f=await fixture(t,{finalUsage:false});await f.say('forest');await f.say('picnic');await f.say('roar');
  f.beat(true);t.mock.timers.tick(2000);f.beat(false);t.mock.timers.tick(1250);t.mock.timers.tick(8000);await flush();
  assert.equal(f.voice.active,null);assert.equal(f.voice.blocked,true);assert.equal(f.hangups,1);
  assert.equal(JSON.parse(readFileSync(f.path)).runs[0].status,'unconfirmed');
});
test('HTTP native unmute is refused while the game finishes',async t=>{
  const origins=[],app=createApp({origins});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(()=>{app.voice.active=null;return app.close();});
  const base='http://127.0.0.1:'+app.server.address().port;origins.push(base);let unmuted=false;
  app.voice.active={token:'fixture-token',finishing:{},mirror:{mute(){unmuted=true;}}};
  const res=await fetch(base+'/api/voice/mute',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({token:'fixture-token',muted:false})});
  assert.equal(res.status,409);assert.equal(unmuted,false);
});
