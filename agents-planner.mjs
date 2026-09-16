import OpenAI from 'openai';
import { plannerDecisionSchema, validateDecision } from './assistant-contract.mjs';
import { assistantInstructions } from './prompts/assistant-instructions.mjs';
import {closeAgentSession,recoveryError} from './agent-recovery.mjs';
import {validateResearchBoard} from './research-board.mjs';
import {verifyResearchSources} from './research-sources.mjs';

// Agents API, not Agents SDK. The cloud agent only proposes JSON: no application
// mutation can occur until a completed turn passes our local validation/commit.
export class AgentsPlanner {
  constructor({client,budget,telemetry,model=process.env.OPENAI_AGENT_MODEL||'gpt-5.4-mini',effort=process.env.OPENAI_AGENT_REASONING||'low',timeoutMs=90000,verifySources=verifyResearchSources}={}) {
    if(!['none','low','medium','high','xhigh'].includes(effort))throw Error('Invalid planning effort');
    this.client=client;this.budget=budget;this.telemetry=telemetry;this.model=model;this.effort=effort;this.timeoutMs=timeoutMs;
    this.verifySources=verifySources;
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
  async recover({signal,trace}={}) {
    const unresolved=this.budget.unresolvedAgents?.()||[];
    if(!unresolved.length)return;
    this.client ||= new OpenAI({maxRetries:0,timeout:15000});
    for(const run of unresolved){
      if(signal?.aborted)throw Error('Request cancelled');
      // Unknown IDs and live owners cannot be safely reconciled automatically.
      if(run.status!=='unconfirmed'||!run.sessionId)throw recoveryError();
      if(this.recoveryFailedAt&&Date.now()-this.recoveryFailedAt<30000)throw recoveryError();
      const span=this.telemetry?.start('agent.recovery',{},trace);
      const result=await closeAgentSession(this.client.beta.agents.sessions,run.sessionId,{complete:run.complete,inspect:true});
      this.budget.recordAgentRecovery(run.id,result);
      span?.end({outcome:result.cleaned?'completed':'unconfirmed'});
      if(!result.cleaned){this.recoveryFailedAt=Date.now();throw recoveryError();}
    }
  }
  async runDecision(context,{signal,trace}={}) {
    const started=Date.now();let plannedAt;
    this.client ||= new OpenAI({maxRetries:0,timeout:15000});
    await this.recover({signal,trace});
    if(signal?.aborted)throw Error('Request cancelled');
    const reservation=this.budget.reserve('agents-decision');
    const deadline=AbortSignal.timeout(this.timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
    let stream,sessionId,complete=false,text='',usage,rejected=false,accepted=false;
    const openedUrls=new Set();let searches=0;
    const evidence=this.lastResearchEvidence={calls:[],citedUrls:[]};
    const timing={planningMs:null,readyMs:null,cleanupMs:null,totalMs:null};this.lastTiming=timing;
    const planning=this.telemetry?.start('agent.planning',{},trace);
    try {
      stream=await this.client.beta.agents.sessions.create({
        agent:{model:this.model,instructions:assistantInstructions,reasoning:{effort:this.effort},tools:[{type:'web_search',mode:'live',context_size:'medium'}],multi_agent:{enabled:false},text:{format:{type:'json_schema',schema:plannerDecisionSchema},verbosity:'low'}},
        environment:{type:'none'},input:JSON.stringify(context),stream:true,
      },{signal:combined});
      for await(const event of stream) {
        const nextId=event.session_id||event.session?.id;
        if(nextId&&!sessionId){sessionId=nextId;this.budget.identifyAgent?.(reservation,sessionId);}
        if(event.type==='agent.session.turn.item.done'&&event.item?.type==='web_search_call'&&event.item.status==='completed'){
          evidence.calls.push(event.item.action);
          if(++searches>10)throw Error('Research tool limit reached');
          if(event.item.action?.type==='open_page'&&event.item.action.url)openedUrls.add(event.item.action.url);
          planning?.event('research.source_checked',{action:event.item.action?.type});
        }
        if(event.type==='agent.session.turn.output_text.done')text=event.text;
        if(event.type==='agent.session.turn.completed'){complete=true;usage=event.usage;plannedAt=Date.now();break;}
        if(['agent.session.turn.failed','agent.session.turn.cancelled','agent.session.failed','agent.session.requires_action','agent.session.error'].includes(event.type))throw Error('Agent could not produce a decision');
      }
      if(!complete||combined.aborted)throw Error('Agent decision interrupted');
      if(text.length>24000)throw Error('Agent decision too large');
      const decision=validateDecision(JSON.parse(text));
      for(const a of decision.actions)if(a.action==='compose_research'){
        evidence.citedUrls=a.board.sources.map(s=>s.url);
        validateResearchBoard(a.board);
        // Hosted search sometimes reports page opening as `other`, without a URL.
        // Require actual search activity and independently fetch missing sources.
        const missing=evidence.citedUrls.filter(url=>!openedUrls.has(url));
        if(missing.length&&searches){
          const verified=await this.verifySources(missing,{signal:combined});
          for(const url of verified)openedUrls.add(url);
          evidence.independentlyChecked=[...verified];
        }
        validateResearchBoard(a.board,{openedUrls});
      }
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
        if(sessionId)cleaned=(await closeAgentSession(this.client.beta.agents.sessions,sessionId,{complete})).cleaned;
        this.budget.finishAgent(reservation,{complete,cleaned,usage});
        timing.cleanupMs=Date.now()-cleanupStarted;timing.totalMs=Date.now()-started;
        cleanupTrace?.end({outcome:cleaned?'completed':'unconfirmed'});
      })();
      this.cleanup.catch(()=>{cleanupTrace?.end({outcome:'error'});});
      if(!accepted)await this.cleanup;
    }
  }
}
