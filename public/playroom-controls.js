(function(){
  function act(body){
    var x=new XMLHttpRequest();x.open('POST','/api/playroom');x.setRequestHeader('Content-Type','application/json');
    x.onload=function(){var status=document.getElementById('playroom-control-status');try{var r=JSON.parse(x.responseText);status.textContent=x.status===200?(body.action==='start'?'Rehearsal ready. Start a fresh voice conversation above, then say hello or answer the card.':'Playroom closed. Microphone stopped.'):(r.error||'Could not change playroom.');}catch(e){status.textContent='Could not change playroom.';}};
    x.send(JSON.stringify(body));
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-playroom-start]'),function(el){el.addEventListener('click',function(){
    if(!document.getElementById('playroom-adult').checked){document.getElementById('playroom-control-status').textContent='Please acknowledge adult-only rehearsal first.';return;}
    act({action:'start',kind:el.getAttribute('data-playroom-start'),adultRehearsal:true});
  });});
  document.getElementById('playroom-stop').addEventListener('click',function(){act({action:'stop'});});
}());
