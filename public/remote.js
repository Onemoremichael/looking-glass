(function(){
  var state = null,dom=window.GlassDOM;
  function esc(s){return String(s == null ? '' : s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function button(action,id,label){return '<button data-action="'+action+'" data-id="'+esc(id)+'">'+label+'</button>';}
  function send(body){
    var x=new XMLHttpRequest();x.open('POST','/api/command');x.setRequestHeader('Content-Type','application/json');x.timeout=5000;
    function error(){document.getElementById('connection').textContent='Command failed. Check the connection and inputs.';}
    x.onload=function(){if(x.status!==200)error();};x.onerror=error;x.ontimeout=error;x.send(JSON.stringify(body));
  }
  function render(){
    var panels=['home','time','timers','todos','weather','research','studio','workflows','functions','calendar','tasks','saved'];
    dom.patch(document.getElementById('nav'),panels.map(function(p){return '<button data-panel="'+p+'" aria-current="'+(p===state.panel)+'">'+({todos:'To-dos',tasks:'Requests',saved:'Saved views'}[p]||p.charAt(0).toUpperCase()+p.slice(1))+'</button>';}).join('')+'<a class="nav-link" href="/clocks">Clock studio ↗</a>');
    var message=document.getElementById('message');
    message.textContent=state.assistant?'':state.message;message.hidden=!!state.assistant||state.panel==='research';
    var html='',savedCount=state.recipes.length+(state.weatherViews||[]).length;
if(state.panel==='home')html='<div class="grid"><article><span class="tag">WORKING LOCALLY</span><h3>Everyday essentials</h3><p>Time, persistent timers, and a simple to-do list.</p></article><article><span class="tag">YOUR CAPABILITY LIBRARY</span><h3>'+savedCount+' saved views</h3><p>Keep the structure. Refresh the facts. Fork a view when your needs change.</p></article><article><span class="tag">HONEST STATUS</span><h3>'+state.tasks.filter(function(t){return t.status!=='cancelled';}).length+' requests</h3><p>Clarify first. See what is blocked. No background research is running.</p></article><article><span class="tag">OUTCOME-FIRST VOICE</span><h3>Speak, then see it</h3><p>Ask naturally. The agent can act, clarify with shared options, or explain a limitation. Read-only web research is available by voice.</p></article></div>';
    if(state.panel==='time')html='<p class="empty">Time shown above follows this device’s clock and time zone.</p>';
    if(state.panel==='weather')html='<div id="weather-content">'+window.GlassWeather.render(state.weather)+'</div>';
    if(state.panel==='playroom')html=window.GlassPlayroom.render(state.playroom);
    if(state.panel==='studio')html=window.GlassStudio.render(state,true);
    if(state.panel==='workflows')html=window.GlassWorkflow.render(state,true);
    if(state.panel==='functions')html=window.GlassFunction.render(state,true);
    if(state.panel==='research')html=window.GlassResearch.render(state.research,true);
    if(state.panel==='calendar')html='<article><span class="tag">NOT CONNECTED</span><h2>A clear view of your day.</h2><p>Connect a calendar explicitly before we can review events. No account access has been requested.</p></article>';
    if(state.panel==='timers'){
      html='<form id="timer-form"><label for="seconds">Duration in seconds (1–86400)</label><input id="seconds" type="number" min="1" max="86400" value="300" required><button>Start timer</button></form><p class="note">Visual alerts only. Saved across server restarts; not a safety-critical alarm.</p>';
      html+=state.timers.map(function(t){return '<article data-render-key="timer:'+esc(t.id)+'"><span class="tag">'+esc(t.label)+'</span><div class="countdown" data-end="'+t.endsAt+'"></div>'+button('cancel_timer',t.id,'Dismiss timer')+'</article>';}).join('');
    }
    if(state.panel==='todos'){
      html='<form id="todo-form"><label for="todo">Add something to do</label><input id="todo" maxlength="300" required><button>Add item</button></form>';
      html+=state.todos.map(function(t,i){return '<div class="row" data-render-key="todo:'+esc(t.id)+'"><button data-action="toggle_todo" data-id="'+esc(t.id)+'" aria-label="'+esc(t.done?'Mark incomplete':'Mark complete')+'">'+(t.done?'✓':'○')+'</button><span class="'+(t.done?'done':'')+'">'+(i+1)+'. '+esc(t.text)+'</span></div>';}).join('');
    }
    if(state.panel==='tasks'){
      html=state.tasks.length?'':'<p class="empty">Ask for something new. We’ll capture the request and clarify what matters.</p>';
      html+=state.tasks.map(function(t){return '<article><span class="tag">'+esc(t.status.replace('_',' '))+'</span><h3>'+esc(t.request)+'</h3><p>'+esc(t.question||t.detail||'')+'</p>'+(t.answers?'<p>Preferences: '+esc(t.answers)+'</p>':'')+(t.status==='needs_input'?'<form data-answer="'+esc(t.id)+'"><label>Tell us a little more<textarea name="answer" required maxlength="600"></textarea></label><button>Save preferences</button></form>':'')+(t.status==='blocked'?button('save_recipe',t.id,'Keep this configuration'):'')+(t.status!=='cancelled'?button('cancel_task',t.id,'Cancel request'):'')+'</article>';}).join('');
    }
    if(state.panel==='saved'){
      html=savedCount?'':'<p class="empty">Nothing saved yet. Supported custom views save automatically.</p>';
      html+=state.recipes.map(function(r){return '<article><span class="tag">CONFIGURATION ONLY · SOURCE NOT CONNECTED</span><h3>'+esc(r.title)+'</h3><p>'+esc(r.preferences)+'</p><p class="note">Agenda component · refresh on open when connected · no scheduled work'+(r.parentId?' · forked variation':'')+'</p>'+button('open_recipe',r.id,'Open')+'<details><summary>Create a variation</summary><form data-fork="'+esc(r.id)+'"><label>New name<input name="title" maxlength="80" required></label><label>Preferences<textarea name="preferences" maxlength="600" required>'+esc(r.preferences)+'</textarea></label><button>Save variation</button></form></details></article>';}).join('');
    }
    if(state.panel==='saved')html=(state.weatherViews||[]).map(function(v){return '<article><span class="tag">REUSABLE WEATHER VIEW</span><h3>'+esc(v.spec.title)+'</h3><p>'+esc(v.spec.range.replace(/_/g,' '))+' · '+esc(v.spec.focus)+' focus</p>'+button('open_weather_view',v.id,'Open forecast')+'</article>';}).join('')+html;
    dom.patch(document.getElementById('panel'),window.GlassSurface.card(state)+html+window.GlassWorkflow.strip(state)+window.GlassSurface.saveOffer(state),{scope:state.panel});window.GlassWeatherControls.render(state);tick();window.GlassSurface.rendered(state);window.dispatchEvent(new CustomEvent('workflow-state',{detail:state}));
  }
  function tick(){
    var d=new Date();dom.text(document.getElementById('clock'),d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));
    dom.text(document.getElementById('date'),d.toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'}));
    Array.prototype.forEach.call(document.querySelectorAll('[data-end]'),function(el){var s=Math.max(0,Math.ceil((Number(el.getAttribute('data-end'))-Date.now())/1000));dom.text(el,s?Math.floor(s/60)+':'+('0'+s%60).slice(-2):'Time’s up');});
  }
  document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-panel'))send({action:'show',panel:b.getAttribute('data-panel')});if(b.hasAttribute('data-action'))send({action:b.getAttribute('data-action'),id:b.getAttribute('data-id')});});
  document.addEventListener('click',function(e){var b=e.target.closest('button[data-research-page]');if(b&&!b.disabled)send({action:'research_page',direction:b.getAttribute('data-research-page')});});
  document.addEventListener('submit',function(e){
    e.preventDefault();var f=e.target;
    if(f.id==='request-form'){send({action:'request',text:document.getElementById('request').value});}
    if(f.id==='timer-form')send({action:'start_timer',seconds:Number(document.getElementById('seconds').value)});
    if(f.id==='todo-form')send({action:'add_todo',text:document.getElementById('todo').value});
    if(f.hasAttribute('data-answer'))send({action:'answer',id:f.getAttribute('data-answer'),text:f.elements.answer.value});
    if(f.hasAttribute('data-fork'))send({action:'fork_recipe',id:f.getAttribute('data-fork'),title:f.elements.title.value,preferences:f.elements.preferences.value});
  });
  document.getElementById('gators').textContent='Gators at home · next 2 weeks';
  document.getElementById('gators').onclick=function(){
    if(!state)return;
    var button=this,x=new XMLHttpRequest();button.disabled=true;
    document.getElementById('connection').textContent='Checking official Gators schedules. Progress will appear in Workflows.';
    x.open('POST','/api/workflows');x.setRequestHeader('Content-Type','application/json');x.timeout=10000;
    x.onload=function(){button.disabled=false;if(x.status>=300){var b;try{b=JSON.parse(x.responseText);}catch(e){}document.getElementById('connection').textContent=b&&b.error||'Could not start research.';}};
    x.onerror=x.ontimeout=function(){button.disabled=false;document.getElementById('connection').textContent='Connection interrupted. Check Workflows before retrying.';};
    x.send(JSON.stringify({requestId:'gators-'+Date.now()+'-'+Math.random().toString(36).slice(2),revision:state.revision,command:window.GlassGators.command(state)}));
  };
  window.GlassSurface.subscribe({
    voice:function(value){window.GlassPlayroom.voice(value);window.dispatchEvent(new CustomEvent('glass-voice',{detail:value}));},
    wake:function(value){window.dispatchEvent(new CustomEvent('glass-wake',{detail:value}));},
    playroomAudio:function(value){window.GlassPlayroom.voice(value);window.dispatchEvent(new CustomEvent('glass-playroom-audio',{detail:value}));},
    state:function(value){state=value;render();document.getElementById('connection').textContent='Local display connected · camera off';},
    error:function(){document.getElementById('connection').textContent='Disconnected. Reconnecting; displayed state may be stale.';}
  });
  tick();setInterval(tick,500);
  setInterval(function(){var el=document.getElementById('weather-content');if(el&&state)dom.patch(el,window.GlassWeather.render(state.weather));},60000);
}());
