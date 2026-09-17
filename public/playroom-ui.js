(function(){
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  var animals=['elephant','giraffe','penguin','bear','dog','cat','duck'];
  window.GlassPlayroom={render:function(g){
    if(!g)return '';
    var cards=g.cards||animals.slice(0,4),bear=g.kind==='bear',done=g.phase==='complete',name=bear||done?'bear':cards[g.index];
    if(animals.indexOf(name)===-1)return '';
    var last=!bear&&animals.indexOf(g.lastAnimal)!==-1?g.lastAnimal:null;
    var feedback=last?'<div class="playroom-last"><img src="/assets/playroom/'+last+'-v1.png" alt=""><span>'+(g.feedback==='correct'?'You found: ':'We met: ')+esc(last)+'</span></div>':'';
    var question=last&&!done?'Here’s the next friend. What animal do you see?':g.prompt;
    return '<section class="playroom '+(bear?'bear-game':'animal-game')+'" data-feedback="'+esc(g.feedback)+'"><div class="playroom-kicker">'+(bear?'PIP’S LITTLE ADVENTURES':'ANIMAL FRIENDS')+'<span>Adult rehearsal</span></div><h2>'+(done?'Lovely playing!':bear?'A little imagination.':last?'Next friend!':'Who’s this?')+'</h2><div class="playroom-stage"><div class="playroom-glow"></div><div class="playroom-character"><img src="/assets/playroom/'+name+'-v1.png" alt="'+(bear?'Pip the pretend bear':done?'Pip the friendly bear':'Animal guessing card')+'">'+(bear?'<span class="bear-mouth" aria-hidden="true"></span>':'')+'</div></div>'+feedback+'<div class="playroom-speech"><p>'+esc(question)+'</p></div>'+(g.options.length?'<ol class="playroom-options">'+g.options.map(function(o){return '<li>'+esc(o)+'</li>';}).join('')+'</ol>':'')+(!bear&&!done?'<div class="playroom-progress" aria-label="Card '+(g.index+1)+' of '+cards.length+'">'+cards.map(function(_,i){return '<span class="'+(i===g.index?'current':i<g.index?'visited':'')+'"></span>';}).join('')+'</div>':'')+'</section>';
  },voice:function(state){document.documentElement.setAttribute('data-playroom-speaking',state.phase==='speaking'?'true':'false');}};
}());
