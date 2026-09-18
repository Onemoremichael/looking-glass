import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { presentation } from '../assistant-contract.mjs';
import { Session } from '../session.mjs';
import GlassDOM from '../public/dom-patch.cjs';
test('mirror contains no interactive elements or command transport', () => {
  for (const file of ['index.html', 'display.js']) {
    const source = readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /<(?:input|textarea|button|form|a|select|details)(?:\s|>)/i);
    assert.doesNotMatch(source, /\/api\/command|XMLHttpRequest/);
  }
  const companion = readFileSync(new URL('../public/remote.html', import.meta.url), 'utf8');
  assert.match(companion, /src="\/remote.js"/);
});
function surface(){
  const context={window:{},location:{pathname:'/'},document:{addEventListener(){}},setInterval(){}};
  runInNewContext(readFileSync(new URL('../public/surface.js',import.meta.url),'utf8'),context);
  return context.window.GlassSurface;
}
test('routine success is not rendered as a card or described as visible to the agent',()=>{
  const session=new Session();
  session.state.assistant={status:'execute',outcome:'Remove milk',message:'Removed milk.',options:[]};
  assert.equal(surface().card(session.state),'');
  assert.equal(presentation(session.state).assistantCard,null);
  assert.equal(session.state.assistant.message,'Removed milk.'); // receipt/history remain intact
});
test('questions, choices, limitations and answers remain visible without intent headings',()=>{
  const ui=surface();
  for(const status of ['clarify','unsupported','answer']){
    const state={assistant:{status,outcome:'Internal intent heading',message:'Which <timer>?',options:status==='clarify'?[{id:'1',label:'Tea & toast'}]:[]}};
    const html=ui.card(state);
    assert.match(html,/Which &lt;timer&gt;\?/);assert.doesNotMatch(html,/Internal intent heading|DONE|<h2>/);
    if(status==='clarify'){assert.match(html,/<ol/);assert.match(html,/Tea &amp; toast/);}
  }
});
function clockOptions(search){
  const elements={};
  class Clock extends Date{
    toLocaleTimeString(locale,options){return JSON.stringify(options);}
    toLocaleDateString(locale,options){return JSON.stringify(options);}
  }
  runInNewContext(readFileSync(new URL('../public/display.js',import.meta.url),'utf8'),{
    location:{search},Intl,Date:Clock,setInterval(){},
    window:{GlassDOM,GlassSurface:{subscribe(){}}},
    document:{getElementById:id=>elements[id]??={},querySelectorAll:()=>[]}
  });
  return {time:JSON.parse(elements.clock.textContent),date:JSON.parse(elements.date.textContent)};
}
test('mirror timer cards omit the visual-alert disclaimer',()=>{
  const source=readFileSync(new URL('../public/display.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/Visual alerts? only/i);
});
test('mirror deployment can override UTC Android with an explicit IANA time zone',()=>{
  const options=clockOptions('?timeZone=America%2FNew_York');
  assert.equal(options.time.timeZone,'America/New_York');assert.equal(options.date.timeZone,'America/New_York');
});
test('absent, invalid and malformed time zones keep the device-local fallback',()=>{
  for(const search of ['', '?timeZone=not-a-zone','?timeZone=%ZZ']){
    const options=clockOptions(search);assert.equal(options.time.timeZone,undefined);assert.equal(options.date.timeZone,undefined);
  }
});
test('native conversation indicator replaces routine footer but preserves actionable status',()=>{
  const elements={};let handlers;
  runInNewContext(readFileSync(new URL('../public/display.js',import.meta.url),'utf8'),{
    location:{search:''},Intl,Date,setInterval(){},
    window:{GlassDOM,GlassSurface:{subscribe(value){handlers=value;}}},
    document:{getElementById:id=>elements[id]??={setAttribute(){}},querySelectorAll:()=>[]}
  });
  for(const phase of ['listening','speaking','muted','off']){
    handlers.voice({device:'mirror',phase});
    assert.equal(elements['mirror-voice'].className,'mirror-voice off');
  }
  for(const phase of ['connecting','thinking','needs_input','error','stopping']){
    handlers.voice({device:'mirror',phase,detail:'Which timer?'});
    assert.equal(elements['mirror-voice'].className,'mirror-voice');
    assert.ok(elements['mirror-voice-label'].textContent);
  }
  handlers.voice({device:'mac',phase:'listening'});
  assert.equal(elements['mirror-voice'].className,'mirror-voice');
  assert.equal(elements['mirror-voice-label'].textContent,'Listening');
});
test('background work stays visible without cloud voice, distinguishes ready, clears and fails stale',()=>{
  const elements={};let handlers;
  runInNewContext(readFileSync(new URL('../public/display.js',import.meta.url),'utf8'),{
    location:{search:''},Intl,Date,setInterval(){},
    window:{GlassDOM,GlassSurface:{subscribe(value){handlers=value;}}},
    document:{getElementById:id=>elements[id]??={setAttribute(k,v){this[k]=v;}},querySelectorAll:()=>[]}
  });
  for(const phase of ['off','listening','thinking','speaking','stopping']){
    handlers.voice({device:'mirror',phase,background:{running:1,waitingToAnnounce:0}});
    assert.equal(elements['mirror-voice'].className,'mirror-voice background-work');
    assert.equal(elements['mirror-voice-label'].textContent,'Working in background');
  }
  handlers.voice({phase:'off',background:{running:2}});assert.equal(elements['mirror-voice-label'].textContent,'2 tasks running');
  handlers.voice({phase:'off',background:{running:0,waitingToAnnounce:1}});assert.equal(elements['mirror-voice-label'].textContent,'Result ready');
  assert.equal(elements['mirror-voice']['data-phase'],'ready');
  handlers.error();assert.equal(elements['mirror-voice'].className,'mirror-voice off');assert.equal(elements.connection.hidden,false);
  handlers.voice({phase:'off',background:{running:0,waitingToAnnounce:0}});assert.equal(elements['mirror-voice'].className,'mirror-voice off');
});
