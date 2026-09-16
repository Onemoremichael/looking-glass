(function(){
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  var animals=['elephant','giraffe','penguin','bear'];
  window.GlassPlayroom={render:function(g){
    if(!g)return '';
    var bear=g.kind==='bear',done=g.phase==='complete',name=bear||done?'bear':animals[g.index];
    if(animals.indexOf(name)===-1)return '';
    return '<section class="playroom '+(bear?'bear-game':'animal-game')+'" data-feedback="'+esc(g.feedback)+'"><div class="playroom-kicker">'+(bear?'PIP’S LITTLE ADVENTURES':'ANIMAL FRIENDS')+'<span>Adult rehearsal</span></div><h2>'+(done?'Lovely playing!':bear?'A little imagination.':'Who’s this?')+'</h2><div class="playroom-stage"><div class="playroom-glow"></div><div class="playroom-character"><img src="/assets/playroom/'+name+'-v1.png" alt="'+(bear?'Pip the pretend bear':'Animal guessing card')+'">'+(bear?'<span class="bear-mouth" aria-hidden="true"></span>':'')+'</div></div><div class="playroom-speech"><p>'+esc(g.prompt)+'</p></div>'+(g.options.length?'<ol class="playroom-options">'+g.options.map(function(o){return '<li>'+esc(o)+'</li>';}).join('')+'</ol>':'')+(!bear&&!done?'<div class="playroom-progress" aria-label="Card '+(g.index+1)+' of 4">'+animals.map(function(_,i){return '<span class="'+(i===g.index?'current':i<g.index?'visited':'')+'"></span>';}).join('')+'</div>':'')+'</section>';
  },voice:function(state){document.documentElement.setAttribute('data-playroom-speaking',state.phase==='speaking'?'true':'false');}};
}());
