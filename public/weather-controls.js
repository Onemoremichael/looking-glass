(function(){
  var state=null,root=document.getElementById('weather-settings');
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function request(path,body,done){
    var x=new XMLHttpRequest(),status=document.getElementById('weather-search-status');x.open('POST',path);x.setRequestHeader('Content-Type','application/json');x.timeout=10000;
    x.onload=function(){try{var result=JSON.parse(x.responseText);if(x.status!==200)throw Error(result.error||'Weather request failed');status.textContent='';if(done)done(result);}catch(e){status.textContent=e.message;}};
    x.onerror=x.ontimeout=function(){status.textContent='Weather service did not respond. Please try again.';};x.send(JSON.stringify(body));
  }
  root.addEventListener('click',function(e){
    var b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-weather-place'))request('/api/weather',{action:'select',id:b.getAttribute('data-weather-place')});
    if(b.hasAttribute('data-weather-remove'))request('/api/weather',{action:'remove',id:b.getAttribute('data-weather-remove')});
    if(b.hasAttribute('data-weather-add'))request('/api/weather',{action:'add',id:b.getAttribute('data-weather-add')},function(){document.getElementById('weather-results').innerHTML='';});
    if(b.hasAttribute('data-weather-period'))request('/api/command',{action:'get_weather',period:b.getAttribute('data-weather-period'),locationId:null});
  });
  document.getElementById('weather-units').onchange=function(e){request('/api/weather',{action:'units',units:e.target.value});};
  document.getElementById('weather-search').onsubmit=function(e){
    e.preventDefault();document.getElementById('weather-search-status').textContent='Searching places…';
    request('/api/weather',{action:'search',query:document.getElementById('weather-query').value},function(data){
      document.getElementById('weather-results').innerHTML=data.results.map(function(p){return '<button type="button" class="subtle" data-weather-add="'+esc(p.id)+'">'+esc(p.label)+'</button>';}).join('');
      if(!data.results.length)document.getElementById('weather-search-status').textContent='No places found. Try city, state or country.';
    });
  };
  window.GlassWeatherControls={render:function(s){
    state=s;root.hidden=s.panel!=='weather';var w=s.weather||{locations:[],units:'fahrenheit'};
    document.getElementById('weather-units').value=w.units;
    document.getElementById('weather-places').innerHTML=w.locations.map(function(p){return '<span><button type="button" class="subtle" data-weather-place="'+esc(p.id)+'" aria-pressed="'+(p.id===w.activeId)+'" title="'+esc(p.label)+'">'+esc(p.name)+'</button> <button type="button" class="subtle" data-weather-remove="'+esc(p.id)+'" aria-label="Remove '+esc(p.label)+'">×</button></span>';}).join('');
  }};
}());
