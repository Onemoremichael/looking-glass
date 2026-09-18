// One bounded paid Live check. Synthetic silence, no mic/speakers or recording.
// Uses the existing allowance and never retries a session automatically.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Voice} from '../voice.mjs';
import {Session} from '../session.mjs';
import {backgroundCommentary} from '../live-commentary.mjs';
if(!process.argv.includes('--run-paid'))throw Error('Pass --run-paid to use the shared allowance');
process.loadEnvFile(new URL('../.env',import.meta.url).pathname);
let feed,audioFrames=0,accepted=false,providerError=false;
const mirror=new EventEmitter();Object.assign(mirror,{
  status:()=>({connected:true,playing:false}),
  start(){feed=setInterval(()=>mirror.emit('audio',Buffer.alloc(640)),20);},
  stop(){clearInterval(feed);},mute(){},
  output(base64){const pcm=Buffer.from(base64,'base64');for(let i=0;i+1<pcm.length;i+=2)if(Math.abs(pcm.readInt16LE(i))>180){audioFrames++;break;}return audioFrames;}
});
const voice=new Voice({session:new Session(),budgetPath:new URL('../data/api-test-budget.json',import.meta.url).pathname});
try{
  await voice.start(null,mirror,{owner:'wake',resuming:true});
  const a=voice.active;
  a.ws.on('event',e=>{if(e.type==='session.commentary.appended')accepted=true;if(e.type==='error')providerError=true;});
  const content=backgroundCommentary({status:'completed',message:'The test result is ready. This was a voice delivery check.',researchArtifact:{cards:Array(6).fill({body:'Long report content. '.repeat(300)})}});
  voice.reply(a,null,content,'background-speech-check');
  const deadline=Date.now()+15000;
  while((!audioFrames||!accepted)&&!providerError&&voice.active&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
  console.log(JSON.stringify({accepted,nonSilentAudioFrames:audioFrames,providerError,commentaryBytes:Buffer.byteLength(content)}));
  assert.ok(!providerError&&audioFrames>0,'Expected non-silent GPT-Live output without provider errors');
}finally{await voice.stop(undefined,'shutdown');clearInterval(feed);}
