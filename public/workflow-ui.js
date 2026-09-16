(function(){
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function selected(state){return (state.workflows||[]).filter(function(r){return r.id===state.workflowId;})[0];}
  function button(action,run,label,extra){return '<button data-workflow="'+action+'" data-run="'+esc(run.id)+'"'+(extra||'')+'>'+label+'</button>';}
  window.GlassWorkflow={
    ownsQuestion:function(state){var r=selected(state),step=r&&r.steps.filter(function(s){return s.status!=='completed';})[0];return state.panel==='workflows'&&step&&step.status==='needs_input'&&step.receipt&&state.assistant&&step.receipt.questionId===state.assistant.id;},
    strip:function(state){var r=selected(state);if(!r||state.panel==='workflows'||state.playroom||['cancelled','completed'].indexOf(r.status)!==-1)return '';return '<aside class="workflow-strip"><span>'+esc(r.title)+'</span><strong>'+r.steps.filter(function(s){return s.status==='completed';}).length+' / '+r.steps.length+'</strong><p>'+esc(r.detail)+'</p></aside>';},
    render:function(state,companion){
      var r=selected(state),html='<section class="workflow-view">';
      if(!r)html+='<h2>Big ideas.<br>One step at a time.</h2><p>Ask me to plan something with a few moving parts.</p>';
      else{
        var done=r.steps.filter(function(s){return s.status==='completed';}).length,current=r.steps.filter(function(s){return s.status!=='completed';})[0],index=current?r.steps.indexOf(current):r.steps.length-1;
        html+='<div class="workflow-heading"><span class="workflow-kicker">'+esc(r.status.replace(/_/g,' '))+'</span><span>'+done+' / '+r.steps.length+'</span></div><h2>'+esc(r.title)+'</h2><p class="workflow-outcome">'+esc(r.outcome)+'</p><div class="workflow-track" aria-label="'+done+' of '+r.steps.length+' steps finished">'+r.steps.map(function(s){return '<i class="'+esc(s.status)+'"></i>';}).join('')+'</div>';
        html+='<div class="workflow-focus"><span class="workflow-kicker">'+(r.status==='completed'?'ALL SET':r.status==='needs_input'?'YOUR TURN':'NEXT UP')+'</span><h3>'+esc(r.status==='completed'?'A little more done.':current?current.title:r.title)+'</h3><p>'+esc(r.detail)+'</p></div>';
        if(r.status==='needs_input'&&current&&current.options&&current.options.length)html+='<ol class="workflow-options">'+current.options.map(function(o){return '<li>'+esc(o.label)+'</li>';}).join('')+'</ol>';
        var visible=companion?r.steps:r.steps.slice(Math.max(0,index-1),Math.max(0,index-1)+3);
        html+='<ol class="workflow-steps">'+visible.map(function(s){return '<li><span class="workflow-step-number">'+(s.status==='completed'?'✓':r.steps.indexOf(s)+1)+'</span><div><h4>'+esc(s.title)+'</h4><p>'+esc(s.status.replace(/_/g,' '))+'</p>'+(companion&&s.evidence?'<details><summary>Completion evidence</summary><p>'+esc(s.evidence.summary||s.evidence.confirmation||s.evidence.type)+'</p></details>':'')+'</div></li>';}).join('')+'</ol>';
        if(companion){
          html+='<div class="workflow-controls">';
          if(r.status==='running')html+=button('pause_workflow',r,'Pause');
          if(['paused','blocked'].indexOf(r.status)!==-1)html+=button('continue_workflow',r,'Resume');
          if(r.status==='needs_input'&&!r.inputQuestions.length&&current&&current.kind==='confirm')html+=button('confirm_workflow_step',r,'I’ve done this',' data-step="'+esc(current.id)+'"');
          if(['completed','cancelled'].indexOf(r.status)===-1)html+=button('cancel_workflow',r,'Cancel run');
          html+='</div>';
          if(r.inputQuestions.length)html+='<form data-workflow-inputs="'+esc(r.id)+'">'+r.inputQuestions.map(function(i){return '<label>'+esc(i.question)+'<input name="'+esc(i.name)+'" maxlength="200" required></label>';}).join('')+'<button>Continue with these details</button></form>';
          else if(r.status==='needs_input'&&current&&current.kind!=='confirm')html+='<form data-workflow-reply="'+esc(r.id)+'"><label>'+esc(current.detail)+'<input name="reply" maxlength="600" required></label><button>Continue</button></form>';
        }
      }
      if(companion){
        html+='<div class="workflow-library"><h3>Your plans</h3>'+(state.workflows||[]).slice().reverse().map(function(r){return button('open_workflow',r,esc(r.title)+' · '+esc(r.status));}).join('')+'<h3>Start fresh from a saved flow</h3>'+(state.reusableViews||[]).filter(function(v){return v.kind==='workflow';}).map(function(v){return '<button data-workflow="reuse_workflow" data-view="'+esc(v.id)+'">'+esc(v.spec.title)+'</button>';}).join('')+'</div>';
      }
      return html+'</section>';
    }
  };
}());
