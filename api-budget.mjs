import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Shared with transport diagnostics. A reservation is an allowance, not billed spend.
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
      if(kind==='agents-decision'&&b.runs.some(r=>r.kind===kind&&['pending','unconfirmed'].includes(r.status)))throw Error('Prior agent request is still active or needs usage review');
      const used = b.runs.reduce((sum, r) => sum + (r.status === 'closed' ? r.estimatedUSD : r.reservedUSD), 0);
      if (!Number.isFinite(used) || used + 0.5 > b.approvedUSD) throw Error('Test budget exhausted or invalid');
      const run = { id: randomUUID(), kind, startedAt: new Date().toISOString(), status: 'pending', reservedUSD: 0.5 };
      b.runs.push(run); return run.id;
    });
  }
  finishAgent(id,{complete,cleaned,usage}) {
    this.change(b=>{
      const r=b.runs.find(r=>r.id===id);if(!r||r.kind!=='agents-decision')throw Error('Unknown agent reservation');
      // Retain the full allowance even on success: token usage is not a billing quote.
      r.status=cleaned?'closed':'unconfirmed';r.estimatedUSD=r.reservedUSD;r.complete=complete;r.cleaned=cleaned;
      if(usage&&Number.isFinite(usage.input_tokens)&&Number.isFinite(usage.output_tokens))r.tokens={input:usage.input_tokens,output:usage.output_tokens};
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
}
