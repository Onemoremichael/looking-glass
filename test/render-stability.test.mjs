import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
import dom from '../public/dom-patch.cjs';
import {Session} from '../session.mjs';

const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
function harness(){
  const {document}=parseHTML('<html><body><div id="root"></div></body></html>');
  let id=0,stamp=0,reduced=false;const frames=new Map();
  const window={document,GlassDOM:dom,performance:{now:()=>stamp},matchMedia:()=>({matches:reduced}),
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:n=>frames.delete(n)};
  runInNewContext(source('clock-art.cjs'),{window});
  return {document,el:document.getElementById('root'),art:window.GlassClock,frames,
    reduce:value=>{reduced=value;},tick:ms=>{stamp=ms;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(ms));}};
}
test('reconciliation keeps decoded images, SVG namespaces, animation nodes and local input drafts',()=>{
  const {el}=harness();
  const html=n=>'<section id="weather"><img src="/cloud.png"><i class="rain"></i><p>'+n+'</p><svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 L '+n+' 3"/></svg></section><form id="draft"><input value="initial"><textarea>initial</textarea></form><details><summary>More</summary><p>'+n+'</p></details>';
  dom.patch(el,html(1));const nodes=[...el.querySelectorAll('*')];
  const input=el.querySelector('input'),area=el.querySelector('textarea'),details=el.querySelector('details');
  input.value='unsubmitted';area.value='my draft';details.setAttribute('open','');
  dom.patch(el,html(2));
  assert.deepEqual([...el.querySelectorAll('*')],nodes,'no elements replaced');
  assert.equal(input.value,'unsubmitted');assert.equal(area.value,'my draft');assert.ok(details.hasAttribute('open'));
  assert.equal(el.querySelector('path').namespaceURI,'http://www.w3.org/2000/svg');
  assert.equal(el.querySelector('path').getAttribute('d'),'M 0 0 L 2 3');
});
test('keyed timers survive insertion/removal/reorder; runtime countdown content is retained',()=>{
  const {el}=harness();const timer=id=>'<article data-render-key="timer:'+id+'"><div data-end="1000"></div></article>';
  dom.patch(el,timer('a')+timer('b'),{scope:'home'});const [a,b]=el.children;
  a.firstChild.textContent='0:42';b.firstChild.textContent='0:19';
  dom.patch(el,'<p>Weather</p>'+timer('b')+timer('a'),{scope:'weather'});
  assert.equal(el.children[1],b);assert.equal(el.children[2],a);assert.equal(a.firstChild.textContent,'0:42');
  dom.patch(el,timer('b'),{scope:'weather'});assert.equal(el.firstChild,b);assert.equal(el.children.length,1);
});
test('identical markup and text cause zero mutations, including reconnect snapshots',async()=>{
  const {el,document}=harness();dom.patch(el,'<p>Ready</p>');
  const mutations=[];const observer=new document.defaultView.MutationObserver(items=>mutations.push(...items));observer.observe(el,{subtree:true,attributes:true,childList:true,characterData:true});
  for(let i=0;i<10;i++){dom.patch(el,'<p>Ready</p>');dom.text(el.firstChild,'Ready');dom.attr(el.firstChild,'id','status');}
  await Promise.resolve();observer.disconnect();assert.equal(mutations.length,1,'only the first id change writes');
});
for(const style of ['orbit','atelier','meridian','monolith','ribbon','split','folio','tourbillon']){
  test(style+' retains its dial through minute/midnight changes and composition adjustments',()=>{
    const h=harness(),c={...h.art.defaults(),style},start=new Date('2026-09-18T23:59:58Z');
    h.art.mount(h.el,c,start,'UTC');h.tick(0);
    const svg=h.el.firstChild,img=h.el.querySelector('image'),defs=h.el.querySelector('defs');
    const date=h.el.querySelector('[data-calendar="date"]'),day=h.el.querySelector('[data-calendar="day"]');
    const ids=[...h.el.querySelectorAll('[id]')].map(n=>n.id);
    for(const delta of [500,1000,2000,3000,65000]){
      h.tick(delta);h.art.mount(h.el,{...c,x:80,y:25,scale:40},new Date(+start+delta),'UTC');h.tick(delta);h.tick(delta+700);
      assert.equal(h.el.firstChild,svg);assert.equal(h.el.querySelector('image'),img);assert.equal(h.el.querySelector('defs'),defs);
      assert.equal(h.el.querySelector('[data-calendar="date"]'),date);assert.equal(h.el.querySelector('[data-calendar="day"]'),day);
      assert.deepEqual([...h.el.querySelectorAll('[id]')].map(n=>n.id),ids);
      assert.ok(h.frames.size<=1,'one animation owner per dial');
    }
    assert.match(date.textContent,/SEP.*19/);assert.match(day.textContent,/SAT/);
    assert.equal(svg.getAttribute('aria-label'),'12:01 AM');
  });
}
test('mechanical minute updates preserve gear phase, image and spring nodes',()=>{
  const h=harness(),c={...h.art.defaults(),style:'tourbillon'},d=new Date('2026-09-18T10:08:59Z');
  h.art.mount(h.el,c,d,'UTC');h.tick(0);h.tick(900);
  const gear=h.el.querySelector('[data-motion="cage"]'),spring=h.el.querySelector('[data-motion="spring"]'),image=h.el.querySelector('image');
  const phase=gear.getAttribute('transform'),curve=spring.getAttribute('d');
  h.art.mount(h.el,c,new Date(+d+1000),'UTC');
  assert.equal(h.el.querySelector('[data-motion="cage"]'),gear);assert.equal(h.el.querySelector('image'),image);
  assert.equal(gear.getAttribute('transform'),phase);assert.equal(spring.getAttribute('d'),curve);
  h.tick(1100);assert.notEqual(gear.getAttribute('transform'),phase);
  assert.match(h.el.querySelector('[data-clock-hand="minute"]').getAttribute('transform'),/^rotate\(54\./);
  const paused=gear.getAttribute('transform');h.reduce(true);h.art.mount(h.el,c,new Date(+d+2000),'UTC');
  assert.equal(h.frames.size,0);assert.equal(gear.getAttribute('transform'),paused,'reduced motion freezes the current pose');
  h.art.mount(h.el,{...c,seconds:false},new Date(+d+3000),'UTC');assert.equal(gear.getAttribute('transform'),paused);
});
test('clock resumes at current time without replacing face or running catch-up loops',()=>{
  const h=harness(),c={...h.art.defaults(),style:'folio'},d=new Date('2026-09-18T10:08:15Z');
  h.art.mount(h.el,c,d,'UTC');h.tick(0);const svg=h.el.firstChild,image=h.el.querySelector('image');
  h.document.hidden=true;h.tick(500);assert.equal(h.frames.size,0);
  h.document.hidden=false;h.tick(3600000);h.art.mount(h.el,c,new Date(+d+3600000),'UTC');h.tick(3600000);
  assert.equal(h.el.firstChild,svg);assert.equal(h.el.querySelector('image'),image);assert.equal(h.frames.size,1);
  assert.equal(svg.getAttribute('aria-label'),'11:08 AM');
  h.reduce(true);h.art.mount(h.el,c,new Date(+d+3601000),'UTC');assert.equal(h.frames.size,0);
  assert.equal(h.el.querySelector('[data-folio-hand="second"]').getAttribute('transform'),'rotate(96)');
});
test('split flaps retain SVG, calendar and unchanged hour tile throughout minute transition',()=>{
  const h=harness(),c={...h.art.defaults(),style:'split'},d=new Date('2026-09-18T10:08:59.500Z');
  h.art.mount(h.el,c,d,'UTC');const svg=h.el.firstChild,hour=h.el.querySelector('[data-clock-tile="hour"]'),hourNodes=[...hour.children];
  const date=h.el.querySelector('[data-calendar="date"]');
  h.art.mount(h.el,c,new Date(+d+500),'UTC');
  for(const stamp of [0,100,200,350,500,700]){h.tick(stamp);assert.equal(h.el.firstChild,svg);assert.equal(h.el.querySelector('[data-calendar="date"]'),date);assert.deepEqual([...hour.children],hourNodes);}
  assert.equal(h.frames.size,0);assert.equal(h.el.querySelector('[data-flap]'),null);
  assert.match(h.el.querySelector('[data-clock-tile="minute"]').textContent,/09/);
});

function surfaceHarness(remote=false){
  const {document}=parseHTML(source(remote?'remote.html':'index.html'));
  let now=Date.parse('2026-09-18T12:00:00Z'),handlers;const intervals=[],reports=[];
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const window={document,GlassDOM:dom,addEventListener(){},dispatchEvent(){},
    GlassSurface:{subscribe:h=>{handlers=h;},rendered:s=>reports.push(s.revision),card:s=>s.assistant?'<article class="assistant-card"><p>Which one?</p></article>':'',saveOffer:()=>''}};
  const context={window,document,Date:Clock,Intl,location:{pathname:remote?'/remote':'/',search:''},CustomEvent:document.defaultView.CustomEvent,setInterval:(fn,ms)=>intervals.push({fn,ms})};
  for(const name of ['weather-ui.js','workflow-ui.js','playroom-ui.js','studio-ui.js','function-ui.js'])runInNewContext(source(name),context);
  if(remote)runInNewContext(source('weather-controls.js'),context);
  runInNewContext(source(remote?'remote.js':'display.js'),context);
  return {document,handlers,reports,advance:ms=>{now+=ms;intervals.forEach(i=>i.fn());}};
}
function weatherState(){
  const state=new Session().state,now=Date.parse('2026-09-18T12:00:00Z');state.panel='weather';
  state.weather={locations:[{id:'1',name:'Test City',label:'Test City'}],activeId:'1',units:'fahrenheit',errors:{},view:'now',forecasts:{'1':{
    fetchedAt:now,timeZone:'UTC',units:'fahrenheit',current:{time:now,temp:76,feels:79,kind:'rain',label:'Rain'},
    daily:Array.from({length:7},(_,i)=>({time:now+i*86400000,high:82,low:68,kind:'rain',label:'Rain',rain:50})),
    hourly:Array.from({length:24},(_,i)=>({time:now+i*3600000,temp:77,kind:'rain',label:'Rain',rain:50}))}}};
  return state;
}
test('mirror weather artwork and rain retain identity through state, age, voice and reconnect updates',()=>{
  const h=surfaceHarness(),s=weatherState();h.handlers.state(s);
  const scene=h.document.querySelector('.weather-scene'),image=h.document.querySelector('.wx-sky img'),trail=h.document.querySelector('.wx-trail'),rain=h.document.querySelector('.wx-rain-streak');
  s.revision++;s.assistant={status:'clarify',options:[]};h.handlers.state(s);
  h.handlers.voice({phase:'thinking',device:'mac'});h.advance(60000);h.handlers.error();h.handlers.state(s);
  assert.equal(h.document.querySelector('.weather-scene'),scene);assert.equal(h.document.querySelector('.wx-sky img'),image);
  assert.equal(h.document.querySelector('.wx-trail'),trail);assert.equal(h.document.querySelector('.wx-rain-streak'),rain);
  assert.match(h.document.querySelector('.wx-source').textContent,/updated 1 min ago/);
  assert.equal(h.reports.length,3,'render acknowledgements still advance even if visuals do not');
});
test('companion keeps navigation, form drafts and timers stable during unrelated state updates',()=>{
  const h=surfaceHarness(true),s=new Session().state;s.panel='timers';s.timers=[{id:'tea',label:'Tea',endsAt:Date.parse('2026-09-18T12:05:00Z')}];
  h.handlers.state(s);const input=h.document.getElementById('seconds'),nav=h.document.querySelector('[data-panel="timers"]'),timer=h.document.querySelector('[data-render-key="timer:tea"]');
  input.value='127';s.revision++;s.assistant={status:'clarify'};h.handlers.state(s);h.advance(1000);h.handlers.error();h.handlers.state(s);
  assert.equal(h.document.getElementById('seconds'),input);assert.equal(input.value,'127');
  assert.equal(h.document.querySelector('[data-panel="timers"]'),nav);assert.equal(h.document.querySelector('[data-render-key="timer:tea"]'),timer);
  assert.equal(timer.querySelector('.countdown').textContent,'4:59');
});
test('nested renderer caches cannot suppress updates after an ancestor patch',()=>{
  const {el}=harness();dom.patch(el,'<section id="nested"><p>A</p></section>');const nested=el.firstChild;
  dom.patch(nested,'<p>B</p>');dom.patch(el,'<section id="nested"><p>C</p></section>');
  dom.patch(nested,'<p>B</p>');assert.equal(nested.textContent,'B');
});
