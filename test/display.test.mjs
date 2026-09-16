import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { presentation } from '../assistant-contract.mjs';
import { Session } from '../session.mjs';
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
