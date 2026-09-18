// Optional offline Mac smoke test. Synthetic speech only, never opens a mic/API.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const accents=process.argv.includes('--accents');
const shortcuts=process.argv.includes('--shortcuts');
const sensitivity=process.argv.includes('--sensitivity');
const detectorArgs=process.argv.slice(2).filter(arg=>!['--accents','--shortcuts','--sensitivity'].includes(arg));
const dir=mkdtempSync(join(tmpdir(),'glass-wake-check-'));
function run(cmd,args,options={}){const p=spawnSync(cmd,args,{timeout:20000,...options});if(p.error||p.status!==0)throw Error('Local wake smoke test failed: '+cmd);return p.stdout;}
function samples(wav){
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');
  for(let pos=12;pos+8<=wav.length;){const size=wav.readUInt32LE(pos+4);if(wav.toString('ascii',pos,pos+4)==='data')return wav.subarray(pos+8,pos+8+size);pos+=8+size+(size%2);}
  throw Error('No PCM chunk');
}
try{
  const failures=[];
  // --accents is a stricter characterization suite with known misses; do not
  // mistake a passing baseline for coverage of every accent or acoustic room.
  const voices=accents?['Samantha','Daniel','Karen','Moira','Rishi']:['Samantha','Daniel','Moira'];
  const cases=sensitivity?[
    ...['Samantha','Daniel','Moira'].flatMap(voice=>[.1,.03,.01].map(gain=>[voice,'Hey Mirror',true,1,gain])),
    ...['Hey Michael','Hey there','A mirror','Mirror mirror on the wall','Can you hear me','The mirror is near the window','Hey Siri','Hey Mary','Next week will be rainy'].map(phrase=>['Samantha',phrase,false]),
  ]:shortcuts?[
    ['Samantha','Next page',false,0,1,1,'next_page'],
    ['Daniel','Previous page',false,0,1,2,'previous_page'],
    ['Moira','Next page',false,0,1,3,'next_page'],
    ['Samantha','Hey Mirror',true,0,1,3],
    ['Samantha','Next page',false,0,1,0],
    ['Samantha','Previous page',false,0,1,1],
    ['Samantha','We should go shopping. The weather is nice today.',false,0,1,3],
  ]:[...voices.map(voice=>[voice,'Hey Mirror',true]),
    ['Samantha','Hey Mirror',true,20,.1],
    ['Samantha','The weather is nice today. Set a timer for ten minutes. There is a mirror on the wall.',false],
    ['Samantha','Hey Michael. Mirror mirror on the wall. Can you hear me?',false],
    ['Daniel','Are we going to dinner tonight? Could you pass me the water? The mirror is upstairs.',false],
    ['Samantha','We should go shopping later. There is milk in the fridge. Hey Mirror.',true]];
  for(const [voice,phrase,wantWake,lead=0,gain=1,mask=0,wantShortcut] of cases){
    const aiff=join(dir,'speech.aiff'),wav=join(dir,'speech.wav');
    run('/usr/bin/say',['-v',voice,'-o',aiff,phrase]);run('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',aiff,wav]);
    const speech=Buffer.from(samples(readFileSync(wav)));
    for(let i=0;i+1<speech.length;i+=2)speech.writeInt16LE(Math.round(speech.readInt16LE(i)*gain),i);
    const pcm=Buffer.concat([Buffer.alloc(lead*32000),speech,Buffer.alloc(32000)]),frames=[];
    for(let i=0;i<pcm.length;i+=640){const frame=Buffer.alloc(641);frame[0]=1;pcm.copy(frame,1,i,Math.min(i+640,pcm.length));frames.push(frame);}
    const profile=Buffer.alloc(6);profile[0]=2;profile[1]=mask;profile.writeUInt32LE(42,2);
    const output=run(root+'/data/wake/venv/bin/python',[root+'/scripts/wake-detector.py',...detectorArgs],{input:Buffer.concat([profile,...frames])}).toString();
    const events=output.trim().split('\n').map(line=>JSON.parse(line)),commands=events.filter(e=>e.type==='shortcut');
    const passed=events.some(e=>e.type==='wake')===wantWake&&(wantShortcut?commands.length===1&&commands[0].command===wantShortcut&&commands[0].generation===42:commands.length===0);
    const label=voice+': '+phrase+((lead||gain!==1)?` (after ${lead}s, gain ${gain})`:'');
    if(!passed)failures.push(label);
    console.log(passed?'PASS:':'FAIL:',label);
  }
  assert.deepEqual(failures,[], 'Wake regression failures');
}finally{rmSync(dir,{recursive:true,force:true});}
