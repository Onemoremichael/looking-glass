import OpenAI from 'openai';
import { SidebandWS } from 'openai/resources/live/sideband/ws';
import { randomUUID } from 'node:crypto';
import { ApiBudget } from './api-budget.mjs';
import { VoiceTools } from './voice-tools.mjs';
import { noTelemetry } from './telemetry.mjs';
import { liveInstructions } from './prompts/live-instructions.mjs';
import { analyzeTimerIntent, TIMER_QUIET_MS } from './timer-intent.mjs';

export class Voice {
  constructor({ session, budgetPath, publish = () => {}, clientFactory, attachFactory, telemetry=noTelemetry, assistant, fastTimers=process.env.OPENAI_TIMER_FAST_PATH!=='0' } = {}) {
    this.session = session; this.publish = publish; this.budget = new ApiBudget(budgetPath);
    this.telemetry=telemetry;
    this.assistant=assistant;
    this.fastTimers=fastTimers;
    this.clientFactory = clientFactory || (() => new OpenAI({ maxRetries:0, timeout:15000 }));
    this.attachFactory = attachFactory || ((client,id) => new SidebandWS(client,{session_id:id},{reconnect:null,handshakeTimeout:10000}));
    this.state = { phase:'off', detail:'Microphone off', muted:false }; this.active = null;
  }
  update(phase, detail = '') {
    if(phase!==this.state.phase)this.active?.trace?.event('phase',{phase});
    this.state = { ...this.state, phase, detail }; this.publish(this.state);
  }
  async start(sdp) {
    if (this.active || this.blocked) throw Error('A voice session is active or needs finalization review.');
    if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > 60000) throw Error('Invalid SDP offer');
    const client = this.clientFactory();
    const a = this.active = { token:randomUUID(), client, budgetId:this.budget.reserve(), tools:new VoiceTools(this.session),
      transcript:[], seen:new Set(), delegations:new Set(), acknowledged:new Set(), fastReceipts:[], cursor:0, lastInput:0, lastOutput:0, lastBeat:Date.now(), started:Date.now(), closing:false, finalized:false };
    a.trace=this.telemetry.start('voice.session');a.startupTrace=this.telemetry.start('voice.startup',{},a.trace);
    this.state.muted = false; this.update('connecting','Connecting to GPT-Live-1');
    a.lease = setInterval(() => {
      const reason=Date.now()-a.started > 180000 ? 'duration_limit':Date.now()-a.lastBeat > 20000 ? 'lease_expired':null;
      if(reason){a.trace.event('watchdog',{reason});void this.stop(a.token,reason);}
    },1000);
    try {
      const result = await client.live.create({
        session:{ model:'gpt-live-1', store:false, audio:{output:{voice:'marin'}}, delegation:{type:'client'},
          client:{data_channel:{allowed_client_events:['session.close','session.input_audio.mute','session.input_audio.unmute'],allowed_server_events:'all'}},
          instructions:liveInstructions },
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
      this.telemetry.transcript(a.trace,'assistant',e.delta);
    }
    if (e.type === 'session.input_transcript.delta') {
      if(a.job){a.job.controller.abort();a.job=null;a.workTrace?.end({outcome:'cancelled'});a.workTrace=this.telemetry.start('voice.delegation',{},a.trace);}
      this.telemetry.transcript(a.trace,'user',e.delta);
      a.transcript.push({ text:e.delta, start:e.start_ms, end:e.end_ms });
      a.lastInput = Date.now();
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
      if(a.ws?.socket.readyState===1)a.ws.send({type:'session.thinking.append',delegation_id:id,content:'The preceding timer request was already handled by the application. Do not repeat the action or confirmation. Wait for the next user request.'});
    }catch{a.trace.event('transport.error',{error_code:'timer_context_failed'});}
  }
  scheduleTimer(a){
    clearTimeout(a.fastWork);
    a.fastFallbackReason=null;
    if(!this.fastTimers){a.fastFallbackReason='disabled';return;}
    const from=a.cursor,to=a.transcript.length;
    const text=a.transcript.slice(from,to).map(t=>t.text).join('');
    const {intent}=analyzeTimerIntent(text);
    // A pending question can change the meaning of a short answer; let the
    // contextual planner handle it. Timers do not require a cloud reservation.
    if(this.session.state.assistant?.status==='clarify'){a.fastFallbackReason='pending_clarification';return;}
    if(!intent)return;
    const revision=this.session.state.revision;
    a.fastWork=setTimeout(()=>{
      if(a.closing||a!==this.active||a.cursor!==from||a.transcript.length!==to)return;
      if(revision!==this.session.state.revision){a.fastFallbackReason='state_changed';return;}
      const span=this.telemetry.start('voice.timer_fast',{since_last_fragment_ms:Date.now()-a.lastInput,quiet_window_ms:TIMER_QUIET_MS},a.workTrace||a.trace);
      const id=a.token+':timer:'+from+':'+to;
      let result;
      try{
        result=this.session.commitDecision(id,revision,{
          status:'execute',outcome:'Start a timer.',message:'Timer requested.',
          actions:[{action:'start_timer',...intent}],options:[],selectedOptionId:null,
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
      span.end({outcome:'completed',action:'start_timer',revision:this.session.state.revision,timer_count:this.session.state.timers.length});
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
    // cancels the in-flight plan. The legacy parser still accepts only whole requests.
    a.work = setTimeout(() => {
      if (a.closing || a !== this.active || !a.pending) return;
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
    const job=a.job={controller:new AbortController(),id};
    const text=a.transcript.slice(from,to).map(t=>t.text).join('');
    const workTrace=a.workTrace;
    // One factual progress cue for a genuinely pending request, never startup filler.
    const acknowledgement=setTimeout(()=>{
      if(a.job!==job||job.controller.signal.aborted||a.closing||a!==this.active||a.acknowledged.has(id)||a.lastOutput>=a.lastInput)return;
      try {
        if(this.reply(a,id,'Still working on your request. No result is ready yet.')){
          a.acknowledged.add(id);workTrace?.event('waiting.acknowledgment',{since_last_fragment_ms:Date.now()-a.lastInput});
        }
      }catch{/* A progress cue must not fail the action or escape the timer callback. */}
    },1500);
    job.controller.signal.addEventListener('abort',()=>clearTimeout(acknowledgement),{once:true});
    try {
      const result=await this.assistant.execute(a.token+':'+id+':'+to,text,{signal:job.controller.signal,trace:workTrace});
      if(a.job!==job||job.controller.signal.aborted||a.closing||a!==this.active)return;
      a.cursor=to;a.pending=null;a.job=null;
      workTrace?.end({outcome:result.status});a.workTrace=null;
      a.toolFinishedAt=Date.now();this.reply(a,id,result.message);
      this.update(result.status==='needs_input'?'needs_input':'listening',result.status==='needs_input'?result.message:'');
    }catch{
      workTrace?.end({outcome:job.controller.signal.aborted?'cancelled':'error'});
      if(a.job!==job||a.closing||a!==this.active)return;
      a.cursor=to;a.pending=null;a.job=null;a.workTrace=null;
      const message='I could not safely complete that request. Nothing was changed. Please try again; the display may have changed or the assistant connection failed.';
      this.reply(a,id,message);this.update('needs_input',message);
    }finally{clearTimeout(acknowledgement);}
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
    a.closing = true; a.job?.controller.abort(); clearTimeout(a.work); clearTimeout(a.fastWork); clearInterval(a.lease); this.update('stopping','Closing voice session');
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
    a.job?.controller.abort();
    a.startupTrace?.end({outcome:a.finalized?'ok':'cancelled'});
    a.workTrace?.end({outcome:'cancelled'});
    clearInterval(a.lease); clearTimeout(a.work); clearTimeout(a.fastWork); clearTimeout(a.closeTimer); a.resolveStop?.();
    if (this.active===a) this.active=null;
    a.ws?.close(); a.transcript=[];
  }
}
