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
// Compile a whole request into a capability query, not a saved title or an
// arbitrary substring match. A new phrasing never authorizes new operations.
const rangeAliases=new Map([
  ...['later in the week','later this week','later on this week','later on in the week','the rest of the week','rest of the week','the rest of this week','rest of this week','the remainder of this week','the remainder of the week','the remaining days this week'].map(s=>[s,'rest_of_week']),
  ...['next week','the coming week'].map(s=>[s,'next_week']),
  ...['this weekend','the weekend','weekend','over the weekend','over this weekend'].map(s=>[s,'weekend']),
  ...['the next seven days','next seven days','the next 7 days','next 7 days','the week ahead','week ahead','a week ahead'].map(s=>[s,'next_seven_days']),
]);
export function weatherReuseRequest(text,state){
  if(typeof text!=='string'||text.length>300)return null;
  let s=framing(text),locationId=state.weather?.activeId,explicit=false,focus=null;
  const places=(state.weather?.locations||[]).filter(p=>[p.name,p.label].some(n=>n&&s.endsWith(' in '+n.toLowerCase())));
  if(places.length>1)return null;
  if(places.length===1){
    const name=[places[0].name,places[0].label].find(n=>n&&s.endsWith(' in '+n.toLowerCase()));
    locationId=places[0].id;s=s.slice(0,-(' in '+name).length);
  }
  s=s.replace(/^(?:what about|how about) /,'');
  const rain=s.match(/^(?:will it rain|is it going to rain|are we (?:getting|expecting) rain) (.+)$/);
  const temperature=s.match(/^how (?:warm|hot|cold) (?:will it be|is it going to be) (.+)$/);
  if(rain||temperature){explicit=true;focus=rain?'rain':'temperature';s=(rain||temperature)[1];}
  else{
    s=s.replace(/^(?:show|open|display|bring up|pull up) (?:me )?(?:the )?/,'')
      .replace(/^(?:tell me|let me see) (?:about )?(?:the )?/,'');
    const question=s.match(/^what (?:does|will) (.+) (?:look|be) like$/)
      ||s.match(/^(?:what's|what is) (.+?) (?:going to be |going to look )?like$/)
      ||s.match(/^(?:how's|how is) (.+?)(?: looking)?$/);
    if(question)s=question[1];
    // Both "weather for next week" and "next week's weather", with natural
    // question wrappers, compile into the same range/focus query.
    const head=s.match(/^(?:(?:what's|what is|what are|how's|how is) )?(?:the )?(weather|forecast|rain|temperatures?)(?: (?:forecast|outlook))?(?: (?:going to be |going to look )?like)? (?:for |during |over )?(.+)$/);
    const tail=s.match(/^(.+?)(?:'s)? (weather|forecast|rain|temperatures?)(?: (?:forecast|outlook))?$/);
    if(head||tail){
      const domain=head?head[1]:tail[2];s=head?head[2]:tail[1];explicit=true;
      focus=domain==='rain'?'rain':domain.startsWith('temperature')?'temperature':null;
    }else{
      // Pronoun-only weather follow-ups need the current weather surface.
      s=s.replace(/^(?:what (?:will it|is it going to) be like|what's it like) /,'');
    }
  }
  s=s.replace(/^(?:for|during|over) /,'');
  const range=rangeAliases.get(s);
  if(!range||(!explicit&&state.panel!=='weather')||!(state.weather?.locations||[]).some(p=>p.id===locationId))return null;
  return {range,locationId,focus};
}
function reusableWeatherIntent(text,state){
  const request=weatherReuseRequest(text,state);if(!request)return null;
  let matches=(state.weatherViews||[]).filter(v=>{
    try{validateWeatherSpec(v.spec);}catch{return false;}
    return v.version===1&&v.locationId===request.locationId&&v.spec.range===request.range&&(!request.focus||v.spec.focus===request.focus);
  });
  // Keep an already selected matching variant; otherwise use a unique general
  // view, or a sole matching saved capability. Never guess among alternatives.
  const current=state.panel==='weather'&&matches.find(v=>v.id===state.weather?.composition?.savedId);
  if(current)matches=[current];
  else if(!request.focus){const general=matches.filter(v=>v.spec.focus==='general');if(general.length===1)matches=general;}
  return matches.length===1?{action:'open_weather_view',viewId:matches[0].id}:null;
}
export function savedViewIntent(text,state,now=Date.now()){
  if(typeof text!=='string'||state.assistant?.status==='clarify')return null;
  const s=framing(text);
  if(state.panel==='weather'&&state.weather?.composition&&/^(?:save it|save this|save this view|keep it|keep this view|no save it|yes save it)$/.test(s.replace(/,/g,'')))return {action:'save_current_view'};
  if(viewOfferCurrent(state,now)){
    if(/^(?:yes|yeah|yep|sure|save it|keep it|save this view|keep this view|yes save it|yes please|please do)$/.test(s))return {action:'resolve_view_offer',offerId:state.viewOffer.id,choice:'save'};
    if(/^(?:no|no thanks|not now|don't save it|do not save it|just this time)$/.test(s))return {action:'resolve_view_offer',offerId:state.viewOffer.id,choice:'discard'};
  }
  const m=s.match(/^(?:show|open|bring up) (?:my |the )?(.+)$/);
  if(m){
    const matches=(state.weatherViews||[]).filter(v=>(state.weather?.locations||[]).some(p=>p.id===v.locationId)&&v.spec.title.toLowerCase().replace(/^(?:my|the) /,'')===m[1].replace(/^(?:my|the) /,''));
    if(matches.length===1)return {action:'open_weather_view',viewId:matches[0].id};
    if(matches.length>1)return null;
  }
  return reusableWeatherIntent(text,state);
}
