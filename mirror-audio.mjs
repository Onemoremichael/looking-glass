import net from 'node:net';
import {EventEmitter} from 'node:events';

// USB adb reverse only. No LAN listener, browser access, audio files or API keys.
// Frames: one byte type, uint32 big-endian length, payload (PCM16LE mono 16kHz).
export class MirrorAudio extends EventEmitter {
  constructor(){super();this.peer=null;this.active=false;this.stats={};this.server=net.createServer(s=>this.connect(s));}
  listen(port=8782){return new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(port,'127.0.0.1',resolve);});}
  status(){return {connected:!!this.peer?.hello,wakeCapable:!!this.peer?.wakeCapable,mode:this.mode||'off',active:this.active,...this.stats};}
  connect(s){
    if(this.peer){s.destroy();return;}
    this.peer=s;s.setNoDelay(true);s.setTimeout(5000,()=>s.destroy());let pending=Buffer.alloc(0);
    s.on('error',()=>{});
    s.on('close',()=>{if(this.peer===s){this.peer=null;this.active=false;this.mode='off';this.stats={};this.emit('disconnect');}});
    s.on('data',chunk=>{
      pending=Buffer.concat([pending,chunk]);
      while(pending.length>=5){
        const type=pending[0],length=pending.readUInt32BE(1);
        if(length>65536){s.destroy();return;}
        if(pending.length<5+length)return;
        const data=pending.subarray(5,5+length);pending=pending.subarray(5+length);
        try{
          if(type===1&&!s.hello){const hello=JSON.parse(data);if(hello.version!==1||hello.rate!==16000)throw Error();s.hello=true;s.wakeCapable=hello.wake===true;this.stats={};}
          else if(!s.hello)throw Error();
          else if(type===2){if(data.length!==640)throw Error();if(this.active)this.emit('audio',data);else if(this.mode==='standby')this.emit('standby-audio',data);}
          else if(type===3){const m=JSON.parse(data);this.stats={receivedAt:Date.now(),capturing:!!m.capturing,playing:!!m.playing,rms:Number(m.rms)||0,peak:Number(m.peak)||0,inputFrames:Number(m.inputFrames)||0,outputFrames:Number(m.outputFrames)||0};if(m.error)this.emit('fault');}
          else if(type===4)this.send(14); // local keepalive, not a paid-session lease
          else if(type===6&&this.mode==='conversation')this.active=true; // Fresh capture, never queued standby PCM.
        }catch{s.destroy();return;}
      }
    });
  }
  send(type,data=Buffer.alloc(0)){
    const s=this.peer;if(!s?.hello||s.destroyed)throw Error('Mirror audio is not connected');
    if(s.writableLength>128000){s.destroy();throw Error('Mirror audio is falling behind');}
    const header=Buffer.alloc(5);header[0]=type;header.writeUInt32BE(data.length,1);s.write(Buffer.concat([header,data]));
  }
  start(){this.stats={};this.outputFramesSent=0;this.mode='conversation';this.active=!this.peer?.wakeCapable;this.send(10);}
  standby(){if(!this.peer?.wakeCapable)throw Error('Mirror needs wake-capable APK');this.active=false;this.mode='standby';this.send(15,Buffer.from([0]));}
  connecting(){this.active=false;this.mode='connecting';this.send(15,Buffer.from([1]));}
  stop(){this.active=false;this.mode='off';try{this.send(11);}catch{}}
  mute(value){this.send(12,Buffer.from([value?1:0]));}
  // Android splits each message into <=640-byte playback blocks and reports
  // outputFrames per block, not per provider message. Count cue blocks as well.
  chime(pcm){if(this.mode==='conversation'){const data=Buffer.from(pcm,'base64');this.send(16,data);return this.outputFramesSent+=Math.ceil(data.length/640);}}
  output(base64){if(this.mode==='conversation'){const data=Buffer.from(base64,'base64');this.send(13,data);return this.outputFramesSent+=Math.ceil(data.length/640);}}
  close(){this.stop();this.peer?.destroy();this.server.close();}
}
