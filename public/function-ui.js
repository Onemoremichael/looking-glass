(function(){
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function block(b,data){
    var v=data[b.key],html='<article class="function-block function-'+b.kind+'"><h3>'+esc(b.label)+'</h3>';
    if(b.kind==='metric')html+='<p class="function-value">'+esc(v)+'<span>'+esc(b.unit)+'</span></p>';
    if(b.kind==='note')html+='<p class="function-note">'+esc(v)+'</p>';
    if(b.kind==='list')html+='<ol>'+v.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ol>';
    if(b.kind==='bars'){
      var max=Math.max.apply(Math,v.map(function(x){return Math.abs(x.value);}));
      html+=v.map(function(x){var width=max?Math.round(Math.abs(x.value)/max*20)*5:0;return '<div class="function-bar"><div><span>'+esc(x.label)+'</span><strong>'+esc(x.value)+'</strong></div><div class="function-track"><i class="function-fill-'+width+'"></i></div></div>';}).join('');
    }
    return html+'</article>';
  }
  window.GlassFunction={render:function(state,companion){
    var view=state.customView,library=(state.reusableViews||[]).filter(function(v){return v.kind==='function';}),html='<section class="function-view">';
    if(!view)html+='<h2>A little ingenuity.</h2><p>Ask me to make something useful.</p>';
    else{
      var pages=Math.ceil(view.spec.layout.blocks.length/2),page=Math.max(0,Math.min(pages-1,view.page||0));
      html+='<div class="function-heading"><h2>'+esc(view.spec.title)+'</h2>'+(view.output&&pages>1?'<span>'+esc(page+1)+' / '+pages+'</span>':'')+'</div>';
      if(view.output)html+='<div class="function-canvas accent-'+esc(view.spec.layout.accent)+'">'+view.spec.layout.blocks.slice(page*2,page*2+2).map(function(b){return block(b,view.output);}).join('')+'</div>';
      else html+='<p class="function-question">'+(view.spec.inputs.length?'What values should I use?':'Ready when you are.')+'</p>'+(companion?'':'<p>'+view.spec.inputs.map(function(i){return esc(i.label);}).join(' · ')+'</p>');
      if(companion){
        if(view.output&&pages>1)html+='<div class="function-pages"><button data-function-page="previous"'+(page===0?' disabled':'')+'>Previous</button><button data-function-page="next"'+(page===pages-1?' disabled':'')+'>Next</button></div>';
        html+='<form data-function-run="'+esc(view.functionId)+'"><h3>Try new values</h3>'+view.spec.inputs.map(function(i){var v=view.input?view.input[i.name]:'';return '<label>'+esc(i.label)+(i.type==='boolean'?'<select name="'+esc(i.name)+'" required><option value="">Choose</option><option value="true"'+(v===true?' selected':'')+'>Yes</option><option value="false"'+(v===false?' selected':'')+'>No</option></select>':'<input name="'+esc(i.name)+'" type="'+(i.type==='number'?'number':'text')+'" '+(i.type==='number'?'min="-1000000000" max="1000000000" step="any"':'maxlength="400"')+' value="'+esc(v)+'" required>')+'</label>';}).join('')+'<button>Calculate locally</button></form>';
        html+='<details><summary>How this works</summary><p>'+esc(view.spec.outcome)+'</p><p>Runs locally without network or device access. '+esc(view.testsPassed)+' example tests passed on this run; examples are not an independent correctness guarantee.</p><pre>'+esc(view.spec.code)+'</pre></details>';
      }
    }
    if(companion)html+='<div class="function-library"><h3>Saved functions</h3>'+library.map(function(v){return '<button class="subtle" data-function-open="'+esc(v.id)+'">'+esc(v.spec.title)+(v.parentId?' · variation':'')+'</button>';}).join('')+'</div><p id="function-status" role="status"></p>';
    return html+'</section>';
  }};
}());
