(function(root){
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function navigationHint(direction,voice,wake){
    var command=(direction==='previous'?'previous':'next')+' page';
    if(voice&&['listening','speaking','thinking','needs_input'].indexOf(voice.phase)!==-1&&!voice.muted)return 'Say “'+command+'”';
    if(wake&&wake.enabled&&wake.phase==='standby'&&wake.shortcuts&&wake.shortcuts.indexOf(direction+'_page')!==-1&&Date.now()<wake.shortcutsExpireAt)return 'Say “'+command+'”';
    if(wake&&wake.enabled&&wake.phase==='standby')return 'Say “Hey Mirror”, then “'+command+'”';
    return 'Start voice on companion · '+command;
  }
  function render(board,companion){
    if(!board)return '<p class="empty">Ask me to explore something.</p>';
    var view=root.GlassResearchPages.current(board),page=view.index,total=view.total,stale=Date.now()-board.fetchedAt>=900000;
    var agenda=board.spec.layout==='agenda',gators=agenda&&/\bgators?\b/i.test(board.spec.title);
    var html='<section class="research-board research-'+esc(board.spec.layout)+(gators?' research-gators':'')+(view.dense?' research-paged':'')+'"><div class="research-eyebrow">'+(view.page.kind==='context'?'OVERVIEW':agenda?'ON THE CALENDAR':'FIELD NOTES')+' <span>'+(total>1?(page+1)+' / '+total:agenda?'EVENT GUIDE':esc(board.spec.layout))+'</span></div><h2>'+esc(board.spec.title)+'</h2>'+(view.page.summary?'<p class="research-lead">'+esc(board.summary)+'</p>':'')+'<div class="research-cards">';
    html+=view.page.cardNumbers.map(function(number){var c=board.cards[number-1];return '<article class="research-card"><div class="research-number">'+('0'+number).slice(-2)+'</div><div class="research-copy"><p class="research-kicker">'+esc(c.kicker)+'</p><h3>'+esc(c.heading)+'</h3><p>'+esc(c.body)+'</p>'+(c.detail?'<strong>'+esc(c.detail)+'</strong>':'')+'<div class="research-cites">'+c.sourceIds.filter(function(id,n,a){return a.indexOf(id)===n;}).map(function(id){var n=board.sources.map(function(s){return s.id;}).indexOf(id);return '['+(n+1)+']';}).join(' ')+'</div></div></article>';}).join('');
    var direction=page<total-1?'next':'previous';
    var age=Math.max(0,Math.floor((Date.now()-board.fetchedAt)/60000));
    html+='</div>'+(view.page.caveat&&board.caveat?'<p class="research-caveat">'+esc(board.caveat)+'</p>':'')+'<footer class="research-footer"><span>'+(stale?'Earlier research · ask to refresh':age?'Checked '+age+' min ago':'Checked just now')+'</span>'+(total>1?'<span data-research-direction="'+direction+'">'+(companion?'Use page controls below':navigationHint(direction))+'</span>':'')+'</footer>'+(view.dense&&page>0&&board.caveat?'<p class="research-context-hint">Limitations on overview</p>':'')+'<div class="research-sources">';
    html+=companion?board.sources.map(function(s,i){return /^https?:\/\//.test(s.url)?'<a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">['+(i+1)+'] '+esc(s.title)+'</a>':'';}).join(''):'<span>'+board.sources.length+' sources · links on your companion</span>';
    html+='</div>';
    if(companion&&total>1)html+='<nav class="research-pagination" aria-label="Research pages"><button data-research-page="previous"'+(page===0?' disabled':'')+'>Previous page</button><span>'+(page+1)+' / '+total+'</span><button data-research-page="next"'+(page===total-1?' disabled':'')+'>Next page</button></nav>';
    return html+'</section>';
  }
  root.GlassResearch={render:render,navigationHint:navigationHint};
}(typeof window==='undefined'?globalThis:window));
