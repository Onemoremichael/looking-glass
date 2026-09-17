import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {recoveryError} from './agent-recovery.mjs';

// Shared with transport diagnostics. A reservation is an allowance, not billed spend.
export function budgetAllocation(b){
  const checkpoint=b.reconciliations?.at(-1),covered=new Set((checkpoint?.closedRunIds||[]).filter(id=>typeof id==='string'&&id));
  if(checkpoint&&(!Number.isFinite(checkpoint.reportedUSD)||checkpoint.reportedUSD<0||!Array.isArray(checkpoint.closedRunIds)))throw Error('Invalid budget reconciliation');
  return b.runs.reduce((sum,r)=>{
    if(r.status==='closed'&&covered.has(r.id))return sum;
    const amount=r.status==='closed'?r.estimatedUSD:r.reservedUSD;
    if(!Number.isFinite(amount)||amount<0)throw Error('Invalid budget allocation');
    return sum+amount;
  },checkpoint?.reportedUSD||0);
}
export class ApiBudget {
  constructor(path) { this.path = path; }
  change(fn) {
    mkdirSync(dirname(this.path), { recursive: true });
    const lock = this.path.replace(/\.json$/, '.lock');
    const fd = openSync(lock, 'wx', 0o600);
    try {
      const b = JSON.parse(readFileSync(this.path, 'utf8'));
      if (b.approvedUSD !== 25 || !Array.isArray(b.runs)) throw Error('Approved test budget is missing');
      const result = fn(b);
      writeFileSync(this.path + '.tmp', JSON.stringify(b, null, 2), { mode: 0o600 });
      renameSync(this.path + '.tmp', this.path);
      return result;
    } finally { closeSync(fd); unlinkSync(lock); }
  }
  reserve(kind='live-webrtc') {
    return this.change(b => {
      if(kind==='agents-decision'&&b.runs.some(r=>r.kind===kind&&['pending','unconfirmed'].includes(r.status)))throw recoveryError();
      const used = budgetAllocation(b);
      if (!Number.isFinite(used) || used + 0.5 > b.approvedUSD) throw Object.assign(Error('Test budget exhausted or invalid'),{code:'test_budget_exhausted'});
      const run = { id: randomUUID(), kind, startedAt: new Date().toISOString(), status: 'pending', reservedUSD: 0.5 };
      b.runs.push(run); return run.id;
    });
  }
  // Explicit operator reconciliation only. Never infer a provider balance or
  // silently zero unknown usage. Original runs and previous checkpoints remain.
  reconcile({reportedUSD,evidence}){
    if(!Number.isFinite(reportedUSD)||reportedUSD<0||typeof evidence!=='string'||!evidence.trim()||evidence.length>1000)throw Error('Reported spend and evidence required');
    return this.change(b=>{
      if(b.runs.some(r=>r.status==='pending'))throw Error('Finish pending requests before reconciling');
      const checkpoint={at:new Date().toISOString(),reportedUSD,evidence,closedRunIds:b.runs.filter(r=>r.status==='closed'&&typeof r.id==='string'&&r.id).map(r=>r.id)};
      b.reconciliations=[...(b.reconciliations||[]),checkpoint];
      return {approvedUSD:b.approvedUSD,allocatedUSD:budgetAllocation(b)};
    });
  }
  unresolvedAgents(){
    const b=JSON.parse(readFileSync(this.path,'utf8'));
    if(b.approvedUSD!==25||!Array.isArray(b.runs))throw Error('Approved test budget is missing');
    return b.runs.filter(r=>r.kind==='agents-decision'&&['pending','unconfirmed'].includes(r.status));
  }
  recordAgentRecovery(id,{cleaned,evidence}){
    this.change(b=>{
      const r=b.runs.find(r=>r.id===id);
      // Never settle another process's pending request or change its allowance.
      if(!r||r.status!=='unconfirmed')throw recoveryError();
      r.recovery={at:new Date().toISOString(),evidence};
      if(cleaned){r.status='closed';r.cleaned=true;r.estimatedUSD=r.reservedUSD;}
    });
  }
  finishAgent(id,{complete,cleaned,usage,model,webSearchCalls}) {
    this.change(b=>{
      const r=b.runs.find(r=>r.id===id);if(!r||r.kind!=='agents-decision')throw Error('Unknown agent reservation');
      // Unknown/unfinished work retains its hold. Known usage is an estimate,
      // not a provider bill; do not permanently count a reservation as spend.
      r.status=cleaned?'closed':'unconfirmed';r.estimatedUSD=r.reservedUSD;r.complete=complete;r.cleaned=cleaned;
      r.accountingBasis='reservation_hold';
      if(usage&&Number.isSafeInteger(usage.input_tokens)&&usage.input_tokens>=0&&Number.isSafeInteger(usage.output_tokens)&&usage.output_tokens>=0){
        r.tokens={input:usage.input_tokens,output:usage.output_tokens};
        // Standard GPT-5.4-mini rates verified 2026-09-17. Count all input at
        // uncached rates and every observed web call at $0.01 conservatively.
        // No subagents/sandbox or other hosted tools are enabled in this planner.
        if(complete&&cleaned&&model==='gpt-5.4-mini'&&Number.isSafeInteger(webSearchCalls)&&webSearchCalls>=0){
          r.estimatedUSD=Math.ceil((usage.input_tokens*.75+usage.output_tokens*4.5+webSearchCalls*10000))/1e6;
          r.accountingBasis='usage_estimate';r.model=model;r.webSearchCalls=webSearchCalls;r.pricingDate='2026-09-17';
        }
      }
    });
  }
  identifyAgent(id,sessionId) {
    this.change(b=>{const r=b.runs.find(r=>r.id===id);if(!r)throw Error('Unknown reservation');r.sessionId=sessionId;});
  }
  finish(id, seconds) {
    this.change(b => {
      const r = b.runs.find(r => r.id === id); if (!r) throw Error('Unknown budget reservation');
      if (Number.isFinite(seconds) && seconds >= 0) {
        r.status = 'closed'; r.seconds = seconds;
        // WebRTC initialization has a 15-second minimum charge, credited to duration.
        r.estimatedUSD = Math.ceil(Math.max(15, seconds) * 0.05 / 60 * 1e6) / 1e6;
      } else r.status = 'unconfirmed';
    });
  }
  finishImage(id,{received,usage}){
    this.change(b=>{
      const r=b.runs.find(r=>r.id===id);if(!r||r.kind!=='image-generation')throw Error('Unknown image reservation');
      r.status=received?'closed':'unconfirmed';r.estimatedUSD=r.reservedUSD;
      // Text-only input at $5/M, image output at $30/M; never refund the allowance.
      // This ledger is conservative accounting, not a provider-side spending cap.
      if(usage&&Number.isFinite(usage.input_tokens)&&usage.input_tokens>=0&&Number.isFinite(usage.output_tokens)&&usage.output_tokens>=0){
        r.tokens={input:usage.input_tokens,output:usage.output_tokens};
        r.estimatedUSD=Math.max(r.reservedUSD,(usage.input_tokens*5+usage.output_tokens*30)/1e6);
        if(!received)r.reservedUSD=r.estimatedUSD;
      }
    });
  }
}
