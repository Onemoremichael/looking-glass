import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import gators from '../public/gators-flow.cjs';
import {validateDecision} from '../assistant-contract.mjs';
import {createApp} from '../server.mjs';

test('Gators attendance flow runs real research and overrides the obsolete football-only preference',()=>{
  const command=gators.command({tasks:[{kind:'sports',answers:'Football games to watch. Include TV details.'}]});
  validateDecision({status:'execute',outcome:'Find home events',message:'Researching',actions:[command],options:[],selectedOptionId:null});
  const request=command.spec.steps[0].request;
  assert.equal(command.spec.steps[0].kind,'research');
  for(const pattern of [/ALL UF sports HOME/,/Gainesville FL/,/14 days/,/America\/New_York/,/Exclude past, away and neutral/,/official/,/admission/,/no TV/,/Never invent/])assert.match(request,pattern);
  assert.doesNotMatch(request,/Football games to watch/);
  const ctx={window:{}};runInNewContext(readFileSync(new URL('../public/gators-flow.cjs',import.meta.url),'utf8'),ctx);
  assert.equal(JSON.stringify(ctx.window.GlassGators.command()),JSON.stringify(command));
});

test('Gators agenda uses attendance styling with source links and no mirror touch controls',()=>{
  const ctx={window:{}};
  for(const file of ['research-pages.cjs','research-ui.js'])runInNewContext(readFileSync(new URL('../public/'+file,import.meta.url),'utf8'),ctx);
  const board={spec:{title:'Gators at home',layout:'agenda'},summary:'Upcoming home events · test fixture',caveat:'Verify admission.',fetchedAt:Date.now(),page:0,cards:[{heading:'Soccer · Test opponent',kicker:'Thu · 6 PM ET',body:'Home venue',detail:'Admission not confirmed',sourceIds:['official']}],sources:[{id:'official',title:'Official schedule',url:'https://floridagators.com/calendar'}]};
  const html=ctx.window.GlassResearch.render(board,false);
  assert.match(html,/research-gators/);assert.match(html,/ON THE CALENDAR/);assert.doesNotMatch(html,/FIELD NOTES|<button|<a /);
  assert.match(ctx.window.GlassResearch.render(board,true),/Official schedule<\/a>/);
  board.spec.title='Community events';assert.doesNotMatch(ctx.window.GlassResearch.render(board,false),/research-gators/);
});

test('companion serves the shortcut and starts a guarded research workflow',async t=>{
  let calls=0;
  const origins=[],app=createApp({origins,assistantOptions:{planner:{decide:async()=>{throw Error('Shortcut must not invoke inference');}},gatorsSchedule:async()=>{
    calls++;
    return {spec:{title:'Gators at home',query:gators.command().spec.steps[0].request,layout:'agenda'},summary:'Test fixture only',caveat:'Not live events.',cards:[{heading:'Soccer · Fixture',kicker:'Test time ET',body:'Test home venue',detail:'Admission not confirmed',sourceIds:['uf']}],sources:[{id:'uf',title:'Official schedule',url:'https://floridagators.com/calendar'}]};
  }}});
  t.after(()=>app.close());await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;origins.push(base);
  const asset=await fetch(base+'/gators-flow.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
  const html=await(await fetch(base+'/remote')).text();assert.ok(html.indexOf('/gators-flow.js')<html.indexOf('/remote.js'));
  const body=JSON.stringify({requestId:'gators-test',revision:app.session.state.revision,command:gators.command()});
  const post=origin=>fetch(base+'/api/workflows',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body});
  assert.equal((await post('https://elsewhere.test')).status,403);
  assert.equal((await post(base)).status,200);await app.workflows.active?.promise;
  assert.equal(calls,1);assert.equal(app.session.state.workflows[0].status,'completed');assert.equal(app.session.state.panel,'research');
});
