import {framing} from './timer-intent.mjs';

export const QUICK_ACTION_VERSION=1;
export const quickActionSchema={anyOf:[{type:'null'},{enum:['cancel_only_timer','show_panel']}]};
const panels=['home','time','timers','todos'];
const uncertain=/\b(?:don't|do not|not|never|no|if|unless|maybe|perhaps|or|actually|wait|instead|rather|and|then|after|before|until|when|why|how|what|whether|except|all|every|first|second|third|last|it|that|this|keep|leave|save|pause|reset|restart|hide|dismiss|wish)\b/;
export function quickPhrase(text){
  if(typeof text!=='string'||text.length>200)return null;
  const phrase=framing(text);
  if(!/^[a-z]+(?: [a-z]+){1,11}$/.test(phrase)||uncertain.test(phrase))return null;
  return phrase;
}
function candidatePhrase(phrase,template){
  if(template==='cancel_only_timer')return /^(?:clear|cancel|stop|end|remove|delete|ditch|scrap|take away|get rid of|wipe away) (?:the |my )?timer(?: card)?$/.test(phrase);
  if(template==='show_panel')return /^(?:show|open|display|bring up|pull up|take me to|let me see) (?:the |my )?(?:home|clock|time|timers|timer list|todos|to do list)$/.test(phrase);
  return false;
}
function materialize(template,panel,state){
  if(template==='cancel_only_timer')return state.timers.length===1?{action:'cancel_timer',id:state.timers[0].id}:null;
  if(template==='show_panel'&&panels.includes(panel))return {action:'show',panel};
  return null;
}
function namedPanel(phrase){
  const name=phrase.match(/\b(home|clock|time|timers|timer list|todos|to do list)$/)?.[1];
  return ({home:'home',clock:'time',time:'time',timers:'timers','timer list':'timers',todos:'todos','to do list':'todos'})[name];
}
export function analyzeQuickAction(text,state,{learned=true}={}){
  const reject=reason=>({action:null,reason});
  const phrase=quickPhrase(text);if(!phrase)return reject('unsupported_wording');
  if(state.assistant?.status==='clarify')return reject('pending_clarification');
  const builtin=/^(?:clear|cancel|stop|end|remove|delete) (?:the |my )?timer$/.test(phrase);
  const entry=learned&&(state.quickActions||[]).find(e=>e.version===QUICK_ACTION_VERSION&&e.phrase===phrase&&candidatePhrase(phrase,e.template)&&! /\bcard\b/.test(phrase)&&(e.template!=='show_panel'||e.panel===namedPanel(phrase)));
  if(!builtin&&!entry)return reject('not_learned');
  const template=builtin?'cancel_only_timer':entry.template;
  const action=materialize(template,entry?.panel,state);
  if(!action)return reject('ambiguous_target');
  return {action,reason:'matched',source:builtin?'builtin':'learned',template};
}
// The planner may nominate a template, never executable code or a regex. Promotion
// is derived from its validated action and persisted in the same commit as success.
export function promoteQuickAction(state,decision,text,now){
  const template=decision.quickAction,phrase=quickPhrase(text);
  if(!template||!phrase||!candidatePhrase(phrase,template)||state.assistant?.status==='clarify'||decision.status!=='execute'||decision.actions.length!==1||decision.selectedOptionId)return null;
  const action=decision.actions[0],expected=materialize(template,action.panel,state);
  if(!expected||Object.keys(action).length!==Object.keys(expected).length||Object.keys(expected).some(k=>action[k]!==expected[k]))return null;
  // Do not promote screen-relative wording without proof of current presentation.
  // Such phrases can be handled by the contextual planner, but not learned here.
  if(/\bcard\b/.test(phrase))return null;
  if(template==='show_panel'&&action.panel!==namedPanel(phrase))return null;
  return {version:QUICK_ACTION_VERSION,phrase,template,...(action.action==='show'?{panel:action.panel}:{}),
    reason:template==='cancel_only_timer'?'single_local_action_unique_timer':'single_local_panel_selection',learnedAt:now};
}
