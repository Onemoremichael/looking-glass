(function(){
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  window.GlassStudio={render:function(state,companion){
    var jobs=state.imageJobs||[],j=jobs.filter(function(x){return x.id===state.imageJobId;})[0];
    var html='<section class="studio"><span class="studio-eyebrow">ART STUDIO</span>';
    if(!j)html+='<h2>A little imagination.</h2><p>Ask me to create a picture.</p>';
    else{
      html+='<h2>'+esc(j.spec.title)+'</h2>';
      if(j.status==='completed'&&/^[0-9a-f-]{36}$/.test(j.id))html+='<div class="studio-art"><img src="/artwork/'+j.id+'.png" alt="'+esc(j.spec.title)+'"></div><p class="studio-caption">AI-generated · saved</p>';
      else html+='<div class="studio-progress" data-state="'+esc(j.status)+'"><span class="studio-orbit" aria-hidden="true"></span><h3>'+({queued:'Getting ready',generating:'A little imagination at work',failed:'Couldn’t finish this one',cancelled:'Stopped',interrupted:'Interrupted'}[j.status]||'Unavailable')+'</h3><p>'+esc(j.detail)+'</p></div>';
      if(companion){html+='<details><summary>Creative recipe</summary><p>'+esc(j.spec.prompt)+'</p><p>'+esc(j.model)+' · '+esc(j.spec.background)+'</p></details>';if(j.status==='generating'||j.status==='queued')html+='<button data-studio-cancel="'+esc(j.id)+'">Stop waiting</button>';}
    }
    if(companion&&jobs.length)html+='<div class="studio-library"><h3>Your artwork</h3>'+jobs.slice().reverse().map(function(x){return '<button class="subtle" data-studio-open="'+esc(x.id)+'">'+esc(x.spec.title)+' · '+esc(x.status)+'</button>';}).join('')+'</div>';
    return html+'</section>';
  }};
}());
