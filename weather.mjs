import {framing} from './timer-intent.mjs';

export const WEATHER_TTL=10*60*1000, WEATHER_MAX_AGE=6*60*60*1000;
export const emptyWeather=()=>({locations:[],activeId:null,units:'fahrenheit',forecasts:{},errors:{},view:'now'});
export function condition(code,isDay=1){
  if(code===0||code===1)return {label:isDay?'Clear skies':'Clear night',kind:isDay?'sun':'moon'};
  if(code===2)return {label:'Partly cloudy',kind:'cloud'};
  if(code===3)return {label:'Overcast',kind:'cloud'};
  if([45,48].includes(code))return {label:'Fog',kind:'fog'};
  if([51,53,55,56,57].includes(code))return {label:'Drizzle',kind:'rain'};
  if([61,63,65,66,67,80,81,82].includes(code))return {label:'Rain',kind:'rain'};
  if([71,73,75,77,85,86].includes(code))return {label:'Snow',kind:'snow'};
  if([95,96,99].includes(code))return {label:'Thunderstorms',kind:'storm'};
  return {label:'Conditions unavailable',kind:'cloud'};
}
const num=(n,min=-200,max=500)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max?n:null;
function location(raw){
  if(!Number.isInteger(raw?.id)||raw.id<1||typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>100||num(raw.latitude,-90,90)===null||num(raw.longitude,-180,180)===null)throw Error('Invalid location response');
  new Intl.DateTimeFormat('en',{timeZone:raw.timezone}).format();
  return {id:String(raw.id),name:raw.name,label:[raw.name,raw.admin1,raw.country].filter(Boolean).join(', ').slice(0,240),latitude:raw.latitude,longitude:raw.longitude,timeZone:raw.timezone||'UTC'};
}
export function normalizeForecast(raw,place,units,now){
  const c=raw?.current,h=raw?.hourly,d=raw?.daily;
  if(!c||num(c.temperature_2m)===null||!Number.isFinite(c.time)||Math.abs(c.time*1000-now)>2*60*60*1000||!Array.isArray(h?.time)||!Array.isArray(d?.time)||d.time.length<2)throw Error('Incomplete forecast');
  const point=(time,temp,code,isDay=1)=>({time:time*1000,temp:num(temp),...condition(code,isDay)});
  const hourly=h.time.map((time,i)=>({...point(time,h.temperature_2m?.[i],h.weather_code?.[i],h.is_day?.[i]),rain:num(h.precipitation_probability?.[i],0,100)})).filter(p=>p.time>=now-60*60*1000&&Number.isFinite(p.time)).slice(0,48);
  const daily=d.time.map((time,i)=>({time:time*1000,...condition(d.weather_code?.[i]),high:num(d.temperature_2m_max?.[i]),low:num(d.temperature_2m_min?.[i]),rain:num(d.precipitation_probability_max?.[i],0,100),sunrise:Number.isFinite(d.sunrise?.[i])?d.sunrise[i]*1000:null,sunset:Number.isFinite(d.sunset?.[i])?d.sunset[i]*1000:null})).slice(0,16);
  if(hourly.length<6||!daily.every(p=>Number.isFinite(p.time)))throw Error('Incomplete forecast');
  return {horizonVersion:2,locationId:place.id,units,timeZone:place.timeZone,fetchedAt:now,current:{...point(c.time,c.temperature_2m,c.weather_code,c.is_day),feels:num(c.apparent_temperature),wind:num(c.wind_speed_10m,0,500),humidity:num(c.relative_humidity_2m,0,100)},hourly,daily};
}
function dateKey(time,zone){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));}
export function weatherView(weather,now=Date.now(),id=weather?.activeId){
  const w=weather||emptyWeather(),place=w.locations.find(l=>l.id===id),data=w.forecasts[id];
  if(!place)return {status:'setup',locations:w.locations,units:w.units};
  if(!data||data.units!==w.units)return {status:w.errors[id]?'unavailable':'loading',place,units:w.units,locations:w.locations};
  const age=Math.max(now-data.fetchedAt,now-data.current.time,0);
  if(age>WEATHER_MAX_AGE)return {status:'unavailable',place,units:w.units,locations:w.locations};
  const today=dateKey(now,place.timeZone);
  const daily=data.daily.filter(d=>dateKey(d.time,place.timeZone)>=today);
  return {...data,place,locations:w.locations,status:age>30*60*1000||w.errors[id]?'stale':'ready',daily,hourly:data.hourly.filter(h=>h.time>=now-60*60*1000).slice(0,12)};
}
export function weatherSummary(weather,period='now',now=Date.now()){
  const v=weatherView(weather,now);
  if(v.status==='setup')return 'Choose a weather location in the companion first. You can save up to five places.';
  if(v.status==='loading')return `Fetching the forecast for ${v.place.name}. The weather view is open; current conditions are not available yet.`;
  if(v.status==='unavailable')return `Weather for ${v.place.name} is unavailable right now. I do not have a recent forecast.`;
  const unit=v.units==='fahrenheit'?'Fahrenheit':'Celsius',n=x=>x===null?'unavailable':Math.round(x);
  const stale=v.status==='stale'?`Last available forecast, fetched ${Math.floor((now-v.fetchedAt)/60000)} minutes ago. `:'';
  if(period==='now')return `${stale}${v.place.name}: ${n(v.current.temp)} degrees ${unit}, ${v.current.label.toLowerCase()}${v.current.feels===null?'':`, feels like ${n(v.current.feels)}`}.`;
  const days=period==='week'?v.daily:v.daily.slice(period==='tomorrow'?1:0,period==='tomorrow'?2:1);
  if(!days.length)return 'The requested forecast is not available yet.';
  return stale+v.place.name+', '+unit+'. '+days.slice(0,period==='week'?3:1).map((d,i)=>`${period==='tomorrow'?'Tomorrow':period==='today'?'Today':new Intl.DateTimeFormat('en',{weekday:'long',timeZone:v.timeZone}).format(new Date(d.time))}: ${d.label.toLowerCase()}, high ${n(d.high)}, low ${n(d.low)}${d.rain===null?'':`, ${n(d.rain)} percent chance of precipitation`}.`).join(' ')+(period==='week'?' The full seven-day forecast is on the display.':'');
}
export function weatherIntent(text,weather){
  if(typeof text!=='string'||text.length>200)return null;
  let s=framing(text),locationId=null;
  const inCity=s.match(/^(.*) in (.+)$/);
  if(inCity){
    const matches=(weather?.locations||[]).filter(l=>[l.name,l.label].some(n=>n.toLowerCase()===inCity[2]));
    if(matches.length!==1)return null;locationId=matches[0].id;s=inCity[1];
  }
  const m=s.match(/^(?:(?:show|open|display|bring up) (?:me )?(?:the )?(?:weather|forecast)|(?:what's|what is|how's|how is) (?:the )?weather(?: like)?|weather|forecast)(?: (?:for )?(now|today|tomorrow|this week))?$/);
  return m?{action:'get_weather',period:m[1]==='this week'?'week':m[1]||'now',locationId}:null;
}

// Fixed provider hosts only. No user-supplied URLs, credentials or browser requests
// to the provider; all surfaces share the same bounded cache on the Mac.
export class Weather {
  constructor({session,fetcher=fetch,now=Date.now}={}){Object.assign(this,{session,fetcher,now});this.inflight=new Map();this.attempts=new Map();this.searchCache=new Map();this.closed=false;}
  async json(url,signal){
    const r=await this.fetcher(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000),redirect:'error'});
    if(!r.ok)throw Error('Weather provider unavailable');
    const text=await r.text();if(text.length>500000)throw Error('Provider response too large');return JSON.parse(text);
  }
  async search(query){
    if(typeof query!=='string'||query.trim().length<2||query.length>100)throw Error('Enter at least two characters');
    const key=query.trim().toLowerCase(),cached=this.searchCache.get(key);
    if(cached&&this.now()-cached.at<10*60*1000)return cached.results;
    if(this.lastSearch&&this.now()-this.lastSearch<1000)throw Error('Please wait a moment before searching again');this.lastSearch=this.now();
    const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.search=new URLSearchParams({name:query.trim(),count:'5',language:'en',format:'json'});
    const raw=await this.json(url),results=(raw.results||[]).map(location);
    if(this.searchCache.size>=30)this.searchCache.delete(this.searchCache.keys().next().value);
    this.searchCache.set(key,{at:this.now(),results});return results;
  }
  add(id){
    // A location must have come from this server's recent search, not client coordinates.
    const place=[...this.searchCache.values()].filter(v=>this.now()-v.at<10*60*1000).flatMap(v=>v.results).find(p=>p.id===id);
    if(!place)throw Error('Search for the city again before adding it');
    this.session.editWeather(w=>{
      if(!w.locations.some(l=>l.id===id)){if(w.locations.length>=5)throw Error('Maximum five places');w.locations.push(place);}
      w.activeId=id;w.view='now';
    });
  }
  settings(body){
    if(body.action==='add')return this.add(body.id);
    this.session.editWeather(w=>{
      if(body.action==='units'){
        if(!['fahrenheit','celsius'].includes(body.units))throw Error('Invalid units');
        if(w.units!==body.units){w.units=body.units;w.forecasts={};w.errors={};}
      }else if(body.action==='select'||body.action==='remove'){
        if(!w.locations.some(l=>l.id===body.id))throw Error('Unknown saved place');
        if(body.action==='select')w.activeId=body.id;
        else {w.locations=w.locations.filter(l=>l.id!==body.id);delete w.forecasts[body.id];delete w.errors[body.id];if(w.activeId===body.id)w.activeId=w.locations[0]?.id||null;}
      }else throw Error('Unknown weather setting');
    });
  }
  refresh(){return Promise.all((this.session.state.weather?.locations||[]).map(p=>this.refreshPlace(p)));}
  async refreshPlace(place){
    if(this.closed)return;
    const w=this.session.state.weather,units=w.units,key=place.id+':'+units,cached=w.forecasts[place.id];
    if(cached?.horizonVersion===2&&cached.units===units&&this.now()-cached.fetchedAt<WEATHER_TTL&&!w.errors[place.id])return;
    if(this.inflight.has(key))return this.inflight.get(key).promise;
    if(this.now()-(this.attempts.get(key)??-Infinity)<60000)return;
    this.attempts.set(key,this.now());const controller=new AbortController();
    const task={controller};this.inflight.set(key,task);
    task.promise=(async()=>{
      const url=new URL('https://api.open-meteo.com/v1/forecast');
      url.search=new URLSearchParams({latitude:place.latitude,longitude:place.longitude,timezone:place.timeZone,timeformat:'unixtime',forecast_days:'16',temperature_unit:units,wind_speed_unit:units==='fahrenheit'?'mph':'kmh',current:'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m',hourly:'temperature_2m,precipitation_probability,weather_code,is_day',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'});
      const stillCurrent=()=>!this.closed&&this.session.state.weather.units===units&&this.session.state.weather.locations.some(l=>l.id===place.id);
      try{
        const forecast=normalizeForecast(await this.json(url,controller.signal),place,units,this.now());
        if(stillCurrent())this.session.editWeather(next=>{next.forecasts[place.id]=forecast;delete next.errors[place.id];});
      }catch{
        if(stillCurrent())this.session.editWeather(next=>{next.errors[place.id]='Weather provider unavailable';});
      }finally{this.inflight.delete(key);}
    })();return task.promise;
  }
  start(){this.refresh().catch(()=>{});this.interval=setInterval(()=>this.refresh().catch(()=>{}),60000);this.interval.unref();}
  async close(){this.closed=true;clearInterval(this.interval);for(const t of this.inflight.values())t.controller.abort();await Promise.allSettled([...this.inflight.values()].map(t=>t.promise));}
}
