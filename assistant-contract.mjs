export const capabilities = {
  available: ['get_time','show','start_timer','cancel_timer','add_todo','set_todo_done','remove_todo'],
  limitations: ['Timer alerts are visual only; no audible alarms.', 'No weather provider, calendar account, web research, music, camera, purchases, messages or background jobs are connected.', 'Home/back returns home, not navigation history.', 'Only the first five to-dos are shown on the mirror; the companion shows all items.'],
};
const str = (maxLength=300) => ({type:'string',minLength:1,maxLength});
const obj = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const actionSchema = {anyOf:[
  obj({action:{enum:['get_time']}}),
  obj({action:{enum:['show']},panel:{enum:['home','time','timers','todos','weather','calendar','tasks','saved']}}),
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
  if(!matches(decisionSchema,d))throw Error('Invalid assistant decision');
  if((d.status==='execute')!==!!d.actions.length)throw Error('Actions require execute status');
  if(d.status!=='clarify'&&d.options.length)throw Error('Options require clarification');
  if(new Set(d.options.map(o=>o.id)).size!==d.options.length)throw Error('Duplicate option IDs');
  return d;
}

export function presentation(state) {
  return {
    revision:state.revision, panel:state.panel,
    assistantCard:state.assistant&&state.assistant.status!=='execute'?{status:state.assistant.status,message:state.assistant.message,options:state.assistant.options}:null,
    mirror:{panel:state.panel,todos:state.panel==='todos'?state.todos.slice(0,5):[],timers:state.timers,clock:true,
      tasks:state.panel==='tasks'?state.tasks.slice(0,3):[],recipes:state.panel==='saved'?state.recipes.slice(0,3):[]},
    companion:{panel:state.panel,todos:state.panel==='todos'?state.todos:[],timers:state.panel==='timers'?state.timers:[],clock:true,
      tasks:state.panel==='tasks'?state.tasks:[],recipes:state.panel==='saved'?state.recipes:[],
      homeSummary:state.panel==='home'?{savedViews:state.recipes.length,requests:state.tasks.filter(t=>t.status!=='cancelled').length,backgroundResearch:false}:null},
    disconnectedPlaceholder:['weather','calendar'].includes(state.panel)?state.panel:null,
    clarification:state.assistant?.status==='clarify'?state.assistant:null,
  };
}

export class SurfaceRegistry {
  constructor(now=Date.now){this.now=now;this.clients=new Map();}
  report(body,state) {
    if(!body||!['mirror','companion'].includes(body.surface)||typeof body.clientId!=='string'||!/^[a-z0-9-]{1,80}$/i.test(body.clientId)||!Number.isInteger(body.revision)||body.revision<0||body.revision>state.revision||typeof body.visible!=='boolean')throw Error('Invalid surface report');
    this.prune();if(this.clients.size>=40&&!this.clients.has(body.clientId))throw Error('Too many surfaces');
    this.clients.set(body.clientId,{surface:body.surface,revision:body.revision,visible:body.visible,at:this.now()});
  }
  prune(){for(const [id,v] of this.clients)if(this.now()-v.at>15000)this.clients.delete(id);}
  snapshot(state){this.prune();return [...this.clients.values()].map(v=>({...v,current:v.revision===state.revision}));}
}
