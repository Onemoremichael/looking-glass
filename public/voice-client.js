// Modern Mac-only audio adapter. Never loaded by the Android mirror display.
const start = document.getElementById('voice-start');
const stop = document.getElementById('voice-stop');
const mute = document.getElementById('voice-mute');
const status = document.getElementById('voice-status');
const audio = document.getElementById('voice-audio');
const device = document.getElementById('voice-device');
let run = null;
let wakeState={enabled:false},serverVoice={phase:'off'};
const wakeEnable=document.getElementById('wake-enable'),wakeTest=document.getElementById('wake-test'),wakeDisable=document.getElementById('wake-disable');
async function wakePost(action,body={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  try{const response=await fetch('/api/wake/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const value=await response.json();if(!response.ok)throw Error(value.error||'Wake request failed');renderWake(value);return value;
  }finally{clearTimeout(timer);}
}
function renderWake(value){
  const wasEnabled=wakeState.enabled;
  wakeState=value;
  const active=run||!['off','error'].includes(serverVoice.phase);
  wakeEnable.disabled=wakeTest.disabled=!!value.enabled||!!active;
  wakeDisable.disabled=!value.enabled;
  if(!run)start.disabled=!!value.enabled||!!active;
  const localDetail=value.phase==='starting'?'Preparing local wake detector · microphone off':value.phase==='standby'?'Local wake listening · cloud voice off':value.phase==='connecting'?'Wake detected · connecting…':'Returning to local standby · cloud voice off';
  if(!run&&!active&&(value.enabled||wasEnabled))paint(value.enabled?'standby':serverVoice.phase,value.enabled?localDetail:serverVoice.detail);
  const label={starting:'Starting local detector…',standby:'Say “Hey Mirror” · local listening',connecting:'Wake detected · connecting…',conversation:'Conversation active',cooldown:'Returning to local standby…',off:'Wake listening off'}[value.phase]||'Wake listening off';
  document.getElementById('wake-status').textContent=label+(value.test&&value.enabled?' · test only':'')+(value.enabled?' · '+value.count+'/10 wakes':'')+(value.reason&&value.reason!=='user'?' · '+value.reason.replaceAll('_',' '):'');
}
async function wakeClick(action,body){
  wakeEnable.disabled=wakeTest.disabled=true;
  try{await wakePost(action,body);}catch(e){document.getElementById('wake-status').textContent=e.message;wakeEnable.disabled=wakeTest.disabled=false;wakeDisable.disabled=false;}
}
wakeEnable.onclick=()=>wakeClick('enable',{test:false});wakeTest.onclick=()=>wakeClick('enable',{test:true});wakeDisable.onclick=()=>wakeClick('disable');
window.addEventListener('glass-wake',e=>renderWake(e.detail));
fetch('/api/wake').then(r=>r.json()).then(renderWake).catch(()=>{});
function ownVoice(active){window.dispatchEvent(new CustomEvent('glass-voice-active',{detail:active}));}
async function post(path,body) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),path==='start'?30000:12000);
  try{
    const response = await fetch('/api/voice/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const result=await response.json(); if(!response.ok) throw Error(result.error || 'Voice request failed'); return result;
  }catch(e){
    if(e.name==='AbortError')throw Error('The local voice request timed out. Close extra companion tabs and retry after the server closes any pending session.');
    throw e;
  }finally{clearTimeout(timeout);}
}
function waitFor(r,promise,ms,message){
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>finish(reject,Error(message)),ms);
    const cancel=()=>finish(reject,Error('Connection cancelled'));
    const finish=(fn,value)=>{clearTimeout(timeout);if(r.cancelWait===cancel)r.cancelWait=null;fn(value);};
    r.cancelWait=cancel;Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));
  });
}
function stage(r,name,detail){
  r.stage=name;console.info('[voice startup]',name);paint('connecting',detail);
}
function paint(phase,detail) {
  document.getElementById('voice-card').setAttribute('data-phase',phase);
  status.textContent=detail || ({off:'Microphone off',listening:'Listening',speaking:'Speaking',muted:'Microphone muted',thinking:'Checking your request',connecting:'Connecting…',stopping:'Finishing…'}[phase] || phase);
}
function release(r) {
  r.cancelWait?.();r.cancelWait=null;
  clearInterval(r.beat); clearTimeout(r.deadline); clearTimeout(r.readyTimeout);
  r.stream?.getTracks().forEach(t=>t.stop()); r.channel?.close(); r.peer?.close();
  if(r.context && r.context.state!=='closed') void r.context.close().catch(()=>{});
  if(run===r) { device.disabled=false;audio.srcObject=null; audio.hidden=true;run=null; ownVoice(false); start.disabled=false; stop.disabled=true; mute.disabled=true; mute.textContent='Mute microphone'; mute.setAttribute('aria-pressed','false'); }
}
async function end() {
  const r=run; if(!r || r.closing)return;
  r.closing=true; stop.disabled=true; mute.disabled=true; paint('stopping');
  r.cancelWait?.();
  // Stop capture immediately; keep connection open long enough for terminal usage.
  r.stream?.getTracks().forEach(t=>t.stop());
  if(r.channel?.readyState==='open') r.channel.send(JSON.stringify({type:'session.close'}));
  try {
    if(r.token) { const result=await post('stop',{token:r.token}); paint(result.phase,result.detail); }
    else paint('off','Connection cancelled');
  } catch { paint('error','Connection lost; server watchdog will close the session.'); }
  finally { release(r); }
}
start.onclick=async()=>{
  if(run||wakeState.enabled)return;
  if(device.value==='mirror'){
    const r=run={ready:false,muted:false,closing:false,mirror:true};device.disabled=true;start.disabled=true;stop.disabled=false;ownVoice(true);
    paint('connecting','Connecting the Mirror microphone and speakers…');
    try{
      const result=await post('start',{device:'mirror'});r.token=result.token;
      if(r.closing||run!==r){await post('stop',{token:r.token});return;}
      r.ready=true;mute.disabled=false;paint('listening','Mirror microphone · listening');
      r.beat=setInterval(()=>post('heartbeat',{token:r.token,ready:true,muted:r.muted}).catch(()=>void end()),1000);
      r.deadline=setTimeout(()=>void end(),175000);
    }catch(e){if(run===r){release(r);paint('error',e.message);}}
    return;
  }
  if(!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) { paint('error','Use a current Mac browser on localhost for voice.'); return; }
  const r=run={ready:false,muted:false,closing:false}; device.disabled=true;start.disabled=true; stop.disabled=false; paint('connecting','Allow the Mac microphone to begin.');
  ownVoice(true);
  try {
    // Request capture directly from the click. Optional audio metering is not a
    // prerequisite for microphone permission, WebRTC, or assistant playback.
    stage(r,'microphone','Waiting for microphone access… Check the browser permission prompt.');
    const microphone=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    microphone.then(stream=>{if(r.closing||run!==r)stream.getTracks().forEach(t=>t.stop());},()=>{});
    r.stream=await waitFor(r,microphone,15000,'Microphone access did not finish. Check browser and macOS microphone permissions, then retry.');
    if(r.closing || run!==r) { release(r); return; }
    r.peer=new RTCPeerConnection();
    r.stream.getAudioTracks().forEach(t=>r.peer.addTrack(t,r.stream));
    r.peer.ontrack=e=>{
      if(run!==r||r.closing)return;
      const stream=new MediaStream([e.track]); audio.srcObject=stream; audio.hidden=false;
      audio.play().catch(()=>paint('error','Press Play below to enable the assistant’s audio.'));
      try {
        r.context=new AudioContext();void r.context.resume().catch(()=>{});
        r.analyser=r.context.createAnalyser(); r.analyser.fftSize=256;
        r.context.createMediaStreamSource(stream).connect(r.analyser);
      }catch{r.analyser=null;console.warn('[voice startup] optional audio meter unavailable');}
    };
    r.peer.onconnectionstatechange=()=>{ if(['failed','disconnected'].includes(r.peer.connectionState)&&!r.closing) void end(); };
    r.channel=r.peer.createDataChannel('oai-events');
    r.channel.onmessage=({data})=>{
      if(run!==r||r.closing)return;
      const event=JSON.parse(data);
      if(event.type==='session.started') { r.ready=true; clearTimeout(r.readyTimeout); mute.disabled=false; paint('listening'); }
      if(event.type==='session.closed') { paint('off','Microphone off · session closed'); release(r); }
      if(event.type==='error') { paint('error','Voice reported an error; ending the session.'); void end(); }
    };
    r.channel.onclose=()=>{ if(run===r&&!r.closing) void end(); };
    stage(r,'network','Microphone ready · negotiating the audio connection…');
    const offer=await waitFor(r,r.peer.createOffer(),5000,'Could not prepare the browser audio connection.');
    await waitFor(r,r.peer.setLocalDescription(offer),5000,'Could not prepare the browser audio offer.');
    await waitFor(r,new Promise(resolve=>{
      if(r.peer.iceGatheringState==='complete')return resolve();
      r.peer.addEventListener('icegatheringstatechange',()=>{if(r.peer.iceGatheringState==='complete')resolve();});
    }),10000,'Browser network negotiation timed out.');
    if(r.closing)return;
    stage(r,'server','Connecting the voice service…');
    const result=await post('start',{sdp:r.peer.localDescription.sdp}); r.token=result.token;
    if(r.closing || run!==r) { await post('stop',{token:r.token}); return; }
    stage(r,'answer','Voice service connected · attaching browser audio…');
    await waitFor(r,r.peer.setRemoteDescription({type:'answer',sdp:result.transport.sdp}),8000,'The browser could not attach the voice connection.');
    if(r.closing || run!==r)return;
    if(!r.ready){
      stage(r,'ready','Waiting for the voice audio channel…');
      r.readyTimeout=setTimeout(()=>{if(!r.ready){console.warn('[voice startup] ready_timeout');void end();}},15000);
    }
    r.beat=setInterval(()=>{
      let speaking=false;
      if(r.analyser&&!audio.paused&&!audio.muted) {
        const samples=new Uint8Array(256);r.analyser.getByteTimeDomainData(samples);
        speaking=samples.some(v=>Math.abs(v-128)>3);
      }
      post('heartbeat',{token:r.token,ready:r.ready,muted:r.muted,speaking}).catch(()=>{if(!r.closing)void end();});
    },1000);
    r.deadline=setTimeout(()=>void end(),175000);
  } catch(e) {
    if(r.closing||run!==r)return;
    r.closing=true;
    r.stream?.getTracks().forEach(t=>t.stop());
    const detail=e.name==='NotAllowedError'?'Microphone permission was denied. No voice session started.':e.message;
    console.warn('[voice startup failed]',r.stage,e.name);
    if(r.token) { try{await post('stop',{token:r.token});}catch{} }
    const ownsUI=run===r||run===null;
    release(r);if(ownsUI)paint('error',detail);
  }
};
stop.onclick=()=>{if(!run&&serverVoice.owner==='wake')void wakeClick('end');else void end();};
mute.onclick=()=>{
  const r=run;if(!r?.ready || r.closing)return;
  if(r.mirror){
    r.muted=!r.muted;post('mute',{token:r.token,muted:r.muted}).catch(()=>void end());
    mute.textContent=r.muted?'Unmute microphone':'Mute microphone';mute.setAttribute('aria-pressed',String(r.muted));paint(r.muted?'muted':'listening');return;
  }
  r.muted=!r.muted;r.stream.getAudioTracks().forEach(t=>t.enabled=!r.muted);
  r.channel.send(JSON.stringify({type:r.muted?'session.input_audio.mute':'session.input_audio.unmute'}));
  mute.textContent=r.muted?'Unmute microphone':'Mute microphone';mute.setAttribute('aria-pressed',String(r.muted));
  paint(r.muted?'muted':'listening',r.muted?'Microphone muted · session still billed':'Listening');
};
// remote.js owns this page's single EventSource. Duplicating it consumes another
// HTTP/1 connection, leaving fewer slots for startup and heartbeat requests.
window.addEventListener('glass-voice',e=>{
  const state=e.detail;
  serverVoice=state;renderWake(wakeState);
  if(!run){
    const elsewhere=!['off','error'].includes(state.phase);
    start.disabled=elsewhere||!!wakeState.enabled;
    stop.disabled=!(elsewhere&&state.owner==='wake');
    if(!elsewhere&&wakeState.enabled)return; // renderWake already reports the precise local capture state.
    else paint(elsewhere&&state.owner!=='wake'?'off':state.phase,elsewhere&&state.owner!=='wake'?'Conversation active in another companion tab. Use that tab to end it.':state.detail);
    return;
  }
  if(run&&!run.ready&&state.phase==='connecting')return; // Keep the precise local stage.
  paint(state.phase,state.detail);
  if(run?.token&&state.phase==='off'){run.closing=true;release(run);}
  else if(run&&state.phase==='error')void end();
});
window.addEventListener('pagehide',()=>{
  if(run?.token) { navigator.sendBeacon('/api/voice/stop',new Blob([JSON.stringify({token:run.token})],{type:'application/json'})); }
  if(run)release(run);
});
