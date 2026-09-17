// Task lifecycle, not weather-specific scripts. The voice model chooses wording.
export function trackTaskProgress({send,isCurrent,lastSpeech=()=>0,now=Date.now,signal,background=false}){
  let stage='planning',closed=false;
  const emit=delayed=>{
    if(closed||!isCurrent()||signal?.aborted||now()-lastSpeech()<2500)return;
    send(JSON.stringify({kind:'task_progress',stage,delayed,resultReady:false,background,
      guidance:background?'This task can keep working after voice idles. Briefly say you will check and let the user know when ready. No ETA or invented milestones.':delayed?'The request is still pending and the wait is now noticeable. Briefly set expectations in your own natural voice, even if you acknowledged it earlier. No ETA or invented milestones.':'Briefly acknowledge ongoing work if useful. Be natural, not scripted. No completion or future-speed claim.'}));
  };
  const initial=setTimeout(()=>emit(false),1800),delay=background?null:setTimeout(()=>emit(true),10000);
  const stop=()=>{closed=true;clearTimeout(initial);clearTimeout(delay);signal?.removeEventListener('abort',stop);};
  signal?.addEventListener('abort',stop,{once:true});
  return {update:value=>{if(['checking_data','planning','presenting','testing_function','repairing_function'].includes(value.stage))stage=value.stage;},stop};
}
