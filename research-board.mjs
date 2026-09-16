import {framing} from './timer-intent.mjs';

const str=maxLength=>({type:'string',minLength:1,maxLength});
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const list=(items,maxItems)=>({type:'array',items,maxItems});
export const researchSpecSchema=obj({title:str(70),query:str(700),layout:{enum:['briefing','agenda','comparison','steps']}});
export const researchBoardSchema=obj({
  spec:researchSpecSchema,summary:str(300),caveat:{type:'string',minLength:0,maxLength:300},
  cards:list(obj({heading:str(80),kicker:{type:'string',minLength:0,maxLength:60},body:str(350),detail:{type:'string',minLength:0,maxLength:100},sourceIds:list(str(30),4)}),6),
  sources:list(obj({id:str(30),title:str(100),url:str(1000)}),8),
});
// First-pass URL validation; host retrieval also requires pinned public DNS and bounded redirects.
export function publicSource(value){
  try{const u=new URL(value),h=u.hostname.toLowerCase();
    return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port&&
      !h.includes(':')&&!/^\d+(?:\.\d+){3}$/.test(h)&&h.includes('.')&&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(h);
  }catch{return false;}
}
export function validateResearchSpec(spec){
  if(!spec||Object.keys(spec).sort().join()!=='layout,query,title'||
    typeof spec.title!=='string'||!spec.title.trim()||spec.title.length>70||
    typeof spec.query!=='string'||!spec.query.trim()||spec.query.length>700||
    !['briefing','agenda','comparison','steps'].includes(spec.layout))throw Error('Invalid research recipe');
  return spec;
}
export function validateResearchBoard(board,{openedUrls}={}){
  validateResearchSpec(board?.spec);
  if(!Array.isArray(board.cards)||!board.cards.length||board.cards.length>6||!Array.isArray(board.sources)||!board.sources.length||board.sources.length>8)throw Error('Research requires cards and sources');
  const ids=new Set();
  for(const s of board.sources){
    if(ids.has(s.id)||!publicSource(s.url))throw Error('Invalid research source');
    if(openedUrls&&!openedUrls.has(s.url))throw Error('Research citation was not opened by the search tool');
    ids.add(s.id);
  }
  for(const c of board.cards)if(!Array.isArray(c.sourceIds)||!c.sourceIds.length||c.sourceIds.some(id=>!ids.has(id)))throw Error('Every research card needs known sources');
  return board;
}
export const RESEARCH_FRESH_MS=15*60*1000;
export function researchView(state,now=Date.now()){
  const board=state.research;if(!board)return null;
  return {...board,stale:now-board.fetchedAt>=RESEARCH_FRESH_MS};
}
export function researchIntent(text,state){
  if(typeof text!=='string'||state.assistant?.status==='clarify')return null;
  const s=framing(text);
  if(['next page','next cards','more results'].includes(s)&&state.panel==='research')return {action:'research_page',direction:'next'};
  if(['previous page','previous cards'].includes(s)&&state.panel==='research')return {action:'research_page',direction:'previous'};
  const match=s.match(/^(?:open|show|bring up|refresh|update) (?:my |the )?(.+)$/);
  if(!match)return null;
  const views=(state.reusableViews||[]).filter(v=>v.kind==='research'&&framing(v.spec.title)===match[1]);
  return views.length===1?{action:'open_research_view',viewId:views[0].id,refresh:/^(refresh|update) /.test(s)}:null;
}
