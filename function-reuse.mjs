import {createHash} from 'node:crypto';
import {framing} from './timer-intent.mjs';

// Learned routes contain literal tokens and typed slots, never generated regex
// or executable instructions. Promote only after an actual successful run.
export const FUNCTION_CONTEXT_MS=120000;
const small='zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const tens={twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const unsafe=/\b(?:don't|do not|not|never|unless|maybe|perhaps|instead|or|actually|wait|cancel|stop|then|also|before|after)\b/;
const own=(v,k)=>Object.hasOwn(v,k);
const bounded=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e9;
const label=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function wordsNumber(s){
  if(/^-?\d+(?:\.\d+)?$/.test(s))return Number(s);
  if(s.startsWith('minus ')){const n=wordsNumber(s.slice(6));return n===null?null:-n;}
  if(small.includes(s))return small.indexOf(s);
  const [a,b,...rest]=s.split(' ');
  if(tens[a]&&!rest.length&&(!b||small.indexOf(b)>0&&small.indexOf(b)<10))return tens[a]+(b?small.indexOf(b):0);
  return null;
}
function scalar(s,type){
  if(type==='number'){const n=wordsNumber(s);return bounded(n)?{value:n}:null;}
  if(type==='boolean')return /^(yes|true|no|false)$/.test(s)?{value:s==='yes'||s==='true'}:null;
  // Unquoted text needs semantic interpretation; do not swallow a whole command.
  const m=s.match(/^"([^"\n]{0,400})"$/);return m?{value:m[1]}:null;
}
function normalized(text){
  if(typeof text!=='string'||text.length>400)return null;
  const quoted=[...text.matchAll(/"[^"\n]*"/g)].map(m=>m[0]);let index=0;
  const s=framing(text).replace(/^(?:work out|figure out) /,'calculate ').replace(/"[^"\n]*"/g,()=>quoted[index++]);
  return s&&!unsafe.test(s.replace(/"[^"\n]*"/g,''))?s:null;
}
function tokens(text){
  const s=normalized(text);if(!s||!/^[a-z0-9 .,'?\-]+$/.test(s))return null;
  const words=s.split(/\s+/),out=[];
  for(let i=0;i<words.length;i++){
    let matched=false;
    for(let n=Math.min(3,words.length-i);n>0;n--){const value=wordsNumber(words.slice(i,i+n).join(' '));if(bounded(value)){out.push(value);i+=n-1;matched=true;break;}}
    if(!matched)out.push(words[i]);
  }
  return out;
}
export function functionFingerprint(spec){return createHash('sha256').update(JSON.stringify(spec)).digest('hex');}
export function promoteFunctionRoute(state,view,input,utterance,now){
  if(!view.spec.inputs.length||view.spec.inputs.some(i=>i.type!=='number'))return false;
  const t=tokens(utterance);if(!t||t.length>40||t.filter(x=>typeof x==='string').length<3||! /^(calculate|pack|plan|make|how|what|run|use|show)\b/.test(normalized(utterance)))return false;
  const numbers=t.filter(x=>typeof x==='number'),names=view.spec.inputs.map(i=>i.name);
  if(numbers.length!==names.length||new Set(numbers).size!==names.length||names.some(n=>!numbers.includes(input[n])))return false;
  const parts=t.map(x=>typeof x==='number'?{slot:names.find(n=>input[n]===x)}:{literal:x});
  const route={version:1,viewId:view.id,fingerprint:functionFingerprint(view.spec),parts,learnedAt:now};
  const entries=state.functionRoutes||[];
  if(entries.some(r=>r.viewId===route.viewId&&r.fingerprint===route.fingerprint&&JSON.stringify(r.parts)===JSON.stringify(parts)))return false;
  if(entries.length>=128)return false;
  state.functionRoutes=[...entries,route];return true;
}
function learned(text,state){
  const t=tokens(text);if(!t)return [];
  const matches=[];
  for(const r of (state.functionRoutes||[]).slice(0,128)){
    const v=(state.reusableViews||[]).find(v=>v.kind==='function'&&v.id===r.viewId);
    if(r.version!==1||!v||r.fingerprint!==functionFingerprint(v.spec)||!Array.isArray(r.parts)||r.parts.length!==t.length)continue;
    const input={};let ok=true;
    for(let i=0;i<t.length;i++){
      const p=r.parts[i];
      if(!p||typeof p!=='object'){ok=false;break;}
      if(own(p,'literal')){if(Object.keys(p).length!==1||p.literal!==t[i])ok=false;}
      else if(Object.keys(p).length===1&&own(p,'slot')&&v.spec.inputs.some(x=>x.name===p.slot&&x.type==='number')&&bounded(t[i])&&!own(input,p.slot))input[p.slot]=t[i];
      else ok=false;
    }
    if(ok&&v.spec.inputs.every(i=>own(input,i.name)))matches.push({action:'run_function',viewId:v.id,inputJSON:JSON.stringify(input)});
  }
  return matches;
}
function assignments(s,spec){
  const values={},parts=s.split(/\s*,\s*|\s+and\s+/);
  for(const part of parts){
    const candidates=[];
    for(const i of spec.inputs){
      const aliases=[...new Set([label(i.name),label(i.label)])].filter(Boolean);
      for(const a of aliases){
        const start=a+' ';if(!part.startsWith(start))continue;
        const parsed=scalar(part.slice(start.length).replace(/^(?:is|at|of|equals) /,''),i.type);
        if(parsed)candidates.push({name:i.name,...parsed});
      }
    }
    const unique=[...new Map(candidates.map(c=>[c.name, c])).values()];
    if(unique.length!==1||own(values,unique[0].name))return null;
    values[unique[0].name]=unique[0].value;
  }
  return values;
}
function bind(s,spec,missing){
  if(missing.length===1){const parsed=scalar(s,missing[0].type);if(parsed)return {[missing[0].name]:parsed.value};}
  return assignments(s,spec);
}
function actionFor(view,values){
  return {action:view.spec.inputs.every(i=>own(values,i.name))?'run_function':'prepare_function',viewId:view.id,inputJSON:JSON.stringify(values)};
}
export function analyzeFunctionReuse(text,state,now=Date.now(),{learned:allowLearned=true}={}){
  const reject=reason=>({action:null,reason});
  if(state.playroom||state.assistant?.status==='clarify')return reject('pending_clarification');
  const s=normalized(text);if(!s)return reject('unsupported_wording');
  const routes=allowLearned?learned(text,state):[],distinct=[...new Map(routes.map(a=>[a.viewId+'|'+a.inputJSON,a])).values()];
  if(distinct.length>1)return reject('ambiguous_target');
  if(distinct.length===1)return {action:distinct[0],source:'learned',reason:'matched'};
  const library=(state.reusableViews||[]).filter(v=>v.kind==='function');
  // An explicitly named function starts with fresh values, never prior inputs.
  const command=s.match(/^(?:open|show|run|use|calculate)(?: me)? (?:my |the )?(.+)$/);
  if(command){
    const candidates=[];
    for(const view of library){
      const title=view.spec.title.toLowerCase();
      for(const name of [title,title+' function']){
        if(command[1]===name)candidates.push({view,rest:null});
        for(const separator of [' with ',' for '])if(command[1].startsWith(name+separator))candidates.push({view,rest:command[1].slice(name.length+separator.length)});
      }
    }
    if(candidates.length>1)return reject('ambiguous_target');
    if(candidates.length===1){
      const {view,rest}=candidates[0];if(rest===null)return {action:{action:'open_function',viewId:view.id},source:'builtin',reason:'matched'};
      const values=bind(rest,view.spec,view.spec.inputs);if(values)return {action:actionFor(view,values),source:'builtin',reason:'matched'};
      return reject('unsupported_wording');
    }
  }
  const current=state.customView,view=library.find(v=>v.id===current?.functionId);
  if(state.panel!=='functions'||!current||!view||current.interactionRevision!==state.revision||now<current.createdAt||now-current.createdAt>FUNCTION_CONTEXT_MS||functionFingerprint(view.spec)!==functionFingerprint(current.spec))return reject('stale_context');
  if(current.output&&/^(next|previous)( page)?$/.test(s))return {action:{action:'function_page',direction:s.startsWith('next')?'next':'previous'},source:'builtin',reason:'matched'};
  const previous=current.input||{},missing=view.spec.inputs.filter(i=>!own(previous,i.name));
  const followup=s.match(/^(?:what about|how about|try|make it|make that|what if|with|for) (.+)$/);
  // Bare scalar answers are valid only while a focused input question is active.
  if(!followup&&current.output)return reject('unsupported_wording');
  const values=bind(followup?followup[1]:s,view.spec,!current.output?missing.slice(0,1):view.spec.inputs);
  if(!values)return reject('unsupported_wording');
  return {action:actionFor(view,{...previous,...values}),source:'builtin',reason:'matched'};
}
