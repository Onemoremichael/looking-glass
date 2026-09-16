(function(){
  function act(body){
    var x=new XMLHttpRequest();x.open('POST','/api/playroom');x.setRequestHeader('Content-Type','application/json');
    x.onload=function(){var status=document.getElementById('playroom-control-status');try{var r=JSON.parse(x.responseText);status.textContent=x.status===200?(body.action==='start'?'Rehearsal ready. Start a fresh GPT-Live conversation above for Marin, then say hello or answer the card. Local diagnostics use a different voice.':'Playroom closed. Microphone stopped.'):(r.error||'Could not change playroom.');}catch(e){status.textContent='Could not change playroom.';}};
    x.send(JSON.stringify(body));
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-playroom-start]'),function(el){el.addEventListener('click',function(){
    if(!document.getElementById('playroom-adult').checked){document.getElementById('playroom-control-status').textContent='Please acknowledge adult-only rehearsal first.';return;}
    act({action:'start',kind:el.getAttribute('data-playroom-start'),adultRehearsal:true});
  });});
  document.getElementById('playroom-stop').addEventListener('click',function(){act({action:'stop'});});
  function local(action){
    if(action==='start'&&!document.getElementById('playroom-adult').checked){document.getElementById('playroom-control-status').textContent='Acknowledge adult rehearsal first.';return;}
    var x=new XMLHttpRequest();x.open('POST','/api/playroom-audio');x.setRequestHeader('Content-Type','application/json');x.timeout=20000;
    x.onload=function(){try{var r=JSON.parse(x.responseText);document.getElementById('playroom-control-status').textContent=r.error||r.detail;}catch(e){document.getElementById('playroom-control-status').textContent='Check local game audio status.';}};
    x.onerror=x.ontimeout=function(){document.getElementById('playroom-control-status').textContent='Connection interrupted. Use Stop local mic if needed; local capture has a three-minute limit.';};
    x.send(JSON.stringify({action:action,adultRehearsal:true}));
  }
  document.getElementById('playroom-local-start').addEventListener('click',function(){local('start');});
  document.getElementById('playroom-local-stop').addEventListener('click',function(){local('stop');});
  window.addEventListener('glass-playroom-audio',function(e){
    var s=e.detail;document.getElementById('playroom-control-status').textContent=s.detail;
    document.getElementById('playroom-local-start').disabled=['off','error'].indexOf(s.phase)===-1;
    document.getElementById('playroom-local-stop').disabled=['off','error'].indexOf(s.phase)!==-1;
  });
}());
