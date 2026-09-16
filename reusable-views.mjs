import {randomUUID} from 'node:crypto';

const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);

// Shared durable repertoire for assembled experiences. Adapters are trusted app
// code: they validate configurations, including sandbox-only function recipes.
// Retention never executes generated code or replays actions.
export class ReusableViews {
  constructor(adapters){this.adapters=adapters;}
  retain(state,{kind,scope,spec,parentId=null},now=Date.now()){
    if(!Object.hasOwn(this.adapters,kind))throw Error('Unsupported reusable view kind');
    this.adapters[kind](spec);
    if(typeof scope!=='string'||!scope||scope.length>100)throw Error('Invalid view scope');
    const entries=state.reusableViews ||= [];
    const existing=entries.find(v=>v.kind===kind&&v.scope===scope&&canonical(v.spec)===canonical(spec));
    if(existing)return existing;
    if(entries.length>=64)return null; // Keep existing work; never silently evict it.
    if(parentId&&!entries.some(v=>v.id===parentId&&v.kind===kind))throw Error('Unknown parent view');
    const view={id:randomUUID(),version:1,kind,scope,spec:structuredClone(spec),parentId,createdAt:now};
    entries.push(view);return view;
  }
}

// Compatibility projection for the current weather UI and actions. The durable
// store itself is domain-neutral; new adapters must also implement fresh binding.
export function weatherViewIndex(state){
  state.weatherViews=(state.reusableViews||[]).filter(v=>v.kind==='weather').map(v=>({
    id:v.id,version:v.version,locationId:v.scope,spec:structuredClone(v.spec),createdAt:v.createdAt,parentId:v.parentId,
  }));
}
