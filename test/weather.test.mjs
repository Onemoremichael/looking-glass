import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {Weather,normalizeForecast,weatherIntent,weatherView,weatherSummary,WEATHER_TTL} from '../weather.mjs';
import {Session} from '../session.mjs';
import {createApp} from '../server.mjs';
import {validateDecision,presentation} from '../assistant-contract.mjs';

const now=Date.parse('2026-09-16T12:00:00Z');
const place={id:'1',name:'Test City',label:'Test City, Test Region',latitude:40,longitude:-74,timeZone:'UTC'};
function raw(at=now){
  const midnight=Math.floor(at/86400000)*86400;
  return {current:{time:at/1000,temperature_2m:76,apparent_temperature:79,wind_speed_10m:8,relative_humidity_2m:70,weather_code:61,is_day:1},
    hourly:{time:Array.from({length:72},(_,i)=>midnight+i*3600),temperature_2m:Array(72).fill(75),precipitation_probability:Array(72).fill(60),weather_code:Array(72).fill(61),is_day:Array(72).fill(1)},
    daily:{time:Array.from({length:7},(_,i)=>midnight+i*86400),temperature_2m_max:Array(7).fill(82),temperature_2m_min:Array(7).fill(68),precipitation_probability_max:Array(7).fill(70),weather_code:Array(7).fill(61),sunrise:Array.from({length:7},(_,i)=>midnight+i*86400+6*3600),sunset:Array.from({length:7},(_,i)=>midnight+i*86400+19*3600)}};
}
const response=data=>({ok:true,text:async()=>JSON.stringify(data)});
function setup(at=()=>now){const s=new Session({now:at});s.editWeather(w=>{w.locations=[place];w.activeId=place.id;});return s;}
function populated(){const s=setup();s.state.weather.forecasts['1']=normalizeForecast(raw(),place,'fahrenheit',now);return s;}

test('weather defaults to F with no inferred location; normalizes explicit nulls and timestamps',()=>{
  assert.equal(new Session().state.weather.units,'fahrenheit');assert.equal(weatherView(undefined,now).status,'setup');
  const r=raw();r.current.wind_speed_10m=null;r.hourly.precipitation_probability[12]=null;
  const data=normalizeForecast(r,place,'fahrenheit',now);
  assert.equal(data.current.temp,76);assert.equal(data.current.wind,null);assert.equal(data.current.kind,'rain');
  assert.equal(data.current.time,now);assert.equal(data.hourly.find(h=>h.time===now).rain,null);
  assert.throws(()=>normalizeForecast({...raw(),current:{...raw().current,temperature_2m:null}},place,'fahrenheit',now));
  assert.throws(()=>normalizeForecast(raw(now-86400000),place,'fahrenheit',now));
});
test('cache deduplicates requests, respects TTL, marks failures stale, hides expired data',async()=>{
  let at=now,calls=0,fail=false;const s=setup(()=>at),provider=new Weather({session:s,now:()=>at,fetcher:async url=>{calls++;assert.equal(url.hostname,'api.open-meteo.com');assert.equal(url.searchParams.get('temperature_unit'),'fahrenheit');if(fail)throw Error('offline');return response(raw(at));}});
  await Promise.all([provider.refresh(),provider.refresh()]);assert.equal(calls,1);assert.equal(weatherView(s.state.weather,at).status,'ready');
  await provider.refresh();assert.equal(calls,1);at+=WEATHER_TTL+1;fail=true;await provider.refresh();assert.equal(calls,2);
  assert.equal(weatherView(s.state.weather,at).status,'stale');assert.match(weatherSummary(s.state.weather,'now',at),/Last available/);
  await provider.refresh();assert.equal(calls,2);at+=7*3600000;assert.equal(weatherView(s.state.weather,at).status,'unavailable');assert.doesNotMatch(weatherSummary(s.state.weather,'now',at),/76 degrees/);await provider.close();
});
test('unit switch and removing a place discard in-flight responses, never relabel old values',async()=>{
  const s=setup();let finish;const provider=new Weather({session:s,now:()=>now,fetcher:()=>new Promise(r=>finish=r)});
  const old=provider.refresh();provider.settings({action:'units',units:'celsius'});finish(response(raw()));await old;
  assert.equal(s.state.weather.forecasts['1'],undefined);assert.equal(weatherView(s.state.weather,now).units,'celsius');
  const second=provider.refresh();provider.settings({action:'remove',id:'1'});finish(response(raw()));await second;
  assert.equal(s.state.weather.forecasts['1'],undefined);assert.equal(s.state.weather.activeId,null);await provider.close();
});
test('saved places must be confirmed search results; locations and unit settings persist',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'glass-weather-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'state.json'),s=new Session({file}),provider=new Weather({session:s,now:()=>now,fetcher:async url=>{assert.equal(url.hostname,'geocoding-api.open-meteo.com');return response({results:[{id:1,name:'Test City',latitude:40,longitude:-74,timezone:'UTC',country:'Test'}]});}});
  assert.throws(()=>provider.add('1'),/Search/);const matches=await provider.search('Test');assert.equal(matches.length,1);
  provider.add('1');provider.add('1');assert.equal(s.state.weather.locations.length,1);provider.settings({action:'units',units:'celsius'});
  assert.throws(()=>provider.settings({action:'select',id:'999'}));assert.throws(()=>provider.settings({action:'units',units:'kelvin'}));
  const reloaded=new Session({file});assert.equal(reloaded.state.weather.activeId,'1');assert.equal(reloaded.state.weather.units,'celsius');await provider.close();
});
test('fast weather requests bind only complete supported questions and unique saved cities',()=>{
  const w=populated().state.weather;
  for(const [text,period] of [["What's the weather like?",'now'],['Please show the weather tomorrow','tomorrow'],['forecast this week','week'],['weather today','today']])assert.equal(weatherIntent(text,w).period,period,text);
  assert.equal(weatherIntent('weather tomorrow in test city',w).locationId,'1');
  for(const text of ['do not show weather','show weather and cancel timer','weather in Paris','will it rain in two months','weather tomorrow actually today'])assert.equal(weatherIntent(text,w),null,text);
  w.locations.push({...place,id:'2'});assert.equal(weatherIntent('weather in test city',w),null);
});
test('weather action uses current cache, validates location, and exposes truthful shared context',()=>{
  const s=populated(),d={status:'execute',outcome:'Forecast',message:'Invented sunshine',actions:[{action:'get_weather',period:'tomorrow',locationId:'1'}],options:[],selectedOptionId:null};
  validateDecision(d);const result=s.commitDecision('weather',s.state.revision,d,'weather tomorrow');
  assert.match(result.message,/Tomorrow: rain/);assert.doesNotMatch(result.message,/sunshine/);assert.equal(s.state.weather.view,'tomorrow');assert.equal(s.state.panel,'weather');
  assert.equal(presentation(s.state,now).weather.status,'ready');assert.equal(presentation(s.state,now).weather.view,'tomorrow');
  assert.throws(()=>s.command('get_weather',{period:'today',locationId:'unknown'}));
});
test('forecast days follow place timezone at midnight rather than the Mac timezone',()=>{
  const s=populated();s.state.weather.locations[0]={...place,timeZone:'America/New_York'};
  const f=s.state.weather.forecasts['1'];f.timeZone='America/New_York';f.daily[0].time=Date.parse('2026-09-16T04:00:00Z');f.daily[1].time=Date.parse('2026-09-17T04:00:00Z');
  assert.equal(weatherView(s.state.weather,Date.parse('2026-09-17T01:00:00Z')).status,'unavailable');
  f.fetchedAt=f.current.time=Date.parse('2026-09-17T01:00:00Z');
  assert.equal(weatherView(s.state.weather,f.fetchedAt).daily[0].time,Date.parse('2026-09-16T04:00:00Z'));
});
test('weather rendering is noninteractive, ES5, escaped, reduced-motion aware and reflects actual conditions',()=>{
  const src=readFileSync(new URL('../public/weather-ui.js',import.meta.url),'utf8'),context={window:{},Date};runInNewContext(src,context);
  const s=populated();s.state.weather.locations[0]={...place,name:'<script>alert(1)</script>'};
  const html=context.window.GlassWeather.render(s.state.weather,now);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script|<(?:button|a|input|form)\b/);assert.match(html,/wx-trail-7/);assert.match(html,/76/);assert.match(html,/Open-Meteo/);
  assert.doesNotMatch(src,/\b(?:let|const)\b|=>|\?\.|fetch\(|getUserMedia|backdrop-filter/);
  s.state.weather.forecasts['1'].current.kind='sun';assert.doesNotMatch(context.window.GlassWeather.render(s.state.weather,now),/class="wx-trail /);
  assert.match(readFileSync(new URL('../public/weather.css',import.meta.url),'utf8'),/prefers-reduced-motion/);
  assert.doesNotMatch(context.window.GlassWeather.render(s.state.weather,now+7*3600000),/wx-temp/);
});
test('weather HTTP routes enforce origin and bounded search; cannot accept arbitrary provider URLs',async t=>{
  let calls=0;const origins=[],app=createApp({origins,weatherOptions:{fetcher:async()=>{calls++;return response({results:[]});}}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;origins.push(base);
  const post=(body,origin=base)=>fetch(base+'/api/weather',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({action:'search',query:'Test'},'https://bad.example')).status,403);assert.equal(calls,0);
  assert.equal((await post({action:'search',query:'x'})).status,400);assert.equal(calls,0);
  assert.equal((await post({action:'add',id:'999',url:'http://localhost/private'})).status,400);assert.equal(calls,0);
  assert.equal((await post({action:'search',query:'Test'})).status,200);assert.equal(calls,1);
  for(const kind of ['cloud','sun','moon','rain','storm','snow','fog']){
  const art=await fetch(base+'/assets/weather/'+kind+'-volume-v1.png');
  assert.equal(art.status,200);assert.equal(art.headers.get('content-type'),'image/png');
  const png=Buffer.from(await art.arrayBuffer());assert.equal(png.subarray(1,4).toString(),'PNG');
  assert.equal(png[25],6); // PNG truecolor + alpha, never flattened to JPEG/RGB.
  }
  assert.equal((await fetch(base+'/assets/weather/README.md')).status,404);
});

test('all weather states use matching local alpha art at hero, hourly and daily sizes',()=>{
  const context={window:{},Date};runInNewContext(readFileSync(new URL('../public/weather-ui.js',import.meta.url),'utf8'),context);
  const w=populated().state.weather;
  for(const kind of ['cloud','sun','moon','rain','storm','snow','fog']){
    w.forecasts['1'].current.kind=kind;
    w.forecasts['1'].hourly.forEach(h=>{h.kind=kind;});
    w.forecasts['1'].daily.forEach(d=>{d.kind=kind;});
    const html=context.window.GlassWeather.render(w,now);
    assert.equal((html.match(/<img /g)||[]).length,7); // hero + four hours + two days
    assert.equal((html.match(new RegExp('/assets/weather/'+(kind==='rain'?'cloud':kind)+'-volume-v1.png','g'))||[]).length,7);
    assert.match(html,new RegExp('wx-art-'+kind));assert.match(html,/alt=""/);
    assert.match(html,/class="wx-hour-slot"/);
  }
  w.forecasts['1'].current.kind='../../secret';
  const unknown=context.window.GlassWeather.render(w,now);
  assert.doesNotMatch(unknown,/src="[^"\n]*secret/);
  assert.match(unknown,/wx-icon wx-cloud/); // Safe neutral fallback, no invented weather asset.
});

test('rain is layered with hero-only motion and static compact forecast marks',()=>{
  const context={window:{},Date};runInNewContext(readFileSync(new URL('../public/weather-ui.js',import.meta.url),'utf8'),context);
  const art=context.window.GlassWeather.renderArt;
  const hero=art('rain','Rain',true),compact=art('rain','Rain');
  assert.match(hero,/cloud-volume-v1.png/);assert.doesNotMatch(hero,/rain-volume-v1.png/);
  assert.match(hero,/wx-rain-live/);assert.equal((hero.match(/class="wx-rain-streak /g)||[]).length,4);
  assert.doesNotMatch(compact,/wx-rain-live/);assert.equal((compact.match(/class="wx-rain-streak /g)||[]).length,3);
  for(const kind of ['cloud','sun','moon','storm','snow','fog'])assert.doesNotMatch(art(kind,kind,true),/wx-rain-fall/);
  const css=readFileSync(new URL('../public/weather.css',import.meta.url),'utf8');
  assert.match(css,/\.wx-rain-live \.wx-rain-streak\{[^}]*animation:wx-soft-rain/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)[\s\S]*\.wx-rain-live \.wx-rain-streak\{animation:none!important/);
  const w=populated().state.weather;
  w.forecasts['1'].current.kind='rain';w.forecasts['1'].hourly.forEach(h=>{h.kind='rain';});w.forecasts['1'].daily.forEach(d=>{d.kind='rain';});
  assert.equal((context.window.GlassWeather.render(w,now).match(/wx-rain-live/g)||[]).length,1);
});

test('glanceable weather limits hourly detail, retains seven-day mode, and labels precipitation honestly',()=>{
  const context={window:{},Date};runInNewContext(readFileSync(new URL('../public/weather-ui.js',import.meta.url),'utf8'),context);
  const w=populated().state.weather,render=()=>context.window.GlassWeather.render(w,now);
  let html=render();
  assert.equal((html.match(/class="wx-hour-slot"/g)||[]).length,4);
  assert.equal((html.match(/class="wx-day"/g)||[]).length,2);
  assert.doesNotMatch(html,/wx-curve|wx-facts|Humidity|Sunset/);
  assert.match(html,/Precip\. 60%/);
  w.forecasts['1'].hourly.forEach(h=>{h.rain=5;});
  html=render();assert.doesNotMatch(html,/Precip\. 5%/);
  w.view='week';html=render();
  assert.equal((html.match(/class="wx-day"/g)||[]).length,7);
  assert.doesNotMatch(html,/class="wx-hour-slot"/);assert.match(html,/Today’s high/);
  w.view='tomorrow';html=render();
  assert.equal((html.match(/class="wx-day"/g)||[]).length,2);
  assert.doesNotMatch(html,/class="wx-day-name">Tomorrow/);
  w.forecasts['1'].current.kind='cloud';w.forecasts['1'].current.label='Partly cloudy';w.view='now';
  assert.doesNotMatch(render(),/wx-peeking-sun/); // No guessed sun for nighttime clouds.
});
