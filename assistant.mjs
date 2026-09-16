import { capabilities, presentation, validateDecision } from './assistant-contract.mjs';
import {quickPhrase} from './quick-actions.mjs';
import {weatherView,weatherIntent} from './weather.mjs';
import {savedViewIntent,viewOfferCurrent} from './weather-composition.mjs';
import {researchIntent,RESEARCH_FRESH_MS} from './research-board.mjs';
import {gameIntent} from './playroom.mjs';
import {imageIntent} from './image-studio.mjs';
import {workflowIntent} from './workflows.mjs';
import {analyzeFunctionReuse} from './function-reuse.mjs';
export class Assistant {
  constructor({session,planner,surfaces,telemetry,weather,studio}){Object.assign(this,{session,planner,surfaces,telemetry,weather,studio});this.inflight=new Map();}
  execute(id,utterance,{signal,trace,onProgress=()=>{},beforeCommit=async()=>{},workflowContext=null,guardDecision=()=>{}}={}) {
    const workflowReceipt=(this.session.state.workflowReceipts||[]).find(r=>r.id===id);if(workflowReceipt)return Promise.resolve(workflowReceipt.result);
    const prior=(this.session.state.assistantReceipts||[]).find(r=>r.id===id);if(prior)return Promise.resolve(prior.result);
    if(this.inflight.has(id))return this.inflight.get(id);
    const work=this.run(id,utterance,{signal,trace,onProgress,beforeCommit,workflowContext,guardDecision}).finally(()=>this.inflight.delete(id));this.inflight.set(id,work);return work;
  }
  async run(id,utterance,{signal,trace,onProgress,beforeCommit,workflowContext,guardDecision}) {
    if(typeof utterance!=='string'||!utterance.trim()||utterance.length>4000)return {status:'needs_input',message:'I did not catch a request. Please say it again.'};
    if(this.session.state.playroom){
      const revision=this.session.state.revision,action=gameIntent(utterance,this.session.state);
      await beforeCommit();if(signal?.aborted)throw Error('Request cancelled');
      return this.session.commitDecision(id,revision,{status:'execute',outcome:'Continue game',message:'Game answer',actions:[action],options:[],selectedOptionId:null},'');
    }
    let researchRequest=null;
    const workflowStep=workflowContext?.steps.find(s=>s.id===workflowContext.currentStepId);
    if(workflowStep?.kind==='weather'&&this.weather){
      onProgress({stage:'checking_data'});await this.weather.refresh();
      if(signal?.aborted)throw Error('Request cancelled');
    }
    const functionReuse=this.functions&&!workflowContext?analyzeFunctionReuse(utterance,this.session.state,this.session.now(),{learned:this.session.learnQuickActions}):{action:null};
    let quick=(!workflowContext&&this.workflows?workflowIntent(utterance,this.session.state):null)||(workflowStep?.kind==='weather'?weatherIntent(utterance,this.session.state.weather):null)||functionReuse.action||imageIntent(utterance,this.session.state)||researchIntent(utterance,this.session.state)||savedViewIntent(utterance,this.session.state,this.session.now());
    if(quick?.action==='open_research_view'){
      const cached=this.session.state.researchCache?.find(b=>b.savedId===quick.viewId);
      if(quick.refresh||!cached||this.session.now()-cached.fetchedAt>=RESEARCH_FRESH_MS){
        researchRequest=this.session.state.reusableViews.find(v=>v.id===quick.viewId)?.spec;quick=null;
      }
    }
    if(quick){
      const revision=this.session.state.revision;
      await beforeCommit();
      if(signal?.aborted)throw Error('Request cancelled');
      guardDecision({status:'execute',actions:[quick]});
      if(['run_function','prepare_function','open_function','function_page'].includes(quick.action)){
        let span;try{span=this.telemetry?.start('function.reuse',{source:functionReuse.source},trace);}catch{}
        try{const result=await this.functions.handle(id,quick,{revision,utterance,signal});try{span?.end({outcome:result.status});}catch{}return result;}
        catch(e){try{span?.end({outcome:signal?.aborted?'cancelled':'error'});}catch{}throw e;}
      }
      if(quick.action.endsWith('_workflow'))return this.workflows.handle(id,quick,{revision,utterance});
      return this.session.commitDecision(id,revision,{status:'execute',outcome:'Use a saved view',message:'Requested',actions:[quick],options:[],selectedOptionId:null},utterance);
    }
    if(!['weather','custom'].includes(workflowStep?.kind)&&this.weather&&(/weather|forecast|rain|week|weekend/i.test(utterance)||this.session.state.panel==='weather')){
      onProgress({stage:'checking_data'});
      await this.weather.refresh();
      if(signal?.aborted)throw Error('Request cancelled');
    }
    onProgress({stage:'planning'});
    const state=structuredClone(this.session.state),revision=state.revision,view=presentation(state,this.session.now());
    const reports=this.surfaces?.snapshot(state)||[];
    if(/\b(?:the (?:first|second|third|fourth)|(?:first|second|third|fourth) (?:one|item|option|timer)|on (?:the )?(?:screen|mirror)|this (?:item|option)|that (?:item|option))\b/i.test(utterance)&&!reports.some(s=>s.visible&&s.current))return {status:'needs_input',message:'I cannot confirm the current display. Please repeat the item or option by name.'};
    const ordinal=utterance.trim().toLowerCase().replace(/[.!?,]/g,'').match(/^(?:(?:yes|yeah|yep|okay) )?(?:the )?(first|second|third|fourth|1|2|3|4)(?: one| option)?$/);
    let resolvedSelection=null;
    if(ordinal&&view.clarification){
      const index={first:0,second:1,third:2,fourth:3,'1':0,'2':1,'3':2,'4':3}[ordinal[1]];
      const choice=view.clarification?.options[index];
      if(!choice)return {status:'needs_input',message:'Which item do you mean? There is no matching active choice.'};
      if(!reports.some(s=>s.visible&&s.current))return {status:'needs_input',message:'I cannot confirm the current options are displayed. Please repeat the option by name.'};
      resolvedSelection=choice;
    }
    const span=this.telemetry?.start('agent.decision',{revision},trace);
    try {
      // Short opaque aliases reduce ID-copy errors. The model never supplies a raw
      // storage ID; translate only aliases from this exact immutable snapshot.
      const targets=new Map();
      state.timers.forEach((t,i)=>targets.set('timer_'+(i+1),t.id));
      state.todos.forEach((t,i)=>targets.set('todo_'+(i+1),t.id));
      const reverse=new Map([...targets].map(([alias,id])=>[id,alias]));
      const aliased=JSON.parse(JSON.stringify({
        utterance,capabilities,workflowContext,workflows:(state.workflows||[]).map(r=>({id:r.id,title:r.title,outcome:r.outcome,status:r.status,detail:r.detail,recipeId:r.recipeId,inputQuestions:r.inputQuestions,steps:r.steps.map(s=>({id:s.id,title:s.title,kind:s.kind,status:s.status,detail:s.detail,options:s.options}))})),workflowAvailable:!!this.workflows,now:new Date(this.session.now()).toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
        state:{revision,panel:state.panel,timers:state.timers,todos:state.todos},
        weather:weatherView(state.weather,this.session.now()),
        viewOffer:viewOfferCurrent(state,this.session.now())?state.viewOffer:null,
        weatherViews:state.weatherViews||[],
        reusableViews:state.reusableViews||[],researchRequest,research:state.research||null,
        imageJobs:state.imageJobs||[],imageStudio:{available:!!this.studio,asynchronous:true,autoSave:true,editsSupported:false},
        researchCache:(state.researchCache||[]).map(b=>({viewId:b.savedId,fresh:this.session.now()-b.fetchedAt<RESEARCH_FRESH_MS})),
        customFunctions:{available:!!this.functions,pureOnly:true,testsRequired:true,localReuse:true,noNetworkOrDeviceAccess:true},
        durability:{autoSave:true,supportedKinds:['weather','research','workflow','function'],stores:'validated configuration, not data or action replays'},
        presentation:view,surfaces:reports,history:state.assistantHistory||[],resolvedSelection,
      }),(key,value)=>typeof value==='string'&&reverse.has(value)?reverse.get(value):value);
      // A pure workflow calculation is defined by its run, not unrelated chat,
      // current weather, ambient time or whatever happens to be on the mirror.
      // This bounded planning context is also the contract for learned executors.
      const planningContext=workflowStep?.kind==='custom'?{
        utterance,workflowContext,resolvedSelection,customFunctions:aliased.customFunctions,
        reusableViews:aliased.reusableViews.filter(v=>v.kind==='function'),
        durability:aliased.durability,capabilities:aliased.capabilities,
      }:aliased;
      const decision=validateDecision(await this.planner.decide(planningContext,{signal,trace:span}));
      // A model-selected stale recipe gets a new research turn, never stale facts
      // represented as a fresh result. Tell the user to request refresh if the
      // planner did not follow the supplied cache state.
      if(signal?.aborted)throw Error('Request cancelled');
      guardDecision(decision);
      if(decision.selectedOptionId&&targets.has(decision.selectedOptionId))decision.selectedOptionId=targets.get(decision.selectedOptionId);
      for(const option of decision.options)if(targets.has(option.id))option.id=targets.get(option.id);
      if(decision.selectedOptionId&&!view.clarification?.options.some(o=>o.id===decision.selectedOptionId))throw Error('Unknown choice');
      if(resolvedSelection&&decision.selectedOptionId!==resolvedSelection.id)throw Error('Choice mismatch');
      const affected=new Set();
      for(const action of decision.actions)if(action.id){
        if(!targets.has(action.id))throw Error('Unknown target alias');
        action.id=targets.get(action.id);
        if(resolvedSelection&&reverse.has(resolvedSelection.id)&&action.id!==resolvedSelection.id)throw Error('Selected target mismatch');
        // Reject duplicate mutations of the same target instead of half-applying a batch.
        if(affected.has(action.id))throw Error('Duplicate target action');affected.add(action.id);
      }
      await beforeCommit();
      if(signal?.aborted)throw Error('Request cancelled');
      if(decision.actions.some(a=>/^(?:create|reuse|open|pause|cancel|continue)_workflow$|^(?:provide_workflow_inputs|confirm_workflow_step)$/.test(a.action))){
        if(decision.actions.length!==1||!this.workflows)throw Error('Use one workflow operation at a time');
        const result=this.workflows.handle(id,decision.actions[0],{revision,utterance,resolvedSelection});
        span?.end({outcome:'completed',action:'assistant'});return result;
      }
      if(decision.actions.some(a=>['create_function','run_function','open_function','function_page'].includes(a.action))){
        if(decision.actions.length!==1||!this.functions)throw Error('Use one available function operation at a time');
        onProgress({stage:'checking_data'});
        const result=await this.functions.handle(id,decision.actions[0],{revision,utterance,signal});
        span?.end({outcome:result.status,action:'assistant'});return result;
      }
      if(decision.actions.some(a=>['generate_image','cancel_image'].includes(a.action))){
        if(decision.actions.length!==1||!this.studio)throw Error('Use one image operation at a time');
        if(this.session.state.revision!==revision)throw Error('Display changed while deciding');
        const action=decision.actions[0];
        const result=action.action==='generate_image'?this.studio.start(id,action.spec,{revision}):this.studio.cancel(action.jobId);
        span?.end({outcome:'completed',action:'assistant'});return result;
      }
      const result=this.session.commitDecision(id,revision,decision,utterance);
      if(result.compositionId){
        onProgress({stage:'presenting',reusable:false});
        const rendered=await this.surfaces?.waitForRevision?.(this.session.state.revision,{signal});
        if(!signal?.aborted&&rendered)result.message+=' The new view was rendered by a connected display.';
        else result.message+=' The view was prepared, but display rendering is not confirmed. Do not claim it is visible.';
      }
      const learned=(this.session.state.quickActions||[]).find(e=>e.phrase===quickPhrase(utterance)&&e.template===decision.quickAction);
      if(learned&&!state.quickActions?.some(e=>e.phrase===learned.phrase&&e.template===learned.template&&e.panel===learned.panel))span?.event('quick_action.promoted',{template:learned.template,source:'learned'});
      span?.end({outcome:result.status,action:'assistant'});return result;
    }catch(error){span?.end({outcome:signal?.aborted?'cancelled':'error'});throw error;}
  }
}
