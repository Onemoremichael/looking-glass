import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {CustomFunctions} from '../custom-functions.mjs';
import {Workflows} from '../workflows.mjs';
import {Telemetry} from '../telemetry.mjs';
import {workflowExecutor} from '../workflow-reuse.mjs';
import {normalizeForecast} from '../weather.mjs';
import {AgentsPlanner} from '../agents-planner.mjs';

const calc=()=>({title:'Party portions',outcome:'Two snacks per person',inputs:[{name:'people',label:'People',type:'number'}],code:'input => ({portions: input.people * 2})',tests:[{inputJSON:'{"people":4}',expectedJSON:'{"portions":8}'},{inputJSON:'{"people":0}',expectedJSON:'{"portions":0}'}],layout:{accent:'peach',blocks:[{kind:'metric',label:'Snacks to pack',key:'portions',unit:'pieces'}]}});
const plan=()=>({title:'Prepare a party',outcome:'Prepare the right number of snacks',inputs:[{name:'people',question:'How many people?'}],steps:[{kind:'custom',title:'Calculate portions',request:'Calculate two snacks each for {{people}} people'}]});
const values=people=>[{name:'people',value:String(people)}];
const decision=action=>({status:'execute',outcome:'Calculate portions',message:'Requested',actions:[action],options:[],selectedOptionId:null});
async function settle(f){if(f.workflows.active)await f.workflows.active.promise;}
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'glass-workflow-reuse-')),session=new Session({file:join(dir,'state.json')}),telemetry=new Telemetry();
  const functions=new CustomFunctions({session,telemetry});let calls=0;
  const assistant=new Assistant({session,telemetry,planner:{decide:async c=>{
    calls++;assert.equal(c.now,undefined);assert.equal(c.history,undefined);assert.equal(c.weather,undefined);
    const input=Number(c.workflowContext.inputs.find(v=>v.name==='people').value);
    return decision({action:'create_function',spec:calc(),inputJSON:JSON.stringify({people:input}),parentId:null});
  }}});assistant.functions=functions;
  const workflows=new Workflows({session,assistant,telemetry});assistant.workflows=workflows;
  t.after(async()=>{await workflows.close();await functions.close();await telemetry.close();session.close();rmSync(dir,{recursive:true,force:true});});
  return {session,assistant,functions,workflows,telemetry,calls:()=>calls};
}
async function first(f,s=plan(),v=values(6)){
  const r=f.workflows.handle('first',{action:'create_workflow',spec:s,values:v,parentId:null});await settle(f);return f.workflows.get(r.runId);
}
async function again(f,r,v=values(9),id='again'){
  const next=f.workflows.handle(id,{action:'reuse_workflow',viewId:r.recipeId,values:v});await settle(f);return f.workflows.get(next.runId);
}
test('verified workflow function auto-promotes; fresh inputs rerun the real sandbox without a planner',async t=>{
  const f=fixture(t),r=await first(f);assert.equal(r.status,'completed');assert.equal(f.calls(),1);
  assert.equal(f.session.state.reusableViews.find(v=>v.id===r.recipeId).executors.length,1);
  assert.deepEqual(r.steps[0].evidence.functionOutput,{portions:12});
  const start=performance.now(),next=await again(f,r);const elapsed=performance.now()-start;
  assert.equal(next.status,'completed');assert.equal(f.calls(),1);assert.equal(next.steps[0].execution,'saved_function');
  assert.deepEqual(next.steps[0].evidence.functionOutput,{portions:18});assert.notEqual(next.steps[0].operationId,r.steps[0].operationId);
  assert.deepEqual(await again(f,r,values(9),'again'),next); // Idempotent command, not a third calculation.
  assert.equal(f.telemetry.snapshot().metrics['workflow.step_reuse'].count,1);
  assert.doesNotMatch(JSON.stringify(f.telemetry.snapshot().records),/Prepare a party|snacks|"people"/);
  t.diagnostic('Fixture learned workflow fresh-input execution: '+elapsed.toFixed(1)+' ms (no audio/provider)');
});
test('saved executor survives a server restart and no old output is replayed',async t=>{
  const f=fixture(t),r=await first(f),session=new Session({file:f.session.file});
  const assistant=new Assistant({session,planner:{decide(){throw Error('No inference expected');}}});
  assistant.functions=new CustomFunctions({session});const workflows=new Workflows({session,assistant});
  t.after(async()=>{await workflows.close();await assistant.functions.close();session.close();});
  const n=workflows.handle('fresh',{action:'reuse_workflow',viewId:r.recipeId,values:values(11)});await settle({workflows});
  assert.equal(workflows.get(n.runId).status,'completed');assert.deepEqual(session.state.customView.output,{portions:22});
});
test('unbound constants, replies, undeclared fields, changed specs and disabled learning cannot replay',async t=>{
  const f=fixture(t),r=await first(f),source=f.session.state.reusableViews.find(v=>v.kind==='function');
  const probe=structuredClone(r);probe.values=values(7);
  assert.ok(workflowExecutor(probe,0,f.session.state));
  for(const value of ['seven','7 and erase my list','1e999','1000000001','']){
    probe.values=values(value);assert.equal(workflowExecutor(probe,0,f.session.state),null,value);
  }
  probe.values=values(7);probe.steps[0].reply='Actually different';assert.equal(workflowExecutor(probe,0,f.session.state),null);probe.steps[0].reply=null;
  source.spec.layout.blocks[0].label='Changed';assert.equal(workflowExecutor(probe,0,f.session.state),null);
  source.spec.layout.blocks[0].label='Snacks to pack';source.spec.code='input => ({portions: 999})';assert.equal(workflowExecutor(probe,0,f.session.state),null);
  source.spec.code=calc().code;f.session.learnQuickActions=false;const next=await again(f,r);assert.equal(next.steps[0].execution,'assistant');assert.equal(f.calls(),2);
});
test('changing an input not passed into the function requires replanning',async t=>{
  const f=fixture(t),p=plan();p.inputs.push({name:'occasion',question:'What occasion?'});p.outcome='Prepare {{occasion}} snacks';
  const r=await first(f,p,[...values(6),{name:'occasion',value:'picnic'}]);
  const next=await again(f,r,[...values(9),{name:'occasion',value:'birthday'}]);assert.equal(next.status,'completed');assert.equal(f.calls(),2);
});
test('placeholder/name mismatches and inferred constants do not get promoted',async t=>{
  for(const mode of ['no-placeholder','different-value','different-name']){
    const f=fixture(t),p=plan();
    if(mode==='no-placeholder')p.steps[0].request='Calculate snacks for six people';
    f.assistant.planner.decide=async()=>{const s=calc();if(mode==='different-name'){s.inputs[0].name='guests';s.code=s.code.replace('people','guests');s.tests=s.tests.map(t=>({...t,inputJSON:t.inputJSON.replace('people','guests')}));}
      return decision({action:'create_function',spec:s,inputJSON:mode==='different-name'?'{"guests":6}':mode==='different-value'?'{"people":99}':'{"people":6}',parentId:null});};
    const r=await first(f,p);assert.equal(r.status,'completed');assert.equal(f.session.state.reusableViews.find(v=>v.id===r.recipeId).executors,undefined,mode);
  }
});
test('prior human answers are preserved dependencies, not silently generalized',async t=>{
  const f=fixture(t),p=plan();p.steps.unshift({kind:'confirm',title:'Choose the menu',request:'Confirm the menu choice'});
  const r=await first(f,p);f.workflows.handle('confirm',{action:'confirm_workflow_step',runId:r.id,stepId:r.steps[0].id},{utterance:'Fruit'});await settle(f);
  const next=await again(f,r);f.workflows.handle('confirm-next',{action:'confirm_workflow_step',runId:next.id,stepId:next.steps[0].id},{utterance:'Cookies'});await settle(f);
  assert.equal(f.calls(),2);assert.equal(f.workflows.get(next.id).steps[1].execution,'assistant');
});
test('failed example checks never promote; a failed reused executor blocks without paid fallback',async t=>{
  const f=fixture(t),r=await first(f);
  f.functions.evaluate=async()=>[{portions:999},{portions:0},{portions:18},{portions:18}];
  const next=await again(f,r);assert.equal(next.status,'blocked');assert.equal(next.steps[0].evidence,null);assert.equal(f.calls(),1);
  assert.deepEqual(f.session.state.customView.output,{portions:12});
});
test('first-run validation failure cannot teach an executor',async t=>{
  const f=fixture(t);f.functions.evaluate=async()=>[{portions:99},{portions:0},{portions:12},{portions:12}];
  const r=await first(f);assert.equal(r.status,'blocked');
  assert.equal(f.session.state.reusableViews.find(v=>v.id===r.recipeId).executors,undefined);
  assert.equal(f.session.state.reusableViews.some(v=>v.kind==='function'),false);
});
test('executor persistence failure rolls back promotion; receipt recovery does not recompute',async t=>{
  const f=fixture(t),save=f.session.save.bind(f.session);
  f.session.save=()=>{if(f.session.state.reusableViews.some(v=>v.executors?.length))throw Error('disk full');save();};
  const r=await first(f);assert.equal(r.status,'blocked');assert.equal(f.calls(),1);
  assert.equal(f.session.state.reusableViews.find(v=>v.id===r.recipeId).executors,undefined);
  assert.equal(r.steps[0].receipt.functionVerified,true);
  f.session.save=save;f.functions.evaluate=()=>{throw Error('Committed calculation must not rerun');};
  f.workflows.handle('recover',{action:'continue_workflow',runId:r.id,reply:null});await settle(f);
  assert.equal(f.workflows.get(r.id).status,'completed');assert.equal(f.calls(),1);
  assert.equal(f.session.state.reusableViews.find(v=>v.id===r.recipeId).executors.length,1);
});
test('deleted function source requires a new verified calculation rather than stale code replay',async t=>{
  const f=fixture(t),r=await first(f);f.session.state.reusableViews=f.session.state.reusableViews.filter(v=>v.kind!=='function');
  const next=await again(f,r);assert.equal(next.status,'completed');assert.equal(f.calls(),2);assert.equal(next.steps[0].execution,'assistant');
});
test('typed text and boolean workflow bindings are preserved as data',async t=>{
  const f=fixture(t),p=plan();p.inputs=[{name:'name',question:'Name?'},{name:'loud',question:'Loud?'}];p.steps[0].request='Greet {{name}} with loud={{loud}}';
  const s={...calc(),inputs:[{name:'name',label:'Name',type:'text'},{name:'loud',label:'Loud',type:'boolean'}],code:'input => ({greeting: input.loud ? input.name.toUpperCase() : input.name})',tests:[{inputJSON:'{"name":"Ada","loud":true}',expectedJSON:'{"greeting":"ADA"}'},{inputJSON:'{"name":"Ada","loud":false}',expectedJSON:'{"greeting":"Ada"}'}],layout:{accent:'mint',blocks:[{kind:'note',label:'Greeting',key:'greeting'}]}};
  f.assistant.planner.decide=async()=>decision({action:'create_function',spec:s,inputJSON:'{"name":"Ada","loud":false}',parentId:null});
  const r=await first(f,p,[{name:'name',value:'Ada'},{name:'loud',value:'false'}]);
  const n=await again(f,r,[{name:'name',value:'<b>Sam</b>'},{name:'loud',value:'true'}]);
  assert.equal(n.steps[0].execution,'saved_function');assert.deepEqual(n.steps[0].evidence.functionOutput,{greeting:'<B>SAM</B>'});
});
test('pause during a reused sandbox call discards late output and keeps old result',async t=>{
  const f=fixture(t),r=await first(f);let release;
  f.functions.evaluate=()=>new Promise(resolve=>release=resolve);
  const next=f.workflows.handle('again',{action:'reuse_workflow',viewId:r.recipeId,values:values(9)});await new Promise(r=>setImmediate(r));
  f.workflows.handle('pause',{action:'pause_workflow',runId:next.runId});release([{portions:8},{portions:0},{portions:18},{portions:18}]);await settle(f);
  assert.equal(f.workflows.get(next.runId).status,'paused');assert.deepEqual(f.session.state.customView.output,{portions:12});assert.equal(f.calls(),1);
});
test('workflow weather takes a built-in route but refreshes before every fresh run',async t=>{
  const f=fixture(t),s=f.session,place={id:'1',name:'Test City',label:'Test City',latitude:40,longitude:-74,timeZone:'UTC'};let refreshes=0,temp=70;
  s.editWeather(w=>{w.locations=[place];w.activeId='1';});
  f.assistant.weather={refresh:async()=>{
    refreshes++;const now=s.now(),midnight=Math.floor(now/86400000)*86400;
    const raw={current:{time:now/1000,temperature_2m:temp,apparent_temperature:temp,wind_speed_10m:8,relative_humidity_2m:70,weather_code:0,is_day:1},hourly:{time:[now/1000],temperature_2m:[temp],precipitation_probability:[0],weather_code:[0],is_day:[1]},daily:{time:[midnight],temperature_2m_max:[temp+4],temperature_2m_min:[temp-4],precipitation_probability_max:[0],weather_code:[0],sunrise:[midnight+21600],sunset:[midnight+68400]}};
    raw.hourly.time=Array.from({length:12},(_,i)=>now/1000+i*3600);
    for(const key of Object.keys(raw.hourly))if(key!=='time')raw.hourly[key]=Array(12).fill(raw.hourly[key][0]);
    raw.daily.time=[midnight,midnight+86400];
    for(const key of Object.keys(raw.daily))if(key!=='time')raw.daily[key]=[raw.daily[key][0],raw.daily[key][0]];
    s.editWeather(w=>{w.forecasts['1']=normalizeForecast(raw,place,'fahrenheit',now);});
  }};
  const p={title:'Check outside',outcome:'Check the weather',inputs:[],steps:[{kind:'weather',title:'Weather',request:'Show weather'}]};
  const r=await first(f,p,[]);assert.equal(r.status,'completed');temp=82;const next=await again(f,r,[]);
  assert.equal(next.status,'completed');assert.equal(refreshes,2);assert.equal(f.calls(),0);assert.equal(s.state.weather.forecasts['1'].current.temp,82);
});
test('companion distinguishes primary GPT-Live from optional local diagnostic speech',()=>{
  const html=readFileSync(new URL('../public/remote.html',import.meta.url),'utf8');
  assert.match(html,/id="voice-start">Start GPT-Live conversation/);
  assert.match(html,/<details><summary>Local speech diagnostics · different voice/);
  assert.match(html,/Samantha/);assert.match(html,/No automatic fallback from GPT-Live/);
});
test('pure workflow planning has no web tool for hidden live dependencies',async()=>{
  const d={...decision({action:'run_function',viewId:'fixture',inputJSON:'{"people":9}'}),quickAction:null};
  const stream={controller:{abort(){}},async *[Symbol.asyncIterator](){yield {type:'agent.session.created',session:{id:'fixture'}};yield {type:'agent.session.turn.output_text.done',text:JSON.stringify({decision:d})};yield {type:'agent.session.turn.completed'};}};
  const planner=new AgentsPlanner({client:{beta:{agents:{sessions:{create:async body=>{assert.deepEqual(body.agent.tools,[]);assert.equal(body.environment.type,'none');return stream;},delete:async()=>{}}}}},budget:{reserve:()=> 'fixture',finishAgent:()=>{}}});
  assert.deepEqual(await planner.decide({workflowContext:{currentStepId:'calculation',steps:[{id:'calculation',kind:'custom'}]}}),d);await planner.drain();
});
