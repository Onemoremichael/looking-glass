(function(){
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function value(n){return typeof n==='number'&&isFinite(n)?Math.round(n):'—';}
  function time(t,zone,options){try{options.timeZone=zone;return new Date(t).toLocaleString('en-US',options);}catch(e){return '—';}}
  function icon(kind,label){
    var cloud='<path class="wx-cloud-body" fill="currentColor" d="M27 73h47a16 16 0 0 0 0-32 24 24 0 0 0-45-7 20 20 0 0 0-2 39Z"/><path class="wx-cloud-base" d="M27 73h47a16 16 0 0 0 14-8H13a20 20 0 0 0 14 8Z" fill="#7795aa" stroke="none"/>',body='';
    if(kind==='sun')body='<circle cx="50" cy="50" r="25" fill="currentColor"/><g class="wx-rays"><path d="M50 4v10m0 72v10M4 50h10m72 0h10M17 17l8 8m50 50 8 8M17 83l8-8m50-50 8-8"/></g>';
    else if(kind==='moon')body='<path d="M75 72A35 35 0 0 1 43 13 38 38 0 1 0 75 72Z" fill="currentColor"/><path d="M75 15v14m-7-7h14M88 40v8m-4-4h8"/>';
    else if(kind==='fog')body=cloud+'<path d="M18 80h62M26 90h48"/>';
    else if(kind==='rain')body=cloud+'<g class="wx-drops"><path d="M31 78l-4 10m23-10-4 10m23-10-4 10"/></g>';
    else if(kind==='snow')body=cloud+'<path d="M31 79v12m-6-6h12m26-6v12m-6-6h12"/>';
    else if(kind==='storm')body=cloud+'<path d="m52 68-12 18h12l-5 12 19-22H54l6-8"/>';
    // Cloud codes do not carry day/night here. Do not imply sunshine at night.
    else body=cloud;
    return '<svg class="wx-icon wx-'+esc(kind)+'" viewBox="0 0 100 100" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'+body+'</svg>';
  }
  function forecastDays(data,zone,now){
    var today=time(now,zone,{year:'numeric',month:'2-digit',day:'2-digit'}),index=-1;
    data.daily.forEach(function(d,i){if(time(d.time,zone,{year:'numeric',month:'2-digit',day:'2-digit'})===today)index=i;});
    return index<0?[]:data.daily.slice(index);
  }
  function sky(kind,label,hero){
    if(['cloud','sun','moon','rain','storm','snow','fog'].indexOf(kind)<0)return icon('cloud',label);
    // Reuse the cloud without altering its PNG. Rain is a separate, scalable layer.
    if(kind==='rain')return '<div class="wx-atmosphere wx-art-rain'+(hero?' wx-rain-live':'')+'" aria-hidden="true"><img class="wx-weather-art" src="/assets/weather/cloud-volume-v1.png" alt="" decoding="async"><span class="wx-rain-fall"><i class="wx-rain-streak wx-rs-1"></i><i class="wx-rain-streak wx-rs-2"></i><i class="wx-rain-streak wx-rs-3"></i>'+(hero?'<i class="wx-rain-streak wx-rs-4"></i>':'')+'</span></div>';
    return '<div class="wx-atmosphere wx-art-'+kind+'" aria-hidden="true"><img class="wx-weather-art" src="/assets/weather/'+kind+'-volume-v1.png" alt="" decoding="async"></div>';
  }
  function render(w,now){
    now=now||Date.now();w=w||{locations:[],forecasts:{},errors:{},units:'fahrenheit'};
    var place=w.locations.filter(function(p){return p.id===w.activeId;})[0],data=w.forecasts[w.activeId],unit=w.units==='celsius'?'C':'F';
    if(!place)return '<section class="weather-scene wx-empty">'+icon('sun')+'<h2>Your places. Your sky.</h2><p>Add a city in the companion to bring the forecast here.</p></section>';
    var age=data?Math.max(now-data.fetchedAt,now-data.current.time,0):Infinity;
    if(!data||data.units!==w.units||age>21600000)return '<section class="weather-scene wx-empty">'+icon('cloud')+'<span class="wx-place">'+esc(place.name)+'</span><h2>'+(w.errors[place.id]||age>21600000&&data?'Forecast unavailable':'Finding your forecast…')+'</h2><p>No recent weather to show yet.</p></section>';
    var zone=data.timeZone,days=forecastDays(data,zone,now),period=w.view||'now',day=days[period==='tomorrow'?1:0],hero=period==='now'?data.current:day;
    if(!hero)return '<section class="weather-scene wx-empty"><h2>Forecast unavailable for that day.</h2></section>';
    var stale=age>1800000||w.errors[place.id],kind=hero.kind;
    var tomorrowEnd=days[2]?days[2].time:day&&day.time+86400000;
    var hours=data.hourly.filter(function(h){return period==='tomorrow'?day&&h.time>=day.time&&h.time<tomorrowEnd:h.time>=now-3600000;}).filter(function(h,i){return i%3===0;}).slice(0,4);
    var rain=kind==='rain'||kind==='storm',trails='';
    if(rain)for(var j=0;j<8;j++)trails+='<i class="wx-trail wx-trail-'+j+'"></i>';
    var html='<section class="weather-scene weather-'+esc(kind)+(period==='week'?' wx-week':'')+'"><div class="wx-rain-window" aria-hidden="true">'+trails+'</div><div class="wx-head"><div><span class="wx-place">'+esc(place.name)+'</span><span class="wx-period">'+({now:'Right now',today:'Today’s forecast',tomorrow:'Tomorrow’s forecast',week:'The week ahead'}[period]||'Right now')+'</span></div><span class="wx-unit">°'+unit+'</span></div>';
    html+='<div class="wx-current"><div class="wx-reading"><div class="wx-temp">'+value(period==='now'?hero.temp:hero.high)+'<span>°</span></div><p class="wx-feels">'+(period==='now'?'Feels like '+value(hero.feels)+'°':period==='week'?'Today’s high':'Daily high')+'</p></div><div class="wx-sky">'+sky(kind,hero.label,true)+'</div></div>';
    html+='<div class="wx-outlook"><h2 class="wx-condition">'+esc(hero.label)+'</h2>'+(day?'<p class="wx-range"><span>High <strong>'+value(day.high)+'°</strong></span><span>Low <strong>'+value(day.low)+'°</strong></span></p>':'')+'</div>';
    if(hours.length&&period!=='week'){
      html+='<div class="wx-horizon"><h3 class="wx-section-label">'+(period==='tomorrow'?'Tomorrow, by the hour':'Coming up')+'</h3><div class="wx-hours">';
      html+=hours.map(function(h){return '<div class="wx-hour-slot"><span class="wx-hour">'+esc(time(h.time,zone,{hour:'numeric'}))+'</span>'+sky(h.kind,h.label)+'<strong>'+value(h.temp)+'°</strong>'+(typeof h.rain==='number'&&h.rain>=20?'<span class="wx-chance">Precip. '+value(h.rain)+'%</span>':'')+'</div>';}).join('')+'</div></div>';
    }
    var firstDay=period==='week'?0:period==='tomorrow'?2:1;
    html+='<div class="wx-days">'+days.slice(firstDay,period==='week'?7:firstDay+2).map(function(d){var i=days.indexOf(d);return '<div class="wx-day">'+sky(d.kind,d.label)+'<div class="wx-day-description"><span class="wx-day-name">'+(i===0?'Today':i===1?'Tomorrow':esc(time(d.time,zone,{weekday:'long'})))+'</span><span class="wx-day-condition">'+esc(d.label)+(typeof d.rain==='number'&&d.rain>=20?' · Precip. '+value(d.rain)+'%':'')+'</span></div><strong>'+value(d.high)+'° <span>'+value(d.low)+'°</span></strong></div>';}).join('')+'</div>';
    var ageMinutes=Math.max(0,Math.floor((now-data.fetchedAt)/60000));
    html+='<p class="wx-source'+(stale?' wx-stale':'')+'">'+(stale?'Last available forecast · ':'')+'Open-Meteo · '+(ageMinutes<1?'updated just now':'updated '+ageMinutes+' min ago')+'</p></section>';
    return html;
  }
  window.GlassWeather={render:render,renderArt:sky};
}());
