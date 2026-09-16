// Optional offline Mac smoke test. Synthetic speech only, never opens a mic/API.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const accents=process.argv.includes('--accents');
const detectorArgs=process.argv.slice(2).filter(arg=>arg!=='--accents');
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
  const cases=[...voices.map(voice=>[voice,'Hey Mirror',true]),
    ['Samantha','Hey Mirror',true,20,.1],
    ['Samantha','The weather is nice today. Set a timer for ten minutes. There is a mirror on the wall.',false],
    ['Samantha','Hey Michael. Mirror mirror on the wall. Can you hear me?',false],
    ['Daniel','Are we going to dinner tonight? Could you pass me the water? The mirror is upstairs.',false],
    ['Samantha','We should go shopping later. There is milk in the fridge. Hey Mirror.',true]];
  for(const [voice,phrase,wantWake,lead=0,gain=1] of cases){
    const aiff=join(dir,'speech.aiff'),wav=join(dir,'speech.wav');
    run('/usr/bin/say',['-v',voice,'-o',aiff,phrase]);run('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',aiff,wav]);
    const speech=Buffer.from(samples(readFileSync(wav)));
    for(let i=0;i+1<speech.length;i+=2)speech.writeInt16LE(Math.round(speech.readInt16LE(i)*gain),i);
    const pcm=Buffer.concat([Buffer.alloc(lead*32000),speech,Buffer.alloc(32000)]),frames=[];
    for(let i=0;i<pcm.length;i+=640){const frame=Buffer.alloc(641);frame[0]=1;pcm.copy(frame,1,i,Math.min(i+640,pcm.length));frames.push(frame);}
    const output=run(root+'/data/wake/venv/bin/python',[root+'/scripts/wake-detector.py',...detectorArgs],{input:Buffer.concat(frames)}).toString();
    const events=output.trim().split('\n').map(line=>JSON.parse(line));const passed=events.some(e=>e.type==='wake')===wantWake;
    const label=voice+': '+phrase+(lead?` (after ${lead}s, gain ${gain})`:'');
    if(!passed)failures.push(label);
    console.log(passed?'PASS:':'FAIL:',label);
  }
  assert.deepEqual(failures,[], 'Wake regression failures');
}finally{rmSync(dir,{recursive:true,force:true});}
