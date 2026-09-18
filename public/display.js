(function(){
  var lastState=null,weatherMinute=-1,voiceState=null,wakeState=null,dom=window.GlassDOM;
  function navigationHints(){
    if(!window.GlassResearch)return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-research-direction]'),function(el){
      var wake=wakeState;
      if(wake&&lastState&&wake.shortcutRevision!==lastState.revision){wake={enabled:wake.enabled,phase:wake.phase,shortcuts:[]};}
      dom.text(el,window.GlassResearch.navigationHint(el.getAttribute('data-research-direction'),voiceState,wake));
    });
  }
  // The recovered Android image can default to UTC. Deployment may explicitly
  // supply the Mac's IANA zone without changing Android's system configuration.
  var timeOptions={hour:'numeric',minute:'2-digit'},dateOptions={weekday:'long',month:'short',day:'numeric'};
  var zoneMatch=location.search.match(/(?:^|[?&])timeZone=([^&]+)/);
  if(zoneMatch){
    try{
      var zone=decodeURIComponent(zoneMatch[1]);
      new Intl.DateTimeFormat('en-US',{timeZone:zone}).format(new Date());
      timeOptions.timeZone=zone;dateOptions.timeZone=zone;
    }catch(e){/* Invalid/unsupported zones retain the device-local fallback. */}
  }
  function esc(s){return String(s == null ? '' : s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function render(state){
    lastState=state;var bodyClass='mirror-display'+(state.panel==='weather'?' weather-open':state.panel==='research'?' research-open':state.panel==='playroom'?' playroom-open':state.panel==='studio'?' studio-open':'');
    var clockMode=['home','time'].indexOf(state.panel)!==-1&&!state.timers.length&&(!state.assistant||state.assistant.status==='execute');
    document.getElementById('clock-art').hidden=!clockMode;if(clockMode)bodyClass+=' clock-open';
    var html='';
    if(state.panel==='workflows'){bodyClass='mirror-display workflow-open';html=window.GlassWorkflow.render(state,false);}
    if(state.panel==='functions'){bodyClass='mirror-display function-open';html=window.GlassFunction.render(state,false);}
    if(state.panel==='studio')html=window.GlassStudio.render(state,false);
    if(state.panel==='playroom')html=window.GlassPlayroom.render(state.playroom);
    if(state.panel==='research')html=window.GlassResearch.render(state.research,false);
    if(state.panel==='weather')html='<div id="weather-content">'+window.GlassWeather.render(state.weather)+'</div>';
    if(state.panel==='calendar')html='<article><span class="tag">NOT CONNECTED</span><h2>Calendar</h2><p>Set up this connection from your companion.</p></article>';
    if(state.panel==='todos')html=state.todos.slice(0,5).map(function(t,i){return '<p class="'+(t.done?'done':'')+'">'+(i+1)+'. '+(t.done?'✓ ':'○ ')+esc(t.text)+'</p>';}).join('')+(state.todos.length>5?'<p class="note">More items on your companion.</p>':'')||'<p class="empty">Nothing on your list.</p>';
    if(state.panel==='tasks')html=state.tasks.slice(0,3).map(function(t){return '<article><span class="tag">'+esc(t.status.replace('_',' '))+'</span><h3>'+esc(t.request)+'</h3><p>'+esc(t.question||t.detail||'')+'</p>'+(t.status==='needs_input'?'<p class="note">Prototype request · reply using companion controls</p>':'')+'</article>';}).join('');
    if(state.panel==='saved')html=state.recipes.slice(0,3).map(function(r){return '<article><span class="tag">CONFIGURATION ONLY · DATA NOT CONNECTED</span><h3>'+esc(r.title)+'</h3><p>'+esc(r.preferences)+'</p></article>';}).join('');
    if(state.panel==='saved')html=(state.weatherViews||[]).slice(0,3).map(function(v){return '<article><h3>'+esc(v.spec.title)+'</h3><p>'+esc(v.spec.range.replace(/_/g,' '))+' · '+esc(v.spec.focus)+' focus</p></article>';}).join('')+html;
    // Timers remain visible regardless of the requested panel.
    html+=state.timers.map(function(t){return '<article data-render-key="timer:'+esc(t.id)+'"><span class="tag">'+esc(t.label)+'</span><div class="countdown" data-end="'+t.endsAt+'"></div></article>';}).join('');
    dom.attr(document.body,'class',bodyClass);
    dom.patch(document.getElementById('panel'),window.GlassSurface.card(state)+html+window.GlassWorkflow.strip(state)+window.GlassSurface.saveOffer(state),{scope:state.panel});tick();navigationHints();window.GlassSurface.rendered(state);
  }
  function tick(){
    navigationHints();
    var d=new Date();dom.text(document.getElementById('clock'),d.toLocaleTimeString([],timeOptions));
    var art=document.getElementById('clock-art');
    if(art&&!art.hidden&&lastState){var design=lastState.clockDesign||window.GlassClock.defaults(),g=window.GlassClock.geometry(design,window.innerWidth,window.innerHeight);art.style.left=g.left+'px';art.style.top=g.top+'px';art.style.width=g.size+'px';art.style.height=g.size+'px';window.GlassClock.mount(art,design,d,timeOptions.timeZone);}
    dom.text(document.getElementById('date'),d.toLocaleDateString([],dateOptions));
    if(lastState&&lastState.panel==='weather'&&weatherMinute!==Math.floor(Date.now()/60000)){weatherMinute=Math.floor(Date.now()/60000);var weather=document.getElementById('weather-content');if(weather)dom.patch(weather,window.GlassWeather.render(lastState.weather));}
    Array.prototype.forEach.call(document.querySelectorAll('[data-end]'),function(el){var s=Math.max(0,Math.ceil((Number(el.getAttribute('data-end'))-Date.now())/1000));dom.text(el,s?Math.floor(s/60)+':'+('0'+s%60).slice(-2):'Time’s up');});
  }
  window.GlassSurface.subscribe({voice:function(state){
    voiceState=state;navigationHints();
    if(window.GlassPlayroom)window.GlassPlayroom.voice(state);
    var indicator=document.getElementById('mirror-voice');
    // Native audio has its own level-reactive indicator; retain actionable web status.
    var nativeRoutine=state.device==='mirror'&&['listening','speaking','muted'].indexOf(state.phase)!==-1;
    var background=state.background||{},working=background.running>0,ready=background.waitingToAnnounce>0;
    if(working||ready){
      indicator.className='mirror-voice background-work';indicator.setAttribute('data-phase',working?'background':'ready');
      document.getElementById('mirror-voice-label').textContent=working?(background.running>1?background.running+' tasks running':'Working in background'):'Result ready';
      return;
    }
    indicator.className='mirror-voice'+(state.phase==='off'||nativeRoutine?' off':''); indicator.setAttribute('data-phase',state.phase);
    document.getElementById('mirror-voice-label').textContent=state.phase==='needs_input'?state.detail:({listening:'Listening',thinking:'Working on your request',speaking:'Speaking',muted:'Mic muted',connecting:'Connecting',stopping:'Finishing',error:'Voice unavailable'}[state.phase]||'');
  },
  wake:function(state){wakeState=state;navigationHints();},
  playroomAudio:function(state){if(window.GlassPlayroom)window.GlassPlayroom.voice(state);},
  state:function(state){render(state);var status=document.getElementById('connection');status.textContent='';status.hidden=true;},
  error:function(){var status=document.getElementById('connection');status.textContent='Connection lost · displayed information may be stale';status.hidden=false;
    voiceState=null;wakeState=null;navigationHints();
    // A disconnected display must not keep implying that work is progressing.
    document.getElementById('mirror-voice').className='mirror-voice off';
  }
  });
  tick();setInterval(tick,500);
}());
