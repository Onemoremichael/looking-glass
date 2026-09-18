(function(root){
  // Shared by Android, companion and agent context. Dense boards get a context
  // page plus one finding per page; no facts are shortened or hidden by CSS.
  function length(value){return String(value||'').replace(/\s+/g,' ').length;}
  function plan(board){
    var cards=board.cards||[],dense=length(board.spec.title)>50||length(board.summary)+length(board.caveat)>260,pages=[],i;
    // An attendance agenda is a glanceable board, not a slideshow. Keep every
    // event and the scope together, including when restoring an old page index.
    if(board.spec.layout==='agenda')return [{kind:'agenda',cardNumbers:cards.map(function(c,n){return n+1;}),summary:true,caveat:true}];
    for(i=0;i<cards.length;i+=2){
      var pair=cards.slice(i,i+2).reduce(function(sum,c){return sum+length(c.heading)+length(c.kicker)+length(c.body)+length(c.detail);},0);
      if(pair>650)dense=true;
    }
    if(dense){
      pages.push({kind:'context',cardNumbers:[],summary:true,caveat:true});
      for(i=0;i<cards.length;i++)pages.push({kind:'finding',cardNumbers:[i+1],summary:false,caveat:false});
    }else{
      for(i=0;i<cards.length;i+=2)pages.push({kind:'findings',cardNumbers:cards.slice(i,i+2).map(function(c,j){return i+j+1;}),summary:true,caveat:true});
    }
    return pages;
  }
  function current(board){
    var pages=plan(board),index=Math.max(0,Math.min(pages.length-1,Math.floor(Number(board.page)||0)));
    return {index:index,total:pages.length,page:pages[index],dense:pages.length>0&&pages[0].kind==='context'};
  }
  var api={plan:plan,current:current};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.GlassResearchPages=api;
}(typeof window==='undefined'?globalThis:window));
