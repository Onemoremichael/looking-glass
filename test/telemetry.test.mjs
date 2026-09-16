import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { Telemetry, safeAttributes, exportConfig } from '../telemetry.mjs';

function local(t){const dir=mkdtempSync(join(tmpdir(),'glass-telemetry-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'events.jsonl');}
test('metadata allowlist excludes secrets, transcript content and arbitrary enum values',()=>{
  assert.deepEqual(safeAttributes({token:'secret',sdp:'secret',transcript:'secret',error:'secret',phase:'secret',duration_ms:-1,seconds:Infinity,action:'show',muted:true}),{action:'show',muted:true});
  assert.deepEqual(safeAttributes({fallback_reason:'user utterance secret'}),{});
  assert.deepEqual(safeAttributes({fallback_reason:'unsupported_wording'}),{fallback_reason:'unsupported_wording'});
});
test('OTLP stays disabled until explicit opt-in; bad external endpoints rejected',()=>{
  assert.equal(exportConfig({OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:'https://example.com'}),null);
  assert.throws(()=>exportConfig({OTEL_EXPORT_ENABLED:'1'}));
  for(const url of ['http://external.example/traces','https://user:pass@example.com/traces','https://example.com/traces?key=secret'])assert.throws(()=>exportConfig({OTEL_EXPORT_ENABLED:'1',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:url}));
  const cfg=exportConfig({OTEL_EXPORT_ENABLED:'1',LANGFUSE_BASE_URL:'https://us.cloud.langfuse.com',LANGFUSE_PUBLIC_KEY:'test-public',LANGFUSE_SECRET_KEY:'test-secret'});
  assert.equal(cfg.url,'https://us.cloud.langfuse.com/api/public/otel/v1/traces');assert.equal(cfg.headers['x-langfuse-ingestion-version'],'4');
});
test('real OTel spans correlate; transcript opt-in stays local and never exports',async t=>{
  let clock=1000;const file=local(t),exporter=new InMemorySpanExporter();
  const telemetry=new Telemetry({file,exporter,env:{TELEMETRY_TRANSCRIPTS:'1'},now:()=>clock});t.after(()=>telemetry.close());
  const root=telemetry.start('voice.session',{token:'CONTROL_SECRET'});
  const child=telemetry.start('voice.tool',{action:'start_timer'},root);
  telemetry.transcript(root,'user','PRIVATE_PHRASE sk-EXAMPLESECRET');
  clock+=12;child.end({outcome:'completed'});child.end({outcome:'error'});root.end({outcome:'ok'});
  await telemetry.provider.forceFlush();const spans=exporter.getFinishedSpans();assert.equal(spans.length,2);
  assert.equal(spans[0].spanContext().traceId,spans[1].spanContext().traceId);
  assert.equal(spans[0].parentSpanContext.spanId,root.spanId);
  assert.doesNotMatch(JSON.stringify(spans.map(s=>({attributes:s.attributes,events:s.events}))),/PRIVATE_PHRASE|CONTROL_SECRET|EXAMPLESECRET/);
  const log=readFileSync(file,'utf8');assert.match(log,/PRIVATE_PHRASE/);assert.doesNotMatch(log,/CONTROL_SECRET|EXAMPLESECRET/);
  assert.equal(statSync(file).mode&0o777,0o600);
  assert.equal(telemetry.snapshot().metrics['voice.tool'].p50_ms,12);
});
test('transcripts disabled by default, disk failure does not throw into voice',async t=>{
  const file=local(t);writeFileSync(file,'not a directory');const telemetry=new Telemetry({file:join(file,'invalid.jsonl')});t.after(()=>telemetry.close());
  const span=telemetry.start('voice.session');telemetry.transcript(span,'user','private');span.end({outcome:'ok'});
  assert.ok(telemetry.snapshot().writeFailures>0);assert.equal(telemetry.records.some(r=>r.kind==='transcript'),false);
});
test('rotation and recent-window retention are bounded; report survives restart',async t=>{
  const file=local(t),telemetry=new Telemetry({file,maxBytes:600});t.after(()=>telemetry.close());
  for(let i=0;i<12;i++){const s=telemetry.start('voice.tool');s.end({outcome:'completed'});}
  assert.ok(statSync(file+'.previous').size<1500);assert.ok(statSync(file).size<1500);
  const restored=new Telemetry({file,maxBytes:1500});t.after(()=>restored.close());assert.ok(restored.records.length>0);
});
test('exporter failure is counted without losing local trace records',async t=>{
  const telemetry=new Telemetry({file:local(t),exporter:{export:(_spans,done)=>done({code:1}),shutdown:async()=>{}}});t.after(()=>telemetry.close());
  telemetry.start('voice.session').end({outcome:'ok'});
  try{await telemetry.provider.forceFlush();}catch{}
  assert.equal(telemetry.snapshot().exportFailures,1);assert.equal(telemetry.snapshot().metrics['voice.session'].count,1);
});
