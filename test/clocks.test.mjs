import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import clocks from '../public/clock-art.cjs';
import {Session} from '../session.mjs';
import {createApp} from '../server.mjs';
test('eight clock faces render on the shared legacy browser path without remote assets',()=>{
  const context={window:{}};runInNewContext(readFileSync(new URL('../public/clock-art.cjs',import.meta.url),'utf8'),context);
  assert.equal(clocks.styles.length,8);assert.equal(clocks.styles.filter(s=>s.kind==='Analog').length,5);
  for(const style of clocks.styles){const c={...clocks.defaults(),style:style.id};const svg=context.window.GlassClock.scene(c,new Date('2026-01-01T15:08:36Z'),'America/New_York');
    assert.match(svg,/<svg /);assert.match(svg,/aria-label="10:08 AM"/);assert.doesNotMatch(svg,/NaN|undefined|<script|https:\/\//);
    if(style.id==='tourbillon')assert.match(svg,/<image[^>]*\/assets\/clocks\/tourbillon-bezel-v1.png/);
    else if(style.id==='folio')assert.match(svg,/<image[^>]*\/assets\/clocks\/folio-paper-v1.png/);
    else assert.doesNotMatch(svg,/<image/);
  }
});
test('Folio clips local paper to a circular dial and animates hands without rebuilding it',()=>{
  const config={...clocks.defaults(),style:'folio'},date=new Date('2026-09-18T10:08:15.250Z');
  assert.ok(clocks.valid(config));
  const svg=clocks.scene(config,date,'UTC');
  assert.match(svg,/data-folio-face="circle"/);
  assert.match(svg,/<clipPath[^>]*><circle cx="300" cy="300" r="276"\/><\/clipPath>/);
  assert.match(svg,/<image[^>]*clip-path="url\(#[^"]+-paper-clip\)"/);
  assert.doesNotMatch(svg,/data-folio-sheet|data-folio="pendulum"|Horloge à pendule|<rect/);
  assert.match(svg,/data-folio-hand="second"/);
  assert.match(svg,/<image[^>]*\/assets\/clocks\/folio-paper-v1.png/);assert.doesNotMatch(svg,/<filter|https:\/\//);
  assert.doesNotMatch(clocks.scene({...config,seconds:false},date,'UTC'),/data-folio-hand="second"/);
  let writes=0,id=0,reduced=false;const queue=new Map();
  const node=(kind,hand)=>({value:'',getAttribute:k=>k==='data-folio'?kind:k==='data-folio-hand'?hand:null,setAttribute(k,v){assert.equal(k,'transform');assert.doesNotMatch(v,/NaN/);this.value=v;}});
  const nodes=[node(null,'second'),node(null,'minute'),node(null,'hour')];
  const el={hidden:false,querySelectorAll:()=>nodes,set innerHTML(v){writes++;}};
  const window={document:{hidden:false},matchMedia:()=>({matches:reduced}),requestAnimationFrame:fn=>{queue.set(++id,fn);return id;},cancelAnimationFrame:n=>queue.delete(n)};
  runInNewContext(readFileSync(new URL('../public/clock-art.cjs',import.meta.url),'utf8'),{window});
  const tick=stamp=>{const pending=[...queue.values()];queue.clear();pending.forEach(fn=>fn(stamp));};
  window.GlassClock.mount(el,config,date,'UTC');tick(0);assert.equal(nodes[0].value,'rotate(91.5)');
  tick(500);assert.equal(nodes[0].value,'rotate(94.5)');assert.equal(writes,1);
  window.GlassClock.mount(el,config,new Date(+date+500),'UTC');assert.equal(writes,1);assert.equal(queue.size,1);
  reduced=true;window.GlassClock.mount(el,config,date,'UTC');assert.equal(queue.size,0);
  reduced=false;window.GlassClock.mount(el,{...config,seconds:false},date,'UTC');assert.equal(queue.size,0);
});
test('tourbillon updates mechanism transforms and spring path, pauses when hidden, and honors motion preferences',()=>{
  let serial=0,reduced=false,writes=0,markup='';const queue=new Map();
  const nodes=['cage','balance','barrel','center','third','escape','fork','spring'].map(kind=>({angle:null,getAttribute:()=>kind,setAttribute(k,v){assert.equal(k,kind==='spring'?'d':'transform');assert.doesNotMatch(v,/NaN|undefined/);this.angle=v;}}));
  const el={hidden:false,querySelectorAll:()=>nodes,get innerHTML(){return markup;},set innerHTML(v){markup=v;writes++;}};
  const window={document:{hidden:false},matchMedia:()=>({matches:reduced}),requestAnimationFrame:fn=>{queue.set(++serial,fn);return serial;},cancelAnimationFrame:id=>queue.delete(id)};
  runInNewContext(readFileSync(new URL('../public/clock-art.cjs',import.meta.url),'utf8'),{window});
  const art=window.GlassClock,c={...art.defaults(),style:'tourbillon'},d=new Date('2026-09-18T09:12:01Z');
  const tick=stamp=>{const fns=[...queue.values()];queue.clear();fns.forEach(fn=>fn(stamp));};
  art.mount(el,c,d,'UTC');assert.equal(writes,1);assert.match(markup,/data-motion="cage"/);assert.match(markup,/data-motion="balance"/);
  tick(0);const first=nodes[0].angle,spring=nodes[7].angle;tick(250);assert.notEqual(nodes[0].angle,first);assert.notEqual(nodes[7].angle,spring);assert.equal(writes,1);
  art.mount(el,c,new Date(+d+500),'UTC');assert.equal(writes,1);assert.equal(queue.size,1);
  window.document.hidden=true;tick(200);assert.equal(queue.size,0);
  window.document.hidden=false;art.mount(el,c,new Date(+d+1000),'UTC');assert.equal(queue.size,1);
  reduced=true;art.mount(el,c,new Date(+d+1100),'UTC');assert.equal(queue.size,0);
  reduced=false;art.mount(el,{...c,seconds:false},d,'UTC');assert.equal(queue.size,0);
  art.mount(el,c,new Date(+d+60000),'UTC');assert.equal(queue.size,1);assert.match(markup,/09:13 AM/);
  art.mount(el,{...c,style:'atelier'},new Date(+d+60001),'UTC');assert.equal(queue.size,0);assert.doesNotMatch(markup,/data-motion=/);
});
test('tourbillon compound train has matched pitch geometry and correct opposite shaft ratios',()=>{
  const train=clocks.movementSpec.train;
  for(let i=0;i<train.length-1;i++){
    const driver=train[i],driven=train[i+1],pinion=driven.pinion||driven.teeth,radius=driven.pinionRadius||driven.r;
    assert.ok(Math.abs(2*driver.r/driver.teeth-2*radius/pinion)<1e-9,'matching module');
    assert.ok(Math.abs(Math.hypot(driver.x-driven.x,driver.y-driven.y)-driver.r-radius)<1e-9,'tangent pitch circles');
    for(const t of [0,.07,1.21,57.9,600]){
      const state=clocks.movementState(t);
      assert.ok(Math.abs(state[driver.id]*driver.teeth+state[driven.id]*pinion)<1e-7,'no-slip opposite tooth travel');
    }
  }
  assert.equal(clocks.movementState(60).cage,360);
  assert.equal(clocks.movementState(3600).center,360);
  assert.equal(clocks.movementState(28800).barrel,-360);
});
test('escapement locks between five beats per second and balance oscillates with an anchored spring',()=>{
  const state=clocks.movementState;
  assert.equal(state(.05).escape,state(.19).escape,'locked dwell');
  assert.equal(state(.25).escape-state(.05).escape,12,'half a 15-tooth wheel tooth per beat');
  assert.equal(state(6).escape,360);
  assert.ok(Math.abs(state(.1).balance-235)<1e-8);assert.ok(Math.abs(state(.3).balance+235)<1e-8);
  assert.ok(Math.abs(state(.4).balance)<1e-8,'2.5 Hz full oscillation');
  for(const t of [0,.07,1.2,19.19,60]){
    const s=state(t);assert.equal(s.escape,s.cage*clocks.movementSpec.fixedTeeth/clocks.movementSpec.escapePinionTeeth);
    assert.ok(Math.abs(s.fork)<=6);assert.ok(Math.abs(s.balance)<=235);
  }
  const ends=angle=>clocks.hairspring(angle).match(/-?\d+\.\d+/g).map(Number);
  const a=ends(-235),b=ends(235);assert.deepEqual(a.slice(-2),[31,0]);assert.deepEqual(b.slice(-2),[31,0]);
  assert.notDeepEqual(a.slice(0,2),b.slice(0,2),'collet end follows balance instead of rotating outer attachment');
  assert.ok(Math.abs(Math.hypot(...a.slice(0,2))-5)<.01);
});
test('stationary bridge mounting posts clear every rotating wheel envelope and the flying cage',()=>{
  const spec=clocks.movementSpec;
  for(const mount of spec.mounts){
    for(const wheel of spec.train){
      const envelope=wheel.id==='cage'?spec.cageRadius:wheel.r+(2*wheel.r/wheel.teeth)*.65;
      assert.ok(Math.hypot(mount.x-wheel.x,mount.y-wheel.y)>envelope+mount.r+3,
        'fixed mounting post must not pass through '+wheel.id);
    }
  }
  const svg=clocks.scene({...clocks.defaults(),style:'tourbillon'},new Date());
  assert.equal((svg.match(/data-fixed-post=/g)||[]).length,4);
  assert.match(svg,/data-fixed-wheel="80"/);
  assert.doesNotMatch(svg,/data-rate=/,'no independent arbitrary gear speeds');
});
test('clock layouts fit portrait and landscape at every edge and scale',()=>{
  for(const [w,h] of [[1080,1920],[1920,1080],[320,568]])for(const x of [0,50,100])for(const y of [0,50,100])for(const scale of [25,70,100]){
    const g=clocks.geometry({...clocks.defaults(),x,y,scale},w,h);assert.ok(g.left>=0&&g.top>=0);assert.ok(g.left+g.size<=w+.0001&&g.top+g.size<=h+.0001);
  }
});
test('Orbit has a subtly heavier hour ring, lighter minute ring and 60 optional second dots',()=>{
  const c={...clocks.defaults(),style:'orbit'},date=new Date('2026-01-01T15:08:36Z');
  const svg=clocks.scene(c,date,'UTC');
  assert.match(svg,/r="158"[^>]*stroke-width="2.25"/);
  assert.match(svg,/r="212"[^>]*stroke-width="1.5"/);
  assert.doesNotMatch(svg,/r="248"/);
  assert.equal((svg.match(/r="1.2"/g)||[]).length,60);
  assert.equal((svg.match(/r="2.4"/g)||[]).length,1,'current-second marker remains visible');
  const hidden=clocks.scene({...c,seconds:false},date,'UTC');
  assert.doesNotMatch(hidden,/r="1.2"|r="2.4"/);
});
test('clock settings validate strictly, persist, and do not erase another interaction',t=>{
  const dir=mkdtempSync(join(tmpdir(),'glass-clock-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'state.json'),s=new Session({file});
  assert.ok(clocks.valid(s.state.clockDesign));const config={...clocks.defaults(),style:'split',scale:91,x:100,y:0,hour24:true};
  s.state.assistant={status:'clarify',message:'Which one?'};s.command('set_clock',{config});assert.equal(s.state.assistant.status,'clarify');assert.deepEqual(new Session({file}).state.clockDesign,config);
  for(const patch of [{style:'<script>'},{accent:'__proto__'},{scale:0},{x:101},{y:NaN},{seconds:'yes'},{extra:true}])assert.throws(()=>s.command('set_clock',{config:{...config,...patch}}));
  assert.deepEqual(s.state.clockDesign,config);
});
test('clock date, seconds and time formats honor design choices and explicit time zone',()=>{
  const d=new Date('2026-01-01T05:08:36Z');assert.equal(clocks.time(d,'America/New_York').h,0);
  assert.match(clocks.scene({...clocks.defaults(),style:'ribbon'},d,'America/New_York'),/12:08 AM/);
  const svg=clocks.scene({...clocks.defaults(),style:'ribbon',hour24:true,day:false,date:false,seconds:false},d,'America/New_York');assert.match(svg,/00:08/);assert.doesNotMatch(svg,/>36<|JAN|THU/);
});
test('every face independently toggles weekday and calendar date',()=>{
  for(const style of clocks.styles)for(const day of [true,false])for(const date of [true,false]){
    const svg=clocks.scene({...clocks.defaults(),style:style.id,day,date},new Date('2026-09-18T01:00:00Z'),'America/New_York');
    assert.equal(svg.includes('data-calendar="day"'),day,style.id+' weekday');
    assert.equal(svg.includes('data-calendar="date"'),date,style.id+' date');
    assert.equal(svg.includes('THU'),day);assert.equal(svg.includes(style.id==='split'?'>SEP<':'SEP 17'),date);
    if(style.id==='split'){
      assert.equal(svg.includes('data-calendar-segment="month"'),date);
      assert.equal(svg.includes('data-calendar-segment="day-number"'),date);
      assert.equal(svg.includes('>17<'),date);
    }
    assert.doesNotMatch(svg,/NaN|undefined/);
  }
});
test('legacy date toggle migrates without resetting composition or re-enabling hidden details',t=>{
  const dir=mkdtempSync(join(tmpdir(),'glass-clock-migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  for(const date of [true,false]){
    const config={...clocks.defaults(),style:'atelier',x:72,y:6,scale:95,date};delete config.day;
    const normalized=clocks.normalize(config);assert.deepEqual(normalized,{...config,day:date});assert.equal(config.day,undefined);
    const file=join(dir,'state.json');writeFileSync(file,JSON.stringify({version:1,timers:[],todos:[],tasks:[],recipes:[],clockDesign:config}));
    assert.deepEqual(new Session({file}).state.clockDesign,normalized);
  }
});
test('clock studio is served with proper assets and settings mutations require local origin',async t=>{
  const origins=[],app=createApp({origins});t.after(()=>app.close());await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;origins.push(base);
  for(const path of ['/clocks','/clock-art.js','/clock-controls.js','/clocks.css'])assert.equal((await fetch(base+path)).status,200);
  const js=await fetch(base+'/clock-art.js');assert.match(js.headers.get('content-type'),/javascript/);
  const art=await fetch(base+'/assets/clocks/tourbillon-bezel-v1.png');assert.equal(art.status,200);assert.match(art.headers.get('content-type'),/image\/png/);
  const png=Buffer.from(await art.arrayBuffer());assert.equal(png[25],6,'bezel retains PNG alpha');
  const paper=await fetch(base+'/assets/clocks/folio-paper-v1.png');assert.equal(paper.status,200);assert.match(paper.headers.get('content-type'),/image\/png/);
  const texture=Buffer.from(await paper.arrayBuffer());assert.equal(texture.subarray(1,4).toString(),'PNG');
  const body=JSON.stringify({action:'set_clock',config:clocks.defaults()});
  assert.equal((await fetch(base+'/api/command',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body})).status,403);
  assert.equal((await fetch(base+'/api/command',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body})).status,200);
});
test('tourbillon material definitions are unique across gallery and live surface',()=>{
  const c={...clocks.defaults(),style:'tourbillon'},d=new Date('2026-09-18T09:12:01Z');
  const a=clocks.scene(c,d),b=clocks.scene(c,d);
  const ids=svg=>Array.from(svg.matchAll(/id="([^"]+)"/g),m=>m[1]);
  assert.ok(ids(a).length>=4);assert.ok(ids(a).every(id=>!ids(b).includes(id)));
  for(const svg of [a,b])for(const match of svg.matchAll(/url\(#([^)]+)\)/g))assert.ok(ids(svg).includes(match[1]),'material reference resolves locally');
});
test('split flaps animate only changed tiles, including hour rollover, and finish on correct time',()=>{
  const c={...clocks.defaults(),style:'split'},from=new Date('2026-09-18T09:59:59Z'),to=new Date('2026-09-18T10:00:00Z');
  const falling=clocks.scene(c,to,'UTC',{from,progress:.25}),landing=clocks.scene(c,to,'UTC',{from,progress:.75});
  assert.equal((falling.match(/data-flap="falling"/g)||[]).length,2);
  assert.equal((landing.match(/data-flap="landing"/g)||[]).length,2);
  const minute=clocks.scene(c,new Date('2026-09-18T10:01:00Z'),'UTC',{from:to,progress:.25});
  assert.equal((minute.match(/data-flap=/g)||[]).length,1);
  const done=clocks.scene(c,to,'UTC',{from,progress:1});assert.doesNotMatch(done,/data-flap=/);assert.match(done,/aria-label="10:00 AM"/);
});
test('split player survives normal ticks, honors reduced motion, and skips stale catch-up flips',()=>{
  let id=0,reduced=false;const queue=new Map(),el={innerHTML:''};
  const window={document:{hidden:false},matchMedia:()=>({matches:reduced}),requestAnimationFrame:fn=>{queue.set(++id,fn);return id;},cancelAnimationFrame:id=>queue.delete(id)};
  runInNewContext(readFileSync(new URL('../public/clock-art.cjs',import.meta.url),'utf8'),{window});
  const art=window.GlassClock,c={...art.defaults(),style:'split'},start=new Date('2026-09-18T09:59:59Z');
  const tick=stamp=>{const fns=[...queue.values()];queue.clear();fns.forEach(fn=>fn(stamp));};
  art.mount(el,c,start,'UTC');assert.equal(queue.size,0);
  art.mount(el,c,new Date(+start+1000),'UTC');assert.equal(queue.size,1);tick(0);tick(170);assert.match(el.innerHTML,/data-flap="falling"/);
  const before=el.innerHTML;art.mount(el,c,new Date(+start+1500),'UTC');assert.equal(el.innerHTML,before);assert.equal(queue.size,1);
  tick(510);assert.match(el.innerHTML,/data-flap="landing"/);tick(680);assert.equal(queue.size,0);assert.doesNotMatch(el.innerHTML,/data-flap=/);
  art.mount(el,c,new Date(+start+121000),'UTC');assert.equal(queue.size,0);
  reduced=true;art.mount(el,c,new Date(+start+122000),'UTC',start);assert.equal(queue.size,0);
  reduced=false;art.mount(el,c,new Date(+start+123000),'UTC',start);assert.equal(queue.size,1);
  art.mount(el,{...c,style:'orbit'},new Date(+start+123001),'UTC');assert.equal(queue.size,0);assert.doesNotMatch(el.innerHTML,/data-flap=/);
});
