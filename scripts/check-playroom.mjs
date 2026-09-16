// Owner-authorized adult simulation: Mac TTS -> room -> Mirror mic -> Live ->
// local game state -> Mirror speakers. Never substitute this for child QA.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),origin='http://localhost:8780';
if(!process.argv.includes('--run-paid')||!process.argv.includes('--adult-simulation'))throw Error('Explicit paid adult-simulation flags required');
const kind=process.argv.includes('--bear')?'bear':'animals';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function get(path){const r=await fetch(origin+path);if(!r.ok)throw Error('GET failed');return r.json();}
async function post(path,body){const r=await fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});const b=await r.json();if(!r.ok)throw Error(b.error||'Request failed');return b;}
let heartbeat,ownsRehearsal=false;
try{
  assert.equal((await get('/api/voice')).phase,'off','Do not interrupt an existing session');
  assert.equal((await get('/api/wake')).enabled,false,'Turn wake off before a rehearsal');
  await post('/api/playroom',{action:'start',kind,adultRehearsal:true});
  ownsRehearsal=true;
  const live=await post('/api/voice/start',{device:'mirror'});
  heartbeat=setInterval(()=>post('/api/voice/heartbeat',{token:live.token}).catch(()=>{}),3000);
  const answers=kind==='animals'?['An elephant.','A giraffe.','A penguin.','A bear.']:['The second one.','A kite.','Squeak.'];
  for(let i=0;i<answers.length;i++){
    const start=Date.now();await exec('say',['-r','145',answers[i]]);
    let game;
    for(let n=0;n<60;n++){game=(await get('/api/state')).playroom;if(game?.index===i+1)break;await pause(200);}
    assert.equal(game?.index,i+1,'Spoken answer did not advance the expected game step');
    console.log(JSON.stringify({kind,step:i+1,elapsedMs:Date.now()-start,feedback:game.feedback,phase:game.phase}));
    if(game.phase==='complete')break;
    // Let reply playback finish; a watchdog bounds the wait, never loops forever.
    await pause(900);
    for(let n=0;n<40;n++){if((await get('/api/voice')).phase==='listening')break;await pause(200);}
    await pause(500);
  }
  assert.equal((await get('/api/state')).playroom.phase,'complete');
  // A completed board alone isn't proof of a completed voice interaction.
  // Wait for the farewell and automatic release, before finally cleanup can
  // hide a lifecycle regression. The server's drain fallback is not a pass.
  let voice;
  for(let n=0;n<160;n++){voice=await get('/api/voice');if(['off','error'].includes(voice.phase))break;await pause(250);}
  assert.equal(voice.phase,'off','GPT-Live did not automatically finalize');
  assert.equal(voice.stopReason,'game_complete','Final audio was not confirmed drained before timeout');
  let audio;
  for(let n=0;n<16;n++){audio=await get('/api/mirror-audio');if(audio.connected&&audio.active===false&&audio.capturing===false)break;await pause(250);}
  assert.equal(audio.connected,true);assert.equal(audio.active,false);assert.equal(audio.capturing,false,'Native recorder did not confirm release');
  console.log(JSON.stringify({kind,automaticClose:true,stopReason:voice.stopReason,captureStopped:true}));
}finally{
  clearInterval(heartbeat);
  if(ownsRehearsal){
    await post('/api/playroom',{action:'stop'});
    const status=await get('/api/voice');console.log(JSON.stringify({closed:status.phase==='off',phase:status.phase}));
  }
}
