import { appendFileSync, mkdirSync, readFileSync, statSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { BasicTracerProvider, SimpleSpanProcessor, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';

// Only typed metadata crosses this boundary. Never accept arbitrary exception text,
// request bodies, URLs, SDP, IDs/tokens from providers, transcripts, labels or audio.
const enums = {
  phase:['off','connecting','listening','thinking','speaking','muted','needs_input','stopping','error'],
  wake_phase:['off','starting','standby','connecting','conversation','cooldown'],
  wake_reason:['user','shutdown','spoken_disable','detector_error','mirror_disconnected','startup_failed','arming_expired','audio_or_detector_stalled','voice_ended_unexpectedly','wake_limit','game_finished'],
  wrap_state:['started','drained','timeout'],
  outcome:['ok','error','cancelled','superseded','needs_input','completed','unconfirmed'],
  action:['start_timer','cancel_timer','add_todo','show','get_weather','compose_weather','open_weather_view','resolve_view_offer','unsupported','assistant'],
  source:['builtin','learned'],
  template:['start_timer','cancel_only_timer','show_panel','get_weather','weather_view'],
  reason:['user','shutdown','lease_expired','duration_limit','idle_timeout','spoken_end','spoken_disable','wake_disabled','transport_error','startup_error','close_requested','expired','content','remote_hangup','connection_lost','unknown','game_complete','game_stopped','game_wrap_timeout'],
  error_code:['startup_failed','transport_failed','tool_failed','budget_failed','final_usage_missing','hangup_failed','timer_context_failed','timer_confirmation_failed','agent_recovery_required','test_budget_exhausted'],
  fallback_reason:['invalid_request','uncertain_language','unrecognized_duration','unsupported_wording','missing_duration','disabled','pending_clarification','state_changed','commit_failed','not_committed','ambiguous_target','stale_surface','not_learned'],
};
const numeric = new Set(['step_count','duration_ms','seconds','estimated_usd','transcript_chars','fragment_count','quiet_window_ms','since_last_fragment_ms','since_tool_ms','revision','timer_count']);
export function safeAttributes(input={}) {
  const out={};
  for(const [key,value] of Object.entries(input)) {
    if(enums[key]?.includes(value)) out[key]=value;
    else if(numeric.has(key)&&typeof value==='number'&&Number.isFinite(value)&&value>=0)out[key]=value;
    else if(['muted','ready','duplicate','finalized'].includes(key)&&typeof value==='boolean')out[key]=value;
  }
  return out;
}
export function exportConfig(env={}) {
  if(env.OTEL_EXPORT_ENABLED!=='1')return null;
  let url,headers={};
  if(env.LANGFUSE_PUBLIC_KEY || env.LANGFUSE_SECRET_KEY) {
    if(!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY || !env.LANGFUSE_BASE_URL)throw Error('Langfuse export requires host and both keys');
    url=new URL('/api/public/otel/v1/traces',env.LANGFUSE_BASE_URL);
    headers={Authorization:'Basic '+Buffer.from(env.LANGFUSE_PUBLIC_KEY+':'+env.LANGFUSE_SECRET_KEY).toString('base64'),'x-langfuse-ingestion-version':'4'};
  } else {
    if(!env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)throw Error('Explicit OTLP traces endpoint required');
    url=new URL(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
    for(const pair of (env.OTEL_EXPORTER_OTLP_TRACES_HEADERS||'').split(',').filter(Boolean)) {
      const i=pair.indexOf('=');if(i<1)throw Error('Invalid OTLP header configuration');
      headers[pair.slice(0,i).trim()]=decodeURIComponent(pair.slice(i+1).trim());
    }
  }
  if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw Error('Telemetry endpoint must use HTTPS or loopback HTTP, without URL credentials');
  return {url:url.toString(),headers,timeoutMillis:2000};
}
const names=new Set(['function.reuse','function.execute','workflow.run','workflow.step_reuse','image.generate','wake.state','voice.session','voice.startup','voice.delegation','voice.tool','voice.timer_fast','voice.close','agent.decision','agent.planning','agent.cleanup','agent.recovery']);
const eventNames=new Set(['phase','duplicate','watchdog','transport.error','usage','superseded','heartbeat.ready','playback.detected','waiting.acknowledgment','timer.delegation_reconciled','timer.fast_fallback','quick_action.promoted','game.wrapup']);
export class Telemetry {
  constructor({file,env={},exporter,now=Date.now,maxBytes=2*1024*1024}={}) {
    this.file=file;this.now=now;this.maxBytes=maxBytes;this.records=[];this.failures=0;this.exportFailures=0;
    this.captureTranscripts=env.TELEMETRY_TRANSCRIPTS==='1';
    if(file)try {
      if(statSync(file).size<=maxBytes)for(const line of readFileSync(file,'utf8').trim().split('\n').slice(-1000)) {
        try { const r=JSON.parse(line);if(r.schema===1)this.records.push(r); }catch{}
      }
    }catch(e){if(e.code!=='ENOENT')this.failures++;}
    const local={export:(spans,done)=>{done({code:0});},shutdown:async()=>{},forceFlush:async()=>{}};
    const processors=[new SimpleSpanProcessor(local)];
    const config=exportConfig(env);this.exportEnabled=!!config||!!exporter;
    if(config||exporter) {
      const target=exporter||new OTLPTraceExporter(config);
      const guarded={export:(spans,done)=>{
        try{target.export(spans,result=>{if(result.code!==0)this.exportFailures++;done({code:result.code});});}
        catch{this.exportFailures++;done({code:1});}
      },shutdown:()=>target.shutdown(),forceFlush:()=>target.forceFlush?.()||Promise.resolve()};
      processors.push(new BatchSpanProcessor(guarded,{maxQueueSize:512,maxExportBatchSize:64,scheduledDelayMillis:1000,exportTimeoutMillis:2500}));
    }
    this.provider=new BasicTracerProvider({resource:resourceFromAttributes({'service.name':'looking-glass','service.version':'0.1.0'}),spanProcessors:processors});
    this.tracer=this.provider.getTracer('looking-glass.voice','1');
  }
  write(record) {
    const r={schema:1,at:new Date(this.now()).toISOString(),...record};
    this.records.push(r);if(this.records.length>1000)this.records.shift();
    if(this.file)try {
      mkdirSync(dirname(this.file),{recursive:true});
      try {if(statSync(this.file).size>=this.maxBytes)renameSync(this.file,this.file+'.previous');}catch(e){if(e.code!=='ENOENT')throw e;}
      appendFileSync(this.file,JSON.stringify(r)+'\n',{mode:0o600});
    }catch{this.failures++;}
  }
  start(name,attributes={},parent) {
    if(!names.has(name))throw Error('Unknown trace name');
    const ctx=parent ? trace.setSpan(ROOT_CONTEXT,parent.span):ROOT_CONTEXT;
    const span=this.tracer.startSpan(name,{attributes:safeAttributes(attributes)},ctx);
    const {traceId,spanId}=span.spanContext();const started=this.now();let ended=false;
    const base={name,traceId,spanId,parentSpanId:parent?.span.spanContext().spanId};
    this.write({...base,kind:'start',attributes:safeAttributes(attributes)});
    return {span,traceId,spanId,
      event:(name,attrs={})=>{if(ended||!eventNames.has(name))return;const safe=safeAttributes(attrs);span.addEvent(name,safe);this.write({...base,kind:'event',event:name,attributes:safe});},
      end:(attrs={})=>{if(ended)return;ended=true;const safe=safeAttributes({...attrs,duration_ms:Math.max(0,this.now()-started)});
        span.setAttributes(safe);if(['error','unconfirmed'].includes(safe.outcome))span.setStatus({code:2});span.end();this.write({...base,kind:'end',attributes:safe});}
    };
  }
  transcript(parent,speaker,text) {
    if(!this.captureTranscripts||!parent?.traceId||!['user','assistant'].includes(speaker)||typeof text!=='string')return;
    // Local-only record: never attached to an OpenTelemetry span or exporter.
    const content=text.slice(0,4000).replace(/\b(?:sk-|pk-lf-)[A-Za-z0-9_-]+/g,'[redacted key]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]');
    this.write({kind:'transcript',traceId:parent.traceId,spanId:parent.spanId,speaker,text:content});
  }
  snapshot() {
    const ended=this.records.filter(r=>r.kind==='end');
    const metrics={},timerFallbacks={};
    for(const r of this.records)if(r.event==='timer.fast_fallback'){
      const reason=r.attributes?.fallback_reason;
      if(enums.fallback_reason.includes(reason))timerFallbacks[reason]=(timerFallbacks[reason]||0)+1;
    }
    for(const name of names){const rows=ended.filter(r=>r.name===name),values=rows.map(r=>r.attributes.duration_ms).sort((a,b)=>a-b);
      metrics[name]={count:rows.length,errors:rows.filter(r=>['error','unconfirmed'].includes(r.attributes.outcome)).length,p50_ms:values.length?values[Math.ceil(values.length*.5)-1]:null,p95_ms:values.length?values[Math.ceil(values.length*.95)-1]:null};}
    return {exportEnabled:this.exportEnabled,captureTranscripts:this.captureTranscripts,writeFailures:this.failures,exportFailures:this.exportFailures,window:'last 1000 local records',metrics,timerFallbacks,records:this.records.slice(-200)};
  }
  async close(){try{await this.provider.shutdown();}catch{this.failures++;}}
}
export const noTelemetry={start:()=>({event:()=>{},end:()=>{}}),transcript:()=>{}};
