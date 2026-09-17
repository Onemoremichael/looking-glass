(function(root){
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function render(board,companion){
    if(!board)return '<p class="empty">Ask me to explore something.</p>';
    var view=root.GlassResearchPages.current(board),page=view.index,total=view.total,stale=Date.now()-board.fetchedAt>=900000;
    var html='<section class="research-board research-'+esc(board.spec.layout)+(view.dense?' research-paged':'')+'"><div class="research-eyebrow">'+(view.page.kind==='context'?'OVERVIEW':'FIELD NOTES')+' <span>'+esc(board.spec.layout)+' · '+(page+1)+' / '+total+'</span></div><h2>'+esc(board.spec.title)+'</h2>'+(view.page.summary?'<p class="research-lead">'+esc(board.summary)+'</p>':'')+'<div class="research-cards">';
    html+=view.page.cardNumbers.map(function(number){var c=board.cards[number-1];return '<article class="research-card"><div class="research-number">'+('0'+number).slice(-2)+'</div><div class="research-copy"><p class="research-kicker">'+esc(c.kicker)+'</p><h3>'+esc(c.heading)+'</h3><p>'+esc(c.body)+'</p>'+(c.detail?'<strong>'+esc(c.detail)+'</strong>':'')+'<div class="research-cites">'+c.sourceIds.filter(function(id,n,a){return a.indexOf(id)===n;}).map(function(id){var n=board.sources.map(function(s){return s.id;}).indexOf(id);return '['+(n+1)+']';}).join(' ')+'</div></div></article>';}).join('');
    html+='</div>'+(view.page.caveat&&board.caveat?'<p class="research-caveat">'+esc(board.caveat)+'</p>':'')+'<footer class="research-footer"><span>'+(stale?'Earlier research · ask to refresh':'Checked '+new Date(board.fetchedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))+'</span>'+(total>1?'<span>Say “'+(page<total-1?'next':'previous')+' page”</span>':'')+'</footer>'+(view.dense&&page>0&&board.caveat?'<p class="research-context-hint">Limitations on overview · say “previous page” to go back</p>':'')+'<div class="research-sources">';
    html+=companion?board.sources.map(function(s,i){return /^https?:\/\//.test(s.url)?'<a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">['+(i+1)+'] '+esc(s.title)+'</a>':'';}).join(''):'<span>'+board.sources.length+' sources · links on your companion</span>';
    return html+'</div></section>';
  }
  root.GlassResearch={render:render};
}(typeof window==='undefined'?globalThis:window));
