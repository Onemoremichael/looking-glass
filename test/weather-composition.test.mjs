import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {SurfaceRegistry,presentation,validateDecision} from '../assistant-contract.mjs';
import {composeWeather,weatherRange,savedViewIntent,validateWeatherSpec} from '../weather-composition.mjs';
import {trackTaskProgress} from '../task-progress.mjs';

const now=Date.parse('2026-09-16T12:00:00Z');
const spec={title:'The week ahead',range:'next_week',startDate:null,endDate:null,focus:'rain',components:['highlights','daily_forecast']};
const action={action:'compose_weather',locationId:null,spec};
const decision=(actions=[action])=>({status:'execute',outcome:'Adapt forecast',message:'Do not display this prose',actions,options:[],selectedOptionId:null});
function setup(options={}){
  const session=new Session({now:()=>now,...options});
  const w=session.state.weather;w.locations=[{id:'1',name:'Gainesville',timeZone:'America/New_York'}];w.activeId='1';
  w.forecasts['1']={units:'fahrenheit',fetchedAt:now,current:{time:now},hourly:[],daily:Array.from({length:16},(_,i)=>({time:Date.parse('2026-09-16T04:00:00Z')+i*86400000,high:80+i,low:60+i,rain:i*5,kind:'rain',label:'Rain'}))};
  return session;
}
test('calendar ranges distinguish next week, later this week, weekend and rolling seven days',()=>{
  assert.deepEqual(weatherRange(spec,now,'America/New_York'),{start:'2026-09-21',end:'2026-09-27'});
  assert.deepEqual(weatherRange({...spec,range:'rest_of_week'},now,'America/New_York'),{start:'2026-09-17',end:'2026-09-20'});
  assert.deepEqual(weatherRange({...spec,range:'weekend'},now,'America/New_York'),{start:'2026-09-19',end:'2026-09-20'});
  const sunday=Date.parse('2026-11-02T02:00:00Z'); // Sunday in New York after DST change.
  assert.deepEqual(weatherRange(spec,sunday,'America/New_York'),{start:'2026-11-02',end:'2026-11-08'});
});
test('saved weather capabilities match varied wording, not titles; ambiguity and unrelated speech fall back',()=>{
  const s=setup();
  const fixtures=[
    ['rest_of_week','general',[
      "'kay. What about later in the week",'Okay, how about later this week?',
      'What does the rest of the week look like?', 'How is the remainder of this week looking?',
      'Show me the weather for later this week','Could you pull up the forecast for the rest of this week?',
      "What's the weather going to be like later in the week?",'What will it be like later this week?',
      'Tell me about the forecast for the remaining days this week',
    ]],
    ['next_week','general',["Show me next week's forecast",'What will next week be like?',"What's next week going to look like?",'Forecast for next week','What about next week?']],
    ['weekend','rain',['Will it rain this weekend?','Is it going to rain this weekend?','Are we expecting rain over the weekend?','Show me the rain forecast for this weekend']],
    ['next_seven_days','temperature',['How warm will it be over the next seven days?','Temperatures for the next 7 days','Show the week ahead temperature forecast']],
  ];
  for(const [range,focus,phrases] of fixtures){
    s.command('compose_weather',{...action,spec:{...spec,title:'Unrelated title '+range,range,focus}});
    const view=s.state.weatherViews.at(-1);
    for(const phrase of phrases)assert.deepEqual(savedViewIntent(phrase,s.state,now),{action:'open_weather_view',viewId:view.id},phrase);
  }
  for(const phrase of ['Do not show weather next week','Maybe later this week','What about next week and cancel the timer',
    'My wife said show weather next week','What about last week','What about later this week in Paris',
    'Show a completely different layout for later this week','Next weekend','Next week or this weekend'])assert.equal(savedViewIntent(phrase,s.state,now),null,phrase);
  s.command('show',{panel:'todos'});
  assert.equal(savedViewIntent('What about next week?',s.state,now),null);
  assert.ok(savedViewIntent('Show me next week\'s forecast',s.state,now));
  s.state.assistant={status:'clarify'};
  assert.equal(savedViewIntent('Forecast for next week',s.state,now),null);
});
test('reused capabilities bind location and focus; multiple alternatives do not pick arbitrarily',()=>{
  const s=setup();const rest={...spec,title:'Later This Week',range:'rest_of_week'};
  s.command('compose_weather',{...action,spec:rest});const rain=s.state.weatherViews[0];
  // The reported existing rain-focused layout remains eligible for a general
  // range request when it is the sole matching saved experience.
  s.command('get_weather',{period:'now',locationId:null});
  assert.equal(savedViewIntent('What about later in the week',s.state,now).viewId,rain.id);
  s.command('compose_weather',{...action,spec:{...rest,title:'Temperature',focus:'temperature'}});
  s.command('get_weather',{period:'now',locationId:null});
  assert.equal(savedViewIntent('What about later this week',s.state,now),null);
  assert.equal(savedViewIntent('Will it rain later this week',s.state,now).viewId,rain.id);
  s.state.weather.locations.push({id:'2',name:'Boston',timeZone:'America/New_York'});s.state.weather.activeId='2';
  assert.equal(savedViewIntent('Rain later this week',s.state,now),null);
  assert.equal(savedViewIntent('Rain later this week in Gainesville',s.state,now).viewId,rain.id);
  s.state.weather.locations=s.state.weather.locations.filter(p=>p.id!=='1');
  assert.equal(savedViewIntent('Open Later This Week',s.state,now),null);
});
test('newly saved capability becomes reusable after restart without another planning call',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'glass-reuse-routing-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'state.json'),s=setup({file});let calls=0;
  const a=new Assistant({session:s,planner:{decide:async()=>{calls++;return decision([{...action,spec:{...spec,range:'rest_of_week'}}]);}}});
  await a.execute('new','What about later in the week');assert.equal(calls,1);
  const reloaded=new Session({file,now:()=>now});
  const reuse=new Assistant({session:reloaded,planner:{decide:async()=>{throw Error('Should reuse, not plan');}}});
  await reuse.execute('again',"'kay. What about later in the week");
  assert.equal(reloaded.state.weather.composition.savedId,reloaded.state.weatherViews[0].id);
  assert.equal(reloaded.state.reusableViews.length,1);
});
test('compositions validate component vocabulary, actual dates, and bounded non-touch ranges',()=>{
  validateDecision(decision());validateWeatherSpec(spec);
  for(const bad of [{components:['html']},{components:['daily_forecast','daily_forecast']},{script:'alert(1)'},{range:'dates',startDate:'2026-02-30',endDate:'2026-03-01'},{range:'dates',startDate:'2026-09-16',endDate:'2026-10-01'}])assert.throws(()=>validateWeatherSpec({...spec,...bad}));
});
test('forecast composition uses verified facts and reports partial, missing and stale coverage',()=>{
  const s=setup(),w=s.state.weather,c=composeWeather(w,spec,now);
  assert.equal(c.days.length,7);assert.equal(c.days[0].date,'2026-09-21');assert.equal(c.highlights[0].value,'55%');assert.equal(c.complete,true);
  w.forecasts['1'].daily=w.forecasts['1'].daily.slice(0,7);
  const partial=composeWeather(w,spec,now);assert.equal(partial.days.length,2);assert.match(partial.warnings.join(' '),/2 of 7/);
  w.forecasts['1'].current.time=now-7*3600000;
  assert.equal(composeWeather(w,spec,now).days.length,0);
});
test('composition auto-saves atomically; restart and title reuse need no approval or planner',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'glass-composition-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'state.json'),s=setup({file}),surfaces=new SurfaceRegistry(()=>now);let calls=0;
  s.onChange=state=>surfaces.report({clientId:'mirror',surface:'mirror',visible:true,revision:state.revision},state);
  const a=new Assistant({session:s,surfaces,planner:{decide:async()=>{calls++;return decision();}}});
  const r=await a.execute('new','What does next week look like?');
  assert.equal(s.state.weather.view,'custom');assert.doesNotMatch(r.message,/Keep this weather view/);assert.equal(s.state.weatherViews.length,1);
  assert.equal(presentation(s.state,now).weather.composition.data.days.length,7);
  const saved=await a.execute('save','No, save it');assert.match(saved.message,/already saved/);assert.equal(s.state.weatherViews.length,1);assert.equal(calls,1);
  await a.execute('save','No, save it');assert.equal(s.state.weatherViews.length,1);
  const reloaded=new Session({file,now:()=>now});assert.equal(reloaded.state.weatherViews.length,1);
  assert.equal(reloaded.state.weatherViews[0].data,undefined);
  await a.execute('reuse','Open the week ahead');assert.equal(calls,1);assert.equal(s.state.viewOffer,null);
  assert.equal(s.state.weather.composition.savedId,s.state.weatherViews[0].id);
});
test('no save invitation or yes/no handling remains; duplicates and adaptation preserve originals',()=>{
  const s=setup();s.command('compose_weather',action);const offer=s.offerComposition(s.state.weather.composition.id);
  assert.equal(offer,null);const original=structuredClone(s.state.reusableViews[0]);
  for(const text of ['yes','no','thanks','maybe','yes but use Celsius','show weather tomorrow'])assert.equal(savedViewIntent(text,s.state,now),null,text);
  assert.equal(savedViewIntent('yes',s.state,now+600001),null);
  s.command('compose_weather',action);assert.equal(s.state.reusableViews.length,1);
  s.command('compose_weather',{...action,spec:{...spec,focus:'temperature'}});
  assert.equal(s.state.reusableViews.length,2);assert.equal(s.state.reusableViews[1].parentId,original.id);
  assert.deepEqual(s.state.reusableViews[0],original);
});
test('hidden or disconnected display and cancelled presentation do not cause a save invitation',async()=>{
  const s=setup(),a=new Assistant({session:s,surfaces:{snapshot:()=>[],waitForRevision:async()=>false},planner:{decide:async()=>decision()}});
  const r=await a.execute('offscreen','next week');assert.equal(s.state.viewOffer,null);assert.match(r.message,/not confirmed/);
});
test('saving is independent of render confirmation and no offer method is called',async()=>{
  const s=setup(),surfaces={snapshot:()=>[],waitForRevision:async()=>true};
  s.offerComposition=()=>{throw Error('disk full');};
  const a=new Assistant({session:s,surfaces,planner:{decide:async()=>decision()}});
  const r=await a.execute('offer-failed','next week');
  assert.equal(s.state.weather.view,'custom');assert.equal(s.state.weatherViews.length,1);
  assert.match(r.message,/saved automatically/);assert.equal(r.status,'completed');
});
test('reuse resolves relative dates again, respects units, and rejects removed places',()=>{
  let at=now;const s=setup({now:()=>at});s.command('compose_weather',action);const view=s.state.weatherViews[0];
  at+=7*86400000;s.command('open_weather_view',{viewId:view.id});assert.equal(s.state.weather.composition.data.range.start,'2026-09-28');
  s.editWeather(w=>{w.units='celsius';w.forecasts={};});assert.equal(s.state.weather.composition.data.days.length,0);assert.equal(s.state.weather.composition.data.unit,'C');
  s.editWeather(w=>{w.locations=[];w.activeId=null;});assert.throws(()=>s.command('open_weather_view',{viewId:view.id}));
});
test('failed persistence and stale decisions cannot save or partially replace a draft',()=>{
  const s=setup(),before=structuredClone(s.state);
  s.save=()=>{throw Error('disk full');};assert.throws(()=>s.command('compose_weather',action));
  assert.deepEqual(s.state,before);
  assert.throws(()=>s.commitDecision('stale',99,decision(),'future forecast'));
});
test('empty data is not promoted and full library does not prevent display or delete older work',()=>{
  const s=setup();s.state.weather.forecasts={};s.command('compose_weather',action);
  assert.equal(s.state.reusableViews.length,0);assert.match(s.state.weather.composition.saveReason,/no forecast/);
  const full=setup();for(let i=0;i<64;i++)full.command('compose_weather',{...action,spec:{...spec,title:'View '+i}});
  full.command('compose_weather',action);assert.equal(full.state.reusableViews.length,64);
  assert.equal(full.state.weather.composition.savedId,undefined);assert.match(full.state.weather.composition.saveReason,/full/);
  full.command('open_weather_view',{viewId:full.state.reusableViews[0].id});assert.ok(full.state.weather.composition.savedId);
});
test('legacy saved IDs migrate and old invitations are retired without dropping entries',t=>{
  const dir=mkdtempSync(join(tmpdir(),'glass-migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const s=setup();s.command('compose_weather',action);const id=s.state.weatherViews[0].id;
  delete s.state.reusableViews;s.state.viewOffer={id:'old-offer'};
  const file=join(dir,'state.json');writeFileSync(file,JSON.stringify(s.state));
  const loaded=new Session({file,now:()=>now});assert.equal(loaded.state.reusableViews[0].id,id);
  assert.equal(loaded.state.viewOffer,null);loaded.command('open_weather_view',{viewId:id});
  assert.equal(loaded.state.weather.composition.savedId,id);assert.equal(loaded.state.reusableViews.length,1);
});
test('cancelled composition cannot become durable',async()=>{
  const s=setup(),controller=new AbortController();let finish;
  const a=new Assistant({session:s,planner:{decide:()=>new Promise(r=>finish=r)}});
  const work=a.execute('cancelled','next week',{signal:controller.signal});
  controller.abort();finish(decision());await assert.rejects(work,/cancelled/);
  assert.equal(s.state.reusableViews.length,0);assert.equal(s.state.weather.composition,undefined);
});
test('composed renderer uses approved artwork and readable components, escapes titles and never emits controls',()=>{
  const ctx={window:{},Date};runInNewContext(readFileSync(new URL('../public/weather-ui.js',import.meta.url),'utf8'),ctx);
  const s=setup();s.command('compose_weather',{...action,spec:{...spec,title:'<script>oops</script>',components:['highlights','temperature_band','daily_forecast']}});
  const html=ctx.window.GlassWeather.render(s.state.weather,now);
  assert.match(html,/&lt;script&gt;/);assert.match(html,/wx-temperature-band/);assert.equal((html.match(/class="wx-day"/g)||[]).length,7);
  assert.doesNotMatch(html,/<script|<button|<input|Do not display this prose/);
});
test('long delay can produce a fresh update after acknowledgment, but completion and cancellation cancel it',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});let last=10000;const sent=[],controller=new AbortController();
  const p=trackTaskProgress({send:x=>sent.push(JSON.parse(x)),isCurrent:()=>true,lastSpeech:()=>last,signal:controller.signal});
  t.mock.timers.tick(1800);assert.equal(sent.length,0);
  p.update({stage:'checking_data'});t.mock.timers.tick(8200);assert.equal(sent.length,1);assert.equal(sent[0].delayed,true);assert.equal(sent[0].stage,'checking_data');
  p.stop();t.mock.timers.tick(20000);assert.equal(sent.length,1);
  const q=trackTaskProgress({send:x=>sent.push(x),isCurrent:()=>true,signal:controller.signal});controller.abort();t.mock.timers.tick(10000);assert.equal(sent.length,1);q.stop();
});
