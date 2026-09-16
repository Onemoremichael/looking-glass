import {weatherView} from './weather.mjs';
import {framing} from './timer-intent.mjs';

export const weatherComponents=['highlights','temperature_band','daily_forecast'];
export const weatherRanges=['next_seven_days','rest_of_week','next_week','weekend','dates'];
export function validateWeatherSpec(spec){
  if(!spec||Object.keys(spec).sort().join(',')!=='components,endDate,focus,range,startDate,title'||
    typeof spec.title!=='string'||!spec.title.trim()||spec.title.length>60||
    !weatherRanges.includes(spec.range)||!['general','rain','temperature'].includes(spec.focus)||
    !Array.isArray(spec.components)||spec.components.length>3||!spec.components.includes('daily_forecast')||
    new Set(spec.components).size!==spec.components.length||spec.components.some(c=>!weatherComponents.includes(c)))throw Error('Invalid weather composition');
  if(spec.range==='dates'){
    const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
    if(!valid(spec.startDate)||!valid(spec.endDate)||spec.endDate<spec.startDate||Date.parse(spec.endDate)-Date.parse(spec.startDate)>6*86400000)throw Error('Choose at most seven calendar days');
  }else if(spec.startDate!==null||spec.endDate!==null)throw Error('Relative ranges must not store fixed dates');
  return spec;
}
export function localDate(time,zone){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));}
const shift=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function weatherRange(spec,now,zone){
  const today=localDate(now,zone),weekday=new Date(today+'T12:00:00Z').getUTCDay();
  let start=today,end=shift(today,6);
  if(spec.range==='rest_of_week'){start=weekday===0?today:shift(today,1);end=shift(today,(7-weekday)%7);}
  if(spec.range==='next_week'){start=shift(today,weekday===0?1:8-weekday);end=shift(start,6);}
  if(spec.range==='weekend'){start=weekday===0?today:shift(today,(6-weekday+7)%7);end=weekday===0?today:shift(start,1);}
  if(spec.range==='dates'){start=spec.startDate;end=spec.endDate;}
  return {start,end};
}
const shown=n=>Number.isFinite(n)?Math.round(n):'—';
export function composeWeather(weather,spec,now=Date.now()){
  validateWeatherSpec(spec);
  const v=weatherView(weather,now),zone=v.place?.timeZone||'UTC',range=weatherRange(spec,now,zone);
  const days=(v.daily||[]).filter(d=>{const date=localDate(d.time,zone);return date>=range.start&&date<=range.end;}).map(d=>({...d,date:localDate(d.time,zone),day:new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:zone}).format(new Date(d.time))}));
  const expected=(Date.parse(range.end)-Date.parse(range.start))/86400000+1,complete=days.length===expected;
  const highs=days.map(d=>d.high).filter(Number.isFinite),lows=days.map(d=>d.low).filter(Number.isFinite),rain=days.filter(d=>Number.isFinite(d.rain)).sort((a,b)=>b.rain-a.rain)[0];
  const unit=weather.units==='celsius'?'C':'F';
  const highlights=[];
  if(spec.focus==='rain'&&rain)highlights.push({label:'Highest precip. chance',value:shown(rain.rain)+'%',detail:rain.day});
  if(highs.length)highlights.push({label:'Daytime highs',value:shown(Math.min(...highs))+'–'+shown(Math.max(...highs))+'°',detail:unit==='F'?'Fahrenheit':'Celsius'});
  if(spec.focus!=='rain'&&rain)highlights.push({label:'Highest precip. chance',value:shown(rain.rain)+'%',detail:rain.day});
  const warnings=[];
  if(v.status==='stale')warnings.push('Last available forecast; refresh has not succeeded.');
  if(!complete)warnings.push(days.length?'Partial coverage: showing '+days.length+' of '+expected+' requested days.':'No forecast is available for these dates.');
  if(range.end>shift(localDate(now,zone),6))warnings.push('Longer-range outlook; details can change.');
  return {title:spec.title,focus:spec.focus,components:spec.components,range,days,highlights:highlights.slice(0,2),
    band:highs.length&&lows.length?{low:Math.min(...lows),high:Math.max(...highs)}:null,
    unit,place:v.place?.name||'',status:v.status,complete,warnings,fetchedAt:v.fetchedAt||null};
}
export function compositionSummary(c){
  const facts=c.highlights.map(h=>h.label+': '+h.value+' '+h.detail).join('. ');
  return [c.place,c.range.start+' through '+c.range.end,facts,...c.warnings].filter(Boolean).join('. ');
}
export function refreshComposition(state,now){
  const draft=state.weather.composition;
  if(draft){
    if(draft.locationId!==state.weather.activeId){state.weather.composition=null;state.viewOffer=null;return;}
    draft.data=composeWeather(state.weather,draft.spec,now);
  }
}
export function viewOfferCurrent(state,now){
  const o=state.viewOffer,c=state.weather?.composition;
  return !!o&&o.expiresAt>now&&state.panel==='weather'&&o.compositionId===c?.id&&o.locationId===state.weather.activeId;
}
export function savedViewIntent(text,state,now=Date.now()){
  const s=framing(text);
  if(state.panel==='weather'&&state.weather?.composition&&/^(?:save it|save this|save this view|keep it|keep this view|no save it|yes save it)$/.test(s.replace(/,/g,'')))return {action:'save_current_view'};
  if(viewOfferCurrent(state,now)){
    if(/^(?:yes|yeah|yep|sure|save it|keep it|save this view|keep this view|yes save it|yes please|please do)$/.test(s))return {action:'resolve_view_offer',offerId:state.viewOffer.id,choice:'save'};
    if(/^(?:no|no thanks|not now|don't save it|do not save it|just this time)$/.test(s))return {action:'resolve_view_offer',offerId:state.viewOffer.id,choice:'discard'};
  }
  const m=s.match(/^(?:show|open|bring up) (?:my |the )?(.+)$/);
  if(!m)return null;
  const matches=(state.weatherViews||[]).filter(v=>v.spec.title.toLowerCase().replace(/^(?:my|the) /,'')===m[1].replace(/^(?:my|the) /,''));
  return matches.length===1?{action:'open_weather_view',viewId:matches[0].id}:null;
}
