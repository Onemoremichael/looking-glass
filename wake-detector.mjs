import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';

// This subprocess only gets PCM over stdin. Deliberately do not pass API keys.
export class WakeDetector extends EventEmitter {
  async start(){
    const root=fileURLToPath(new URL('.',import.meta.url));
    this.closed=false;this.lastProgress=Date.now();
    const child=this.child=spawn(root+'data/wake/venv/bin/python',['-u',root+'scripts/wake-detector.py'],{
      cwd:root,env:{PATH:'/usr/bin:/bin',PYTHONUNBUFFERED:'1'},stdio:['pipe','pipe','pipe'],
    });
    child.stdin.on('error',()=>this.fail());
    child.stderr.on('data',()=>{}); // Never persist audio or subprocess output.
    let pending='';
    child.stdout.on('data',chunk=>{
      pending+=chunk.toString();if(pending.length>8192){this.fail();return;}
      let newline;while((newline=pending.indexOf('\n'))>=0){
        const line=pending.slice(0,newline);pending=pending.slice(newline+1);
        try{const {type}=JSON.parse(line);if(type==='progress')this.lastProgress=Date.now();
          else if(type==='ready'||type==='wake')this.emit(type);
        }catch{this.fail();}
      }
    });
    return new Promise((resolve,reject)=>{
      const finish=error=>{clearTimeout(timer);this.off('ready',ready);this.off('fault',failed);this.off('closed',failed);error?reject(error):resolve();};
      const ready=()=>finish(),failed=()=>finish(Error('Local wake detector unavailable. Run the wake setup instructions.'));
      const timer=setTimeout(()=>{this.fail();},15000);
      this.once('ready',ready);this.once('fault',failed);this.once('closed',failed);
      child.on('error',()=>this.fail());child.on('exit',()=>this.fail());
    });
  }
  write(type,data=Buffer.alloc(0)){
    if(this.closed)return;
    if(!this.child?.stdin.writable||this.child.stdin.writableLength>32000)throw Error('Local wake detector is falling behind');
    this.child.stdin.write(Buffer.concat([Buffer.from([type]),data]));
  }
  feed(pcm){this.write(1,pcm);}
  reset(){this.lastProgress=Date.now();this.write(0);}
  fail(){if(this.closed)return;this.emit('fault');this.close();}
  close(){if(this.closed)return;this.closed=true;this.child?.stdin.destroy();this.child?.kill('SIGKILL');this.emit('closed');}
}
