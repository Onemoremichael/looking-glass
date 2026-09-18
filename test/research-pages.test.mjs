import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import pages from '../public/research-pages.cjs';
import {Session} from '../session.mjs';
import {presentation} from '../assistant-contract.mjs';
import {createApp} from '../server.mjs';

function board(dense=false){return {spec:{title:'Portrait test',layout:'briefing',query:'Fixture'},summary:dense?'Summary '.repeat(37):'Short summary',caveat:dense?'Caveat '.repeat(42):'Check sources',cards:Array.from({length:6},(_,i)=>({heading:'Finding '+(i+1),kicker:'Fixture',body:dense?'Long body '.repeat(35):'Short body',detail:'Context '+i,sourceIds:['fixture']})),sources:[{id:'fixture',title:'Fixture',url:'https://example.com/'}],fetchedAt:Date.now(),page:0};}
function browser(){const ctx={window:{}};for(const file of ['research-pages.cjs','research-ui.js'])runInNewContext(readFileSync(new URL('../public/'+file,import.meta.url),'utf8'),ctx);return ctx.window;}
test('research navigation hints reflect active, standby, muted and disconnected voice',()=>{
  const hint=browser().GlassResearch.navigationHint;
  assert.equal(hint('next',{phase:'listening'}),'Say “next page”');
  assert.equal(hint('previous',{phase:'off'},{enabled:true,phase:'standby'}),'Say “Hey Mirror”, then “previous page”');
  const wake={enabled:true,phase:'standby',shortcuts:['next_page'],shortcutsExpireAt:Date.now()+120000};
  assert.equal(hint('next',{phase:'off'},wake),'Say “next page”');
  assert.equal(hint('previous',{phase:'off'},wake),'Say “Hey Mirror”, then “previous page”');
  assert.equal(hint('next',{phase:'off'},{...wake,shortcutsExpireAt:0}),'Say “Hey Mirror”, then “next page”');
  for(const voice of [null,{phase:'off'},{phase:'error'},{phase:'muted',muted:true}])assert.match(hint('next',voice),/^Start voice on companion/);
});
test('shared ES5 page plans preserve every finding and agree across surfaces',()=>{
  const w=browser();
  for(const dense of [false,true])for(const layout of ['briefing','agenda','comparison','steps']){
    const b=board(dense);b.spec.layout=layout;const plan=pages.plan(b);
    assert.deepEqual(JSON.parse(JSON.stringify(w.GlassResearchPages.plan(b))),plan);
    assert.deepEqual(plan.flatMap(p=>p.cardNumbers),[1,2,3,4,5,6]);assert.equal(plan.length,dense?7:3);
    assert.ok(plan.some(p=>p.summary));assert.ok(plan.some(p=>p.caveat));
    for(let page=0;page<plan.length;page++){
      b.page=page;const mirror=w.GlassResearch.render(b,false),remote=w.GlassResearch.render(b,true);
      for(let n=1;n<=6;n++){assert.equal(mirror.includes('Finding '+n),plan[page].cardNumbers.includes(n));assert.equal(remote.includes('Finding '+n),plan[page].cardNumbers.includes(n));}
      assert.equal(mirror.includes(b.caveat),plan[page].caveat);assert.equal(mirror.includes(b.summary),plan[page].summary);
      assert.match(mirror,new RegExp((page+1)+' / '+plan.length));
      if(dense&&page>0)assert.match(mirror,/Limitations on overview/);
    }
  }
  for(const file of ['research-pages.cjs','research-ui.js'])assert.doesNotMatch(readFileSync(new URL('../public/'+file,import.meta.url),'utf8'),/\b(?:const|let)\b|=>/);
});
test('long title and long finding independently select spacious pages without mutating content',()=>{
  for(const field of ['title','body']){const b=board();if(field==='title')b.spec.title='T'.repeat(70);else b.cards[0].body='B'.repeat(350),b.cards[1].body='C'.repeat(350);
    const before=structuredClone(b);assert.equal(pages.current(b).dense,true);assert.deepEqual(b,before);
  }
});
test('session navigation and model-visible context use actual pages, including overview and boundaries',()=>{
  const s=new Session();s.state.panel='research';s.state.research=board(true);
  s.command('research_page',{direction:'previous'});assert.equal(s.state.research.page,0);
  assert.deepEqual(presentation(s.state).researchVisibleCardNumbers,[]);
  assert.equal(presentation(s.state).researchPagination.page.kind,'context');
  for(let n=1;n<=6;n++){s.command('research_page',{direction:'next'});assert.deepEqual(presentation(s.state).researchVisibleCardNumbers,[n]);}
  s.command('research_page',{direction:'next'});assert.equal(s.state.research.page,6);
  assert.match(browser().GlassResearch.render(s.state.research,false),/Start voice on companion · previous page/);
  s.command('research_page',{direction:'previous'});assert.deepEqual(presentation(s.state).researchVisibleCardNumbers,[5]);
  s.state.research.page=99;assert.equal(pages.current(s.state.research).index,6);
  s.state.research.page=-4;assert.equal(pages.current(s.state.research).index,0);
});
test('shared planning asset is served with executable MIME and loads before renderer on both surfaces',async t=>{
  const origins=[],app=createApp({origins});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const origin='http://127.0.0.1:'+app.server.address().port;origins.push(origin);
  const script=await fetch(origin+'/research-pages.js');assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/text\/javascript/);
  for(const route of ['/','/remote']){const html=await(await fetch(origin+route)).text();assert.ok(html.indexOf('/research-pages.js')>=0);assert.ok(html.indexOf('/research-pages.js')<html.indexOf('/research-ui.js'));}
  assert.equal(app.voice.state.phase,'off');
});
