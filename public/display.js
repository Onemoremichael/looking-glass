(function(){
  function esc(s){return String(s == null ? '' : s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function render(state){
    var html='';
    if(state.panel==='weather'||state.panel==='calendar')html='<article><span class="tag">NOT CONNECTED</span><h2>'+esc(state.panel==='weather'?'Weather':'Calendar')+'</h2><p>Set up this connection from your companion.</p></article>';
    if(state.panel==='todos')html=state.todos.slice(0,5).map(function(t,i){return '<p class="'+(t.done?'done':'')+'">'+(i+1)+'. '+(t.done?'✓ ':'○ ')+esc(t.text)+'</p>';}).join('')+(state.todos.length>5?'<p class="note">More items on your companion.</p>':'')||'<p class="empty">Nothing on your list.</p>';
    if(state.panel==='tasks')html=state.tasks.slice(0,3).map(function(t){return '<article><span class="tag">'+esc(t.status.replace('_',' '))+'</span><h3>'+esc(t.request)+'</h3><p>'+esc(t.question||t.detail||'')+'</p>'+(t.status==='needs_input'?'<p class="note">Prototype request · reply using companion controls</p>':'')+'</article>';}).join('');
    if(state.panel==='saved')html=state.recipes.slice(0,3).map(function(r){return '<article><span class="tag">CONFIGURATION ONLY · DATA NOT CONNECTED</span><h3>'+esc(r.title)+'</h3><p>'+esc(r.preferences)+'</p></article>';}).join('');
    // Timers remain visible regardless of the requested panel.
    html+=state.timers.map(function(t){return '<article><span class="tag">'+esc(t.label)+'</span><div class="countdown" data-end="'+t.endsAt+'"></div><p class="note">Visual alert only</p></article>';}).join('');
    document.getElementById('panel').innerHTML=window.GlassSurface.card(state)+html;tick();window.GlassSurface.rendered(state);
  }
  function tick(){
    var d=new Date();document.getElementById('clock').textContent=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    document.getElementById('date').textContent=d.toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'});
    Array.prototype.forEach.call(document.querySelectorAll('[data-end]'),function(el){var s=Math.max(0,Math.ceil((Number(el.getAttribute('data-end'))-Date.now())/1000));el.textContent=s?Math.floor(s/60)+':'+('0'+s%60).slice(-2):'Time’s up';});
  }
  window.GlassSurface.subscribe({voice:function(state){
    var indicator=document.getElementById('mirror-voice');
    indicator.className='mirror-voice'+(state.phase==='off'?' off':''); indicator.setAttribute('data-phase',state.phase);
    document.getElementById('mirror-voice-label').textContent=state.phase==='needs_input'?state.detail:({listening:'Listening',thinking:'Working on your request',speaking:'Speaking',muted:'Mic muted',connecting:'Connecting',stopping:'Finishing',error:'Voice unavailable'}[state.phase]||'');
  },
  state:function(state){render(state);var status=document.getElementById('connection');status.textContent='';status.hidden=true;},
  error:function(){var status=document.getElementById('connection');status.textContent='Connection lost · displayed information may be stale';status.hidden=false;}
  });
  tick();setInterval(tick,500);
}());
