import http from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { Voice } from './voice.mjs';
import { Telemetry } from './telemetry.mjs';
import { SurfaceRegistry,validateDecision } from './assistant-contract.mjs';
import { Assistant } from './assistant.mjs';
import { AgentsPlanner } from './agents-planner.mjs';
import { ApiBudget } from './api-budget.mjs';
import {Weather} from './weather.mjs';
import {MirrorAudio} from './mirror-audio.mjs';
import {Wake} from './wake.mjs';
import {ImageStudio} from './image-studio.mjs';
import {Workflows} from './workflows.mjs';
import {CustomFunctions} from './custom-functions.mjs';
import {LocalPlayroom} from './local-playroom.mjs';
import {animals} from './playroom.mjs';

const files = { '/': 'index.html', '/remote': 'remote.html', '/surface.js':'surface.js', '/display.js': 'display.js', '/remote.js': 'remote.js', '/voice-client.js':'voice-client.js', '/voice.css':'voice.css', '/style.css': 'style.css', '/diagnostics':'diagnostics.html','/diagnostics.js':'diagnostics.js' };
const types = { html: 'text/html', js: 'text/javascript', cjs: 'text/javascript', css: 'text/css', png: 'image/png' };
Object.assign(files,{'/weather-ui.js':'weather-ui.js','/weather.css':'weather.css','/weather-controls.js':'weather-controls.js'});
Object.assign(files,{'/research-pages.js':'research-pages.cjs','/research-ui.js':'research-ui.js','/research.css':'research.css'});
Object.assign(files,{'/playroom-ui.js':'playroom-ui.js','/playroom.css':'playroom.css','/playroom-controls.js':'playroom-controls.js'});
Object.assign(files,{'/studio-ui.js':'studio-ui.js','/studio.css':'studio.css','/studio-controls.js':'studio-controls.js'});
Object.assign(files,{'/workflow-ui.js':'workflow-ui.js','/workflow.css':'workflow.css','/workflow-controls.js':'workflow-controls.js'});
Object.assign(files,{'/function-ui.js':'function-ui.js','/function.css':'function.css','/function-controls.js':'function-controls.js'});
for(const {id:name} of animals)files['/assets/playroom/'+name+'-v1.png']='assets/playroom/'+name+'-v1.png';
for(const kind of ['cloud','sun','moon','rain','storm','snow','fog']){
  files['/assets/weather/'+kind+'-volume-v1.png']='assets/weather/'+kind+'-volume-v1.png';
}

export function createApp({ origins = [], sessionOptions = {}, voiceOptions = {}, telemetry, assistantOptions,weatherOptions={}, mirrorAudio=null,wakeOptions={},studioOptions={},localPlayroomOptions={} } = {}) {
  const clients = new Set();
  const surfaces=new SurfaceRegistry();
  const session = new Session({ ...sessionOptions, onChange: state => {
    for (const client of clients) client.write(`data: ${JSON.stringify(state)}\n\n`);
    queueMicrotask(()=>weather.refresh().catch(()=>{}));
  } });
  const weather=new Weather({session,...weatherOptions});weather.start();
  const budgetPath=fileURLToPath(new URL('./data/api-test-budget.json',import.meta.url));
  const studio=new ImageStudio({session,budget:new ApiBudget(budgetPath),directory:fileURLToPath(new URL('./data/artwork',import.meta.url)),telemetry,...studioOptions});
  const assistant=assistantOptions?new Assistant({session,surfaces,telemetry,weather,studio,planner:assistantOptions.planner||new AgentsPlanner({budget:new ApiBudget(budgetPath),telemetry})}):undefined;
  const workflows=new Workflows({session,assistant,studio,telemetry});if(assistant)assistant.workflows=workflows;
  const functions=new CustomFunctions({session,telemetry});if(assistant)assistant.functions=functions;
  const voice = new Voice({ session, telemetry, assistant, budgetPath, ...voiceOptions,
    publish: state => { for (const client of clients) client.write(`event: voice\ndata: ${JSON.stringify(state)}\n\n`); } });
  const wake=new Wake({voice,mirror:mirrorAudio,...wakeOptions,publish:state=>{
    telemetry?.start('wake.state',{wake_phase:state.phase,wake_reason:state.reason}).end({outcome:'ok'});
    for(const client of clients)client.write(`event: wake\ndata: ${JSON.stringify(state)}\n\n`);
  }});
  const localPlayroom=new LocalPlayroom({session,mirror:mirrorAudio,...localPlayroomOptions,publish:state=>{
    for(const client of clients)client.write(`event: playroom-audio\ndata: ${JSON.stringify(state)}\n\n`);
  }});
  const server = http.createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'");
    try {
      const host = req.headers.host;
      const localOrigin = `http://${host}`;
      // Explicit host allowlist also prevents DNS-rebinding access to this LAN control service.
      if (!origins.includes(localOrigin)) return json(403, { error: 'Host not allowed' });
      const path = new URL(req.url, localOrigin).pathname;
      if (req.method==='GET' && ['/diagnostics','/api/telemetry'].includes(path)) {
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return json(403,{error:'Diagnostics are Mac-local only'});
        if(path==='/api/telemetry')return json(200,telemetry?.snapshot()||{records:[],metrics:{},exportEnabled:false,captureTranscripts:false});
      }
      if (req.method === 'GET' && path === '/api/state') return json(200, session.state);
      if(req.method==='GET'&&path==='/api/playroom-audio')return json(200,localPlayroom.state);
      if(req.method==='POST'&&path==='/api/playroom-audio'){
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers.origin!==localOrigin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(403,{error:'Local same-origin JSON required'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>512)return json(413,{error:'Request too large'});}
        try{const b=JSON.parse(raw);
          if(b.action==='stop')localPlayroom.stop();
          else if(b.action==='start'&&b.adultRehearsal===true){if(voice.active||wake.state.enabled)throw Error('Stop cloud voice and wake listening first');await localPlayroom.start();}
          else throw Error('Adult rehearsal and explicit local start required');
          return json(200,localPlayroom.state);
        }catch(e){return json(409,{error:e.message});}
      }
      if(req.method==='POST'&&path==='/api/functions'){
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers.origin!==localOrigin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(403,{error:'Local same-origin JSON required'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>128000)return json(413,{error:'Request too large'});}
        try{const b=JSON.parse(raw);validateDecision({status:'execute',outcome:'Function control',message:'Requested',actions:[b.command],options:[],selectedOptionId:null});return json(200,await functions.handle(b.requestId,b.command,{revision:b.revision}));}
        catch(e){return json(409,{error:e.message});}
      }
      if(req.method==='POST'&&path==='/api/workflows'){
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers.origin!==localOrigin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(403,{error:'Local same-origin JSON required'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16000)return json(413,{error:'Request too large'});}
        try{const b=JSON.parse(raw);validateDecision({status:'execute',outcome:'Workflow control',message:'Requested',actions:[b.command],options:[],selectedOptionId:null});return json(200,workflows.handle(b.requestId,b.command,{revision:b.revision,utterance:b.confirmed===true?'Confirmed done using companion':''}));}
        catch(e){return json(409,{error:e.message});}
      }
      if(req.method==='GET'&&/^\/artwork\/[0-9a-f-]{36}\.png$/.test(path)){
        try{const bytes=studio.read(path.slice(9,-4));res.writeHead(200,{'Content-Type':'image/png'});return res.end(bytes);}catch{return json(404,{error:'Artwork not found'});}
      }
      if(req.method==='POST'&&path==='/api/studio'){
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers.origin!==localOrigin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(403,{error:'Local same-origin JSON required'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8000)return json(413,{error:'Request too large'});}
        try{
          const b=JSON.parse(raw);
          if(b.action==='generate')return json(202,studio.start(b.requestId,b.spec));
          if(b.action==='cancel')return json(200,studio.cancel(b.jobId));
          throw Error('Unknown image operation');
        }catch(e){return json(409,{error:e.message});}
      }
      if (req.method === 'GET' && path === '/api/voice') return json(200, voice.state);
      if(req.method==='GET'&&path==='/api/wake')return json(200,wake.state);
      if(req.method==='GET'&&path==='/api/mirror-audio')return json(200,mirrorAudio?.status()||{connected:false});
      if(req.method==='POST'&&path==='/api/weather'){
        if(req.headers.origin!==localOrigin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(403,{error:'Same-origin JSON required'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>1024)return json(413,{error:'Request too large'});}
        let body;try{body=JSON.parse(raw);if(!body||typeof body!=='object')throw Error();}catch{return json(400,{error:'Invalid weather request'});}
        try{
          if(body.action==='search')return json(200,{results:await weather.search(body.query)});
          weather.settings(body);return json(200,{ok:true});
        }catch(e){return json(400,{error:e.message});}
      }
      if(req.method==='POST'&&path==='/api/surface') {
        if(req.headers.origin!==localOrigin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(403,{error:'Same-origin JSON required'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>1024)return json(413,{error:'Request too large'});}
        try{surfaces.report(JSON.parse(raw),session.state);return json(200,{ok:true});}catch{return json(400,{error:'Invalid surface report'});}
      }
      if (req.method === 'GET' && path === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify(session.state)}\n\n`);
        res.write(`event: voice\ndata: ${JSON.stringify(voice.state)}\n\n`);
        res.write(`event: wake\ndata: ${JSON.stringify(wake.state)}\n\n`);
        res.write(`event: playroom-audio\ndata: ${JSON.stringify(localPlayroom.state)}\n\n`);
        clients.add(res);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
        return;
      }
      if (req.method === 'POST' && (path.startsWith('/api/voice/')||path.startsWith('/api/wake/'))) {
        // Paid voice is Mac-local only, even when the output display is shared on LAN.
        const loopback = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if (!loopback || req.headers.origin !== localOrigin || !origins.includes(req.headers.origin) ||
          !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(403,{error:'Local same-origin JSON required'});
        let raw=''; for await (const chunk of req) { raw+=chunk; if (Buffer.byteLength(raw)>65536) return json(413,{error:'Request too large'}); }
        let body; try { body=JSON.parse(raw); } catch { return json(400,{error:'Invalid JSON'}); }
        if (!body || typeof body!=='object') return json(400,{error:'Invalid body'});
        if(path.startsWith('/api/wake/')){
          try{
            if(path==='/api/wake/enable'){if(localPlayroom.active)throw Error('Stop local game audio first');if(body.test!==undefined&&typeof body.test!=='boolean')throw Error('Invalid test mode');await wake.enable({test:body.test===true});}
            else if(path==='/api/wake/disable')await wake.disable();
            else if(path==='/api/wake/end'){if(voice.active?.owner!=='wake')throw Error('No wake conversation is active');await voice.stop(undefined,'user');}
            else return json(404,{error:'Unknown wake operation'});
            return json(200,wake.state);
          }catch(e){return json(409,{error:e.message});}
        }
        if (path==='/api/voice/start') {
          try { if(localPlayroom.active)throw Error('Stop local game audio first');if(wake.state.enabled)throw Error('Turn off wake listening before starting a manual conversation');if(body.device==='mirror'&&!mirrorAudio)throw Error('Mirror audio is unavailable');return json(201,await voice.start(body.sdp,body.device==='mirror'?mirrorAudio:null)); }
          catch (e) { return json(409,{error:e.message}); }
        }
        if (!voice.active || body.token!==voice.active.token) return json(409,{error:'No matching active session'});
        if(path==='/api/voice/mute'&&voice.active.mirror){if(voice.active.finishing)return json(409,{error:'The game is finishing; start a new game after it closes.'});voice.active.mirror.mute(!!body.muted);return json(200,{ok:true});}
        if (path==='/api/voice/heartbeat') return json(200,{ok:voice.heartbeat(body.token,body)});
        if (path==='/api/voice/stop') { await voice.stop(body.token); return json(200,voice.state); }
        return json(404,{error:'Unknown voice operation'});
      }
      if (req.method === 'POST' && path === '/api/command') {
        if (!origins.includes(req.headers.origin) || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(403, { error: 'Same-origin JSON required' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 2048) return json(413, { error: 'Request too large' });
        }
        let command;
        try { command = JSON.parse(body); session.command(command.action, command); }
        catch { return json(400, { error: 'Invalid command' }); }
        return json(200, session.state);
      }
      if(req.method==='POST'&&path==='/api/playroom'){
        if(req.headers.origin!==localOrigin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(403,{error:'Same-origin JSON required'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>512)return json(413,{error:'Request too large'});}
        try{
          const body=JSON.parse(raw);
          if(body.action==='stop'){localPlayroom.stop();await wake.disable();await voice.stop();session.endPlayroom();}
          else if(body.action==='start'&&body.adultRehearsal===true){
            if(voice.active||wake.state.enabled)throw Error('End voice and wake listening before entering rehearsal');
            if(localPlayroom.active)throw Error('Stop local game audio before changing games');
            if(studio.active)throw Error('Finish or cancel image generation before entering rehearsal');
            if(workflows.active)throw Error('Pause the workflow before entering rehearsal');
            if(functions.active)throw Error('Wait for the function check before entering rehearsal');
            session.startPlayroom(body.kind,body.settings);
          }else throw Error('Adult-only rehearsal must be acknowledged; child deployment is not enabled');
          return json(200,{ok:true});
        }catch(e){return json(409,{error:e.message});}
      }
      if (req.method === 'GET' && files[path]) {
        const name = files[path];
        const data = await readFile(new URL(`./public/${name}`, import.meta.url));
        const mime=types[name.split('.').pop()];
        res.writeHead(200, { 'Content-Type': mime+(mime.startsWith('text/')?'; charset=utf-8':'') });
        return res.end(data);
      }
      json(404, { error: 'Not found' });
    } catch { if (!res.headersSent) json(500, { error: 'Request failed' }); else res.end(); }
  });
  return { server, session, voice, weather,wake,studio,workflows,functions,localPlayroom, close: async () => {
    try { localPlayroom.close();await workflows.close();await functions.close();await studio.close();await wake.close();await weather.close();await voice.stop(undefined,'shutdown'); await assistant?.planner.drain?.(); }
    finally { mirrorAudio?.close();session.close(); for (const client of clients) client.end(); server.close(); await telemetry?.close(); }
  } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const envPath = fileURLToPath(new URL('./.env', import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const port = Number(process.env.PORT || 8780);
  const host = process.env.HOST || '127.0.0.1';
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(process.env.LAN_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)];
  const telemetry=new Telemetry({file:fileURLToPath(new URL('./data/telemetry/events.jsonl',import.meta.url)),env:process.env});
  const mirrorAudio=new MirrorAudio();await mirrorAudio.listen(Number(process.env.MIRROR_AUDIO_PORT||8782));
  const app = createApp({ origins, telemetry, mirrorAudio, assistantOptions:process.env.OPENAI_AGENT_ENABLED==='0'?undefined:{}, sessionOptions: { file: fileURLToPath(new URL('./data/state.json', import.meta.url)) } });
  app.server.listen(port, host, () => console.log(`Looking Glass: http://localhost:${port}/\nRemote: http://localhost:${port}/remote\nMicrophone off until manual Start or explicit local wake enable. Camera off. Bound to ${host}.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close());
}
