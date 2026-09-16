// Lifecycle requests only: never replay inference or refund a test allowance.
// Use an independent bounded signal even when the originating turn was aborted.
export async function closeAgentSession(sessions,id,{complete=false,inspect=false}={}) {
  const signal=AbortSignal.timeout(12000),options={signal,timeout:3000,maxRetries:0};
  let status;
  if(inspect)try {
    status=(await sessions.retrieve(id,options)).status;
  }catch(error){if(error.status===404)return {cleaned:true,evidence:'not_found'};}
  if(!complete&&status!=='idle')try {
    await sessions.events.create(id,{events:[{type:'agent.session.input.cancel'}]},options);
  }catch{/* Cancellation can race a completed turn. Deletion still needs confirmation. */}
  for(let attempt=0;attempt<2&&!signal.aborted;attempt++){
    try {await sessions.delete(id,options);return {cleaned:true,evidence:'deleted'};}
    catch(error){if(error.status===404)return {cleaned:true,evidence:'not_found'};}
    // A lost DELETE response is not proof of failure; check the saved ID.
    try {status=(await sessions.retrieve(id,options)).status;}
    catch(error){if(error.status===404)return {cleaned:true,evidence:'not_found'};}
  }
  return {cleaned:false,evidence:'unconfirmed'};
}

export function recoveryError(){return Object.assign(Error('Prior agent request is still active or needs usage review'),{code:'agent_recovery_required'});}

export function assistantFailureMessage(error){
  if(['function_check_failed','function_repair_invalid'].includes(error?.code))return 'That calculation did not pass its checks. I have not saved any changes or replaced the current result. We can refine the requirements before trying again.';
  if(error?.code==='agent_recovery_required')return 'I could not confirm that the previous planning session closed, so new planning is paused. Basic quick actions still work. The companion needs a connection or session cleanup check—not another repeat of your request.';
  if(error?.code==='test_budget_exhausted')return 'The approved test allowance is used up. More planning needs a budget review; repeating the request will not fix it.';
  return 'I could not complete that request. I cannot confirm a successful result. Please check the companion for details.';
}
