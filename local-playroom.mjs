import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {advanceGame,animals} from './playroom.mjs';
import {LocalRecognizer,synthesizeGameSpeech} from './local-speech.mjs';

export async function playLocalPCM(mirror,pcm,{signal}={}){
  const captureDeadline=Date.now()+4000;
  while(!mirror.status().capturing){if(Date.now()>captureDeadline)throw Error('Mirror did not start capture');await delay(40,null,{signal});}
  const baseline=mirror.status().outputFrames||0,frames=Math.ceil(pcm.length/640);
  for(let p=0;p<pcm.length;p+=640){signal?.throwIfAborted();const block=Buffer.alloc(640);pcm.copy(block,0,p,Math.min(p+640,pcm.length));mirror.output(block.toString('base64'));await delay(20,null,{signal});}
  const deadline=Date.now()+4000;
  while((mirror.status().outputFrames||0)<baseline+frames||mirror.status().playing){if(Date.now()>deadline)throw Error('Mirror playback not confirmed');await delay(60,null,{signal});}
  await delay(400,null,{signal}); // speaker echo tail before a fresh ASR generation
}

export class LocalPlayroom{
  constructor({session,mirror,publish=()=>{},recognizerFactory=()=>new LocalRecognizer(),synthesize=synthesizeGameSpeech,play=playLocalPCM,now=Date.now,idleMs=45000,maxMs=180000}){
    Object.assign(this,{session,mirror,publish,recognizerFactory,synthesize,play,now,idleMs,maxMs});this.active=null;this.state={phase:'off',local:true,detail:'Local game microphone off'};
    this.audio=pcm=>{const a=this.active;if(!a||this.state.phase!=='listening')return;try{a.recognizer.feed(pcm);a.lastFrame=this.now();}catch{this.stop('error');}};
    this.disconnect=()=>this.stop('disconnected');mirror?.on('audio',this.audio);mirror?.on('disconnect',this.disconnect);mirror?.on('fault',this.disconnect);
  }
  update(phase,detail){this.state={...this.state,phase,detail};try{this.publish({...this.state});}catch{}}
  async start(){
    if(this.active)throw Error('Local game voice is already active');
    if(!this.session.state.playroom)throw Error('Open an adult game rehearsal first');
    if(!this.mirror?.status().connected||this.mirror.status().mode!=='off')throw Error('Connect the Mirror and stop other microphone modes');
    const a=this.active={id:randomUUID(),controller:new AbortController(),recognizer:this.recognizerFactory(),started:this.now(),lastAnswer:this.now(),lastFrame:this.now(),gameId:this.session.state.playroom.id};
    this.state={phase:'starting',local:true,accepted:0,ignored:0,detail:'Loading local speech model'};this.update('starting',this.state.detail);
    a.recognizer.on('answer',text=>void this.answer(a,text));a.recognizer.on('fault',()=>{if(this.active===a)this.stop('error');});
    try{await a.recognizer.start();if(this.active!==a)return this.state;
      this.mirror.start();this.timer=setInterval(()=>this.tick(),500);
      void this.speak(a,this.session.state.playroom.prompt).catch(()=>{if(this.active===a)this.stop('error');});return this.state;
    }catch(e){if(this.active===a)this.stop('error');throw e;}
  }
  async speak(a,text){
    if(this.active!==a)return;this.update('preparing','Preparing a local reply');a.recognizer.reset();
    const pcm=await this.synthesize(text,{signal:a.controller.signal});if(this.active!==a)return;
    this.update('speaking','Speaking on the Mirror');await this.play(this.mirror,pcm,{signal:a.controller.signal});if(this.active!==a)return;
    if(this.session.state.playroom?.phase==='complete'){this.stop('complete');return;}
    a.recognizer.reset();a.lastAnswer=a.lastFrame=this.now();this.update('listening',this.session.state.playroom?.kind==='bear'?'Listening locally · say a choice, option number or stop':'Listening locally · say an animal, hint, skip or stop');
  }
  async answer(a,text){
    if(this.active!==a||this.state.phase!=='listening')return;
    if(typeof text!=='string'||!text.trim()||text.length>1000)return;
    const game=this.session.state.playroom;if(!game||game.id!==a.gameId){this.stop('changed');return;}
    const candidate=advanceGame(structuredClone(game),text);
    // Diagnostics expose classification/counts, never recognized words.
    this.state.lastRecognition={words:text.trim().split(/\s+/).length,feedback:candidate.feedback,
      animalMention:animals.some(a=>new RegExp('\\b'+a.id+'\\b','i').test(text))};
    if(candidate.feedback==='uncertain'){
      // A short, answer-shaped utterance can ask for a retry, never earn credit.
      // Do not turn negation, ambiguity or unrelated conversation into answers.
      const normalized=text.toLowerCase().replace(/[’']/g,'').replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();
      const answerShaped=game.kind==='animals'&&normalized.split(' ').length<=8&&
        /^(?:a |an |it is |its |that is |thats |i think (?:it is |its ))/.test(normalized)&&
        !/\b(?:not|dont|no|or|maybe)\b/.test(normalized);
      if(!answerShaped){this.state.ignored++;this.update('listening',this.state.detail);return;}
    }
    this.update('preparing','Checking the game answer');a.lastAnswer=this.now();
    try{
      const r=this.session.commitDecision('local-game:'+a.id+':'+game.turn,this.session.state.revision,{status:'execute',outcome:'Continue local game',message:'Game answer',actions:[{action:'playroom_turn',gameId:game.id,turn:game.turn,text}],options:[],selectedOptionId:null},'');
      a.gameId=this.session.state.playroom.id;this.state.accepted++;await this.speak(a,r.message);
    }catch{if(this.active===a)this.stop('error');}
  }
  tick(){const a=this.active;if(!a)return;
    if(this.session.state.playroom?.id!==a.gameId){this.stop('changed');return;}
    if(this.now()-a.started>this.maxMs){this.stop('limit');return;}
    if(this.state.phase==='listening'&&(this.now()-a.lastFrame>5000||Date.now()-a.recognizer.lastProgress>7000)){this.stop('error');return;}
    if(this.state.phase==='listening'&&this.now()-a.lastAnswer>this.idleMs)this.stop('idle');
  }
  stop(reason='user'){
    const a=this.active;this.active=null;clearInterval(this.timer);
    if(a){a.controller.abort();a.recognizer.close();this.mirror.stop();}
    this.update(reason==='error'?'error':'off',reason==='error'?'Local audio failed; microphone stopped':reason==='complete'?'Game complete · microphone off':'Local game microphone off');
  }
  close(){this.stop('shutdown');this.mirror?.off('audio',this.audio);this.mirror?.off('disconnect',this.disconnect);this.mirror?.off('fault',this.disconnect);}
}
