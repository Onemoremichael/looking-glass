import { Telemetry } from '../telemetry.mjs';
import { fileURLToPath } from 'node:url';
const t=new Telemetry({file:fileURLToPath(new URL('../data/telemetry/events.jsonl',import.meta.url))});
const snapshot=t.snapshot();
console.log(JSON.stringify({window:snapshot.window,metrics:snapshot.metrics,timerFallbacks:snapshot.timerFallbacks,recent:snapshot.records.filter(r=>r.kind==='end').slice(-12)},null,2));
await t.close();
