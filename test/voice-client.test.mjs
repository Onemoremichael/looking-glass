import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/voice-client.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
function fixture(t,{microphone,answer,fetcher,resume,meterFails=false}={}){
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const elements={},listeners={},posts=[],logs=[],contexts=[],activity=[],peers=[];
  const el=id=>elements[id]??= {disabled:false,textContent:'',hidden:true,setAttribute(){},play:async()=>{}};
  const track={stopped:false,stop(){this.stopped=true;}},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  class AudioContext{constructor(){if(meterFails)throw Error('Unavailable');this.state='suspended';contexts.push(this);}resume(){return resume||Promise.resolve();}close(){this.state='closed';return Promise.resolve();}createAnalyser(){return {};}createMediaStreamSource(){return {connect(){}};}}
  class Peer{
    constructor(){peers.push(this);this.iceGatheringState='complete';this.localDescription={sdp:'v=0'};}
    addTrack(){} close(){} createOffer(){return Promise.resolve({sdp:'v=0'});}setLocalDescription(){return Promise.resolve();}
    createDataChannel(){return this.channel={readyState:'open',send(){},close(){}};}
    async setRemoteDescription(){if(answer)await answer;this.channel.onmessage({data:JSON.stringify({type:'session.started'})});}
  }
  const window={RTCPeerConnection:Peer,addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent:e=>{activity.push(e);listeners[e.type]?.(e);}};
  runInNewContext(source,{document:{getElementById:el},window,navigator:{mediaDevices:{getUserMedia:()=>microphone||Promise.resolve(stream)}},
    AudioContext,RTCPeerConnection:Peer,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},MediaStream:class{},AbortController,Uint8Array,setTimeout,clearTimeout,setInterval,clearInterval,
    console:{info:(...a)=>logs.push(a),warn:(...a)=>logs.push(a)},
    fetch:async(path,options)=>{
      posts.push(path);
      if(fetcher)return fetcher(path,options);
      return {ok:true,json:async()=>path.endsWith('/start')?{token:'test',transport:{sdp:'answer'}}:{phase:'off',detail:'Closed'}};
    },
  });
  return {el,posts,logs,track,stream,listeners,contexts,activity,peers};
}
test('suspended AudioContext meter does not block capture or voice startup',async t=>{
  const f=fixture(t,{resume:new Promise(()=>{})});await f.el('voice-start').onclick();
  assert.equal(f.contexts.length,0); // Meter isn't created on the permission path.
  f.peers[0].ontrack({track:{}});assert.equal(f.contexts.length,1);
  assert.ok(f.posts.includes('/api/voice/start'));
  assert.equal(f.el('voice-status').textContent,'Listening');
  f.el('voice-stop').onclick();await flush();assert.equal(f.track.stopped,true);
});
test('ignored microphone prompt times out without API call and stops a late stream',async t=>{
  const mic=deferred(),f=fixture(t,{microphone:mic.promise});const starting=f.el('voice-start').onclick();
  t.mock.timers.tick(15000);await starting;
  assert.match(f.el('voice-status').textContent,/Microphone access did not finish/);
  assert.equal(f.el('voice-start').disabled,false);assert.equal(f.posts.length,0);
  mic.resolve(f.stream);await flush();assert.equal(f.track.stopped,true);
});
test('End cancels preflight immediately and a late permission grant cannot start a session',async t=>{
  const mic=deferred(),f=fixture(t,{microphone:mic.promise});const starting=f.el('voice-start').onclick();
  f.el('voice-stop').onclick();await flush();await starting;
  assert.equal(f.el('voice-status').textContent,'Connection cancelled');
  mic.resolve(f.stream);await flush();assert.equal(f.track.stopped,true);assert.equal(f.posts.length,0);
});
test('stalled remote answer times out, stops capture and closes the allocated server session',async t=>{
  const f=fixture(t,{answer:new Promise(()=>{})});const starting=f.el('voice-start').onclick();await flush();
  assert.match(f.el('voice-status').textContent,/attaching browser audio/);
  t.mock.timers.tick(8000);await starting;
  assert.match(f.el('voice-status').textContent,/could not attach/);
  assert.equal(f.track.stopped,true);assert.ok(f.posts.includes('/api/voice/stop'));
});
test('stalled local fetch has a deadline and releases the microphone',async t=>{
  const f=fixture(t,{fetcher:(_path,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'}))))});
  const starting=f.el('voice-start').onclick();await flush();
  t.mock.timers.tick(30000);await starting;
  assert.match(f.el('voice-status').textContent,/local voice request timed out/);assert.equal(f.track.stopped,true);
});
test('shared update stream preserves startup stage and releases a closed owned session',async t=>{
  const answer=deferred(),f=fixture(t,{answer:answer.promise});const starting=f.el('voice-start').onclick();await flush();
  f.listeners['glass-voice']({detail:{phase:'connecting',detail:'Generic connecting'}});
  assert.match(f.el('voice-status').textContent,/attaching browser audio/);
  answer.resolve();await starting;
  f.listeners['glass-voice']({detail:{phase:'off',detail:'Session closed'}});
  assert.equal(f.el('voice-start').disabled,false);assert.equal(f.track.stopped,true);
  assert.doesNotMatch(source,/new EventSource/);
  const remote=readFileSync(new URL('../public/remote.js',import.meta.url),'utf8');
  assert.match(remote,/GlassSurface.subscribe/);assert.match(remote,/glass-voice/);
});
test('optional meter failure cannot prevent audio playback or a ready connection',async t=>{
  const f=fixture(t,{meterFails:true});await f.el('voice-start').onclick();
  assert.doesNotThrow(()=>f.peers[0].ontrack({track:{}}));
  assert.equal(f.el('voice-audio').hidden,false);assert.equal(f.el('voice-status').textContent,'Listening');
});
test('idle companion distinguishes another tab from its own microphone',async t=>{
  const f=fixture(t);
  f.listeners['glass-voice']({detail:{phase:'listening',detail:''}});
  assert.match(f.el('voice-status').textContent,/another companion tab/);assert.equal(f.el('voice-start').disabled,true);
  f.listeners['glass-voice']({detail:{phase:'off',detail:'Closed'}});
  assert.equal(f.el('voice-start').disabled,false);
  await f.el('voice-start').onclick();f.el('voice-stop').onclick();await flush();
  assert.deepEqual(f.activity.map(e=>e.detail),[true,false]);
});
test('Mirror mode never asks for a browser microphone or opens WebRTC; mute and end use server controls',async t=>{
  const f=fixture(t,{microphone:new Promise(()=>{})});f.el('voice-device').value='mirror';await f.el('voice-start').onclick();
  assert.equal(f.peers.length,0);assert.equal(f.el('voice-status').textContent,'Mirror microphone · listening');
  f.el('voice-mute').onclick();await flush();assert.ok(f.posts.includes('/api/voice/mute'));
  f.el('voice-stop').onclick();await flush();assert.ok(f.posts.includes('/api/voice/stop'));assert.equal(f.el('voice-device').disabled,false);
});
