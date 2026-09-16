async function refresh(){
  try{
    const response=await fetch('/api/telemetry');if(!response.ok)throw Error('Diagnostics unavailable');const data=await response.json();
    document.getElementById('mode').textContent='Local transcripts '+(data.captureTranscripts?'on':'off')+' · OTLP export '+(data.exportEnabled?'on':'off')+' · write failures '+(data.writeFailures||0)+' · export failures '+(data.exportFailures||0);
    const metrics=document.getElementById('metrics');metrics.replaceChildren();
    for(const [name,m] of Object.entries(data.metrics)){const line=document.createElement('p');line.textContent=name+': '+m.count+' completed spans · '+m.errors+' errors · p50 '+(m.p50_ms??'—')+' ms · p95 '+(m.p95_ms??'—')+' ms';metrics.appendChild(line);}
    const timeline=document.getElementById('timeline');timeline.replaceChildren();
    for(const r of [...data.records].reverse()){
      const item=document.createElement('article'),title=document.createElement('h3'),detail=document.createElement('p'),id=document.createElement('small');
      title.textContent=r.at+' · '+(r.kind==='transcript'?r.speaker:r.name+' · '+(r.event||r.kind));
      detail.textContent=r.kind==='transcript'?r.text:JSON.stringify(r.attributes);
      id.textContent='Trace '+r.traceId+' / '+r.spanId;item.append(title,detail,id);timeline.appendChild(item);
    }
    if(!data.records.length)timeline.textContent='No traces captured yet. The next voice session will appear here.';
  }catch(e){document.getElementById('mode').textContent=e.message;}
}
document.getElementById('refresh').onclick=refresh;refresh();
