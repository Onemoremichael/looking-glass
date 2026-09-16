import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function fixture(hidden=false){
  const page={},win={},sources=[],values=[];
  const document={hidden,addEventListener:(type,fn)=>page[type]=fn};
  const window={addEventListener:(type,fn)=>win[type]=fn};
  class EventSource{
    constructor(){this.closed=false;this.listeners={};sources.push(this);}
    close(){this.closed=true;}addEventListener(type,fn){this.listeners[type]=fn;}
  }
  runInNewContext(readFileSync(new URL('../public/surface.js',import.meta.url),'utf8'),{window,document,location:{pathname:'/'},EventSource,setInterval(){}});
  window.GlassSurface.subscribe({state:v=>values.push(v),voice:v=>values.push(v),error:()=>values.push('error')});
  return {document,page,win,sources,values};
}
test('hidden idle tabs release streams and reconnect with fresh state when visible',()=>{
  const f=fixture();assert.equal(f.sources.length,1);
  f.document.hidden=true;f.page.visibilitychange();assert.equal(f.sources[0].closed,true);
  f.sources[0].onmessage({data:'"stale"'});assert.equal(f.values.length,0);
  f.document.hidden=false;f.page.visibilitychange();assert.equal(f.sources.length,2);
  f.sources[1].onmessage({data:'"fresh"'});assert.deepEqual(f.values,['fresh']);
});
test('voice owner stays subscribed in background; End and pagehide release the stream',()=>{
  const f=fixture(true);assert.equal(f.sources.length,0);
  f.win['glass-voice-active']({detail:true});assert.equal(f.sources.length,1);
  f.page.visibilitychange();assert.equal(f.sources[0].closed,false);
  f.win['glass-voice-active']({detail:false});assert.equal(f.sources[0].closed,true);
  f.document.hidden=false;f.page.visibilitychange();
  f.win.pagehide();assert.equal(f.sources[1].closed,true);
  f.win.pageshow();assert.equal(f.sources.length,3);
});
