import {randomUUID} from 'node:crypto';
import {learnWorkflowExecutor,workflowExecutor} from './workflow-reuse.mjs';

const str=n=>({type:'string',minLength:1,maxLength:n});
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const workflowValuesSchema={type:'array',maxItems:4,items:obj({name:str(24),value:str(200)})};
export const workflowSpecSchema=obj({title:str(80),outcome:str(300),inputs:{type:'array',maxItems:4,items:obj({name:str(24),question:str(160)})},steps:{type:'array',maxItems:8,items:obj({title:str(80),kind:{enum:['research','weather','todos','artwork','confirm','custom']},request:str(600)})}});
function exact(v,keys){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function text(v,n){return typeof v==='string'&&v.trim().length>0&&v.length<=n;}
export function validateWorkflowSpec(s){
  if(!exact(s,['title','outcome','inputs','steps'])||!text(s.title,80)||!text(s.outcome,300)||!Array.isArray(s.inputs)||s.inputs.length>4||!Array.isArray(s.steps)||!s.steps.length||s.steps.length>8)throw Error('Invalid workflow plan');
  const names=new Set();
  for(const i of s.inputs){if(!exact(i,['name','question'])||!text(i.name,24)||!/^[a-z][a-z0-9_]*$/.test(i.name)||names.has(i.name)||!text(i.question,160))throw Error('Invalid workflow input');names.add(i.name);}
  for(const step of s.steps)if(!exact(step,['title','kind','request'])||!text(step.title,80)||!text(step.request,600)||!['research','weather','todos','artwork','confirm','custom'].includes(step.kind))throw Error('Invalid workflow step');
  for(const value of [s.title,s.outcome,...s.steps.flatMap(x=>[x.title,x.request])]){
    for(const m of value.matchAll(/\{\{([^{}]+)\}\}/g))if(!names.has(m[1]))throw Error('Unknown workflow placeholder');
    if(/[{}]/.test(value.replace(/\{\{[a-z][a-z0-9_]*\}\}/g,'')))throw Error('Use named workflow placeholders, not code');
  }
  return s;
}
export function bindWorkflow(spec,values){
  validateWorkflowSpec(spec);
  if(!Array.isArray(values)||values.length>4)throw Error('Invalid workflow values');
  const map=new Map();
  for(const v of values){if(!exact(v,['name','value'])||!spec.inputs.some(i=>i.name===v.name)||map.has(v.name)||!text(v.value,200)||/[{}]/.test(v.value))throw Error('Invalid workflow value');map.set(v.name,v.value);}
  const missing=spec.inputs.filter(i=>!map.has(i.name));
  const bind=s=>s.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g,(all,key)=>map.get(key)||all);
  return {missing,title:bind(spec.title),outcome:bind(spec.outcome),steps:spec.steps.map(s=>({...s,title:bind(s.title),request:bind(s.request)}))};
}
export function workflowView(state){return (state.workflows||[]).find(r=>r.id===state.workflowId)||null;}
export function workflowIntent(text,state){
  const phrase=String(text).toLowerCase().replace(/[.!?]/g,'').trim(),run=workflowView(state);
  if(run&&state.panel==='workflows'){
    if(/^(?:show|open)(?: me)? (?:the |my )?(?:plan|progress)$/.test(phrase))return {action:'open_workflow',runId:run.id};
    if(/^(?:pause|stop) (?:the |this )?(?:plan|workflow)$/.test(phrase))return {action:'pause_workflow',runId:run.id};
    if(/^(?:resume|continue) (?:the |this |my )?(?:plan|workflow)$/.test(phrase))return {action:'continue_workflow',runId:run.id,reply:null};
  }
  const match=phrase.match(/^(?:show|open)(?: me)? (?:my |the )?(.+?) (?:plan|workflow)$/);
  if(match){const runs=(state.workflows||[]).filter(r=>r.title.toLowerCase()===match[1]);if(runs.length===1)return {action:'open_workflow',runId:runs[0].id};}
  const rerun=phrase.match(/^(?:run|start) (?:the |my )?(.+?)(?: again)?$/);
  if(rerun){const views=(state.reusableViews||[]).filter(v=>v.kind==='workflow'&&v.spec.title.toLowerCase()===rerun[1]);if(views.length===1)return {action:'reuse_workflow',viewId:views[0].id,values:[]};}
  return null;
}
const permitted={research:['compose_research','open_research_view'],weather:['get_weather','compose_weather','open_weather_view'],todos:['add_todo'],artwork:['generate_image','open_image'],custom:['create_function','run_function']};
async function waitForJob(promise,signal){
  let abort;const stopped=new Promise(resolve=>{abort=()=>resolve();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)resolve();});
  try{await Promise.race([promise,stopped]);}finally{signal.removeEventListener('abort',abort);}
}
export function guardWorkflowDecision(kind,decision){
  if(decision.status!=='execute')return;
  if(!decision.actions.length||decision.actions.some(a=>!permitted[kind]?.includes(a.action)))throw Error('Step proposed an action outside its scope');
  if(kind!=='todos'&&decision.actions.length!==1)throw Error('One artifact per workflow step');
}

// Local plans and receipts own progress; cloud turns are disposable. No executable
// code, schedule, or external mutation is hidden inside a saved workflow recipe.
export class Workflows {
  constructor({session,assistant,studio,telemetry}){
    Object.assign(this,{session,assistant,studio,telemetry});this.active=null;this.closed=false;
    if((session.state.workflows||[]).some(r=>r.status==='running'))this.edit(s=>{
      for(const r of s.workflows)if(r.status==='running'){r.status='paused';r.detail='Server restarted. Resume explicitly; completed steps will not replay.';}
    });
  }
  edit(fn){const before=structuredClone(this.session.state);try{fn(this.session.state);this.session.state.revision++;this.session.save();}catch(e){this.session.state=before;throw e;}this.session.onChange(this.session.state);}
  get(id){const r=(this.session.state.workflows||[]).find(r=>r.id===id);if(!r)throw Error('Workflow not found');return r;}
  update(id,fn){this.edit(s=>fn(s.workflows.find(r=>r.id===id)));}
  handle(requestId,action,{revision=this.session.state.revision,utterance='',resolvedSelection=null}={}){
    if(this.closed||this.session.state.playroom)throw Error('Workflows are unavailable in this mode');
    if(typeof requestId!=='string'||!requestId||requestId.length>300)throw Error('Invalid workflow operation ID');
    const replay=(this.session.state.workflowReceipts||[]).find(r=>r.id===requestId);if(replay)return replay.result;
    if(revision!==this.session.state.revision)throw Error('Display changed while deciding');
    let runId=action.runId,start=false,abort=false,result;
    this.edit(s=>{
      if(['create_workflow','reuse_workflow'].includes(action.action)){
        if(this.active)throw Error('Pause the active workflow before starting another');
        const source=action.action==='reuse_workflow'?(s.reusableViews||[]).find(v=>v.id===action.viewId&&v.kind==='workflow'):null;
        if(action.action==='reuse_workflow'&&!source)throw Error('Saved workflow not found');
        const spec=structuredClone(source?.spec||action.spec),bound=bindWorkflow(spec,action.values);
        if((s.workflows||[]).length>=32)throw Error('Workflow library is full');
        const saved=this.session.repertoire.retain(s,{kind:'workflow',scope:'local',spec,parentId:action.parentId||null},this.session.now());
        if(!saved)throw Error('Reusable library is full; plan was not started');
        runId=randomUUID();const r={id:runId,recipeId:saved.id,spec,values:action.values,title:bound.title,outcome:bound.outcome,createdAt:this.session.now(),status:bound.missing.length?'needs_input':'paused',detail:bound.missing[0]?.question||'Plan saved. Starting the first step.',inputQuestions:bound.missing,steps:bound.steps.map(step=>({...step,id:randomUUID(),status:'pending',attempt:0,reply:null,evidence:null}))};
        s.workflows=[...(s.workflows||[]),r];start=!bound.missing.length;
      }else{
        const r=this.get(runId),step=r.steps.find(x=>x.status!=='completed');
        if(action.action==='open_workflow'){}else if(action.action==='pause_workflow'||action.action==='cancel_workflow'){
          if(['completed','cancelled'].includes(r.status))throw Error('Workflow is already finished');
          r.status=action.action==='cancel_workflow'?'cancelled':'paused';r.detail=r.status==='cancelled'?'Cancelled. Existing results and list items were kept.':'Paused. Completed steps and answers are saved.';if(step?.status==='running')step.status=r.status;abort=this.active?.id===runId;
        }else if(action.action==='provide_workflow_inputs'){
          if(['completed','cancelled','running'].includes(r.status))throw Error('Workflow is not waiting for inputs');
          if(!r.inputQuestions.length)throw Error('No workflow inputs are pending');
          const values=[...r.values.filter(v=>!action.values.some(n=>n.name===v.name)),...action.values],bound=bindWorkflow(r.spec,values);
          r.values=values;r.title=bound.title;r.outcome=bound.outcome;r.inputQuestions=bound.missing;r.detail=bound.missing[0]?.question||'Inputs saved.';
          r.steps.forEach((step,i)=>Object.assign(step,bound.steps[i]));start=!bound.missing.length;
        }else if(action.action==='continue_workflow'||action.action==='confirm_workflow_step'){
          if(['completed','cancelled','running'].includes(r.status))throw Error('Workflow is not waiting to resume');
          if(r.inputQuestions.length)throw Error(r.inputQuestions[0].question);
          if(action.action==='confirm_workflow_step'){
            if(!step||step.id!==action.stepId||step.kind!=='confirm'||step.status!=='needs_input'||!utterance.trim())throw Error('No matching human step awaiting confirmation');
            step.status='completed';step.evidence={type:'user_confirmation',at:this.session.now(),confirmation:utterance.slice(0,600)};
          }else if(step?.status==='needs_input'&&step.kind!=='confirm'){
            if(!text(action.reply,600))throw Error(step.detail||'Please answer the pending question');
            if(resolvedSelection&&!step.options?.some(o=>o.id===resolvedSelection.id&&o.label===resolvedSelection.label))throw Error('Workflow choice changed');
            step.reply=resolvedSelection?.label||action.reply;step.operationId=null;step.receipt=null;step.status='pending';
          }else if(step?.status==='blocked'){
            // Explicit retry may re-fetch failed/partial work. Never discard a
            // successful committed mutation whose progress write was interrupted.
            const committed=step.receipt?.executedActions?.length&&step.receipt.weatherAvailable!==false;
            if(!committed){step.operationId=null;step.receipt=null;}
            if(text(action.reply,600))step.reply=action.reply;
          }
          start=true;
        }else throw Error('Unknown workflow action');
        if(start&&this.active)throw Error('Another workflow is already running');
      }
      s.workflowId=runId;s.panel='workflows';s.assistant=null;s.message='';
      const r=this.get(runId);
      result={status:'completed',action:'assistant',runId,message:start?'Plan saved. I’m working through it now; progress will stay available after this conversation. This confirms the start, not completion.':r.detail};
      s.workflowReceipts=[...(s.workflowReceipts||[]),{id:requestId,result}].slice(-500);
    });
    if(abort){const active=this.active;active.controller.abort();if(active.ownedImageId)this.studio.cancel(active.ownedImageId);}
    if(start)this.start(runId);
    return result;
  }
  start(id){
    const active=this.active={id,controller:new AbortController()};
    try{active.trace=this.telemetry?.start('workflow.run',{step_count:this.get(id).steps.length});}catch{}
    active.promise=Promise.resolve().then(()=>this.run(active)).catch(()=>{
      if(!active.controller.signal.aborted)this.update(id,r=>{r.status='blocked';r.detail='Work stopped before completion. Review the current step, then resume explicitly.';const step=r.steps.find(s=>s.status!=='completed');if(step){step.status='blocked';step.detail=r.detail;}});
    }).finally(()=>{
      const status=this.get(id).status;
      try{active.trace?.end({outcome:active.controller.signal.aborted?'cancelled':status==='completed'?'completed':status==='needs_input'?'needs_input':'error'});}catch{}
      if(this.active===active)this.active=null;
    });
    // Keep rejected disk failures observable to callers without unhandled rejection.
    active.promise.catch(()=>{});
  }
  async run(active){
    const {id,controller:{signal}}=active;
    if(signal.aborted)return;
    this.update(id,r=>{r.status='running';r.detail='Working through the plan.';});
    while(!signal.aborted){
      const run=this.get(id),step=run.steps.find(s=>s.status!=='completed');
      if(!step){this.update(id,r=>{r.status='completed';r.detail='All steps have completion evidence. The plan is saved for a fresh run.';r.completedAt=this.session.now();});return;}
      if(step.kind==='confirm'||step.kind==='custom'&&!this.assistant?.functions){
        this.update(id,r=>{const s=r.steps.find(s=>s.id===step.id);s.status=s.kind==='confirm'?'needs_input':'blocked';s.detail=s.kind==='confirm'?s.request:'This needs a capability that is not implemented. I can help define the missing function and UX; I cannot execute arbitrary code yet.';r.status=s.status;r.detail=s.detail;});return;
      }
      if(!this.assistant)throw Error('Planner unavailable');
      if(step.attempt>=12)throw Error('Step attempt limit reached');
      this.update(id,r=>{const s=r.steps.find(s=>s.id===step.id);s.status='running';s.operationId ||= 'workflow-'+randomUUID();s.attempt++;r.detail='Working on '+s.title+'.';});
      const current=structuredClone(this.get(id)),item=current.steps.find(s=>s.id===step.id);
      const existingJob=(this.session.state.imageJobs||[]).find(j=>j.requestId===item.operationId);
      const executor=this.session.learnQuickActions&&this.assistant.functions?workflowExecutor(current,current.steps.findIndex(s=>s.id===item.id),this.session.state):null;
      let reuseTrace;
      if(executor&&!item.receipt&&!existingJob)try{reuseTrace=this.telemetry?.start('workflow.step_reuse',{source:'learned'},active.trace);}catch{}
      let result;
      try{result=item.receipt||(existingJob?{jobId:existingJob.id,status:'completed'}:executor?await this.assistant.functions.handle(item.operationId,executor,{signal,utterance:item.request}):await this.assistant.execute(item.operationId,item.reply||item.request,{
        signal,trace:active.trace,workflowContext:{outcome:current.outcome,steps:current.steps,currentStepId:item.id,inputs:current.values},
        guardDecision:d=>guardWorkflowDecision(item.kind,d),
      }));reuseTrace?.end({outcome:result.status});}
      catch(error){reuseTrace?.end({outcome:signal.aborted?'cancelled':'error'});throw error;}
      if(signal.aborted)return;
      let evidence;
      if(result.jobId){
        const job=(this.session.state.imageJobs||[]).find(j=>j.id===result.jobId);
        if(job?.requestId===item.operationId)active.ownedImageId=job.id;
        this.update(id,r=>{const s=r.steps.find(s=>s.id===item.id);s.jobId=result.jobId;s.detail='Artwork is being prepared; accepting a job is not completion.';});
        if(this.studio.active?.id===result.jobId)await waitForJob(this.studio.active.promise,signal);
        if(signal.aborted)return;
        const finished=(this.session.state.imageJobs||[]).find(j=>j.id===result.jobId);
        if(finished?.status==='completed')evidence={type:'artwork',jobId:finished.id,at:this.session.now()};
      }else if(result.status==='completed'&&result.executedActions?.length){
        guardWorkflowDecision(item.kind,{status:'execute',actions:result.executedActions.map(action=>({action}))});
        evidence={type:'tool_receipt',operationId:item.operationId,actions:result.executedActions,artifact:result.compositionId||null,research:result.researchArtifact||null,todoIds:result.createdTodoIds||[],at:this.session.now(),summary:result.message.slice(0,1500)};
        if(item.kind==='artwork'){
          const job=(this.session.state.imageJobs||[]).find(j=>j.id===result.imageJobId);
          if(job?.status!=='completed')evidence=null;
        }
        if(item.kind==='weather'&&!result.weatherAvailable)evidence=null;
        if(item.kind==='custom'){if(!result.functionVerified)evidence=null;else evidence.functionOutput=result.functionOutput;}
      }
      this.update(id,r=>{const s=r.steps.find(s=>s.id===item.id);s.evidence=evidence||null;s.options=result.options||[];
        s.execution=item.receipt?'receipt':executor?'saved_function':'assistant';
        s.status=evidence?'completed':result.status==='needs_input'?'needs_input':'blocked';s.response=result.message||'';s.detail=evidence?'Finished and saved.':result.status==='needs_input'?(result.question||result.message):result.weatherAvailable===false?'The requested forecast is unavailable, stale or incomplete. This step is not finished.':'No verified result was produced. Review this step before explicitly retrying or adapting the plan.';
        if(evidence&&this.session.learnQuickActions){
          const route=learnWorkflowExecutor(r,r.steps.indexOf(s),this.session.state),recipe=this.session.state.reusableViews.find(v=>v.id===r.recipeId);
          if(route&&recipe){
            const existing=recipe.executors||[];
            if(!existing.some(e=>JSON.stringify(e)===JSON.stringify(route)))recipe.executors=[...existing,route].slice(-32);
          }
        }
        if(!evidence){r.status=s.status;r.detail=s.detail;}
      });
      if(!evidence)return;
    }
  }
  async close(){this.closed=true;if(this.active){const a=this.active;a.controller.abort();if(a.ownedImageId)this.studio.cancel(a.ownedImageId);this.update(a.id,r=>{if(r.status==='running'){r.status='paused';r.detail='Server stopped. Resume explicitly to continue.';}});await a.promise;}}
}
