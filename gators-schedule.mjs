import {readPublicPage} from './research-sources.mjs';
import flow from './public/gators-flow.cjs';

// Read-only, fixed official sources. Schedule selection is deterministic; no
// model may invent a home designation, opponent, sport or date for this shortcut.
export const sports=['baseball','mens-basketball','cross-country','football','mens-golf','mens-swimming-and-diving','mens-tennis','track-and-field','womens-basketball','womens-golf','womens-gymnastics','womens-lacrosse','womens-soccer','softball','womens-swimming-and-diving','womens-tennis','womens-volleyball'];
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&#(?:x([\da-f]+)|(\d+));/gi,(_,h,d)=>String.fromCodePoint(Math.min(0x10ffff,parseInt(h||d,h?16:10)))).replace(/&(amp|apos|quot|lt|gt|nbsp);/g,(_,n)=>({amp:'&',apos:"'",quot:'"',lt:'<',gt:'>',nbsp:' '})[n]).replace(/\s+/g,' ').trim();
const name=s=>s.replace(/^mens-/,"Men's ").replace(/^womens-/,"Women's ").replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).replace(/'S/g,"'s");
function local(now){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute)};}
export function parseSchedule(html,sport){
  const title=clean(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'');
  const years=title.match(/\b(20\d\d)(?:-(\d{2,4}))?/);
  const table=html.match(/<table\b[^>]*>[\s\S]*?<\/table>/i)?.[0];
  if(!years||!table||!/<th\b[^>]*>\s*At\s*<\/th>/i.test(table))throw Error('Schedule format unavailable');
  const events=[];let uncertain=0;
  for(const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const c=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>clean(x[1]));
    if(!c.length)continue;
    if(c.length!==7)throw Error('Schedule columns changed');
    if(c[2]!=='Home')continue;
    const date=c[0].match(/^([A-Z][a-z]{2}) (\d{1,2}) \([A-Za-z]{3}\)$/);
    if(!date||!c[3]||!c[4].includes('Gainesville')){uncertain++;continue;}
    const month=months.indexOf(date[1])+1;if(!month){uncertain++;continue;}
    const year=Number(years[1])+(years[2]&&month<7?1:0);
    const iso=year+'-'+String(month).padStart(2,'0')+'-'+date[2].padStart(2,'0');
    if(new Date(iso+'T12:00:00Z').toISOString().slice(0,10)!==iso){uncertain++;continue;}
    // Exclude completed/cancelled matches, retaining TBD future start times.
    if(c[6].replace(/[-\s]/g,'')||/cancel|postpon/i.test(c.join(' ')))continue;
    const t=c[1].replace(/\./g,'').match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    const minute=t&&Number(t[1])>=1&&Number(t[1])<=12&&Number(t[2]||0)<60?(Number(t[1])%12+(t[3].toLowerCase()==='pm'?12:0))*60+Number(t[2]||0):null;
    events.push({sport:name(sport),slug:sport,date:iso,dateLabel:c[0],time:c[1]||'Time TBD',minute,opponent:c[3],venue:c[4],url:'https://floridagators.com/sports/'+sport+'/schedule/text'});
  }
  return {events,uncertain,season:title};
}
export function isGatorsShortcut(utterance){const current=flow.command().spec.steps[0].request;return utterance===current||utterance===current.replace('All events on one page; concise, chronological rows.','Cards concise, chronological; max 6, disclose omissions.');}
export async function gatorsBoard({now=Date.now(),signal,read=readPublicPage}={}){
  const start=local(now),end=local(now+14*86400000),found=[],failed=[],checked=[];let uncertain=0;
  const deadline=AbortSignal.timeout(30000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
  for(let i=0;i<sports.length;i+=3)await Promise.all(sports.slice(i,i+3).map(async sport=>{
    try{
      const page=await read('https://floridagators.com/sports/'+sport+'/schedule/text',{signal:combined,retainText:true});
      if(new URL(page.url).hostname!=='floridagators.com')throw Error('Unexpected schedule host');
      const parsed=parseSchedule(page.text,sport);found.push(...parsed.events);uncertain+=parsed.uncertain;checked.push(sport);
    }catch{failed.push(name(sport));}
  }));
  if(combined.aborted)throw Error('Schedule retrieval interrupted');
  if(failed.length===sports.length)throw Error('Official schedules unavailable');
  const events=found.filter(e=>e.date>=start.date&&e.date<=end.date&&(e.date!==start.date||e.minute!==null&&e.minute>start.minute)&&(e.date!==end.date||e.minute===null||e.minute<=end.minute)).sort((a,b)=>a.date.localeCompare(b.date)||(a.minute??1440)-(b.minute??1440)||a.sport.localeCompare(b.sport));
  if(events.length>32)throw Error('Too many events for one agenda; choose a shorter date range');
  const visible=events,slugs=[...new Set(visible.map(e=>e.slug))];
  const sources=slugs.map(slug=>({id:slug,title:name(slug)+' · official schedule',url:'https://floridagators.com/sports/'+slug+'/schedule/text'}));
  if(!sources.length)for(const slug of checked.slice(0,8))sources.push({id:slug,title:name(slug)+' · official schedule',url:'https://floridagators.com/sports/'+slug+'/schedule/text'});
  const coverage=failed.length?'Unavailable schedules: '+failed.join(', ')+'. ':'';
  return {spec:{title:'Gators at home',query:flow.command().spec.steps[0].request,layout:'agenda'},summary:start.date+' – '+end.date+' · Gainesville · All UF sports · Eastern time',
    caveat:(coverage+(uncertain?'Some undated/multi-day or unlocated home rows need checking. ':'')+'Published schedules only. Confirm details before going.').slice(0,300),sources,
    cards:visible.length?visible.map(e=>({heading:(e.sport+' · '+e.opponent).slice(0,80),kicker:(e.dateLabel+' · '+e.time+' ET').slice(0,60),body:e.venue.slice(0,350),detail:'Admission not confirmed · Check official schedule',sourceIds:[e.slug]})):[{heading:'No verified upcoming home events',kicker:'Next 14 days · Gainesville',body:'No qualifying events found in the published schedules retrieved. This is not a guarantee that none exist.',detail:'Check the official schedules for updates.',sourceIds:sources.slice(0,4).map(s=>s.id)}]
  };
}
