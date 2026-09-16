import OpenAI from 'openai';
import { plannerDecisionSchema, validateDecision } from './assistant-contract.mjs';
import { assistantInstructions } from './prompts/assistant-instructions.mjs';

// Agents API, not Agents SDK. The cloud agent only proposes JSON: no application
// mutation can occur until a completed turn passes our local validation/commit.
export class AgentsPlanner {
  constructor({client,budget,telemetry,model=process.env.OPENAI_AGENT_MODEL||'gpt-5.4-mini',effort=process.env.OPENAI_AGENT_REASONING||'low',timeoutMs=30000}={}) {
    if(!['none','low','medium','high','xhigh'].includes(effort))throw Error('Invalid planning effort');
    this.client=client;this.budget=budget;this.telemetry=telemetry;this.model=model;this.effort=effort;this.timeoutMs=timeoutMs;
  }
  decide(context,{signal,trace}={}) {
    // A spoken correction waits for the aborted session's cleanup, rather than
    // racing its still-open budget reservation. This does not retry inference.
    const work=(this.pending||Promise.resolve()).then(()=>{
      if(signal?.aborted)throw Error('Request cancelled');
      return this.runDecision(context,{signal,trace});
    });
    // Return a completed, validated decision immediately, but gate the next paid
    // call and shutdown on its tracked cleanup. Never leave an unhandled promise.
    this.pending=work.catch(()=>{}).then(()=>this.cleanup);
    this.pending.catch(()=>{});return work;
  }
  async drain(){await this.pending;}
  async runDecision(context,{signal,trace}={}) {
    const started=Date.now();let plannedAt;
    this.client ||= new OpenAI({maxRetries:0,timeout:15000});
    const reservation=this.budget.reserve('agents-decision');
    const deadline=AbortSignal.timeout(this.timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
    let stream,sessionId,complete=false,text='',usage,rejected=false,accepted=false;
    const timing={planningMs:null,readyMs:null,cleanupMs:null,totalMs:null};this.lastTiming=timing;
    const planning=this.telemetry?.start('agent.planning',{},trace);
    try {
      stream=await this.client.beta.agents.sessions.create({
        agent:{model:this.model,instructions:assistantInstructions,reasoning:{effort:this.effort},tools:[],multi_agent:{enabled:false},text:{format:{type:'json_schema',schema:plannerDecisionSchema},verbosity:'low'}},
        environment:{type:'none'},input:JSON.stringify(context),stream:true,
      },{signal:combined});
      for await(const event of stream) {
        const nextId=event.session_id||event.session?.id;
        if(nextId&&!sessionId){sessionId=nextId;this.budget.identifyAgent?.(reservation,sessionId);}
        if(event.type==='agent.session.turn.output_text.done')text=event.text;
        if(event.type==='agent.session.turn.completed'){complete=true;usage=event.usage;plannedAt=Date.now();break;}
        if(['agent.session.turn.failed','agent.session.turn.cancelled','agent.session.failed','agent.session.requires_action','agent.session.error'].includes(event.type))throw Error('Agent could not produce a decision');
      }
      if(!complete||combined.aborted)throw Error('Agent decision interrupted');
      if(text.length>12000)throw Error('Agent decision too large');
      const decision=validateDecision(JSON.parse(text));
      accepted=true;timing.readyMs=Date.now()-started;
      return decision;
    } catch(error) {
      rejected=!stream&&Number.isInteger(error.status)&&error.status>=400&&error.status<500;
      throw error;
    } finally {
      stream?.controller.abort();
      timing.planningMs=plannedAt?plannedAt-started:null;
      planning?.end({outcome:accepted?'completed':signal?.aborted?'cancelled':'error'});
      const cleanupStarted=Date.now();
      const cleanupTrace=this.telemetry?.start('agent.cleanup',{},trace);
      // Independent cleanup signal: an aborted user request still needs server cancellation.
      this.cleanup=(async()=>{
        let cleaned=rejected;
        if(sessionId)try {
          if(!complete)try{await this.client.beta.agents.sessions.events.create(sessionId,{events:[{type:'agent.session.input.cancel'}]},{timeout:5000});}catch{/* Still attempt deletion if cancellation fails. */}
          try{await this.client.beta.agents.sessions.delete(sessionId,{timeout:5000});}
          catch(error){if(error.status!==404)await this.client.beta.agents.sessions.delete(sessionId,{timeout:10000});}
          cleaned=true;
        }catch{/* Reservation remains charged conservatively; never silently retry inference. */}
        this.budget.finishAgent(reservation,{complete,cleaned,usage});
        timing.cleanupMs=Date.now()-cleanupStarted;timing.totalMs=Date.now()-started;
        cleanupTrace?.end({outcome:cleaned?'completed':'unconfirmed'});
      })();
      this.cleanup.catch(()=>{cleanupTrace?.end({outcome:'error'});});
      if(!accepted)await this.cleanup;
    }
  }
}
