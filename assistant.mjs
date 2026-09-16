import { capabilities, presentation, validateDecision } from './assistant-contract.mjs';
import {quickPhrase} from './quick-actions.mjs';
import {weatherView} from './weather.mjs';
import {savedViewIntent,viewOfferCurrent} from './weather-composition.mjs';
export class Assistant {
  constructor({session,planner,surfaces,telemetry,weather}){Object.assign(this,{session,planner,surfaces,telemetry,weather});this.inflight=new Map();}
  execute(id,utterance,{signal,trace,onProgress=()=>{},beforeCommit=async()=>{}}={}) {
    const prior=(this.session.state.assistantReceipts||[]).find(r=>r.id===id);if(prior)return Promise.resolve(prior.result);
    if(this.inflight.has(id))return this.inflight.get(id);
    const work=this.run(id,utterance,{signal,trace,onProgress,beforeCommit}).finally(()=>this.inflight.delete(id));this.inflight.set(id,work);return work;
  }
  async run(id,utterance,{signal,trace,onProgress,beforeCommit}) {
    if(typeof utterance!=='string'||!utterance.trim()||utterance.length>4000)return {status:'needs_input',message:'I did not catch a request. Please say it again.'};
    const quick=savedViewIntent(utterance,this.session.state,this.session.now());
    if(quick){
      const revision=this.session.state.revision;
      await beforeCommit();
      if(signal?.aborted)throw Error('Request cancelled');
      return this.session.commitDecision(id,revision,{status:'execute',outcome:'Use a weather view',message:'Requested',actions:[quick],options:[],selectedOptionId:null},utterance);
    }
    if(this.weather&&(/weather|forecast|rain|week|weekend/i.test(utterance)||this.session.state.panel==='weather')){
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
        utterance,capabilities,now:new Date(this.session.now()).toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
        state:{revision,panel:state.panel,timers:state.timers,todos:state.todos},
        weather:weatherView(state.weather,this.session.now()),
        viewOffer:viewOfferCurrent(state,this.session.now())?state.viewOffer:null,
        weatherViews:state.weatherViews||[],
        reusableViews:state.reusableViews||[],durability:{autoSave:true,supportedKinds:['weather'],stores:'validated configuration, not data or action replays'},
        presentation:view,surfaces:reports,history:state.assistantHistory||[],resolvedSelection,
      }),(key,value)=>typeof value==='string'&&reverse.has(value)?reverse.get(value):value);
      const decision=validateDecision(await this.planner.decide({
        ...aliased,
      },{signal,trace:span}));
      if(signal?.aborted)throw Error('Request cancelled');
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
