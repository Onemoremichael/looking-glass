import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {animals,animalDecks,newGame,advanceGame,gameView,gameReceipt} from '../playroom.mjs';
import {Session} from '../session.mjs';
import {createApp} from '../server.mjs';

test('curated decks complete locally and correctly identify the current and previous card',()=>{
  for(const deck of Object.keys(animalDecks)){
    const g=newGame('animals',{deck,shuffle:false});
    assert.deepEqual(g.cards,animalDecks[deck]);assert.notEqual(g.cards,animalDecks[deck]);
    const count=g.cards.length;
    for(let i=0;i<count;i++){
      const card=g.cards[i];assert.equal(gameView(g).animal,card);
      advanceGame(g,'I see a '+card);
      const receipt=gameReceipt(g);
      assert.equal(receipt.previousAnimal,card);assert.equal(receipt.displayedAnimal,g.cards[i+1]||null);
      assert.equal(receipt.total,count);assert.equal(receipt.completed,i+1);assert.equal(g.feedback,'correct');
    }
    assert.equal(g.phase,'complete');assert.equal(g.found,count);assert.match(g.prompt,new RegExp('all '+count+' animals'));
  }
  assert.equal(gameView(newGame('bear')).total,3);
});
test('shuffle retains unique deck members, restart retains adult-selected settings',()=>{
  for(let i=0;i<25;i++){
    const g=newGame('animals',{deck:'mixed',shuffle:true}),id=g.id;
    assert.deepEqual([...g.cards].sort(),[...animalDecks.mixed].sort());
    advanceGame(g,'skip');advanceGame(g,'again');
    assert.notEqual(g.id,id);assert.equal(g.index,0);assert.equal(g.lastAnimal,null);
    assert.equal(g.deckId,'mixed');assert.equal(g.shuffle,true);assert.deepEqual([...g.cards].sort(),[...animalDecks.mixed].sort());
  }
  // No probabilistic assertion that any specific shuffle must differ.
});
test('new animal vocabulary accepts whole answer phrases but not incidental mentions',()=>{
  const examples={dog:['a puppy','I think it is a doggie','the dog please'],cat:['a kitten','I see a kitty cat','that is a cat'],duck:['a duckling','its a duck','the duck please']};
  for(const [id,phrases] of Object.entries(examples))for(const phrase of phrases){
    const g=newGame('animals',{deck:'familiar'});g.index=g.cards.indexOf(id);
    advanceGame(g,phrase);assert.equal(g.feedback,'correct',phrase);
  }
  for(const phrase of ['not a dog','I see a dog or a cat','my wife said puppy','tell the dog to sit','a puppy and a kitten','maybe a dog','set a timer']){
    const g=newGame('animals',{deck:'familiar'});advanceGame(g,phrase);
    assert.equal(g.index,0,phrase);assert.equal(g.feedback,'uncertain',phrase);
  }
  const g=newGame('animals',{deck:'familiar'});advanceGame(g,'cat');assert.equal(g.feedback,'try_again');assert.match(g.prompt,/woof/);
  advanceGame(g,'dog');advanceGame(g,'hint');assert.equal(g.lastAnimal,null);assert.match(g.prompt,/whiskers/);
});
test('deck settings are bounded and invalid changes preserve existing session',()=>{
  const s=new Session();s.startPlayroom('animals',{deck:'familiar'});const before=structuredClone(s.state);
  for(const settings of [null,[],{deck:'../secret'},{deck:'__proto__'},{shuffle:'yes'},{cards:['dog']},{count:100}]){
    assert.throws(()=>s.startPlayroom('animals',settings),/settings/);assert.deepEqual(s.state,before);
  }
});
test('renderer follows the selected card order and separates previous feedback from new card',()=>{
  const ctx={window:{}};runInNewContext(readFileSync(new URL('../public/playroom-ui.js',import.meta.url),'utf8'),ctx);
  const g=newGame('animals',{deck:'familiar'});g.cards.reverse();
  let html=ctx.window.GlassPlayroom.render(g);assert.match(html,/bear-v1.png/);assert.match(html,/Card 1 of 4/);
  advanceGame(g,'bear');html=ctx.window.GlassPlayroom.render(g);
  assert.match(html,/duck-v1.png/);assert.match(html,/You found: bear/);assert.match(html,/Next friend/);
  const all=newGame('animals',{deck:'mixed'});assert.match(ctx.window.GlassPlayroom.render(all),/Card 1 of 7/);
  all.cards[0]='../../x';assert.equal(ctx.window.GlassPlayroom.render(all),'');
});
test('all curated art is served as PNG with genuine transparent pixels',async t=>{
  const origins=[],app=createApp({origins});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  origins.push('http://127.0.0.1:'+app.server.address().port);
  for(const {id} of animals){
    const r=await fetch('http://127.0.0.1:'+app.server.address().port+'/assets/playroom/'+id+'-v1.png');
    assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/image\/png/);
    const png=Buffer.from(await r.arrayBuffer());assert.equal(png[25],6,'RGBA PNG');
    // PNG row zero uses filter 0/1/2/3/4; its first pixel alpha is directly
    // encoded because all virtual preceding pixels are zero for that pixel.
    const chunks=[];for(let offset=8;offset<png.length;){const n=png.readUInt32BE(offset);if(png.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(png.subarray(offset+8,offset+8+n));offset+=12+n;}
    const raw=inflateSync(Buffer.concat(chunks));assert.equal(raw[4],0,'transparent upper-left padding');
  }
});
test('HTTP starts selected deck without starting audio and rejects unbounded settings',async t=>{
  const origins=[],app=createApp({origins});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const origin='http://127.0.0.1:'+app.server.address().port;origins.push(origin);
  const post=settings=>fetch(origin+'/api/playroom',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'start',kind:'animals',adultRehearsal:true,settings})});
  assert.equal((await post({deck:'familiar',shuffle:false})).status,200);
  assert.deepEqual(app.session.state.playroom.cards,animalDecks.familiar);assert.equal(app.voice.state.phase,'off');
  const id=app.session.state.playroom.id;assert.equal((await post({deck:'bogus'})).status,409);assert.equal(app.session.state.playroom.id,id);
});
