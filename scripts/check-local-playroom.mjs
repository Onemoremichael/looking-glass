// Explicit local acceptance checks. Synthetic mode never opens a microphone;
// adult simulation plays generated speech into the physical Mirror microphone.
// Neither mode starts cloud voice or records microphone audio/transcripts.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as pause} from 'node:timers/promises';
import {LocalRecognizer,synthesizeGameSpeech} from '../local-speech.mjs';
import {newGame,advanceGame} from '../playroom.mjs';
const exec=promisify(execFile);
const synthetic=process.argv.includes('--synthetic'),physical=process.argv.includes('--adult-simulation');
const voice=process.argv.includes('--daniel')?'Daniel':'Samantha';
if(synthetic===physical)throw Error('Choose --synthetic OR --adult-simulation (opens Mirror mic)');
const answers={animals:['An elephant.','A giraffe.','A penguin.','A bear.'],bear:['The second one.','A kite.','Squeak.']};
if(process.argv.includes('--full-answers'))answers.animals=['I think it is an elephant.','It is a giraffe.','It is a penguin.','That is a bear.'];
if(process.argv.includes('--ordinals'))answers.bear=['The second one.','The second one.','The third one.'];

if(synthetic){
  const recognizer=new LocalRecognizer();let recognized=[],fault=false;
  recognizer.on('answer',text=>recognized.push(text));recognizer.on('fault',()=>fault=true);
  try{
    await recognizer.start();
    if(process.argv.includes('--safety')){
      for(const text of ['', 'It is not an elephant.', 'An elephant or a giraffe.', 'My wife said elephant.']){
        const pcm=text?await synthesizeGameSpeech(text,{voice}):Buffer.alloc(32000);
        recognized=[];recognizer.reset();const audio=Buffer.concat([pcm,Buffer.alloc(96000)]);
        for(let p=0;p<audio.length;p+=640){const frame=Buffer.alloc(640);audio.copy(frame,0,p,Math.min(p+640,audio.length));recognizer.feed(frame);await pause(20);}
        await pause(300);assert.equal(fault,false);
        if(!text)assert.equal(recognized.length,0,'Silence must not fabricate an answer');
        else assert.ok(recognized.length,'Safety speech must actually be decoded, not pass by being dropped');
        for(const result of recognized){const game=advanceGame(newGame('animals'),result);assert.equal(game.index,0);assert.equal(game.feedback,'uncertain','Negation or background speech must not grade an answer');}
        console.log(JSON.stringify({mode:'synthetic-safety',case:text?'speech':'silence',decoded:recognized.length,passed:true}));
      }
    }else{
    // Vary the onset so a decoder that loses word beginnings cannot pass only
    // because one fixture happened to line up with its internal chunk boundary.
    for(const leadMs of [0,500,1000])for(const kind of ['animals','bear']){
      let game=newGame(kind);
      for(const text of answers[kind]){
        const pcm=await synthesizeGameSpeech(text,{voice});recognized=[];recognizer.reset();
        const audio=Buffer.concat([Buffer.alloc(leadMs*32),pcm,Buffer.alloc(96000)]);
        for(let p=0;p<audio.length;p+=640){
          const block=Buffer.alloc(640);audio.copy(block,0,p,Math.min(p+640,audio.length));
          recognizer.feed(block);await pause(20);
        }
        for(let n=0;n<20&&!recognized.length&&!fault;n++)await pause(50);
        assert.equal(fault,false,'Recognizer fault');assert.equal(recognized.length,1,`Expected one utterance: ${kind} step ${game.index+1}, onset ${leadMs} ms`);
        const before=game.index;game=advanceGame(game,recognized[0]);assert.equal(game.index,before+1,`Synthetic ${kind} answer ${before+1} misrecognized as ${JSON.stringify(recognized[0])}`);
      }
      assert.equal(game.phase,'complete');console.log(JSON.stringify({mode:'synthetic',kind,leadMs,completed:true}));
    }
    }
  }finally{recognizer.close();}
}else{
  const origin='http://localhost:8780',kind=process.argv.includes('--bear')?'bear':'animals';
  async function get(path){const r=await fetch(origin+path,{signal:AbortSignal.timeout(5000)});assert.ok(r.ok,'GET failed');return r.json();}
  async function post(path,body){const r=await fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const b=await r.json();if(!r.ok)throw Error(b.error||'Request failed');return b;}
  async function until(check,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await pause(150);}throw Error('Local audio acceptance timeout');}
  let owns=false;
  try{
    assert.equal((await get('/api/voice')).phase,'off');assert.equal((await get('/api/wake')).enabled,false);
    assert.equal((await get('/api/playroom-audio')).phase,'off');assert.ok(!(await get('/api/state')).playroom,'Do not replace an existing game');
    await until(async()=> (await get('/api/mirror-audio')).connected,10000);
    await post('/api/playroom',{action:'start',kind,adultRehearsal:true});owns=true;
    await post('/api/playroom-audio',{action:'start',adultRehearsal:true});
    for(let i=0;i<answers[kind].length;i++){
      await until(async()=> (await get('/api/playroom-audio')).phase==='listening');
      const start=Date.now();await exec('/usr/bin/say',['-v',voice,'-r','150',answers[kind][i]],{timeout:10000});
      await until(async()=> (await get('/api/state')).playroom?.index===i+1,12000);
      console.log(JSON.stringify({mode:'physical',kind,step:i+1,elapsedMs:Date.now()-start}));
    }
    await until(async()=> (await get('/api/playroom-audio')).phase==='off',30000);
    assert.equal((await get('/api/state')).playroom.phase,'complete');console.log(JSON.stringify({kind,completed:true}));
  }catch(e){
    console.log(JSON.stringify({failed:true,audio:await get('/api/playroom-audio'),mirror:await get('/api/mirror-audio')}));throw e;
  }finally{
    if(owns){await post('/api/playroom',{action:'stop'});assert.equal((await get('/api/playroom-audio')).phase,'off');console.log(JSON.stringify({microphoneOff:true}));}
  }
}
