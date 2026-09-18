(function(){
  var art=window.GlassClock,c=art.defaults(),version=0,saved=0,busy=false,timer=null,drag=null,galleryKey=null;
  var stage=document.getElementById('clock-stage'),preview=document.getElementById('clock-preview-art'),status=document.getElementById('clock-status');
  var gallery=document.getElementById('clock-gallery'),accents=document.getElementById('clock-accent');
  gallery.innerHTML=art.styles.map(function(s){return '<button class="clock-choice" data-style="'+s.id+'" aria-pressed="false"><span class="mini" aria-hidden="true"></span><strong>'+s.name+'</strong><small>'+s.kind+'</small></button>';}).join('');
  accents.innerHTML=Object.keys(art.colors).map(function(a){return '<button data-accent="'+a+'" aria-pressed="false">'+a.charAt(0).toUpperCase()+a.slice(1)+'</button>';}).join('');
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function paint(){
    var g=art.geometry(c,stage.clientWidth,stage.clientHeight);preview.style.width=g.size+'px';preview.style.height=g.size+'px';preview.style.left=g.left+'px';preview.style.top=g.top+'px';art.mount(preview,c,new Date());
  }
  function controls(){
    ['scale','x','y'].forEach(function(k){document.getElementById('clock-'+k).value=c[k];document.getElementById('clock-'+k+'-value').textContent=c[k]+'%';});
    ['seconds','day','date','hour24'].forEach(function(k){document.getElementById('clock-'+k).checked=c[k];});
    var sampleKey=[c.accent,c.seconds,c.day,c.date,c.hour24].join('|');
    Array.prototype.forEach.call(gallery.querySelectorAll('button'),function(b){var selected=b.getAttribute('data-style')===c.style;window.GlassDOM.attr(b,'aria-pressed',String(selected));
      if(sampleKey!==galleryKey){var sample=clone(c);sample.style=b.getAttribute('data-style');
        // Static thumbnails never run eight simultaneous mechanical players.
        var mini=b.querySelector('.mini');if(!mini._material)mini._material='gallery-'+b.getAttribute('data-style');
        window.GlassDOM.patch(mini,art.scene(sample,new Date(2026,0,1,10,8,36),undefined,null,mini._material));}
    });galleryKey=sampleKey;
    Array.prototype.forEach.call(accents.querySelectorAll('button'),function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-accent')===c.accent));});
    document.getElementById('clock-description').textContent=art.styles.filter(function(s){return s.id===c.style;})[0].description;document.getElementById('clock-flip-preview').hidden=c.style!=='split';paint();
  }
  function post(body,done){var x=new XMLHttpRequest();x.open('POST','/api/command');x.setRequestHeader('Content-Type','application/json');x.timeout=5000;
    x.onload=function(){done(x.status===200);};x.onerror=x.ontimeout=function(){done(false);};x.send(JSON.stringify(body));}
  function save(){
    clearTimeout(timer);timer=null;if(busy||version===saved)return;busy=true;var sent=version;
    post({action:'set_clock',config:clone(c)},function(ok){busy=false;if(ok){saved=sent;status.textContent='Saved to mirror';if(version>saved)save();}else status.textContent='Could not save. Adjust a control to retry.';});
  }
  function changed(){version++;controls();status.textContent='Saving…';clearTimeout(timer);timer=setTimeout(save,180);}
  gallery.onclick=function(e){var b=e.target;while(b&&b!==gallery&&!b.getAttribute('data-style'))b=b.parentNode;if(b&&b!==gallery){c.style=b.getAttribute('data-style');changed();}};
  accents.onclick=function(e){var a=e.target.getAttribute('data-accent');if(a){c.accent=a;changed();}};
  ['scale','x','y'].forEach(function(k){document.getElementById('clock-'+k).oninput=function(){c[k]=Number(this.value);changed();};});
  ['seconds','day','date','hour24'].forEach(function(k){document.getElementById('clock-'+k).onchange=function(){c[k]=this.checked;changed();};});
  Array.prototype.forEach.call(document.querySelectorAll('[data-position]'),function(b){b.onclick=function(){var p=b.getAttribute('data-position').split(',');c.x=Number(p[0]);c.y=Number(p[1]);changed();};});
  document.getElementById('clock-reset').onclick=function(){c=art.defaults();changed();};
  document.getElementById('clock-flip-preview').onclick=function(){var now=new Date();art.mount(preview,c,now,undefined,new Date(now.getTime()-60000));};
  document.getElementById('clock-show').onclick=function(){post({action:'show',panel:'home'},function(ok){status.textContent=ok?'Clock view opened. Active timers remain visible.':'Could not open mirror view.';});};
  function point(e){return e.touches?e.touches[0]:e;}
  function begin(e){if(e.type==='mousedown'&&e.button!==0)return;var p=point(e);drag={x:p.clientX,y:p.clientY,cx:c.x,cy:c.y};e.preventDefault();}
  function move(e){if(!drag)return;var p=point(e),g=art.geometry(c,stage.clientWidth,stage.clientHeight);
    c.x=Math.max(0,Math.min(100,Math.round(drag.cx+(p.clientX-drag.x)/Math.max(1,stage.clientWidth-g.size)*100)));
    c.y=Math.max(0,Math.min(100,Math.round(drag.cy+(p.clientY-drag.y)/Math.max(1,stage.clientHeight-g.size)*100)));changed();e.preventDefault();}
  stage.addEventListener('mousedown',begin);stage.addEventListener('touchstart',begin,{passive:false});window.addEventListener('mousemove',move);window.addEventListener('touchmove',move,{passive:false});window.addEventListener('mouseup',function(){drag=null;});window.addEventListener('touchend',function(){drag=null;});window.addEventListener('touchcancel',function(){drag=null;});
  stage.onkeydown=function(e){var delta=e.shiftKey?10:2;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].indexOf(e.key)===-1)return;e.preventDefault();if(e.key==='ArrowLeft')c.x=Math.max(0,c.x-delta);if(e.key==='ArrowRight')c.x=Math.min(100,c.x+delta);if(e.key==='ArrowUp')c.y=Math.max(0,c.y-delta);if(e.key==='ArrowDown')c.y=Math.min(100,c.y+delta);changed();};
  window.GlassSurface.subscribe({voice:function(){},state:function(s){if(!busy&&!timer&&version===saved){var next=clone(art.normalize(s.clockDesign));if(JSON.stringify(c)!==JSON.stringify(next)){c=next;controls();}status.textContent='Connected · changes save automatically';}},error:function(){status.textContent='Connection lost · preview changes may not save';}});
  controls();setInterval(paint,1000);window.addEventListener('resize',paint);
}());
