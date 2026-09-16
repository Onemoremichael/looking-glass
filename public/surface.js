(function(){
  var revision=null,clientId='tab-'+Math.random().toString(36).slice(2),surface=location.pathname==='/remote'?'companion':'mirror';
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function report(){
    if(revision===null)return;
    var x=new XMLHttpRequest();x.open('POST','/api/surface');x.setRequestHeader('Content-Type','application/json');x.timeout=3000;
    x.send(JSON.stringify({clientId:clientId,surface:surface,revision:revision,visible:!document.hidden}));
  }
  window.GlassSurface={
    // Hidden development tabs must not occupy HTTP/1 streaming slots forever.
    // Keep the voice-owning companion subscribed even when it is backgrounded.
    subscribe:function(handlers){
      var events=null,voiceActive=false,closed=false;
      function sync(){
        var needed=!closed&&(!document.hidden||voiceActive);
        if(!needed){if(events)events.close();events=null;return;}
        if(events)return;
        var source=events=new EventSource('/api/events');
        source.onmessage=function(e){if(events===source)handlers.state(JSON.parse(e.data));};
        source.addEventListener('voice',function(e){if(events===source)handlers.voice(JSON.parse(e.data));});
        source.addEventListener('wake',function(e){if(events===source&&handlers.wake)handlers.wake(JSON.parse(e.data));});
        source.addEventListener('playroom-audio',function(e){if(events===source&&handlers.playroomAudio)handlers.playroomAudio(JSON.parse(e.data));});
        source.onerror=function(){if(events===source)handlers.error();};
      }
      document.addEventListener('visibilitychange',sync);
      window.addEventListener('glass-voice-active',function(e){voiceActive=!!e.detail;sync();});
      window.addEventListener('pagehide',function(){closed=true;sync();});
      window.addEventListener('pageshow',function(){closed=false;sync();});
      sync();
    },
    rendered:function(state){revision=state.revision;report();},
    saveOffer:function(state){var o=state.viewOffer,c=state.weather&&state.weather.composition;return o&&o.expiresAt>Date.now()&&state.panel==='weather'&&c&&o.compositionId===c.id?'<div class="view-save-offer">'+esc(o.question)+'<small>Say yes to keep the layout, or no for just this time.</small></div>':'';},
    card:function(state){
      if(window.GlassWorkflow&&window.GlassWorkflow.ownsQuestion(state))return '';
      var a=state.assistant;if(!a||a.status==='execute')return '';
      // Show information the user needs, not a narration of the UI mutation.
      return '<article class="assistant-card" aria-label="Assistant '+(a.status==='clarify'?'question':'answer')+'"><p class="assistant-message">'+esc(a.message)+'</p>'+(a.options.length?'<ol class="assistant-options">'+a.options.map(function(o){return '<li>'+esc(o.label)+'</li>';}).join('')+'</ol><p class="note">Say the option number or name.</p>':'')+'</article>';
    }
  };
  document.addEventListener('visibilitychange',report);setInterval(report,5000);
}());
