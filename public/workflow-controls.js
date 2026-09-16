(function(){
  var revision;
  window.addEventListener('workflow-state',function(e){revision=e.detail.revision;});
  function send(command,confirmed){
    var x=new XMLHttpRequest();x.open('POST','/api/workflows');x.setRequestHeader('Content-Type','application/json');x.timeout=10000;
    x.onload=function(){if(x.status>=300){var b;try{b=JSON.parse(x.responseText);}catch(e){}document.getElementById('connection').textContent=b&&b.error||'Workflow action failed';}};
    x.onerror=x.ontimeout=function(){document.getElementById('connection').textContent='Connection interrupted. Check the saved plan before trying again.';};
    x.send(JSON.stringify({requestId:'companion-'+Date.now()+'-'+Math.random().toString(36).slice(2),revision:revision,command:command,confirmed:!!confirmed}));
  }
  document.addEventListener('click',function(e){var b=e.target.closest('[data-workflow]');if(!b)return;var a=b.getAttribute('data-workflow'),command={action:a,runId:b.getAttribute('data-run')};if(a==='reuse_workflow')command={action:a,viewId:b.getAttribute('data-view'),values:[]};if(a==='continue_workflow')command.reply=null;if(a==='confirm_workflow_step')command.stepId=b.getAttribute('data-step');send(command,a==='confirm_workflow_step');});
  document.addEventListener('submit',function(e){var f=e.target;if(f.hasAttribute('data-workflow-inputs')){e.preventDefault();send({action:'provide_workflow_inputs',runId:f.getAttribute('data-workflow-inputs'),values:Array.prototype.map.call(f.querySelectorAll('input'),function(i){return {name:i.name,value:i.value};})});}if(f.hasAttribute('data-workflow-reply')){e.preventDefault();send({action:'continue_workflow',runId:f.getAttribute('data-workflow-reply'),reply:f.elements.reply.value});}});
}());
