// Acceleration, not the natural-language boundary: anything uncertain falls back
// to the contextual planner. Match the entire request, never a command substring.
const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens={twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
function amount(s){
  if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);
  if(['a','an'].includes(s))return 1;
  if(['half a','half an'].includes(s))return .5;
  if(s.endsWith(' and a half')){const n=amount(s.slice(0,-11));return n===null?null:n+.5;}
  if(small.includes(s))return small.indexOf(s);
  const [ten,one,...extra]=s.split(' ');
  if(tens[ten]&&!extra.length&&(!one||small.indexOf(one)>0&&small.indexOf(one)<10))return tens[ten]+(one?small.indexOf(one):0);
  return null;
}
function duration(s){
  let seconds=0,previous=Infinity;
  while(s){
    const m=s.match(/^(.+?) (hours?|minutes?|seconds?)(?: (?:and )?(.+))?$/);
    if(!m)return null;
    const n=amount(m[1]),scale=m[2].startsWith('hour')?3600:m[2].startsWith('minute')?60:1;
    if(n===null||n<=0||scale>=previous)return null;
    seconds+=n*scale;previous=scale;s=m[3]||'';
  }
  return Number.isInteger(seconds)&&seconds>=1&&seconds<=86400?seconds:null;
}
export function framing(text){
  let s=text.toLowerCase().trim().replace(/[’]/g,"'").replace(/([a-z0-9])-([a-z])/g,'$1 $2').replace(/\s+/g,' ');
  // Only known discourse/politeness prefixes, never arbitrary text before a
  // command. In particular do not strip "no", "but", "if", "don't" or quotes.
  for(let i=0;i<8;i++){
    const next=s.replace(/^(?:thanks(?: a lot)?|thank you(?: very much)?|okay|ok|'?kay|alright|all right|great|perfect|cool|now|please|hey|um|uh)(?:[\s,.!?]+|$)/,'')
      .replace(/^would you mind (setting|starting|creating|adding) /,(_,verb)=>({setting:'set',starting:'start',creating:'create',adding:'add'}[verb]+' '))
      .replace(/^(?:(?:can|could|would|will) you |let's |let us |go ahead and |(?:i'd like|i want) you to )/,'');
    if(next===s)break;s=next;
  }
  for(let i=0;i<4;i++){
    s=s.replace(/[.!?]+$/,'').trim();
    const next=s.replace(/(?:[\s,]+)(?:please|thanks|thank you|for me)$/,'');
    if(next===s)break;s=next;
  }
  return s.replace(/[.!?]+$/,'').trim();
}
function requestedDuration(s){
  const m=s.match(/^(?:set|start|create|add) (?:me )?(?:a |another )?(?:timer|countdown) (?:for |of )?(.+)$/)
    ||s.match(/^(?:set|start|create|add|give me|can i have|could i have) (?:a |another )?(.+) (?:timer|countdown)$/)
    ||s.match(/^(?:i'd like|i want|i need) (?:a |another )?(?:timer|countdown) for (.+)$/)
    ||s.match(/^put (.+) on (?:a|the) timer$/)
    ||s.match(/^(?:give me|set) (.+)$/)
    ||s.match(/^(?:start counting down|count down) (?:from|for) (.+)$/);
  return m?.[1]??null;
}
export function analyzeTimerIntent(text){
  const reject=reason=>({intent:null,reason});
  if(typeof text!=='string'||text.length>500)return reject('invalid_request');
  const s=framing(text);
  if(!/\b(?:timer|countdown|seconds?|minutes?|hours?)\b/.test(s))return reject('not_timer');
  // These categories explain routing only; they never grant permission to act.
  if(/\b(?:don't|do not|never|not|if|unless|maybe|perhaps|instead|or|cancel)\b/.test(s))return reject('uncertain_language');
  // A narrowly supported self-correction must replace a complete explicit timer
  // request with a complete duration in this SAME unconsumed transcript range.
  const correction=s.match(/^(.+?)(?:[,—–]\s*|[.!?]\s+|\s+)actually[,\s]+make (?:it|that) (.+)$/);
  if(correction){
    const original=requestedDuration(correction[1]);
    const seconds=duration(correction[2]);
    if(original!==null&&duration(original)!==null&&seconds!==null)return {intent:{seconds,label:'Timer'},reason:'matched_correction'};
    return reject('uncertain_language');
  }
  if(/\b(?:actually|no|wait|scratch|rather)\b/.test(s))return reject('uncertain_language');
  if(/^(?:set|start|create|add) (?:a |another )?(?:timer|countdown)(?: for)?$/.test(s))return reject('missing_duration');
  const requested=requestedDuration(s);
  if(requested!==null){
    const seconds=duration(requested);
    return seconds===null?reject('unrecognized_duration'):{intent:{seconds,label:'Timer'},reason:'matched'};
  }
  return reject('unsupported_wording');
}
export function timerIntent(text){return analyzeTimerIntent(text).intent;}
export const TIMER_QUIET_MS=700;
