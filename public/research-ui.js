(function(root){
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function render(board,companion){
    if(!board)return '<p class="empty">Ask me to explore something.</p>';
    var page=board.page||0,total=Math.ceil(board.cards.length/2),stale=Date.now()-board.fetchedAt>=900000;
    var html='<section class="research-board research-'+esc(board.spec.layout)+'"><div class="research-eyebrow">FIELD NOTES <span>'+esc(board.spec.layout)+' · '+(page+1)+' / '+total+'</span></div><h2>'+esc(board.spec.title)+'</h2><p class="research-lead">'+esc(board.summary)+'</p><div class="research-cards">';
    html+=board.cards.slice(page*2,page*2+2).map(function(c,i){return '<article class="research-card"><div class="research-number">'+('0'+(page*2+i+1)).slice(-2)+'</div><div class="research-copy"><p class="research-kicker">'+esc(c.kicker)+'</p><h3>'+esc(c.heading)+'</h3><p>'+esc(c.body)+'</p>'+(c.detail?'<strong>'+esc(c.detail)+'</strong>':'')+'<div class="research-cites">'+c.sourceIds.filter(function(id,n,a){return a.indexOf(id)===n;}).map(function(id){var n=board.sources.map(function(s){return s.id;}).indexOf(id);return '['+(n+1)+']';}).join(' ')+'</div></div></article>';}).join('');
    html+='</div>'+(board.caveat?'<p class="research-caveat">'+esc(board.caveat)+'</p>':'')+'<footer class="research-footer"><span>'+(stale?'Earlier research · ask to refresh':'Checked '+new Date(board.fetchedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))+'</span>'+(total>1?'<span>Say “next page”</span>':'')+'</footer><div class="research-sources">';
    html+=companion?board.sources.map(function(s,i){return /^https?:\/\//.test(s.url)?'<a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">['+(i+1)+'] '+esc(s.title)+'</a>':'';}).join(''):'<span>'+board.sources.length+' sources · links on your companion</span>';
    return html+'</div></section>';
  }
  root.GlassResearch={render:render};
}(typeof window==='undefined'?globalThis:window));
