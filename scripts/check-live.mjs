// Explicit paid transport test. No microphone capture or delegated inference.
import OpenAI from 'openai';
import { LiveWS } from 'openai/resources/live/ws';
import { loadEnvFile } from 'node:process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--paid-test')) throw new Error('Use --paid-test only within an approved test budget.');
loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('Missing API key');
const directory = fileURLToPath(new URL('../data', import.meta.url));
mkdirSync(directory, { recursive: true });
const path = directory + '/api-test-budget.json';
const lock = directory + '/api-test-budget.lock';
const fd = openSync(lock, 'wx', 0o600);
const persist = value => { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(path + '.tmp', path); };
let budget;
try {
  try { budget = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; budget = { approvedUSD: 25, authorization: 'Owner approved $25 for this testing round in chat', runs: [] }; }
  if (budget.approvedUSD !== 25 || !Array.isArray(budget.runs)) throw new Error('Invalid budget record');
  if (budget.runs.some(r => r.status !== 'closed') && !process.argv.includes('--reviewed-retry')) throw new Error('An earlier test needs usage/finalization review before another paid run.');
  const accounted = budget.runs.reduce((sum,r) => sum + (r.status === 'closed' ? r.estimatedUSD : r.reservedUSD), 0);
  if (!Number.isFinite(accounted) || accounted + 0.25 > budget.approvedUSD) throw new Error('Test budget exhausted');
  const run = { startedAt: new Date().toISOString(), kind: 'live-handshake', reservedUSD: 0.25, status: 'pending' };
  budget.runs.push(run); persist(budget);
  const client = new OpenAI({ maxRetries: 0, timeout: 15000 });
  const ws = new LiveWS(client, { reconnect: null, handshakeTimeout: 10000 });
  let finalized = false;
  const watchdog = setTimeout(() => {
    console.error('Finalization timeout; no automatic retry. Review budget record.');
    run.status = 'unconfirmed'; persist(budget); process.exitCode = 1;
    ws.socket.platformSocket.terminate();
  }, 30000);
  ws.on('error', error => {
    const safe = String(error.message || 'Unknown error').split(process.env.OPENAI_API_KEY).join('[redacted]').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1000);
    run.error = safe; persist(budget); console.error(safe); process.exitCode = 1;
  });
  ws.socket.on('open', () => ws.send({ type: 'session.start', session: {
    model: 'gpt-live-1', store: false, delegation: { type: 'client' },
    instructions: 'Connection test only. No user audio is provided. Do not perform any tasks.',
    audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'marin' } }
  } }));
  await new Promise(resolve => {
    ws.on('event', event => {
      if (event.type === 'session.started') {
        run.sessionId = event.session.id; persist(budget);
        console.log('GPT-Live-1 session started; requesting immediate close.');
        ws.send({ type: 'session.close' });
      }
      if (event.type === 'session.closed') {
        finalized = true; run.status = 'closed'; run.reason = event.reason;
        run.seconds = event.usage.seconds;
        run.estimatedUSD = Math.ceil(event.usage.seconds * 0.05 / 60 * 1000000) / 1000000;
        persist(budget); clearTimeout(watchdog);
        console.log(JSON.stringify({ finalized: true, reason: run.reason, seconds: run.seconds, estimatedUSD: run.estimatedUSD }));
        ws.close();
      }
    });
    ws.socket.on('close', () => {
      clearTimeout(watchdog);
      if (!finalized) { run.status = 'unconfirmed'; persist(budget); console.error('Closed without final usage; further paid tests blocked.'); process.exitCode = 1; }
      resolve();
    });
  });
} finally { closeSync(fd); unlinkSync(lock); }
