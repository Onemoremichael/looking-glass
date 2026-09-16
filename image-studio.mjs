import OpenAI from 'openai';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,renameSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

export const IMAGE_MODEL='gpt-image-2.5-sunburst';
const pending=['queued','generating'];
export function imageSpec(value){
  if(!value||Object.keys(value).some(k=>!['title','prompt','background'].includes(k))||
    typeof value.title!=='string'||!value.title.trim()||value.title.length>80||
    typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>1200||
    !['transparent','opaque'].includes(value.background))throw Error('Invalid image request');
  return {title:value.title.trim(),prompt:value.prompt.trim(),background:value.background};
}
export function imageKey(spec){return createHash('sha256').update(JSON.stringify([IMAGE_MODEL,spec.prompt.toLowerCase().replace(/\s+/g,' '),spec.background])).digest('hex');}
export function imageIntent(text,state){
  const phrase=String(text).toLowerCase().replace(/[.!?]/g,'').trim();
  if(state.panel==='studio'&&state.imageJobId&&/^(?:show|open)(?: me)? (?:that|the|my) (?:image|artwork|picture)$/.test(phrase))return {action:'open_image',jobId:state.imageJobId};
  const match=phrase.match(/^(?:show|open)(?: me)? (?:my |the )?(.+)$/);if(!match)return null;
  const jobs=(state.imageJobs||[]).filter(j=>j.status==='completed'&&j.spec.title.toLowerCase()===match[1]);
  return jobs.length===1?{action:'open_image',jobId:jobs[0].id}:null;
}
export function validatePng(bytes){
  if(bytes.length<33||bytes.length>12*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw Error('Invalid image payload');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width<1||height<1||width>2048||height>2048)throw Error('Image dimensions exceed limits');
  return {width,height};
}
export class ImageStudio {
  constructor({session,budget,directory,client,timeoutMs=180000,telemetry}={}){
    Object.assign(this,{session,budget,directory,client,timeoutMs,telemetry});this.active=null;this.closed=false;
    if((session.state.imageJobs||[]).some(j=>pending.includes(j.status)))this.edit(s=>{
      for(const j of s.imageJobs)if(pending.includes(j.status)){j.status='interrupted';j.detail='Server restarted. Provider completion and charges are unknown; no automatic retry.';}
    });
  }
  edit(fn){
    const s=this.session,before=structuredClone(s.state);
    try{fn(s.state);s.state.revision++;s.save();}catch(e){s.state=before;throw e;}
    s.onChange(s.state);
  }
  start(requestId,input,{revision=this.session.state.revision}={}){
    if(this.closed)throw Error('Image studio is closing');
    if(this.session.state.playroom)throw Error('Exit playroom before creating artwork');
    const spec=imageSpec(input),key=imageKey(spec),jobs=this.session.state.imageJobs||[];
    if(typeof requestId!=='string'||!requestId||requestId.length>300)throw Error('Invalid image request ID');
    const replay=jobs.find(j=>j.requestId===requestId);if(replay)return this.result(replay);
    if(this.session.state.revision!==revision)throw Error('Display changed while deciding');
    const existing=jobs.find(j=>j.key===key&&(j.status==='completed'||pending.includes(j.status)));
    if(existing){this.session.command('open_image',{jobId:existing.id});return this.result(existing);}
    if(jobs.some(j=>j.accounting==='unconfirmed'))throw Error('Image usage accounting needs reconciliation before another generation');
    if(this.active)throw Error('An image is already being generated. Wait or cancel it first.');
    if(jobs.length>=32)throw Error('Image library is full (32 jobs). No paid request was started.');
    const job={id:randomUUID(),requestId,key,spec,model:IMAGE_MODEL,status:'queued',createdAt:Date.now(),detail:'Preparing one image. It may take a few minutes.'};
    this.edit(s=>{s.imageJobs=[...(s.imageJobs||[]),job];s.imageJobId=job.id;s.panel='studio';s.assistant=null;s.message='';});
    const controller=new AbortController();
    const active=this.active={id:job.id,controller};
    active.promise=Promise.resolve().then(()=>this.run(job,controller.signal)).catch(()=>{}).finally(()=>{if(this.active===active)this.active=null;});
    return this.result(job);
  }
  result(job){return {status:'completed',action:'assistant',jobId:job.id,message:job.status==='completed'?'Saved artwork is ready. Reopened without generation.':pending.includes(job.status)?'Image job accepted, not finished. It can take a few minutes. Progress is on the display; the result and prompt will save automatically. You can keep using other functions.':'Image job '+job.status+'. '+job.detail};}
  update(id,values){this.edit(s=>{const job=s.imageJobs.find(j=>j.id===id);if(!job)throw Error('Missing image job');Object.assign(job,values);});}
  async run(job,signal){
    let reservation,usage,settled=false,span,received=false,accountingFailed=false;
    // Observability cannot prevent execution or turn a completed image into a
    // failure. The real Telemetry integration is covered by tests as well.
    try{span=this.telemetry?.start('image.generate',{});}catch{}
    const end=outcome=>{try{span?.end({outcome});}catch{}};
    const settle=()=>{
      if(!reservation||settled)return;
      settled=true; // Never retry a failed ledger mutation implicitly.
      try{this.budget.finishImage(reservation,{received,usage});}
      catch{accountingFailed=true;}
    };
    try{
      if(signal.aborted){end('cancelled');return;}
      this.client ||= new OpenAI({maxRetries:0,timeout:this.timeoutMs});
      reservation=this.budget.reserve('image-generation');
      this.update(job.id,{status:'generating',detail:'Creating your artwork. You can leave this view; it will be saved here.'});
      const result=await this.client.images.generate({model:IMAGE_MODEL,prompt:job.spec.prompt,n:1,size:'1024x1024',quality:'medium',background:job.spec.background,output_format:'png',moderation:'auto'},
        {signal:AbortSignal.any([signal,AbortSignal.timeout(this.timeoutMs)]),maxRetries:0});
      usage=result.usage;received=true;
      settle();
      if(accountingFailed)throw Error('Image accounting could not be saved');
      if(signal.aborted){end('cancelled');return;}
      const encoded=result.data?.length===1&&result.data[0].b64_json;
      if(typeof encoded!=='string'||encoded.length>16*1024*1024||!encoded.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('Invalid image response');
      const bytes=Buffer.from(encoded,'base64'),dimensions=validatePng(bytes);
      mkdirSync(this.directory,{recursive:true});
      const target=join(this.directory,job.id+'.png');writeFileSync(target+'.tmp',bytes,{mode:0o600});renameSync(target+'.tmp',target);
      this.update(job.id,{status:'completed',detail:'Saved to your artwork library.',completedAt:Date.now(),...dimensions});
      end('completed');
    }catch(error){
      settle();
      if(accountingFailed)this.update(job.id,{accounting:'unconfirmed',accountingReservation:reservation,
        accountingUsage:Object.fromEntries(['input_tokens','output_tokens'].filter(k=>Number.isFinite(usage?.[k])&&usage[k]>=0).map(k=>[k,usage[k]])),
        detail:'Usage accounting could not be saved. Provider charges may have occurred. Image generation is paused until the ledger is reconciled.',...(!signal.aborted?{status:'failed'}:{})});
      else if(!signal.aborted)this.update(job.id,{status:'failed',detail:error.code==='test_budget_exhausted'?'The approved test allowance is exhausted. No image was requested.':'Image generation did not complete. Check account access, network and allowance before explicitly trying again. No automatic retry.'});
      end(signal.aborted?'cancelled':'error');
    }
  }
  cancel(id){
    if(this.session.state.playroom)throw Error('Exit playroom first');
    const job=(this.session.state.imageJobs||[]).find(j=>j.id===id);if(!job)throw Error('Image job not found');
    if(!pending.includes(job.status))return this.result(job);
    this.update(id,{status:'cancelled',detail:'Stopped waiting; provider processing and charges may still occur. No automatic retry.'});
    if(this.active?.id===id)this.active.controller.abort();
    return this.result(this.session.state.imageJobs.find(j=>j.id===id));
  }
  read(id){
    if(!/^[0-9a-f-]{36}$/.test(id)||!(this.session.state.imageJobs||[]).some(j=>j.id===id&&j.status==='completed'))throw Error('Image not found');
    return readFileSync(join(this.directory,id+'.png'));
  }
  async close(){
    this.closed=true;
    if(this.active){
      const active=this.active;active.controller.abort();
      try{if(pending.includes(this.session.state.imageJobs.find(j=>j.id===active.id)?.status))this.update(active.id,{status:'interrupted',detail:'Server stopped waiting. Provider completion and charges may be unknown; no automatic retry.'});}
      finally{await active.promise;}
    }
  }
}
