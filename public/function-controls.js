(function(){
  var state=null,busy=false;
  window.addEventListener('workflow-state',function(e){state=e.detail;});
  function send(command){
    if(!state||busy)return;busy=true;
    var x=new XMLHttpRequest(),status=document.getElementById('function-status');if(status)status.textContent='Checking and calculating…';
    x.open('POST','/api/functions');x.setRequestHeader('Content-Type','application/json');x.timeout=6000;
    function done(message){busy=false;var el=document.getElementById('function-status');if(el)el.textContent=message;}
    x.onload=function(){if(x.status===200)done('');else{try{done(JSON.parse(x.responseText).error||'Could not calculate.');}catch(e){done('Could not calculate.');}}};x.onerror=function(){done('Connection lost. Check before retrying.');};x.ontimeout=x.onerror;
    x.send(JSON.stringify({requestId:'function-ui-'+Date.now()+'-'+Math.random().toString(36).slice(2),revision:state.revision,command:command}));
  }
  document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-function-open'))send({action:'open_function',viewId:b.getAttribute('data-function-open')});if(b.hasAttribute('data-function-page'))send({action:'function_page',direction:b.getAttribute('data-function-page')});});
  document.addEventListener('submit',function(e){var f=e.target;if(!f.hasAttribute('data-function-run'))return;e.preventDefault();if(!state||!state.customView)return;var input={};state.customView.spec.inputs.forEach(function(i){var v=f.elements[i.name].value;input[i.name]=i.type==='number'?Number(v):i.type==='boolean'?v==='true':v;});send({action:'run_function',viewId:f.getAttribute('data-function-run'),inputJSON:JSON.stringify(input)});});
}());
