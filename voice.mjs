import OpenAI from 'openai';
import { SidebandWS } from 'openai/resources/live/sideband/ws';
import { LiveWS } from 'openai/resources/live/ws';
import { randomUUID } from 'node:crypto';
import { ApiBudget } from './api-budget.mjs';
import { VoiceTools } from './voice-tools.mjs';
import { noTelemetry } from './telemetry.mjs';
import { liveInstructions,wakeInstructions } from './prompts/live-instructions.mjs';
import { analyzeTimerIntent, TIMER_QUIET_MS } from './timer-intent.mjs';
import {analyzeQuickAction} from './quick-actions.mjs';
import {weatherIntent} from './weather.mjs';
import {trackTaskProgress} from './task-progress.mjs';
import {savedViewIntent} from './weather-composition.mjs';
import {researchIntent,RESEARCH_FRESH_MS} from './research-board.mjs';
import {assistantFailureMessage} from './agent-recovery.mjs';
import {gameIntent,playroomInstructions} from './playroom.mjs';

export function isConversationEnd(text){return /^(?:(?:ok(?:ay)?|thanks|thank you)[,.!]?\s+)?(?:that['’]?s all|end (?:the )?conversation|stop listening|goodbye)(?:[,.!]?\s+(?:thanks|thank you|mirror))?[.!?\s]*$/i.test(text.trim());}
export function wakeIdle(a,now){return a.owner==='wake'&&!!a.readyAt&&!a.pending&&!a.job&&now-Math.max(a.readyAt,a.lastInput,a.lastOutput,a.lastAudible||0)>=10000;}

export class Voice {
  constructor({ session, budgetPath, publish = () => {}, clientFactory, attachFactory, telemetry=noTelemetry, assistant, fastTimers=process.env.OPENAI_TIMER_FAST_PATH!=='0', learnedFast=process.env.OPENAI_LEARNED_FAST_PATH!=='0' } = {}) {
    this.session = session; this.publish = publish; this.budget = new ApiBudget(budgetPath);
    this.telemetry=telemetry;
    this.assistant=assistant;
    this.fastTimers=fastTimers;
    this.learnedFast=learnedFast;
    this.clientFactory = clientFactory || (() => new OpenAI({ maxRetries:0, timeout:15000 }));
    this.attachFactory = attachFactory || ((client,id) => new SidebandWS(client,{session_id:id},{reconnect:null,handshakeTimeout:10000}));
    this.state = { phase:'off', detail:'Microphone off', muted:false }; this.active = null;
  }
  update(phase, detail = '') {
    if(phase!==this.state.phase)this.active?.trace?.event('phase',{phase});
    this.state = { ...this.state, phase, detail }; this.publish(this.state);
  }
  async start(sdp, mirror=null, {owner='companion'}={}) {
    if(owner!=='companion'&&(!mirror||owner!=='wake'))throw Error('Invalid voice owner');
    if (this.active || this.blocked) throw Error('A voice session is active or needs finalization review.');
    if (!mirror && (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > 60000)) throw Error('Invalid SDP offer');
    if(mirror&&!mirror.status().connected)throw Error('Mirror audio bridge is not connected');
    const client = this.clientFactory();
    const a = this.active = { token:randomUUID(), client, budgetId:this.budget.reserve(mirror?'live-mirror':'live-webrtc'), tools:new VoiceTools(this.session),
      transcript:[], seen:new Set(), delegations:new Set(), acknowledged:new Set(), fastReceipts:[], cursor:0, lastInput:0, lastOutput:0, lastBeat:Date.now(), started:Date.now(), closing:false, finalized:false };
    a.trace=this.telemetry.start('voice.session');a.startupTrace=this.telemetry.start('voice.startup',{},a.trace);
    a.playroom=!!this.session.state.playroom;
    a.instructions=a.playroom?playroomInstructions+'\nCurrent game state (data): '+JSON.stringify({kind:this.session.state.playroom.kind,prompt:this.session.state.playroom.prompt,options:this.session.state.playroom.options}):liveInstructions;
    a.mirror=mirror;a.owner=owner;this.state.owner=owner;this.state.stopReason=null;this.state.device=mirror?'mirror':'mac';
    this.state.muted = false; this.update('connecting','Connecting to GPT-Live-1');
    a.lease = setInterval(() => {
      const reason=Date.now()-a.started > 180000 ? 'duration_limit':wakeIdle(a,Date.now())?'idle_timeout':owner==='companion'&&Date.now()-a.lastBeat > 20000 ? 'lease_expired':null;
      if(reason){a.trace.event('watchdog',{reason});void this.stop(a.token,reason);}
    },1000);
    try {
      if(mirror)return await this.startMirror(a);
      const result = await client.live.create({
        session:{ model:'gpt-live-1', store:false, audio:{output:{voice:'marin'}}, delegation:{type:'client'},
          client:{data_channel:{allowed_client_events:['session.close','session.input_audio.mute','session.input_audio.unmute'],allowed_server_events:'all'}},
          instructions:a.instructions },
        transport:{type:'webrtc',sdp}
      });
      a.id = result.session.id;
      if (a.closing) { await this.hangup(a); throw Error('Connection cancelled'); }
      a.ws = this.attachFactory(client,a.id);
      a.ws.on('event', event => this.event(a,event));
      a.ws.on('error', () => { a.trace.event('transport.error',{error_code:'transport_failed'}); this.update('error','Voice connection error; stopping'); void this.stop(a.token,'transport_error'); });
      a.ws.socket.on('close', () => { if (!a.finalized && !a.closing) void this.stop(a.token,'transport_error'); });
      await new Promise((resolve,reject) => {
        const timeout = setTimeout(() => reject(Error('Voice control connection timed out')),10000);
        a.ws.socket.on('open', () => { clearTimeout(timeout); resolve(); });
        a.ws.socket.on('close', () => { clearTimeout(timeout); reject(Error('Voice control connection closed')); });
      });
      if (a.closing) throw Error('Connection cancelled');
      a.lastBeat = Date.now();
      a.startupTrace.end({outcome:'ok'});
      return { token:a.token, transport:result.transport, maxSeconds:180 };
    } catch (error) {
      a.startupTrace.end({outcome:'error',error_code:'startup_failed'});
      await this.stop(a.token,'startup_error');
      throw Error(error?.code === 'credit_balance_exhausted' ? 'API credits exhausted' : 'Voice startup failed. Check server configuration and API access.');
    }
  }
  async startMirror(a){
    a.ws=this.primaryFactory?this.primaryFactory(a.client):new LiveWS(a.client,{reconnect:null,handshakeTimeout:10000});
    a.ws.on('event',e=>{this.event(a,e);if(e.type==='session.output_audio.delta'&&!a.closing){try{
      const pcm=Buffer.from(e.delta,'base64');for(let i=0;i+1<pcm.length;i+=2){if(Math.abs(pcm.readInt16LE(i))>180){
        a.lastAudible=Date.now()+pcm.length/32;
        if(a.playroom){
          if(this.state.phase!=='speaking')this.update('speaking','');
          clearTimeout(a.speechTimer);a.speechTimer=setTimeout(()=>{if(this.active===a&&!a.closing&&!a.pending&&!a.job)this.update('listening','');},Math.min(2000,pcm.length/32+350));
        }
        break;
      }}
      a.mirror.output(e.delta);
    }catch{void this.stop(a.token,'audio_backpressure');}}});
    a.ws.on('error',()=>void this.stop(a.token,'transport_error'));
    a.ws.socket.on('close',()=>{if(!a.finalized&&!a.closing)void this.stop(a.token,'transport_error');});
    a.onAudio=data=>{if(!a.closing&&a.ws.socket.readyState===1)a.ws.send({type:'session.input_audio.append',audio:data.toString('base64')});};
    a.onDisconnect=()=>void this.stop(a.token,'mirror_disconnected');
    a.mirror.on('disconnect',a.onDisconnect);a.mirror.on('fault',a.onDisconnect);
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>finish(Error('Mirror voice startup timed out')),15000);
      const event=e=>{if(e.type==='session.started'){a.id=e.session.id;finish();}if(e.type==='session.closed'||e.type==='error')finish(Error('Mirror voice startup failed'));};
      const close=()=>finish(Error('Mirror voice connection closed'));
      const finish=error=>{clearTimeout(timeout);a.ws.off('event',event);a.ws.socket.off('close',close);error?reject(error):resolve();};
      a.ws.on('event',event);a.ws.socket.on('close',close);
      a.ws.send({type:'session.start',session:{model:'gpt-live-1',store:false,audio:{format:{type:'audio/pcm',rate:16000},output:{voice:'marin'}},delegation:{type:'client'},instructions:a.instructions+(a.owner==='wake'?wakeInstructions:'')}});
    });
    if(a.closing)throw Error('Connection cancelled');
    a.mirror.on('audio',a.onAudio);a.mirror.start();a.lastBeat=Date.now();a.readyAt=Date.now();
    a.startupTrace.end({outcome:'ok'});this.update('listening','Mirror microphone · listening');
    return {token:a.token,device:'mirror',maxSeconds:180};
  }
  event(a,e) {
    if (a !== this.active) return;
    if (e.type === 'session.closed') {
      a.finalized = true;
      const validUsage=Number.isFinite(e.usage?.seconds)&&e.usage.seconds>=0;
      if(!validUsage)this.blocked=true;
      try { this.budget.finish(a.budgetId,e.usage?.seconds); }
      catch { this.blocked = true; }
      const outcome=this.blocked?'unconfirmed':'ok';
      a.trace.event('usage',{seconds:e.usage?.seconds,finalized:validUsage,estimated_usd:validUsage?Math.ceil(Math.max(15,e.usage.seconds)*.05/60*1e6)/1e6:undefined});
      a.closeTrace?.end({outcome,finalized:validUsage});a.trace.end({outcome,reason:e.reason||'unknown',finalized:validUsage});
      this.cleanup(a);
      this.update(this.blocked ? 'error':'off',this.blocked ? 'Usage could not be saved; review budget before restarting':'Microphone off · session closed');
      return;
    }
    if (a.closing) return;
    if (e.event_id) { if (a.seen.has(e.event_id)) {a.trace.event('duplicate',{duplicate:true});return;} a.seen.add(e.event_id); }
    if(e.type==='session.output_transcript.delta'){
      a.lastOutput=Date.now();
      if(!a.playroom)this.telemetry.transcript(a.trace,'assistant',e.delta);
    }
    if (e.type === 'session.input_transcript.delta') {
      if(typeof e.delta!=='string'||!e.delta.trim())return;
      // Freeze application writes immediately, but wait for a settled utterance
      // before throwing away paid planning. A backchannel is not a new task.
      if(a.job&&!a.job.inputGate){
        const job=a.job;
        job.inputGate=new Promise(resolve=>{job.releaseInput=resolve;});
        job.controller.signal.addEventListener('abort',job.releaseInput,{once:true});
      }
      if(!a.playroom)this.telemetry.transcript(a.trace,'user',e.delta);
      if(Date.now()-a.lastInput>1400)a.endUtterance='';
      a.endUtterance=(a.endUtterance||'')+e.delta;
      a.transcript.push({ text:e.delta, start:e.start_ms, end:e.end_ms });
      a.lastInput = Date.now();
      clearTimeout(a.endTimer);
      if(a.owner==='wake')a.endTimer=setTimeout(()=>{
        if(this.active===a&&!a.closing&&isConversationEnd(a.endUtterance))void this.stop(a.token,/stop listening/i.test(a.endUtterance)?'spoken_disable':'spoken_end');
      },600);
      this.scheduleTimer(a);
      if (a.pending) this.schedule(a);
    }
    if (e.type === 'session.delegation.created' && e.delegation.target === 'client') {
      if (a.delegations.has(e.delegation.id)) return;
      a.delegations.add(e.delegation.id);
      // A late handoff is not a new user request. Associate it with the already
      // committed transcript range, and inject quiet context rather than speak twice.
      const receipt=a.fastReceipts.at(-1),unread=a.transcript[a.cursor];
      if(receipt&&unread&&Number.isFinite(e.offset_ms)&&Number.isFinite(unread.start)&&e.offset_ms<unread.start){
        this.reconcileTimer(a,e.delegation.id);
        return;
      }
      if(a.job){
        // Live can hand off again while the same work is in progress. Change
        // the reply destination, not the work; new speech is classified below.
        a.job.id=e.delegation.id;a.pending=e.delegation.id;
        if(a.job.inputGate)this.schedule(a);
        return;
      }
      if (a.pending) {a.job?.controller.abort();a.job=null;this.reply(a,a.pending,'A newer request superseded this one; no action was taken.');a.workTrace?.end({outcome:'superseded'});}
      a.workTrace=this.telemetry.start('voice.delegation',{},a.trace);
      a.pending = e.delegation.id; this.update('thinking','Checking your request'); this.schedule(a);
    }
  }
  reconcileTimer(a,id){
    a.trace.event('timer.delegation_reconciled',{duplicate:true});
    // No new action and no second spoken confirmation. Transcript events may
    // arrive after a delegation, so no-unread reconciliation waits for quiet.
    try{
      if(a.ws?.socket.readyState===1)a.ws.send({type:'session.thinking.append',delegation_id:id,content:'The preceding request was already handled by the application. Do not repeat the action or confirmation. Wait for the next user request.'});
    }catch{a.trace.event('transport.error',{error_code:'timer_context_failed'});}
  }
  fastAction(text){
    if(this.session.state.playroom)return {action:gameIntent(text,this.session.state),source:'builtin',template:'playroom',reason:'matched'};
    const research=researchIntent(text,this.session.state);
    if(research){
      const cached=this.session.state.researchCache?.find(b=>b.savedId===research.viewId);
      if(research.action==='research_page'||(!research.refresh&&cached&&this.session.now()-cached.fetchedAt<RESEARCH_FRESH_MS))return {action:research,reason:'matched',source:'learned',template:'research_view'};
    }
    const saved=savedViewIntent(text,this.session.state,this.session.now());
    if(saved)return {action:saved,source:'learned',template:'weather_view',reason:'matched'};
    const forecast=weatherIntent(text,this.session.state.weather);
    if(forecast)return {action:forecast,source:'builtin',template:'get_weather',reason:'matched'};
    const timer=analyzeTimerIntent(text);
    if(timer.intent)return {action:{action:'start_timer',...timer.intent},source:'builtin',template:'start_timer',reason:timer.reason};
    const quick=analyzeQuickAction(text,this.session.state,{learned:this.learnedFast});
    return quick.action?quick:{...quick,reason:['unsupported_wording','not_learned'].includes(quick.reason)?timer.reason:quick.reason};
  }
  scheduleTimer(a){
    clearTimeout(a.fastWork);
    a.fastFallbackReason=null;
    if(a.job)return;
    if(!this.fastTimers){a.fastFallbackReason='disabled';return;}
    const from=a.cursor,to=a.transcript.length;
    const text=a.transcript.slice(from,to).map(t=>t.text).join('');
    const route=this.fastAction(text);
    // A pending question can change the meaning of a short answer; let the
    // contextual planner handle it. Timers do not require a cloud reservation.
    if(this.session.state.assistant?.status==='clarify'){a.fastFallbackReason='pending_clarification';return;}
    if(!route.action){a.fastFallbackReason=route.reason;return;}
    const revision=this.session.state.revision;
    a.fastWork=setTimeout(()=>{
      if(a.closing||a!==this.active||a.job||a.cursor!==from||a.transcript.length!==to)return;
      if(revision!==this.session.state.revision){a.fastFallbackReason='state_changed';return;}
      const checked=this.fastAction(text);
      if(!checked.action||JSON.stringify(checked.action)!==JSON.stringify(route.action)){a.fastFallbackReason=checked.reason;return;}
      const span=this.telemetry.start('voice.timer_fast',{since_last_fragment_ms:Date.now()-a.lastInput,quiet_window_ms:TIMER_QUIET_MS,source:route.source,template:route.template},a.workTrace||a.trace);
      const id=a.token+':timer:'+from+':'+to;
      let result;
      try{
        result=this.session.commitDecision(id,revision,{
          status:'execute',outcome:route.action.action==='start_timer'?'Start a timer.':route.action.action==='cancel_timer'?'Cancel the timer.':route.action.action==='get_weather'?'Show the forecast.':'Show the requested panel.',message:'Action requested.',
          actions:[route.action],options:[],selectedOptionId:null,
        },text);
      }catch{
        a.fastFallbackReason='commit_failed';
        span.end({outcome:'error',error_code:'tool_failed'});
        return; // Delegated work can explain a capacity/storage failure.
      }
      const delegation=a.pending;
      a.job?.controller.abort();a.job=null;clearTimeout(a.work);
      a.cursor=to;a.pending=null;
      a.fastReceipts.push({from,to,result});if(a.fastReceipts.length>100)a.fastReceipts.shift();
      span.end({outcome:'completed',action:route.action.action,revision:this.session.state.revision,timer_count:this.session.state.timers.length});
      a.workTrace?.end({outcome:'completed',quiet_window_ms:TIMER_QUIET_MS});a.workTrace=null;
      a.toolFinishedAt=Date.now();
      // null is the documented context channel for application-owned work when
      // Live has not emitted a delegation. Never fabricate a provider ID.
      try{this.reply(a,delegation||null,result.message);}
      catch{a.trace.event('transport.error',{error_code:'timer_confirmation_failed'});}
      this.update('listening','');
    },TIMER_QUIET_MS);
  }
  schedule(a) {
    clearTimeout(a.work);
    // Deltas are not completed turns. Wait for quiet before planning; later speech
    // holds writes until a settled correction can replace the in-flight plan.
    a.work = setTimeout(() => {
      if (a.closing || a !== this.active || !a.pending) return;
      if(a.job){
        const job=a.job;
        if(!job.inputGate)return;
        const tail=a.transcript.slice(job.to).map(t=>t.text).join('').trim();
        if(/^(?:ok(?:ay)?|thanks(?: you)?|thank you|uh huh|mm[ -]?hmm)[.!?,\s]*$/i.test(tail)){
          job.to=a.transcript.length;
          job.controller.signal.removeEventListener('abort',job.releaseInput);
          job.inputGate=null;job.releaseInput();return;
        }
        a.job=null;job.controller.abort();a.workTrace?.end({outcome:'superseded'});
        if(/^(?:stop|cancel|never mind|nevermind|forget it|cancel that)(?: please)?[.!?,\s]*$/i.test(tail)){
          a.cursor=a.transcript.length;a.pending=null;a.workTrace=null;
          this.reply(a,job.id,'Stopped that request.');this.update('listening','');return;
        }
        // Preserve the outcome being requested; e.g. "Warmer" refines next
        // week's forecast rather than becoming a disconnected one-word task.
        a.refinedText=job.text+'\nUser follow-up: '+tail;
        a.workTrace=this.telemetry.start('voice.delegation',{},a.trace);
      }
      if(a.cursor===a.transcript.length&&a.fastReceipts.length){
        this.reconcileTimer(a,a.pending);a.pending=null;
        a.workTrace?.end({outcome:'completed',duplicate:true});a.workTrace=null;
        this.update('listening','');return;
      }
      const analysis=analyzeTimerIntent(a.transcript.slice(a.cursor).map(t=>t.text).join(''));
      if(analysis.reason!=='not_timer')a.workTrace?.event('timer.fast_fallback',{
        fallback_reason:a.fastFallbackReason|| (analysis.intent?'not_committed':analysis.reason),
      });
      if(this.assistant){void this.runAssistant(a);return;}
      const id = a.pending; a.pending = null;
      const text = a.transcript.slice(a.cursor).map(t=>t.text).join(''); a.cursor = a.transcript.length;
      const toolTrace=this.telemetry.start('voice.tool',{transcript_chars:text.length,since_last_fragment_ms:a.lastInput?Date.now()-a.lastInput:0},a.workTrace);
      let result;
      try { result = a.tools.execute(a.token+':'+id,text); }
      catch { toolTrace.end({outcome:'error',error_code:'tool_failed'}); result = {status:'needs_input',message:'That action could not be completed. Please check the companion and try again.'}; }
      toolTrace.end({outcome:result.status,action:result.action||'unsupported',revision:this.session.state.revision,timer_count:this.session.state.timers.length});
      a.workTrace?.end({outcome:result.status,quiet_window_ms:900});a.workTrace=null;
      a.toolFinishedAt=Date.now();
      this.reply(a,id,result.message);
      this.update(result.status === 'needs_input' ? 'needs_input':'listening',result.message);
    },900);
  }
  async runAssistant(a) {
    const id=a.pending,from=a.cursor,to=a.transcript.length;
    const text=a.refinedText||a.transcript.slice(from,to).map(t=>t.text).join('');a.refinedText=null;
    const job=a.job={controller:new AbortController(),id,to,text};
    const beforeCommit=async()=>{
      while(job.inputGate&&!job.controller.signal.aborted)await job.inputGate;
      if(job.controller.signal.aborted||a.job!==job||a.closing)throw Error('Request cancelled');
    };
    const workTrace=a.workTrace;
    const progress=trackTaskProgress({signal:job.controller.signal,lastSpeech:()=>a.lastOutput,
      isCurrent:()=>a.job===job&&!job.inputGate&&!a.closing&&a===this.active,
      send:content=>{try{if(this.reply(a,job.id,content))workTrace?.event('waiting.acknowledgment',{since_last_fragment_ms:Date.now()-a.lastInput});}catch{/* Progress must not fail the action. */}}});
    try {
      const result=await this.assistant.execute(a.token+':'+id+':'+to,text,{signal:job.controller.signal,trace:workTrace,onProgress:progress.update,beforeCommit});
      if(job.inputGate)await beforeCommit();
      if(a.job!==job||job.controller.signal.aborted||a.closing||a!==this.active)return;
      a.cursor=job.to;a.pending=null;a.job=null;
      workTrace?.end({outcome:result.status});a.workTrace=null;
      a.toolFinishedAt=Date.now();this.reply(a,job.id,result.message);
      this.update(result.status==='needs_input'&&!result.viewOffer?'needs_input':'listening',result.status==='needs_input'&&!result.viewOffer?result.message:'');
    }catch(error){
      // Do not report failure over a correction that is still being spoken.
      if(job.inputGate&&!job.controller.signal.aborted)try{await beforeCommit();}catch{}
      workTrace?.end({outcome:job.controller.signal.aborted?'cancelled':'error',error_code:error?.code||'tool_failed'});
      if(a.job!==job||a.closing||a!==this.active)return;
      a.cursor=job.to;a.pending=null;a.job=null;a.workTrace=null;
      const message=assistantFailureMessage(error);
      this.reply(a,job.id,message);this.update('needs_input',message);
    }finally{progress.stop();}
  }
  reply(a,id,content) {
    if (!a.closing && a.ws?.socket.readyState === 1) {a.ws.send({type:'session.commentary.append',delegation_id:id,content});return true;}
    return false;
  }
  heartbeat(token,{ready=false,muted=false,speaking=false}={}) {
    const a = this.active;
    if (!a || token !== a.token || a.closing) return false;
    a.lastBeat = Date.now(); this.state.muted = !!muted;
    if(ready&&!a.readyReported){a.readyReported=true;a.trace.event('heartbeat.ready',{ready:true});}
    if(speaking&&a.toolFinishedAt){a.trace.event('playback.detected',{since_tool_ms:Date.now()-a.toolFinishedAt});a.toolFinishedAt=null;}
    if (ready && !a.pending) this.update(speaking ? 'speaking' : muted ? 'muted' : this.state.phase==='needs_input' ? 'needs_input':'listening',
      this.state.phase==='needs_input' ? this.state.detail : muted ? 'Microphone muted; session remains billed':'');
    return true;
  }
  async hangup(a) {
    if (a.id) {
      try { await a.client.live.sessions.hangup(a.id); }
      catch { this.blocked = true; a.trace.event('transport.error',{error_code:'hangup_failed'}); }
    }
  }
  async stop(token,reason='user') {
    const a = this.active; if (!a || (token && token !== a.token)) return;
    if (a.closing) return a.stopping;
    clearTimeout(a.speechTimer);
    a.closing = true;this.state.stopReason=reason; a.mirror?.stop(); a.job?.controller.abort(); clearTimeout(a.endTimer);clearTimeout(a.work); clearTimeout(a.fastWork); clearInterval(a.lease); this.update('stopping','Closing voice session');
    a.workTrace?.end({outcome:'cancelled'});a.workTrace=null;
    a.closeTrace=this.telemetry.start('voice.close',{reason},a.trace);
    a.stopping = (async () => {
      if (a.ws?.socket.readyState === 1) {
        try { a.ws.send({type:'session.close'}); } catch {}
        await new Promise(resolve => { a.resolveStop=resolve; a.closeTimer=setTimeout(resolve,8000); });
      }
      if (a.finalized) return;
      await this.hangup(a);
      // Hangup without terminal usage is not proof of final billing.
      this.blocked = true;
      try { this.budget.finish(a.budgetId); } catch {}
      a.closeTrace.end({outcome:'unconfirmed',error_code:'final_usage_missing'});a.trace.end({outcome:'unconfirmed',reason,finalized:false});
      this.cleanup(a); this.update('error','Stopped; final usage unconfirmed. Review before another session.');
    })();
    return a.stopping;
  }
  cleanup(a) {
    clearTimeout(a.speechTimer);
    if(a.mirror){a.mirror.stop();if(a.onAudio)a.mirror.off('audio',a.onAudio);if(a.onDisconnect){a.mirror.off('disconnect',a.onDisconnect);a.mirror.off('fault',a.onDisconnect);}}
    a.job?.controller.abort();
    a.startupTrace?.end({outcome:a.finalized?'ok':'cancelled'});
    a.workTrace?.end({outcome:'cancelled'});
    clearInterval(a.lease); clearTimeout(a.endTimer);clearTimeout(a.work); clearTimeout(a.fastWork); clearTimeout(a.closeTimer); a.resolveStop?.();
    if (this.active===a) this.active=null;
    a.ws?.close(); a.transcript=[];
  }
}
