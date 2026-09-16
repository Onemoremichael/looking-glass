import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {CustomFunctions} from '../custom-functions.mjs';
import {Telemetry} from '../telemetry.mjs';
import {analyzeFunctionReuse,promoteFunctionRoute,FUNCTION_CONTEXT_MS} from '../function-reuse.mjs';

const spec=()=>({title:'Picnic portions',outcome:'Calculate two snacks per person',inputs:[{name:'people',label:'People',type:'number'}],code:'i=>({snacks:i.people*2})',tests:[{inputJSON:'{"people":3}',expectedJSON:'{"snacks":6}'},{inputJSON:'{"people":0}',expectedJSON:'{"snacks":0}'}],layout:{accent:'peach',blocks:[{kind:'metric',label:'Snacks',key:'snacks',unit:'pieces'}]}});
const rectangle=()=>({...spec(),title:'Rectangle area',outcome:'Multiply length and width',inputs:[{name:'length',label:'Length',type:'number'},{name:'width',label:'Width',type:'number'}],code:'i=>({area:i.length*i.width})',tests:[{inputJSON:'{"length":3,"width":4}',expectedJSON:'{"area":12}'},{inputJSON:'{"length":0,"width":4}',expectedJSON:'{"area":0}'}],layout:{accent:'sky',blocks:[{kind:'metric',label:'Area',key:'area',unit:'square units'}]}});
function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'glass-reuse-'));let now=1_000_000;
  const file=join(directory,'state.json'),session=new Session({file,now:()=>now}),telemetry=new Telemetry();
  const functions=new CustomFunctions({session,telemetry});let plans=0;
  const assistant=new Assistant({session,telemetry,planner:{decide:async()=>{plans++;return {status:'unsupported',outcome:'Unclear',message:'Needs contextual planning',actions:[],options:[],selectedOptionId:null};}}});assistant.functions=functions;
  t.after(async()=>{await functions.close();await telemetry.close();session.close();rmSync(directory,{recursive:true,force:true});});
  return {session,functions,assistant,telemetry,file,setNow:v=>{now=v;},plans:()=>plans,
    create:async(s=spec(),input={people:6},utterance='Pack snacks for six people')=>functions.handle('create-'+Math.random(),{action:'create_function',spec:s,inputJSON:JSON.stringify(input),parentId:null},{utterance}),
    ask:(id,text,options)=>assistant.execute(id,text,options)};
}
test('successful execution learns numeric slots and reuses spoken variants without planning',async t=>{
  const f=fixture(t),result=await f.create();assert.equal(result.routePromoted,true);
  assert.equal(f.session.state.functionRoutes.length,1);
  for(const [i,phrase,n] of [[0,'Please pack snacks for nine people',9],[1,"Okay, can you pack snacks for twenty-one people for me?",21],[2,'pack snacks for 2.5 people',2.5],[3,'pack snacks for zero people',0]]){
    const r=await f.ask('reuse-'+i,phrase);assert.equal(r.functionOutput.snacks,n*2);assert.equal(r.functionVerified,true);
  }
  assert.equal(f.plans(),0);assert.equal(f.session.state.functionRoutes.length,1);
  const records=f.telemetry.snapshot().records.filter(r=>r.name==='function.reuse'&&r.kind==='end');
  assert.equal(records.length,4);assert.ok(records.every(r=>r.attributes.outcome==='completed'));
});
test('distinct successful wording is learned; units and literal intent are not discarded',async t=>{
  const f=fixture(t),first=await f.create();
  await f.functions.handle('new-wording',{action:'run_function',viewId:first.functionId,inputJSON:'{"people":4}'},{utterance:'Calculate snacks for four guests'});
  assert.equal(f.session.state.functionRoutes.length,2);
  assert.equal((await f.ask('paraphrase','Could you work out snacks for eight guests?')).functionOutput.snacks,16);
  for(const s of ['pack snacks for nine dogs','pack drinks for nine people','pack snacks for nine people tomorrow','do not pack snacks for nine people','pack snacks for nine people and set a timer'])assert.equal(analyzeFunctionReuse(s,f.session.state,1_000_000).action,null,s);
});
test('named functions ask one missing input at a time and retain answers across turns',async t=>{
  const f=fixture(t);await f.create(rectangle(),{length:3,width:4},'Calculate area for length three and width four');
  let r=await f.ask('open','Open rectangle area');assert.equal(r.status,'needs_input');assert.match(r.message,/Length/);assert.doesNotMatch(r.message,/Width/);
  r=await f.ask('first','five');assert.equal(r.status,'needs_input');assert.match(r.message,/Width/);assert.deepEqual(f.session.state.customView.input,{length:5});
  r=await f.ask('second','seven');assert.equal(r.functionOutput.area,35);assert.deepEqual(f.session.state.customView.input,{length:5,width:7});
  r=await f.ask('amend','What if width is eight?');assert.equal(r.functionOutput.area,40);assert.match(r.message,/Length: 5, Width: 8/);
  assert.equal(f.plans(),0);
});
test('explicit function invocation binds fresh values and does not carry previous inputs',async t=>{
  const f=fixture(t);await f.create(rectangle(),{length:3,width:4},'');
  let r=await f.ask('partial','Run rectangle area with width 9');assert.equal(r.status,'needs_input');assert.match(r.message,/Length/);
  assert.deepEqual(f.session.state.customView.input,{width:9});
  r=await f.ask('finish','six');assert.equal(r.functionOutput.area,54);
  r=await f.ask('all','Use rectangle area with width 2 and length 5');assert.equal(r.functionOutput.area,10);
  assert.equal(f.plans(),0);
});
test('single-input follow-ups reuse current function, but bare ambient numbers do not rerun completed output',async t=>{
  const f=fixture(t);await f.create();
  for(const [id,text,n] of [['a','What about nine?',9],['b','How about minus two?',-2],['c','Try 3.5',3.5],['d','Make it twenty two',22]])assert.equal((await f.ask(id,text)).functionOutput.snacks,n*2);
  assert.equal(analyzeFunctionReuse('seven',f.session.state,1_000_000).action,null);
  assert.equal(analyzeFunctionReuse('What about nine and ten?',f.session.state,1_000_000).action,null);
});
test('focus expires and is invalidated by navigation, unrelated revisions, restart or pending clarification',async t=>{
  const f=fixture(t);await f.create();const initial=structuredClone(f.session.state);
  const reject=state=>assert.equal(analyzeFunctionReuse('What about nine?',state,1_000_000).action,null);
  reject({...initial,panel:'home'});reject({...initial,revision:initial.revision+1});reject({...initial,assistant:{status:'clarify'}});reject({...initial,playroom:{kind:'animals'}});
  assert.equal(analyzeFunctionReuse('What about nine?',initial,1_000_000+FUNCTION_CONTEXT_MS+1).action,null);
  assert.equal(analyzeFunctionReuse('What about nine?',initial,999_999).action,null);
  const restored=new Session({file:f.file,now:()=>1_000_000});t.after(()=>restored.close());reject(restored.state);
  // Durable learned routes still work after restart; stale conversational focus does not.
  assert.equal(analyzeFunctionReuse('Pack snacks for nine people',restored.state,1_000_000).action.action,'run_function');
});
test('conflicting recipes, changed source, duplicated arguments and corrupt route slots fall back',async t=>{
  const f=fixture(t);await f.create();const initial=structuredClone(f.session.state);
  await f.create({...spec(),title:'Different portions'}, {people:6});
  assert.equal(analyzeFunctionReuse('Pack snacks for nine people',f.session.state,1_000_000).reason,'ambiguous_target');
  const changed=structuredClone(initial);changed.reusableViews[0].spec.code='i=>({snacks:i.people*3})';
  assert.equal(analyzeFunctionReuse('Pack snacks for nine people',changed,1_000_000).action,null);
  const corrupt=structuredClone(initial);corrupt.functionRoutes[0].parts[3]={slot:'__proto__'};
  assert.equal(analyzeFunctionReuse('Pack snacks for nine people',corrupt,1_000_000).action,null);
  const f2=fixture(t);await f2.create(rectangle(),{length:3,width:4},'');
  for(const s of ['Run rectangle area with width 3 and width 4','Run rectangle area with length 3 and width 4 or 5','Run rectangle area with length 3 feet and width 4'])assert.equal(analyzeFunctionReuse(s,f2.session.state,1_000_000).action,null,s);
});
test('route promotion needs every numeric slot grounded uniquely; failure and opt-out do not learn',async t=>{
  const f=fixture(t);await f.create();const view=f.session.state.reusableViews[0];
  for(const s of ['pack snacks for seven people','pack six snacks for six people','six','do not pack snacks for six people','pack snacks for six people then leave'])assert.equal(promoteFunctionRoute(f.session.state,view,{people:6},s,1),false,s);
  assert.equal(analyzeFunctionReuse('Pack snacks for nine people',f.session.state,1_000_000,{learned:false}).action,null);
  f.session.learnQuickActions=false;await f.functions.handle('no-learn',{action:'run_function',viewId:view.id,inputJSON:'{"people":8}'},{utterance:'Calculate snacks for eight guests'});assert.equal(f.session.state.functionRoutes.length,1);
  const failed=fixture(t),bad=spec();bad.code='i=>({snacks:0})';await assert.rejects(failed.create(bad));assert.equal(failed.session.state.functionRoutes,undefined);
});
test('fast reuse respects cancellation, beforeCommit and workflow action guards',async t=>{
  const f=fixture(t);await f.create();const revision=f.session.state.revision;
  await assert.rejects(f.ask('guard','Pack snacks for nine people',{guardDecision:()=>{throw Error('Step scope');}}),/Step scope/);
  const controller=new AbortController();await assert.rejects(f.ask('cancel','Pack snacks for nine people',{signal:controller.signal,beforeCommit:async()=>controller.abort()}),/cancelled/);
  assert.equal(f.session.state.revision,revision);assert.equal(f.plans(),0);
  await assert.rejects(f.ask('stale','Pack snacks for nine people',{beforeCommit:async()=>f.session.command('show',{panel:'time'})}),/Display changed/);
  assert.equal(f.session.state.panel,'time');
});
test('named boolean and quoted text inputs preserve case and questions render without controls on mirror',async t=>{
  const f=fixture(t),s={...spec(),title:'Name card',inputs:[{name:'name',label:'Name',type:'text'},{name:'loud',label:'Loud',type:'boolean'}],code:'i=>({message:i.loud?i.name.toUpperCase():i.name})',tests:[{inputJSON:'{"name":"Sam","loud":false}',expectedJSON:'{"message":"Sam"}'},{inputJSON:'{"name":"Sam","loud":true}',expectedJSON:'{"message":"SAM"}'}],layout:{accent:'mint',blocks:[{kind:'note',label:'Hello',key:'message'}]}};
  await f.create(s,{name:'Jane',loud:false},'');
  await f.ask('open','Open name card');let r=await f.ask('name','"McKenzie"');assert.equal(r.status,'needs_input');assert.match(r.message,/Loud/);
  const context={window:{}};runInNewContext(readFileSync(new URL('../public/function-ui.js',import.meta.url),'utf8'),context);
  const html=context.window.GlassFunction.render(f.session.state,false);assert.match(html,/What should I use for Loud/);assert.doesNotMatch(html,/<input|<button|<form/);
  r=await f.ask('boolean','no');assert.equal(r.functionOutput.message,'McKenzie');assert.equal(f.plans(),0);
});
test('observer failure cannot hide a committed result; disk failure cannot promote a route',async t=>{
  const f=fixture(t);await f.create();f.assistant.telemetry={start:()=>({end:()=>{throw Error('Observer failed');}})};
  const r=await f.ask('observer','Pack snacks for ten people');assert.equal(r.functionOutput.snacks,20);
  const before=structuredClone(f.session.state);f.session.save=()=>{throw Error('Disk full');};
  await assert.rejects(f.functions.handle('disk',{action:'run_function',viewId:r.functionId,inputJSON:'{"people":8}'},{utterance:'Calculate snacks for eight guests'}),/Disk full/);
  assert.deepEqual(f.session.state,before);
});
