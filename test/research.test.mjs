import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {AgentsPlanner} from '../agents-planner.mjs';
import {Voice} from '../voice.mjs';
import {Telemetry} from '../telemetry.mjs';
import {presentation} from '../assistant-contract.mjs';
import {publicSource,validateResearchBoard,researchIntent} from '../research-board.mjs';
const board=()=>({spec:{title:'Gators this week',query:'UF sports this week',layout:'agenda'},summary:'Two events to explore.',caveat:'Check times before leaving.',cards:Array.from({length:4},(_,i)=>({heading:'Event '+i,kicker:'Saturday · ET',body:'A fixture description.',detail:'Official schedule',sourceIds:['uf']})),sources:[{id:'uf',title:'Official schedule',url:'https://floridagators.com/sports/football/schedule'}]});
const decision=b=>({status:'execute',outcome:'Research sports',message:'Ready',actions:[{action:'compose_research',board:b}],options:[],selectedOptionId:null,quickAction:null});
test('research page fast routes accept natural navigation, not negation or unrelated commands',()=>{
  const state={panel:'research',research:board()};
  for(const text of ['next page','Next','Could you show me the next page please?','go to the next page','more results'])assert.equal(researchIntent(text,state)?.direction,'next',text);
  for(const text of ['previous page','go back','back a page','show the previous page'])assert.equal(researchIntent(text,state)?.direction,'previous',text);
  for(const text of ['do not go to the next page','next week','next page and delete it','my wife said next page','last page'])assert.equal(researchIntent(text,state),null,text);
  assert.equal(researchIntent('next page',{...state,panel:'weather'}),null);
  assert.equal(researchIntent('next page',{...state,assistant:{status:'clarify'}}),null);
});
test('research requires bounded sourced cards, safe URLs and opened provenance',()=>{
  for(const url of ['javascript:alert(1)','http://localhost/a','http://127.0.0.1','http://[::1]','https://u:p@site.com','https://site.local','file:///a'])assert.equal(publicSource(url),false);
  assert.throws(()=>validateResearchBoard(board(),{openedUrls:new Set()}),/not opened/);
  assert.doesNotThrow(()=>validateResearchBoard(board(),{openedUrls:new Set(board().sources.map(s=>s.url))}));
  const b=board();b.cards[0].sourceIds=['missing'];assert.throws(()=>validateResearchBoard(b),/known sources/);
  const s=new Session();assert.throws(()=>s.commitDecision('x',0,decision({...board(),code:'evil'}),'research'));
  assert.equal(s.state.revision,0);
});
test('research saves recipe, not facts, persists, reuses fresh results without planner and refreshes stale',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'glass-research-'));let now=1000,calls=0;
  try{
    const file=join(dir,'state.json');let s=new Session({file,now:()=>now});
    s.commitDecision('first',0,decision(board()),'research');
    assert.equal(s.state.reusableViews[0].kind,'research');assert.equal(s.state.reusableViews[0].spec.summary,undefined);
    s=new Session({file,now:()=>now});
    const a=new Assistant({session:s,planner:{decide:async ctx=>{calls++;assert.equal(ctx.researchRequest.title,'Gators this week');return decision(board());}}});
    await a.execute('reuse','Show my Gators this week');assert.equal(calls,0);
    const v=new Voice({session:s});assert.equal(v.fastAction('Open Gators this week').action.action,'open_research_view');
    now+=900001;assert.ok(!v.fastAction('Open Gators this week').action);
    await a.execute('refresh','Open Gators this week');assert.equal(calls,1);assert.equal(s.state.reusableViews.length,1);assert.equal(s.state.research.fetchedAt,now);
    s.command('research_page',{direction:'next'});assert.deepEqual(presentation(s.state).researchVisibleCardNumbers,[3,4]);
    assert.equal(researchIntent('next page',s.state).action,'research_page');
    s.command('show',{panel:'home'});assert.equal(researchIntent('next page',s.state),null);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('research renderer escapes content, paginates equally, and has no mirror controls',()=>{
  const ctx={window:{}};
  for(const file of ['research-pages.cjs','research-ui.js'])runInNewContext(readFileSync(new URL('../public/'+file,import.meta.url),'utf8'),ctx);
  const b={...board(),page:0,fetchedAt:Date.now()};b.cards[0].heading='<script>bad</script>';
  const mirror=ctx.window.GlassResearch.render(b,false),remote=ctx.window.GlassResearch.render(b,true);
  assert.match(mirror,/&lt;script&gt;/);assert.doesNotMatch(mirror,/<(?:a |button|input|script)/);
  assert.doesNotMatch(mirror,/Event 3/);assert.match(remote,/rel="noopener noreferrer"/);
  b.page=1;assert.match(ctx.window.GlassResearch.render(b,false),/Event 3/);
  assert.doesNotMatch(readFileSync(new URL('../public/research-ui.js',import.meta.url),'utf8'),/\b(?:const|let)\b|=>/);
});
test('saved research titles normalize punctuation and hyphens without relaxing intent',()=>{
  const state={reusableViews:[{id:'animals',kind:'research',spec:{title:'Animals for a Three-Year-Old'}}]};
  assert.equal(researchIntent('Open Animals for a Three-Year-Old',state).viewId,'animals');
  assert.equal(researchIntent('Can you show animals for a three year old?',state).viewId,'animals');
  assert.equal(researchIntent('Do not open animals for a three year old',state),null);
});
test('provider accepts only research sources opened in completed search events',async()=>{
  for(const opened of [false,true]){
    const stream={controller:{abort(){}},async *[Symbol.asyncIterator](){
      yield {type:'agent.session.created',session:{id:'test'}};
      if(opened)yield {type:'agent.session.turn.item.done',item:{type:'web_search_call',status:'completed',action:{type:'open_page',url:board().sources[0].url}}};
      yield {type:'agent.session.turn.output_text.done',text:JSON.stringify({decision:decision(board())})};yield {type:'agent.session.turn.completed'};
    }};
    const p=new AgentsPlanner({client:{beta:{agents:{sessions:{create:async()=>stream,delete:async()=>{}}}}},budget:{reserve:()=>1,finishAgent(){}}});
    if(opened)assert.equal((await p.decide({})).actions[0].action,'compose_research');
    else await assert.rejects(p.decide({}),/not opened/);
    await p.drain();
  }
});
test('URL-less search events require independent verification and fail closed',async()=>{
  for(const verified of [false,true]){
    const stream={controller:{abort(){}},async *[Symbol.asyncIterator](){
      yield {type:'agent.session.created',session:{id:'test'}};
      yield {type:'agent.session.turn.item.done',item:{type:'web_search_call',status:'completed',action:{type:'other'}}};
      yield {type:'agent.session.turn.output_text.done',text:JSON.stringify({decision:decision(board())})};
      yield {type:'agent.session.turn.completed'};
    }};
    let checks=0;
    const p=new AgentsPlanner({client:{beta:{agents:{sessions:{create:async()=>stream,delete:async()=>{}}}}},budget:{reserve:()=>1,finishAgent(){}},verifySources:async urls=>{checks++;return new Set(verified?urls:[]);}});
    if(verified)assert.equal((await p.decide({})).actions[0].action,'compose_research');
    else await assert.rejects(p.decide({}),/not opened/);
    assert.equal(checks,1);await p.drain();
  }
});
test('failed source checks retain a safe actionable diagnostic and never publish unchecked research',async()=>{
  const telemetry=new Telemetry(),session=new Session();
  const stream={controller:{abort(){}},async *[Symbol.asyncIterator](){
    yield {type:'agent.session.created',session:{id:'test'}};
    yield {type:'agent.session.turn.item.done',item:{type:'web_search_call',status:'completed',action:{type:'other'}}};
    yield {type:'agent.session.turn.output_text.done',text:JSON.stringify({decision:decision(board())})};
    yield {type:'agent.session.turn.completed'};
  }};
  let deleted=false;
  const planner=new AgentsPlanner({telemetry,client:{beta:{agents:{sessions:{create:async()=>stream,delete:async()=>{deleted=true;}}}}},budget:{reserve:()=>1,finishAgent(){}},verifySources:async()=>{throw Error('PRIVATE raw URL and request text');}});
  await assert.rejects(new Assistant({session,planner,telemetry}).execute('x','research'),{code:'research_source_unavailable'});
  await planner.drain();assert.equal(deleted,true);assert.equal(session.state.panel,'home');
  assert.deepEqual(planner.lastFailure,{stage:'source_fetch',error_code:'research_source_unavailable'});
  const end=telemetry.records.find(r=>r.kind==='end'&&r.name==='agent.planning');
  assert.equal(end.attributes.error_code,'research_source_unavailable');assert.equal(end.attributes.planner_stage,'source_fetch');
  assert.ok(telemetry.records.some(r=>r.event==='research.source_checked'));
  assert.doesNotMatch(JSON.stringify(telemetry.records),/PRIVATE|floridagators/);await telemetry.close();
});
