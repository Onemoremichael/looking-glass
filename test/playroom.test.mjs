import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {newGame,advanceGame,gameIntent} from '../playroom.mjs';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {Voice} from '../voice.mjs';
import {createApp} from '../server.mjs';
test('animal game judges whole answers, never grades unclear speech, skips and completes',()=>{
  const g=newGame('animals');
  for(const text of ['not an elephant','elephant or giraffe','my wife said elephant','set a timer for 20 minutes','asdf']){
    advanceGame(g,text);assert.equal(g.index,0);assert.equal(g.feedback,'uncertain');
  }
  advanceGame(g,'a dog');assert.equal(g.feedback,'try_again');assert.equal(g.index,0);
  advanceGame(g,'hint');assert.match(g.prompt,/trunk/);
  advanceGame(g,'I think it’s an elephant!');assert.equal(g.index,1);assert.equal(g.feedback,'correct');
  advanceGame(g,'a giraffe');assert.equal(g.index,2);
  advanceGame(g,'skip');assert.equal(g.index,3);assert.match(g.prompt,/penguin/);
  advanceGame(g,'teddy bear');assert.equal(g.phase,'complete');assert.equal(g.found,3);
  advanceGame(g,'play again');assert.equal(g.index,0);assert.equal(g.found,0);
});
test('bear branches on actual choices, resolves ordinal, preserves state for ambiguity',()=>{
  const g=newGame('bear');advanceGame(g,'both');assert.equal(g.index,0);
  advanceGame(g,'the second one');assert.deepEqual(g.choices,['ocean']);
  advanceGame(g,'a kite');advanceGame(g,'squeak');
  assert.equal(g.phase,'complete');assert.match(g.prompt,/ocean.*kite.*squeak/);
  advanceGame(g,'stop');assert.match(g.prompt,/Thanks for playing/);
});
test('playroom transitions clear old messages and roll back failed persistence',()=>{
  const s=new Session();s.state.message='Old confirmation';s.startPlayroom('animals');
  assert.equal(s.state.message,'');
  const before=structuredClone(s.state),save=s.save;
  s.save=()=>{throw Error('storage unavailable');};
  assert.throws(()=>s.endPlayroom(),/storage unavailable/);assert.deepEqual(s.state,before);
  assert.throws(()=>s.startPlayroom('bear'),/storage unavailable/);assert.deepEqual(s.state,before);
  s.save=save;s.state.message='Game confirmation';s.endPlayroom();assert.equal(s.state.message,'');
});
test('game routes locally with revision receipts, no general actions, no durable game transcript',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'glass-game-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'state.json'),s=new Session({file});s.startPlayroom('animals');
  const a=new Assistant({session:s,planner:{decide:()=>{throw Error('must not call cloud planner');}}});
  const v=new Voice({session:s});assert.equal(v.fastAction('an elephant').template,'playroom');
  const stale=gameIntent('an elephant',s.state);
  await a.execute('answer1','an elephant');await a.execute('answer1','an elephant');assert.equal(s.state.playroom.index,1);
  assert.throws(()=>s.command('playroom_turn',stale),/changed/);
  await a.execute('private','my secret is xyz-private');assert.equal(s.state.playroom.index,1);
  assert.throws(()=>s.command('start_timer',{seconds:10}),/Exit playroom/);
  assert.equal(s.state.assistantHistory.length,0);assert.doesNotMatch(readFileSync(file,'utf8'),/xyz-private|playroom|Game answer/);
  assert.equal(new Session({file}).state.panel,'home');assert.equal(new Session({file}).state.playroom,undefined);
  s.endPlayroom();assert.equal(s.state.panel,'home');
});
test('playroom markup is escaped, noninteractive and ES5 with local transparent art',()=>{
  const ctx={window:{}};const src=readFileSync(new URL('../public/playroom-ui.js',import.meta.url),'utf8');runInNewContext(src,ctx);
  const g=newGame('animals');g.prompt='<script>bad()</script>';
  const html=ctx.window.GlassPlayroom.render(g);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<(?:button|input|script|a )/);
  assert.doesNotMatch(src,/\b(?:let|const)\b|=>/);
  for(const n of ['elephant','giraffe','penguin','bear']){
    const png=readFileSync(new URL('../public/assets/playroom/'+n+'-v1.png',import.meta.url));assert.equal(png[25],6,'RGBA alpha preserved');
  }
});
test('playroom entry requires explicit adult rehearsal and stops before exiting',async t=>{
  const app=createApp({origins:[]});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  // Mutable allowlist intentionally supplied by the fixture, never a wildcard.
  const origin='http://127.0.0.1:'+app.server.address().port;
  // Re-create with the known origin because createApp captures its allowlist.
  await app.close();
  const second=createApp({origins:[origin]});await new Promise(r=>second.server.listen(Number(new URL(origin).port),'127.0.0.1',r));t.after(()=>second.close());
  const post=body=>fetch(origin+'/api/playroom',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({action:'start',kind:'animals'})).status,409);
  assert.equal((await post({action:'start',kind:'animals',adultRehearsal:true})).status,200);
  assert.equal(second.session.state.playroom.kind,'animals');
  assert.equal((await post({action:'stop'})).status,200);assert.equal(second.session.state.playroom,undefined);
});
