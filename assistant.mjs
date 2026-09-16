import { capabilities, presentation, validateDecision } from './assistant-contract.mjs';
export class Assistant {
  constructor({session,planner,surfaces,telemetry}){Object.assign(this,{session,planner,surfaces,telemetry});this.inflight=new Map();}
  execute(id,utterance,{signal,trace}={}) {
    const prior=(this.session.state.assistantReceipts||[]).find(r=>r.id===id);if(prior)return Promise.resolve(prior.result);
    if(this.inflight.has(id))return this.inflight.get(id);
    const work=this.run(id,utterance,{signal,trace}).finally(()=>this.inflight.delete(id));this.inflight.set(id,work);return work;
  }
  async run(id,utterance,{signal,trace}) {
    if(typeof utterance!=='string'||!utterance.trim()||utterance.length>4000)return {status:'needs_input',message:'I did not catch a request. Please say it again.'};
    const state=structuredClone(this.session.state),revision=state.revision,view=presentation(state);
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
      const result=this.session.commitDecision(id,revision,decision,utterance);
      span?.end({outcome:result.status,action:'assistant'});return result;
    }catch(error){span?.end({outcome:signal?.aborted?'cancelled':'error'});throw error;}
  }
}
