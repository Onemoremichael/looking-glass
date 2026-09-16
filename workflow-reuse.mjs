import {createHash} from 'node:crypto';
import {functionInput,validateFunctionSpec} from './custom-functions.mjs';

const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');

// Compile only explicit, typed workflow inputs into a verified pure function.
// Never replay a previous result, inferred literal, to-do mutation or provider job.
function context(run,index){
  return hash({spec:run.spec,index,prior:run.steps.slice(0,index).map(s=>({
    request:s.request,reply:s.reply,status:s.status,
    evidence:s.kind==='custom'&&s.evidence?.functionOutput?{output:s.evidence.functionOutput}:
      s.kind==='confirm'?{confirmation:s.evidence?.confirmation}:s.evidence,
  }))});
}
function inputs(run,index,spec){
  if(!spec.inputs.length||run.steps[index].reply)return null;
  const values=new Map(run.values.map(v=>[v.name,v.value])),input={};
  for(const field of spec.inputs){
    // Matching names and an explicit placeholder are required. No guessing that
    // an arbitrary number in a generated action is the person's new input.
    if(!values.has(field.name)||!run.spec.steps[index].request.includes('{{'+field.name+'}}'))return null;
    const raw=values.get(field.name);
    if(field.type==='number'){
      if(!/^-?(?:\d+\.?\d*|\.\d+)$/.test(raw.trim()))return null;
      input[field.name]=Number(raw);
    }else if(field.type==='boolean'){
      if(!/^(true|false)$/.test(raw))return null;
      input[field.name]=raw==='true';
    }else input[field.name]=raw;
  }
  // Unbound workflow inputs may have influenced the generated calculation.
  // Pin their values; only the fields explicitly passed to the function vary.
  return {input:functionInput(spec,JSON.stringify(input)),fixed:run.values.filter(v=>!spec.inputs.some(i=>i.name===v.name)).sort((a,b)=>a.name.localeCompare(b.name))};
}
export function learnWorkflowExecutor(run,index,state){
  try{
    const step=run.steps[index],receipt=step.receipt;
    if(step.kind!=='custom'||!receipt?.functionVerified||!receipt.workflowFunction)return null;
    const action=receipt.workflowFunction,source=state.reusableViews.find(v=>v.kind==='function'&&v.id===action.viewId);
    if(!source)return null;
    validateFunctionSpec(source.spec);
    const bound=inputs(run,index,source.spec);
    if(!bound||canonical(bound.input)!==canonical(JSON.parse(action.inputJSON)))return null;
    return {version:1,index,context:context(run,index),viewId:source.id,specHash:hash(source.spec),fixed:bound.fixed};
  }catch{return null;}
}
export function workflowExecutor(run,index,state){
  try{
    if(run.steps[index]?.kind!=='custom')return null;
    const recipe=state.reusableViews.find(v=>v.kind==='workflow'&&v.id===run.recipeId);
    for(const route of recipe?.executors||[]){
      if(route.version!==1||route.index!==index||route.context!==context(run,index))continue;
      const source=state.reusableViews.find(v=>v.kind==='function'&&v.id===route.viewId);
      if(!source||hash(source.spec)!==route.specHash)continue;
      validateFunctionSpec(source.spec);
      const bound=inputs(run,index,source.spec);
      if(bound&&canonical(bound.fixed)===canonical(route.fixed))return {action:'run_function',viewId:source.id,inputJSON:JSON.stringify(bound.input)};
    }
  }catch{}
  return null;
}
