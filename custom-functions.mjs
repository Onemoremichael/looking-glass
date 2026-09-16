import {Worker} from 'node:worker_threads';
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {analyzeFunctionReuse,promoteFunctionRoute} from './function-reuse.mjs';

const str=n=>({type:'string',minLength:1,maxLength:n});
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const key=str(32);
export const functionSpecSchema=obj({
  title:str(60),outcome:str(240),
  inputs:{type:'array',maxItems:6,items:obj({name:key,label:str(60),type:{enum:['number','text','boolean']}})},
  code:str(6000),
  tests:{type:'array',minItems:2,maxItems:5,items:obj({inputJSON:str(4000),expectedJSON:str(6000)})},
  layout:obj({accent:{enum:['mint','sky','peach']},blocks:{type:'array',minItems:1,maxItems:4,items:{anyOf:[
    obj({kind:{enum:['metric']},label:str(60),key,unit:{type:'string',minLength:0,maxLength:20}}),
    obj({kind:{enum:['list','bars','note']},label:str(60),key}),
  ]}}}),
});
const validKey=k=>typeof k==='string'&&/^[a-z][a-zA-Z0-9_]{0,31}$/.test(k)&&!['constructor','prototype','__proto__'].includes(k);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v,n,empty=false)=>typeof v==='string'&&(empty||v.trim().length>0)&&v.length<=n;
const number=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e9;
export class FunctionCheckError extends Error{
  constructor(message,diagnostic){super(message);this.code='function_check_failed';this.diagnostic=diagnostic;}
}
function parse(text,limit){if(typeof text!=='string'||Buffer.byteLength(text)>limit)throw Error('Function JSON exceeds limit');try{return JSON.parse(text);}catch{throw Error('Invalid function JSON');}}
export function validateFunctionSpec(s){
  if(!exact(s,['title','outcome','inputs','code','tests','layout'])||!text(s.title,60)||!text(s.outcome,240)||!text(s.code,6000)||!Array.isArray(s.inputs)||s.inputs.length>6||!Array.isArray(s.tests)||s.tests.length<2||s.tests.length>5)throw Error('Invalid function specification');
  const names=new Set();for(const i of s.inputs){if(!exact(i,['name','label','type'])||!validKey(i.name)||names.has(i.name)||!text(i.label,60)||!['number','text','boolean'].includes(i.type))throw Error('Invalid function input definition');names.add(i.name);}
  if(!exact(s.layout,['accent','blocks'])||!['mint','sky','peach'].includes(s.layout.accent)||!Array.isArray(s.layout.blocks)||!s.layout.blocks.length||s.layout.blocks.length>4)throw Error('Invalid function layout');
  for(const b of s.layout.blocks)if(!exact(b,b.kind==='metric'?['kind','label','key','unit']:['kind','label','key'])||!['metric','list','bars','note'].includes(b.kind)||!text(b.label,60)||!validKey(b.key)||(b.kind==='metric'&&!text(b.unit,20,true)))throw Error('Invalid function component');
  const examples=new Set();
  for(const t of s.tests){if(!exact(t,['inputJSON','expectedJSON']))throw Error('Invalid function test');const input=functionInput(s,t.inputJSON);const expected=parse(t.expectedJSON,12000);validateFunctionOutput(expected,s.layout);examples.add(JSON.stringify(s.inputs.map(i=>input[i.name])));}
  if(s.inputs.length&&examples.size<2)throw Error('Use at least two distinct example inputs');
  return s;
}
export function functionInput(spec,json){
  const input=parse(json,8000);if(!exact(input,spec.inputs.map(i=>i.name)))throw Error('Provide exactly the named function inputs');
  for(const i of spec.inputs)if(i.type==='number'?!number(input[i.name]):i.type==='boolean'?typeof input[i.name]!=='boolean':!text(input[i.name],400,true))throw Error('Invalid value for function input '+i.name);
  return input;
}
export function validateFunctionOutput(output,layout){
  if(!output||typeof output!=='object'||Array.isArray(output)||Object.keys(output).length>12||!Object.keys(output).length)throw Error('Function must return a bounded object');
  for(const [key,v] of Object.entries(output)){
    if(!validKey(key))throw Error('Invalid function output key');
    if(number(v)||text(v,500,true))continue;
    if(Array.isArray(v)&&v.length<=8&&v.every(x=>text(x,120)||exact(x,['label','value'])&&text(x.label,60)&&number(x.value)))continue;
    throw Error('Unsupported function output value');
  }
  for(const b of layout.blocks){const v=output[b.key];if(!Object.hasOwn(output,b.key)||(b.kind==='metric'&&!(number(v)||text(v,40)))||(b.kind==='note'&&!text(v,500))||(b.kind==='list'&&!(Array.isArray(v)&&v.every(x=>text(x,120))))||(b.kind==='bars'&&!(Array.isArray(v)&&v.length&&v.every(x=>exact(x,['label','value'])&&text(x.label,60)&&number(x.value)))))throw Error('Function output does not match its layout');}
  return output;
}
export function evaluateFunction(code,inputs,{signal,timeoutMs=2500}={}){
  if(signal?.aborted)return Promise.reject(Error('Function cancelled'));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./function-worker.mjs',import.meta.url),{workerData:{code,inputs},env:{},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate().catch(()=>{});error?reject(error):resolve(value);};
    const abort=()=>finish(Error('Function cancelled'));
    const timer=setTimeout(()=>finish(Error('Function exceeded its execution limit')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    worker.on('message',m=>m?.ok&&Array.isArray(m.results)?finish(null,m.results):finish(new FunctionCheckError('Function sandbox rejected execution',{check:'runtime_rejected'})));
    worker.on('error',()=>finish(Error('Function sandbox failed')));
    worker.on('exit',()=>finish(Error('Function sandbox stopped before completion')));
  });
}
export function functionIntent(utterance,state){
  return analyzeFunctionReuse(utterance,state).action;
}
export class CustomFunctions{
  constructor({session,telemetry,evaluate=evaluateFunction}){Object.assign(this,{session,telemetry,evaluate});this.active=null;this.closed=false;}
  async handle(requestId,action,{revision=this.session.state.revision,signal,utterance=''}={}){
    if(this.closed||this.session.state.playroom)throw Error('Functions are unavailable in this mode');
    if(typeof requestId!=='string'||!requestId||requestId.length>300)throw Error('Invalid function operation ID');
    const prior=(this.session.state.assistantReceipts||[]).find(r=>r.id===requestId);if(prior)return prior.result;
    if(this.active)throw Error('A function is already being checked');
    if(revision!==this.session.state.revision)throw Error('Display changed while deciding');
    if(!['create_function','run_function','open_function','prepare_function','function_page'].includes(action.action))throw Error('Unknown function action');
    const source=action.action==='create_function'?null:(this.session.state.reusableViews||[]).find(v=>v.kind==='function'&&v.id===action.viewId);
    if(action.action!=='create_function'&&action.action!=='function_page'&&!source)throw Error('Saved function not found');
    const spec=action.action==='function_page'?null:structuredClone(source?.spec||action.spec);if(spec)validateFunctionSpec(spec);
    const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const active=this.active={controller};
    let span;try{span=this.telemetry?.start('function.execute',{});}catch{}
    const work=(async()=>{
      let output,input;
      if(action.action==='prepare_function'){
        const partial=parse(action.inputJSON,8000);
        if(!partial||typeof partial!=='object'||Array.isArray(partial)||Object.keys(partial).some(k=>!spec.inputs.some(i=>i.name===k)))throw Error('Unknown function input');
        input=functionInput({...spec,inputs:spec.inputs.filter(i=>Object.hasOwn(partial,i.name))},action.inputJSON);
        if(Object.keys(input).length===spec.inputs.length)throw Error('Complete inputs must execute the function');
      }
      if(['create_function','run_function'].includes(action.action)){
        input=functionInput(spec,action.inputJSON);
        const cases=spec.tests.map(t=>functionInput(spec,t.inputJSON));
        const results=await this.evaluate(spec.code,[...cases,input,input],{signal:controller.signal});
        if(results.length!==cases.length+2)throw Error('Function returned incomplete test results');
        for(let i=0;i<results.length;i++)try{validateFunctionOutput(results[i],spec.layout);}catch{
          throw new FunctionCheckError('Function output does not match its layout',{check:'output_contract',caseIndex:i<cases.length?i:null});
        }
        for(let i=0;i<cases.length;i++)if(!isDeepStrictEqual(results[i],parse(spec.tests[i].expectedJSON,12000)))throw new FunctionCheckError('Function example test failed',{check:'example_mismatch',caseIndex:i,actual:structuredClone(results[i])});
        if(!isDeepStrictEqual(results.at(-1),results.at(-2)))throw Error('Function result was not repeatable');
        output=results.at(-1);
      }
      if(controller.signal.aborted)throw Error('Function cancelled');
      if(this.session.state.revision!==revision)throw Error('Display changed while checking function');
      const before=structuredClone(this.session.state),s=this.session.state;let result;
      try{
        let saved=source;
        if(action.action==='create_function'){
          saved=this.session.repertoire.retain(s,{kind:'function',scope:'pure-js-v1',spec,parentId:action.parentId},this.session.now());
          if(!saved)throw Error('Reusable library is full; function not saved');
        }
        if(action.action==='function_page'){
          if(s.panel!=='functions'||!s.customView?.output||!['next','previous'].includes(action.direction))throw Error('No function pages are active');
          const last=Math.ceil(s.customView.spec.layout.blocks.length/2)-1;
          s.customView.page=Math.max(0,Math.min(last,s.customView.page+(action.direction==='next'?1:-1)));
          s.customView.interactionRevision=s.revision+1;s.customView.createdAt=this.session.now();
          result={status:'completed',action:'assistant',message:'Function page '+(s.customView.page+1)+' of '+(last+1)+'.',executedActions:['function_page']};
        }else{
          const missing=spec.inputs.filter(i=>!input||!Object.hasOwn(input,i.name));
          const question=missing.length?(/\?$/.test(missing[0].label.trim())?missing[0].label:'What should I use for '+missing[0].label+'?'):'Ready to calculate.';
          s.customView={id:randomUUID(),functionId:saved.id,spec,input:input||null,output:output||null,question:output?null:question,page:0,createdAt:this.session.now(),interactionRevision:s.revision+1,sourceHash:createHash('sha256').update(spec.code).digest('hex'),testsPassed:output?spec.tests.length:0};
          const promoted=output&&this.session.learnQuickActions&&promoteFunctionRoute(s,saved,input,utterance,this.session.now());
          result={status:output?'completed':'needs_input',action:'assistant',functionId:saved.id,compositionId:s.customView.id,executedActions:output?[action.action]:[],functionVerified:!!output,functionOutput:output||null,routePromoted:!!promoted,message:output?'Calculated using '+spec.inputs.map(i=>i.label+': '+JSON.stringify(input[i.name])).join(', ')+'. '+spec.layout.blocks.map(b=>b.label+': '+JSON.stringify(output[b.key])).join('. ').slice(0,800)+'. The recipe is saved; example tests passed, not independent correctness certification.':question};
        }
        s.panel='functions';s.assistant=null;s.viewOffer=null;s.message='';
        s.assistantHistory=[...(s.assistantHistory||[]),{user:utterance,assistant:result.message,outcome:spec?.outcome||'View result',status:result.status==='needs_input'?'clarify':'execute'}].slice(-8);
        for(const r of s.workflows||[])for(const step of r.steps)if(step.operationId===requestId){
          step.receipt=structuredClone(result);
          if(output)step.receipt.workflowFunction={action:'run_function',viewId:saved.id,inputJSON:JSON.stringify(input)};
        }
        s.assistantReceipts=[...(s.assistantReceipts||[]),{id:requestId,result}].slice(-500);s.revision++;this.session.save();
      }catch(e){this.session.state=before;throw e;}
      this.session.onChange(s);return result;
    })();active.promise=work;
    try{const result=await work;try{span?.end({outcome:'completed'});}catch{}return result;}
    catch(e){try{span?.end({outcome:controller.signal.aborted?'cancelled':'error'});}catch{}throw e;}
    finally{signal?.removeEventListener('abort',abort);if(this.active===active)this.active=null;}
  }
  async close(){this.closed=true;if(this.active){this.active.controller.abort();await this.active.promise.catch(()=>{});}}
}
