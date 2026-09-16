import {spawn,execFile} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const exec=promisify(execFile);

export class LocalRecognizer extends EventEmitter{
  constructor(){super();this.closed=false;this.generation=0;this.lastProgress=Date.now();}
  start(){
    const root=fileURLToPath(new URL('.',import.meta.url));
    return new Promise((resolve,reject)=>{
      const child=this.child=spawn(root+'data/wake/venv/bin/python',['-u',root+'scripts/playroom-recognizer.py'],{cwd:root,env:{PATH:'/usr/bin:/bin',PYTHONUNBUFFERED:'1'},stdio:['pipe','pipe','pipe']});
      let pending='',ready=false;
      const finish=error=>{clearTimeout(timer);this.off('closed',cancel);error?reject(error):resolve();};
      const cancel=()=>finish(Error('Local speech recognizer stopped'));
      const fail=()=>{if(this.closed)return;if(!ready)finish(Error('Local speech model unavailable; run playroom setup'));this.emit('fault');this.close();};
      const timer=setTimeout(fail,15000);this.once('closed',cancel);
      child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);child.stderr.on('data',()=>{});
      child.stdout.on('data',chunk=>{
        pending+=chunk.toString();if(pending.length>8192){fail();return;}
        let end;while((end=pending.indexOf('\n'))!==-1){
          const line=pending.slice(0,end);pending=pending.slice(end+1);
          try{const r=JSON.parse(line);
            if(r.type==='ready'){ready=true;finish();}
            else if(r.type==='progress')this.lastProgress=Date.now();
            else if(r.type==='answer'&&r.generation===this.generation&&typeof r.text==='string'&&r.text.length<=1000)this.emit('answer',r.text);
          }catch{fail();return;}
        }
      });
    });
  }
  write(buffer){if(this.closed||!this.child?.stdin.writable||this.child.stdin.writableLength>32000)throw Error('Local recognizer unavailable or falling behind');this.child.stdin.write(buffer);}
  reset(){this.generation++;this.lastProgress=Date.now();const frame=Buffer.alloc(5);frame[0]=0;frame.writeUInt32BE(this.generation,1);this.write(frame);}
  feed(pcm){if(pcm.length!==640)throw Error('Invalid PCM frame');this.write(Buffer.concat([Buffer.from([1]),pcm]));}
  close(){if(this.closed)return;this.closed=true;this.child?.stdin.destroy();this.child?.kill('SIGKILL');this.emit('closed');}
}

export function wavePCM(wav){
  if(wav.length>2_000_000||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw Error('Invalid speech WAV');
  let valid=false,data;
  for(let p=12;p+8<=wav.length;){const size=wav.readUInt32LE(p+4),end=p+8+size;if(end>wav.length)throw Error('Truncated speech WAV');const id=wav.toString('ascii',p,p+4);
    if(id==='fmt '){if(size<16)throw Error('Invalid PCM format');valid=wav.readUInt16LE(p+8)===1&&wav.readUInt16LE(p+10)===1&&wav.readUInt32LE(p+12)===16000&&wav.readUInt16LE(p+22)===16;}
    if(id==='data')data=wav.subarray(p+8,end);p=end+(size%2);
  }
  if(!valid||!data?.length||data.length%2)throw Error('Expected mono 16kHz PCM16');return Buffer.from(data);
}
// Only fixed game-engine prompts go into synthesis. Files contain generated
// speech, never mic input. Temporary files are removed on success and failure.
export async function synthesizeGameSpeech(text,{signal}={}){
  if(typeof text!=='string'||!text.trim()||text.length>1000)throw Error('Invalid local speech');
  const directory=await mkdtemp(join(tmpdir(),'glass-game-tts-'));
  try{const path=join(directory,'prompt.wav');await exec('/usr/bin/say',['-v','Samantha','-r','150','--file-format=WAVE','--data-format=LEI16@16000','-o',path,text],{signal,timeout:15000,env:{PATH:'/usr/bin:/bin'},maxBuffer:4096});return wavePCM(await readFile(path));}
  finally{await rm(directory,{recursive:true,force:true});}
}
