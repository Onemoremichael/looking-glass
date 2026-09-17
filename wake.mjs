import {WakeDetector} from './wake-detector.mjs';

export function readyChime(){
  const pcm=Buffer.alloc(9600); // 300 ms, quiet two-note local cue; no asset/API.
  for(let i=0;i<4800;i++){
    const t=i/16000, envelope=Math.sin(Math.PI*i/4800)**2;
    pcm.writeInt16LE(Math.round(2200*envelope*Math.sin(2*Math.PI*(t<.15?660:880)*t)),i*2);
  }
  return pcm.toString('base64');
}

// Explicit, finite arming. Standby is local and ephemeral; wake sessions have a
// server owner, NOT an artificial browser heartbeat. No automatic API retries.
export class Wake {
  constructor({voice,mirror,detectorFactory=()=>new WakeDetector(),publish=()=>{},now=Date.now}){
    Object.assign(this,{voice,mirror,detectorFactory,publish,now});
    this.state={enabled:false,phase:'off',phrase:'Hey Mirror',count:0};this.generation=0;
    voice.resumeBackground=origin=>this.resumeBackground(origin);
    this.audio=pcm=>{if(this.state.phase==='standby'){try{this.detector.feed(pcm);}catch{void this.disable('detector_error');}}};
    this.disconnected=()=>void this.disable('mirror_disconnected');
    mirror?.on('standby-audio',this.audio);mirror?.on('disconnect',this.disconnected);mirror?.on('fault',this.disconnected);
  }
  update(patch){Object.assign(this.state,patch);this.publish({...this.state});}
  async enable({test=false}={}){
    if(this.state.enabled)throw Error('Wake listening is already enabled');
    if(this.voice.active)throw Error('End the current conversation first');
    if(this.voice.blocked)throw Error('Voice accounting needs review before enabling wake listening');
    if(!this.mirror?.status().wakeCapable)throw Error('Connect the updated Mirror audio bridge first');
    const generation=++this.generation;
    this.update({enabled:true,phase:'starting',test,count:0,reason:null,expiresAt:this.now()+30*60*1000});
    const detector=this.detector=this.detectorFactory();
    detector.on('wake',()=>void this.trigger());
    detector.on('fault',()=>void this.disable('detector_error'));
    try{
      await detector.start();if(generation!==this.generation){detector.close();return;}
      this.standby();this.timer=setInterval(()=>this.tick(),500);
    }catch(e){if(generation===this.generation)await this.disable('detector_error');throw e;}
  }
  standby(){this.detector.reset();this.mirror.standby();this.update({phase:'standby'});}
  async trigger(){
    if(!this.state.enabled||this.state.phase!=='standby'||this.voice.active)return;
    const generation=this.generation;
    this.update({phase:'connecting',count:this.state.count+1});
    try{
      this.mirror.connecting();this.detector.reset();
      if(this.state.test){
        this.mirror.start();this.mirror.chime(readyChime());
        this.cooldownUntil=this.now()+4000;this.update({phase:'cooldown'});return;
      }
      await this.voice.start(null,this.mirror,{owner:'wake'});
      if(generation!==this.generation){await this.voice.stop(undefined,'wake_disabled');return;}
      this.mirror.chime(readyChime());
      this.update({phase:'conversation'});
    }catch{if(generation===this.generation)await this.disable('startup_failed');}
  }
  async resumeBackground(origin){
    if(this.voice.active)return !this.voice.active.closing;
    if(this.voice.blocked||!this.mirror?.status().connected)return false;
    const armed=this.state.enabled;
    // Wake-origin work never opens a microphone after disarm/expiry. Manual
    // Mirror work may announce once without enabling an always-listening mode.
    if(origin.owner==='wake'&&(!armed||this.state.test||this.now()>=this.state.expiresAt||this.state.count>=10))return false;
    if(armed&&(this.state.test||this.state.phase==='connecting'))return false;
    const generation=this.generation;
    if(armed)this.update({phase:'connecting',count:this.state.count+1});
    try{
      this.mirror.connecting();this.detector?.reset();
      await this.voice.start(null,this.mirror,{owner:'wake',resuming:true});
      if(generation!==this.generation){await this.voice.stop(undefined,'wake_disabled');return false;}
      if(armed)this.update({phase:'conversation'});
      return true;
    }catch{
      if(armed&&generation===this.generation)await this.disable('startup_failed');
      return false;
    }
  }
  tick(){
    if(!this.state.enabled)return;
    if(this.now()>=this.state.expiresAt){void this.disable('arming_expired');return;}
    if(this.state.phase==='standby'&&this.now()-this.detector.lastProgress>5000){void this.disable('audio_or_detector_stalled');return;}
    if(this.state.phase==='conversation'&&!this.voice.active){
      if(['game_complete','game_stopped','game_wrap_timeout'].includes(this.voice.state.stopReason)){void this.disable('game_finished');return;}
      if(this.voice.state.stopReason==='spoken_disable'){void this.disable('spoken_disable');return;}
      if(this.voice.blocked||!['idle_timeout','spoken_end','duration_limit','user'].includes(this.voice.state.stopReason)){
        void this.disable('voice_ended_unexpectedly');return;
      }
      this.cooldownUntil=this.now()+4000;this.update({phase:'cooldown'});
    }
    if(this.state.phase==='cooldown'&&this.now()>=this.cooldownUntil){
      if(this.state.count>=10){void this.disable('wake_limit');return;}
      try{this.standby();}catch{void this.disable('mirror_disconnected');}
    }
  }
  async disable(reason='user'){
    this.voice.suppressBackground?.({cancel:['user','shutdown','spoken_disable'].includes(reason)});
    ++this.generation;clearInterval(this.timer);clearTimeout(this.cueTimer);this.detector?.close();
    this.update({enabled:false,phase:'off',reason,expiresAt:null});
    if(this.voice.active?.owner==='wake')await this.voice.stop(undefined,'wake_disabled');
    else if(!this.voice.active)this.mirror?.stop();
  }
  async close(){await this.disable('shutdown');this.mirror?.off('standby-audio',this.audio);this.mirror?.off('disconnect',this.disconnected);this.mirror?.off('fault',this.disconnected);}
}
