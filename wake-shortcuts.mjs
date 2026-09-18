import {randomUUID} from 'node:crypto';
import pages from './public/research-pages.cjs';

// A visible-view capability bounded by explicit arming, not an always-on command recognizer.
// Add other reversible surface actions here only with equivalent state guards.
export class WakeShortcuts {
  constructor({session,surfaces,now=Date.now,deadline=()=>0,changed=()=>{}}){
    Object.assign(this,{session,surfaces,now,deadline,changed});
    this.epoch=0;this.signature='';this.profile={mask:0,generation:0,commands:[]};
  }
  sync(armed){
    const state=this.session?.state,board=state?.panel==='research'&&state.research;
    const eligible=board&&!state.playroom&&state.assistant?.status!=='clarify';
    const page=eligible?pages.current(board):null;
    const key=page&&page.total>1?board.id+':'+page.index:null;
    const expiresAt=this.deadline();
    const visible=state&&this.surfaces?.snapshot(state).some(s=>s.surface==='mirror'&&s.visible&&s.current);
    const mask=armed&&key&&visible&&Number.isFinite(expiresAt)&&this.now()<expiresAt?((page.index<page.total-1?1:0)|(page.index>0?2:0)):0;
    const signature=[key,state?.revision,mask,expiresAt].join('|');
    if(signature!==this.signature){
      this.signature=signature;
      this.profile={mask,generation:++this.epoch,revision:state?.revision,
        expiresAt:mask?expiresAt:null,commands:[...(mask&1?['next_page']:[]),...(mask&2?['previous_page']:[])]};
      this.changed(this.profile);
    }
    return this.profile;
  }
  act(event,armed){
    const profile=this.sync(armed);
    if(!armed||event.generation!==profile.generation||!profile.commands.includes(event.command)||this.now()<(this.cooldownUntil||0))return false;
    const direction=event.command==='next_page'?'next':'previous';
    try{
      this.session.commitDecision('wake-shortcut:'+randomUUID(),profile.revision,{
        status:'execute',outcome:'Turn the visible research page.',message:'Page turned.',
        actions:[{action:'research_page',direction}],options:[],selectedOptionId:null,
      },direction+' page');
      this.cooldownUntil=this.now()+1500;
      this.sync(armed);return true;
    }catch{return false;} // A stale/invalid surface never falls through to cloud voice.
  }
  clear(){
    this.signature='';
    this.profile={mask:0,generation:++this.epoch,commands:[],expiresAt:null};this.changed(this.profile);
  }
}
