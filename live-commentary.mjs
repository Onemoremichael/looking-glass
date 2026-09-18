// Live commentary has a 500-token cap. A <=480 UTF-8 byte envelope is
// conservatively below it even for non-English text, without a tokenizer.
export function backgroundCommentary(result){
  const status=['completed','needs_input','cancelled'].includes(result?.status)?result.status:'needs_input';
  let message=typeof result?.message==='string'?result.message:'The earlier request finished; check the companion for details.';
  const envelope=()=>JSON.stringify({kind:'background_result',result:{status,message},guidance:'Announce briefly, then listen. Do not rerun the task or assume it is still visible.'});
  if(Buffer.byteLength(envelope(),'utf8')>480){
    // Keep truncation explicit; never send research artifacts, source URLs,
    // code, full layouts or arbitrary result fields as speakable context.
    const chars=Array.from(message);message='';
    for(const c of chars){const prior=message;message+=c;if(Buffer.byteLength(envelope(),'utf8')>477){message=prior;break;}}
    message+='…';
  }
  return envelope();
}
