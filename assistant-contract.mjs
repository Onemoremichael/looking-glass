import {quickActionSchema} from './quick-actions.mjs';
import {weatherView} from './weather.mjs';
import {weatherComponents,weatherRanges} from './weather-composition.mjs';
import {researchBoardSchema,researchView} from './research-board.mjs';
export const capabilities = {
  available: ['get_time','get_weather','compose_weather','open_weather_view','compose_research','open_research_view','research_page','save_current_view','resolve_view_offer','show','start_timer','cancel_timer','add_todo','set_todo_done','remove_todo'],
  limitations: ['Timer alerts are visual only; no audible alarms.', 'Weather is Open-Meteo model data for saved locations only; no radar, severe-weather alerts, or automatic IP location. Set up places/units in companion.', 'No calendar account, music, camera, purchases or messages are connected. Web research is read-only, on demand, and limited to six displayed cards; no autonomous scheduled research.', 'Home/back returns home, not navigation history.', 'Only the first five to-dos are shown on the mirror; the companion shows all items.'],
};
const str = (maxLength=300) => ({type:'string',minLength:1,maxLength});
const obj = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const weatherSpecSchema=obj({title:str(60),range:{enum:weatherRanges},startDate:{anyOf:[{type:'null'},str(10)]},endDate:{anyOf:[{type:'null'},str(10)]},focus:{enum:['general','rain','temperature']},components:{type:'array',items:{enum:weatherComponents},maxItems:3}});
export const actionSchema = {anyOf:[
  obj({action:{enum:['compose_research']},board:researchBoardSchema}),
  obj({action:{enum:['open_research_view']},viewId:str(100),refresh:{type:'boolean'}}),
  obj({action:{enum:['research_page']},direction:{enum:['next','previous']}}),
  obj({action:{enum:['get_time']}}),
  obj({action:{enum:['get_weather']},period:{enum:['now','today','tomorrow','week']},locationId:{anyOf:[{type:'null'},str(100)]}}),
  obj({action:{enum:['compose_weather']},locationId:{anyOf:[{type:'null'},str(100)]},spec:weatherSpecSchema}),
  obj({action:{enum:['open_weather_view']},viewId:str(100)}),
  obj({action:{enum:['resolve_view_offer']},offerId:str(100),choice:{enum:['save','discard']}}),
  obj({action:{enum:['save_current_view']}}),
  obj({action:{enum:['show']},panel:{enum:['home','time','timers','todos','weather','research','calendar','tasks','saved']}}),
  obj({action:{enum:['start_timer']},seconds:{type:'integer',minimum:1,maximum:86400},label:str(80)}),
  obj({action:{enum:['cancel_timer','remove_todo']},id:str(100)}),
  obj({action:{enum:['add_todo']},text:str()}),
  obj({action:{enum:['set_todo_done']},id:str(100),done:{type:'boolean'}}),
]};
export const decisionSchema = obj({
  status:{enum:['execute','clarify','unsupported','answer']},
  outcome:str(200), message:str(500),
  actions:{type:'array',items:actionSchema,maxItems:5},
  options:{type:'array',items:obj({id:str(60),label:str(100)}),maxItems:4},
  selectedOptionId:{anyOf:[{type:'null'},str(60)]},
});
// Provider output always includes a nomination; older local decisions remain valid.
export const plannerDecisionSchema={...decisionSchema,properties:{...decisionSchema.properties,quickAction:quickActionSchema},required:[...decisionSchema.required,'quickAction']};
// Validate this small schema subset locally as well as at the model boundary.
export function matches(schema,value) {
  if(schema.anyOf)return schema.anyOf.some(s=>matches(s,value));
  if(schema.enum&&!schema.enum.includes(value))return false;
  if(schema.type==='null')return value===null;
  if(schema.type==='boolean')return typeof value==='boolean';
  if(schema.type==='integer')return Number.isInteger(value)&&value>=schema.minimum&&value<=schema.maximum;
  if(schema.type==='string')return typeof value==='string'&&value.trim().length>=schema.minLength&&value.length<=schema.maxLength;
  if(schema.type==='array')return Array.isArray(value)&&value.length<=schema.maxItems&&value.every(v=>matches(schema.items,v));
  if(schema.type==='object')return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>Object.hasOwn(schema.properties,k))&&schema.required.every(k=>Object.hasOwn(value,k)&&matches(schema.properties[k],value[k]));
  return !!schema.enum;
}
export function validateDecision(d) {
  if(!matches(Object.hasOwn(d||{},'quickAction')?plannerDecisionSchema:decisionSchema,d))throw Error('Invalid assistant decision');
  if((d.status==='execute')!==!!d.actions.length)throw Error('Actions require execute status');
  if(d.status!=='clarify'&&d.options.length)throw Error('Options require clarification');
  if(new Set(d.options.map(o=>o.id)).size!==d.options.length)throw Error('Duplicate option IDs');
  return d;
}

export function presentation(state,now=Date.now()) {
  return {
    revision:state.revision, panel:state.panel,
    assistantCard:state.assistant&&state.assistant.status!=='execute'?{status:state.assistant.status,message:state.assistant.message,options:state.assistant.options}:null,
    mirror:{panel:state.panel,todos:state.panel==='todos'?state.todos.slice(0,5):[],timers:state.timers,clock:true,
      tasks:state.panel==='tasks'?state.tasks.slice(0,3):[],recipes:state.panel==='saved'?state.recipes.slice(0,3):[],weatherViews:state.panel==='saved'?(state.weatherViews||[]).slice(0,3):[]},
    companion:{panel:state.panel,todos:state.panel==='todos'?state.todos:[],timers:state.panel==='timers'?state.timers:[],clock:true,
      tasks:state.panel==='tasks'?state.tasks:[],recipes:state.panel==='saved'?state.recipes:[],
      weatherViews:state.panel==='saved'?(state.weatherViews||[]):[],homeSummary:state.panel==='home'?{savedViews:state.recipes.length+(state.weatherViews||[]).length,requests:state.tasks.filter(t=>t.status!=='cancelled').length,backgroundResearch:false}:null},
    weather:state.panel==='weather'?{...weatherView(state.weather,now),view:state.weather?.view||'now',composition:state.weather.composition||null}:null,
    research:state.panel==='research'?researchView(state,now):null,
    researchVisibleCardNumbers:state.panel==='research'&&state.research?state.research.cards.slice((state.research.page||0)*2,(state.research.page||0)*2+2).map((_,i)=>(state.research.page||0)*2+i+1):[],
    viewOffer:state.viewOffer||null,weatherViews:state.weatherViews||[],
    disconnectedPlaceholder:state.panel==='calendar'?'calendar':null,
    clarification:state.assistant?.status==='clarify'?state.assistant:null,
  };
}

export class SurfaceRegistry {
  constructor(now=Date.now){this.now=now;this.clients=new Map();this.waiters=new Set();}
  report(body,state) {
    if(!body||!['mirror','companion'].includes(body.surface)||typeof body.clientId!=='string'||!/^[a-z0-9-]{1,80}$/i.test(body.clientId)||!Number.isInteger(body.revision)||body.revision<0||body.revision>state.revision||typeof body.visible!=='boolean')throw Error('Invalid surface report');
    this.prune();if(this.clients.size>=40&&!this.clients.has(body.clientId))throw Error('Too many surfaces');
    this.clients.set(body.clientId,{surface:body.surface,revision:body.revision,visible:body.visible,at:this.now()});
    for(const check of this.waiters)check();
  }
  waitForRevision(revision,{signal,timeoutMs=1200}={}){
    return new Promise(resolve=>{
      const finish=value=>{clearTimeout(timer);this.waiters.delete(check);signal?.removeEventListener('abort',abort);resolve(value);};
      const check=()=>{if([...this.clients.values()].some(c=>c.visible&&c.revision>=revision&&this.now()-c.at<15000))finish(true);};
      const abort=()=>finish(false),timer=setTimeout(()=>finish(false),timeoutMs);
      this.waiters.add(check);signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();else check();
    });
  }
  prune(){for(const [id,v] of this.clients)if(this.now()-v.at>15000)this.clients.delete(id);}
  snapshot(state){this.prune();return [...this.clients.values()].map(v=>({...v,current:v.revision===state.revision}));}
}
