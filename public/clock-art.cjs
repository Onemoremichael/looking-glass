(function(root){
  var styles=[{id:'orbit',name:'Orbit',kind:'Analog',description:'Three rings. One quiet solar system.'},{id:'atelier',name:'Atelier',kind:'Analog',description:'An oversized dial with a watchmaker’s restraint.'},{id:'meridian',name:'Meridian',kind:'Analog',description:'Graphic hands, cardinal points, a little Bauhaus.'},{id:'monolith',name:'Monolith',kind:'Digital',description:'Time as architecture. Two monumental lines.'},{id:'ribbon',name:'Ribbon',kind:'Digital',description:'A fine horizon with a wandering minute marker.'},{id:'split',name:'Split',kind:'Digital',description:'Departure-board proportions, softened for glass.'}];
  var colors={jade:'#b8ddce',amber:'#eac693',ice:'#badcf0',rose:'#dfbfcf'};
  var materialSerial=0;
  styles.splice(3,0,{id:'tourbillon',name:'Tourbillon',kind:'Analog',description:'An open-work instrument. A flying cage, a breathing balance, time in motion.'});
  function defaults(){return {style:'orbit',accent:'jade',x:50,y:35,scale:70,seconds:true,day:true,date:true,hour24:false};}
  function valid(c){return !!c&&Object.keys(c).sort().join(',')==='accent,date,day,hour24,scale,seconds,style,x,y'&&styles.some(function(s){return s.id===c.style;})&&Object.prototype.hasOwnProperty.call(colors,c.accent)&&['x','y','scale'].every(function(k){return typeof c[k]==='number'&&isFinite(c[k])&&Math.floor(c[k])===c[k]&&c[k]>= (k==='scale'?25:0)&&c[k]<=100;})&&['seconds','day','date','hour24'].every(function(k){return typeof c[k]==='boolean';});}
  function normalize(c){
    if(c&&Object.keys(c).sort().join(',')==='accent,date,hour24,scale,seconds,style,x,y'){
      var migrated={};Object.keys(c).forEach(function(k){migrated[k]=c[k];});migrated.day=c.date;c=migrated;
    }
    return valid(c)?c:defaults();
  }
  function geometry(c,w,h){var size=Math.min(w,h)*c.scale/100;return {size:size,left:(w-size)*c.x/100,top:(h-size)*c.y/100};}
  function pad(n){return ('0'+n).slice(-2);}
  // A reduced kinematic model, not a contact-force/elasticity simulation.
  // Compound shafts: barrel 96 -> center 12/60 -> third 8/80 -> cage 10.
  var movementSpec={beatsPerSecond:5,escapeTeeth:15,fixedTeeth:80,escapePinionTeeth:8,
    train:[{id:'barrel',x:249.6,y:294.2,teeth:96,r:48,pinion:0},
      {id:'center',x:249.6,y:348.2,teeth:60,r:30,pinion:12,pinionRadius:6},
      {id:'third',x:249.6,y:382.2,teeth:80,r:56,pinion:8,pinionRadius:4},
      {id:'cage',x:300,y:420,teeth:10,r:7,pinion:0}],
    // Plate screws live outside swept envelopes, unlike jewels centered on axles.
    mounts:[{x:183,y:267,r:4.5},{x:193,y:345,r:4},{x:344,y:252,r:5},{x:401,y:358,r:5}],
    cageRadius:98};
  function movementState(seconds){
    // Each lock releases half an escape tooth. A short eased advance then dwell.
    var beats=seconds*movementSpec.beatsPerSecond,whole=Math.floor(beats),phase=beats-whole;
    var p=Math.min(1,phase/.2),release=p*p*(3-2*p),steps=whole+release;
    var cage=steps*1.2,third=-cage/8,center=-third*8/60;
    return {cage:cage,third:third,center:center,barrel:-center*12/96,
      escape:steps*12,balance:235*Math.sin(beats*Math.PI),
      fork:(whole%2?1:-1)*(6-12*release)};
  }
  function hairspring(angle){
    // Inner collet follows the balance; the last point is an anchored outer stud.
    var path='',turns=4.5,tau=Math.PI*2;
    for(var i=0;i<=120;i++){var u=i/120,r=5+26*u,theta=(u-1)*turns*tau+angle*Math.PI/180*Math.pow(1-u,2);
      path+=(i?' L ':'M ')+(Math.cos(theta)*r).toFixed(2)+' '+(Math.sin(theta)*r).toFixed(2);}
    return path;
  }
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function time(d,zone){
    var h=d.getHours(),m=d.getMinutes(),s=d.getSeconds(),label;
    try{var opts={hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false};if(zone)opts.timeZone=zone;
      var parts=d.toLocaleTimeString('en-GB',opts).match(/\d+/g);if(parts&&parts.length>=3){h=Number(parts[0])%24;m=Number(parts[1]);s=Number(parts[2]);}
      var dateOpts={weekday:'short',month:'short',day:'numeric'};if(zone)dateOpts.timeZone=zone;label=d.toLocaleDateString('en-US',dateOpts);
    }catch(e){label=d.toDateString();}
    var weekday=d.getDay(),day=d.getDate(),month=d.getMonth();
    try{var calendarOpts={month:'numeric',day:'numeric',year:'numeric'};if(zone)calendarOpts.timeZone=zone;
      var calendar=d.toLocaleDateString('en-US',calendarOpts).match(/\d+/g);
      if(calendar&&calendar.length===3){month=Number(calendar[0])-1;day=Number(calendar[1]);weekday=new Date(Date.UTC(Number(calendar[2]),month,day)).getUTCDay();}
    }catch(e){}
    return {h:h,m:m,s:s,label:label,weekday:weekday,day:day,month:['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][month],weekdayName:['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][weekday]};
  }
  function scene(c,d,zone,flip){
    c=normalize(c);var t=time(d,zone),a=colors[c.accent],ink='#f1f1e8',dim='#7e958f',out='';
    var materialId='movement-'+(++materialSerial),gold='url(#'+materialId+'-gold)',steel='url(#'+materialId+'-steel)',plate='url(#'+materialId+'-plate)',ruby='url(#'+materialId+'-ruby)';
    var hour=t.h%12+t.m/60,minute=t.m+(c.seconds?t.s/60:0),h=c.hour24?t.h:(t.h%12||12),digital=pad(h)+':'+pad(t.m);
    function circle(r,color,width){return '<circle cx="300" cy="300" r="'+r+'" fill="none" stroke="'+color+'" stroke-width="'+width+'"/>';}
    function text(x,y,value,size,color,family,weight){return '<text x="'+x+'" y="'+y+'" text-anchor="middle" font-size="'+size+'" fill="'+color+'" font-family="'+(family||'Arial, sans-serif')+'" font-weight="'+(weight||'400')+'">'+esc(value)+'</text>';}
    function hand(angle,len,width,color,tail){return '<line x1="300" y1="'+(300+(tail||0))+'" x2="300" y2="'+(300-len)+'" stroke="'+color+'" stroke-width="'+width+'" stroke-linecap="round" transform="rotate('+angle+' 300 300)"/>';}
    function dot(angle,r,size,color){var n=(angle-90)*Math.PI/180;return '<circle cx="'+(300+Math.cos(n)*r)+'" cy="'+(300+Math.sin(n)*r)+'" r="'+size+'" fill="'+color+'"/>';}
    function ticks(){var str='';for(var i=0;i<60;i++)str+=hand(i*6,247,i%5?1:3,i%5?'#53645f':a,-(i%5?240:230));return str;}
    function teethPath(r,teeth,saw){
      var path='',module=2*r/teeth;
      for(var q=0;q<teeth*4;q++){var theta=q/(teeth*4)*Math.PI*2,rr=r+module*(q%4<2?.65:-.8);
        if(saw)rr=r*(q%4===1?1:.84);
        path+=(q?' L ':'M ')+(Math.cos(theta)*rr).toFixed(2)+' '+(Math.sin(theta)*rr).toFixed(2);}
      return path+' Z';
    }
    function jewel(x,y,r){
      return '<g transform="translate('+x+' '+y+')"><circle cy="1.7" r="'+(r+3)+'" fill="#000"/><circle r="'+(r+2)+'" fill="'+gold+'" stroke="#332c1e"/><circle r="'+r+'" fill="'+ruby+'" stroke="#f1a6bf" stroke-width=".5"/><path d="M '+(-r*.7)+' '+(-r*.4)+' L 0 '+(-r*.8)+' '+(r*.6)+' '+(-r*.3)+' 0 '+(r*.65)+' Z" fill="none" stroke="#ed96b5" stroke-width=".45"/><circle r="'+(r*.25)+'" fill="#190c19"/><circle cx="'+(-r*.3)+'" cy="'+(-r*.5)+'" r="'+(r*.18)+'" fill="#fff3f8"/></g>';
    }
    function screw(x,y,r){return '<g transform="translate('+x+' '+y+')"><circle cy="1.5" r="'+(r+1)+'" fill="#000"/><circle r="'+r+'" fill="'+steel+'" stroke="#182824"/><circle r="'+(r-.9)+'" fill="none" stroke="#bacac7" stroke-width=".45"/><path d="M '+(-r*.6)+' '+(r*.45)+' L '+(r*.6)+' '+(-r*.45)+'" stroke="#101c25" stroke-width="1.3"/></g>';}
    function post(x,y,r){return '<g data-fixed-post="true" transform="translate('+x+' '+y+')"><path d="M '+(-r-3)+' 0 v 5 a '+(r+3)+' '+(r+3)+' 0 0 0 '+(r*2+6)+' 0 v -5" fill="#494438" stroke="#756b51" stroke-width=".7"/><circle r="'+(r+3)+'" fill="'+steel+'" stroke="#c8ceb9" stroke-width=".6"/></g>';}
    function wheel(x,y,r,teeth,motion,pinion,pr,saw){
      var s='<g transform="translate('+x+' '+y+')"><g data-motion="'+motion+'">',outline=teethPath(r,teeth,saw),rim=r-(r<10?1.6:5);
      var ring=outline+' M '+rim+' 0 A '+rim+' '+rim+' 0 1 0 '+(-rim)+' 0 A '+rim+' '+rim+' 0 1 0 '+rim+' 0 Z';
      // Extruded rim, open cutouts and chamfered spokes; no opaque disk over lower gears.
      s+='<g transform="translate(0 2.4)"><path d="'+ring+'" fill="#3b301b" fill-rule="evenodd"/></g><path d="'+ring+'" fill="'+gold+'" fill-rule="evenodd" stroke="#b99b5e" stroke-width=".45"/>';
      for(var sp=0;sp<(r<10?3:5);sp++)s+='<path d="M 3 -2 Q '+(r*.42)+' -9 '+(r-3)+' -2 L '+(r-3)+' 2 Q '+(r*.42)+' -3 3 2 Z" fill="'+gold+'" stroke="#e1d2a0" stroke-width=".5" transform="rotate('+(sp*(r<10?120:72))+')"/>';
      s+='<circle r="'+rim+'" fill="none" stroke="#f1ddb4" stroke-width=".6"/><circle r="'+(r<10?2:6)+'" fill="'+gold+'" stroke="#615034"/>';
      if(pinion)s+='<path d="'+teethPath(pr,pinion)+'" fill="'+steel+'" stroke="#141f21" stroke-width=".6"/>';
      return s+'</g></g>';
    }
    function flap(x,value,color,oldValue){
      function face(v){return '<rect x="'+x+'" y="168" width="258" height="244" rx="24" fill="#060a08" stroke="'+a+'" stroke-width="2"/>'+text(x+129,337,v,154,color,'Arial, sans-serif','700');}
      function half(v,top){var y=top?168:290;return '<svg x="'+x+'" y="'+y+'" width="258" height="122" viewBox="'+x+' '+y+' 258 122" overflow="hidden">'+face(v)+'</svg>';}
      var result=face(value),p=flip?flip.progress:1;
      if(oldValue!==undefined&&oldValue!==value&&p<1){
        result=half(value,true)+half(oldValue,false);
        var first=p<0.5,phase=first?p*2:(p-0.5)*2;
        var squeeze=first?Math.cos(phase*Math.PI/2):Math.sin(phase*Math.PI/2);
        result+='<g data-flap="'+(first?'falling':'landing')+'" transform="translate(0 290) scale(1 '+Math.max(0.001,squeeze)+') translate(0 -290)">'+half(first?oldValue:value,first)+'<rect x="'+(x+1)+'" y="'+(first?168:290)+'" width="256" height="122" fill="#000" opacity="'+((1-squeeze)*0.32)+'"/></g>';
      }
      return result+'<path d="M '+x+' 290 H '+(x+258)+'" stroke="#263b35" stroke-width="2"/><path d="M '+(x+4)+' 287 v 6 M '+(x+254)+' 287 v 6" stroke="'+a+'" stroke-width="3"/>';
    }
    if(c.style==='orbit'){
      out=circle(212,'#82958e',1.5)+circle(158,'#82958e',2.25);
      if(c.seconds)for(var second=0;second<60;second++)out+=dot(second*6,248,1.2,'#82958e');
      out+=dot(hour*30,158,14,ink)+dot(minute*6,212,9,a);
      if(c.seconds)out+=dot(t.s*6,248,2.4,a);
      out+=hand(hour*30,136,5,ink)+hand(minute*6,194,2,a)+dot(0,0,4,ink);
      out+=text(300,362,c.hour24?pad(t.h):pad(h),22,dim)+text(300,400,c.hour24?'HOURS':t.h<12?'AM':'PM',11,dim);
    }else if(c.style==='atelier'){
      out=ticks()+circle(268,'#53645f',1);
      for(var n=1;n<=12;n++){var rad=(n*30-90)*Math.PI/180;out+=text(300+Math.cos(rad)*200,313+Math.sin(rad)*200,n,35,ink,'Georgia, serif');}
      out+=hand(hour*30,120,8,ink,12)+hand(minute*6,181,4,ink,18);
      if(c.seconds)out+=hand(t.s*6,222,1.5,a,40);
      out+=dot(0,0,7,a);
    }else if(c.style==='meridian'){
      out=text(300,106,'12',68,ink)+text(509,325,'3',68,ink)+text(300,546,'6',68,ink)+text(89,325,'9',68,ink);
      for(var j=0;j<12;j++)if(j%3)out+=dot(j*30,227,3,a);
      out+=hand(hour*30,132,24,a,25)+hand(minute*6,209,9,ink,25);
      if(c.seconds)out+=hand(t.s*6,204,2,a,55)+dot(t.s*6,204,6,a);
      out+=dot(0,0,12,ink);
    }else if(c.style==='tourbillon'){
      // Open-work architecture: dark voids remain reflective, highlights catch light.
      out='<defs><linearGradient id="'+materialId+'-gold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff4d4"/><stop offset=".23" stop-color="'+a+'"/><stop offset=".45" stop-color="#796241"/><stop offset=".55" stop-color="#f1dfb8"/><stop offset=".8" stop-color="#a08451"/><stop offset="1" stop-color="#302417"/></linearGradient><linearGradient id="'+materialId+'-steel" x1="0" y1="0" x2=".3" y2="1"><stop stop-color="#f1f4ec"/><stop offset=".2" stop-color="#9aa99d"/><stop offset=".48" stop-color="#344039"/><stop offset=".52" stop-color="#cad3c7"/><stop offset="1" stop-color="#43544a"/></linearGradient><radialGradient id="'+materialId+'-plate" cx=".3" cy=".2" r=".9"><stop stop-color="#25322c"/><stop offset=".55" stop-color="#0e1712"/><stop offset="1" stop-color="#000"/></radialGradient><radialGradient id="'+materialId+'-ruby" cx=".3" cy=".2"><stop stop-color="#ffe1eb"/><stop offset=".2" stop-color="#d77094"/><stop offset=".6" stop-color="#791f48"/><stop offset="1" stop-color="#1e0715"/></radialGradient></defs>';
      out+=circle(273,a,2)+'<image x="0" y="0" width="600" height="600" href="/assets/clocks/tourbillon-bezel-v1.png" xlink:href="/assets/clocks/tourbillon-bezel-v1.png"/>';
      out+='<g transform="translate(300 300) scale(.84) translate(-300 -300)"><circle cx="300" cy="300" r="257" fill="'+plate+'"/>'+circle(258,'#080c09',4)+ticks();
      // The movement sits directly over the dial, without a separate backing patch.
      for(var engine=0;engine<11;engine++)out+='<path d="M 155 '+(222+engine*9)+' H 440" stroke="#93a394" stroke-width=".45" opacity=".13"/>';
      for(var pe=0;pe<24;pe++){var px=325+(pe%4)*21,py=262+Math.floor(pe/4)*17;out+='<circle cx="'+px+'" cy="'+py+'" r="12" fill="none" stroke="#7b8e7f" stroke-width=".6" opacity=".2"/><path d="M '+(px-9)+' '+py+' a 9 9 0 0 1 18 0" fill="none" stroke="#d7d9ba" stroke-width=".5" opacity=".15"/>';}
      // Bottom-to-top compound train. Each wheel engages the NEXT shaft's pinion.
      out+=wheel(300,420,7,10,'cage',0,0);
      for(var gi=2;gi>=0;gi--){var g=movementSpec.train[gi];out+=wheel(g.x,g.y,g.r,g.teeth,g.id,g.pinion,g.pinionRadius);}
      for(var mp=0;mp<movementSpec.mounts.length;mp++){var mounting=movementSpec.mounts[mp];out+=post(mounting.x,mounting.y,mounting.r);}
      // Cutaway mainspring barrel: spring is static at this display timescale.
      out+='<g transform="translate(249.6 294.2)"><circle r="39" fill="'+plate+'" stroke="#a38753" stroke-width="1.5"/>';
      var mainspring='';for(var ms=0;ms<220;ms++){var mr=7+ms*.13,ma=ms*.19;mainspring+=(ms?' L ':'M ')+(Math.cos(ma)*mr).toFixed(2)+' '+(Math.sin(ma)*mr).toFixed(2);}
      out+='<path d="'+mainspring+'" fill="none" stroke="#94998b" stroke-width="1.05"/><circle r="8" fill="'+steel+'"/></g>';
      // Narrow bearing fingers expose the wheels instead of covering them with a plate.
      out+='<path d="M 175 264 Q 205 279 250 288 L 257 300 Q 211 294 178 278 Z M 188 343 Q 214 341 250 342 L 256 353 Q 223 357 189 355 Z" transform="translate(0 4)" fill="#000"/><path d="M 175 260 Q 205 275 250 284 L 257 296 Q 211 290 178 274 Z M 188 339 Q 214 337 250 338 L 256 349 Q 223 353 189 351 Z" fill="'+steel+'" stroke="#bdc7b7" stroke-width=".8"/>';
      out+=screw(183,267,4.5)+screw(193,345,4)+jewel(249.6,294.2,4)+jewel(249.6,348.2,3.5)+jewel(249.6,382.2,3);
      // A dark, chamfered bridge on the upper right anchors the plate assembly.
      out+='<path d="M 345 243 Q 369 265 389 301 L 408 359 L 398 368 L 376 311 Q 353 276 332 257 Z" transform="translate(0 5)" fill="#000"/><path d="M 345 243 Q 369 265 389 301 L 408 359 L 398 368 L 376 311 Q 353 276 332 257 Z" fill="'+steel+'" stroke="#d0d4bc" stroke-width="1.1"/><path d="M 347 249 Q 369 275 382 302 L 401 354" fill="none" stroke="#141f1a" stroke-width="5"/>';
      out+=screw(344,252,5)+screw(401,358,5);
      var romans=['XII','I','II','III','IV','VIII','IX','X','XI'],positions=[0,30,60,90,120,240,270,300,330];
      for(var rn=0;rn<romans.length;rn++){var angle=(positions[rn]-90)*Math.PI/180;out+=text(300+Math.cos(angle)*207,309+Math.sin(angle)*207,romans[rn],25,ink,'Georgia, serif');}
      out+=text(300,167,'T O U R B I L L O N',11,a)+text(300,187,'O P E N   W O R K',7,dim);
      // Flying carriage: supported below, with no stationary bridge across its face.
      out+='<g transform="translate(300 420)"><circle cy="5" r="102" fill="#000"/><circle r="98" fill="'+gold+'"/><circle r="93" fill="#000"/><circle r="89" fill="'+plate+'" stroke="#322d1e" stroke-width="3"/><circle r="83" fill="none" stroke="#8c8463" stroke-width=".8"/>';
      for(var ti=0;ti<60;ti++)out+='<path d="M 0 -87 v '+(ti%5?2:5)+'" stroke="'+(ti%5?dim:a)+'" stroke-width="'+(ti%5?.6:1.4)+'" transform="rotate('+(ti*6)+')"/>';
      // The fixed fourth wheel stays on the plate. The escape pinion orbits it.
      out+='<path data-fixed-wheel="80" d="'+teethPath(40,80)+' M 34 0 A 34 34 0 1 0 -34 0 A 34 34 0 1 0 34 0 Z" fill="'+gold+'" fill-rule="evenodd" opacity=".65"/>';
      out+='<g data-motion="cage"><circle cy="3" r="74" fill="none" stroke="#000" stroke-width="7"/><circle r="74" fill="none" stroke="'+gold+'" stroke-width="4"/><circle r="70" fill="none" stroke="#7f8e7d"/>';
      for(var spoke=0;spoke<3;spoke++)out+='<path d="M 0 -12 C -30 -30 -30 -53 -5 -73 L 1 -73 C -17 -48 -14 -31 7 -12 Z" fill="'+steel+'" stroke="#ced5c1" stroke-width=".7" transform="rotate('+(spoke*120)+')"/>';
      out+=wheel(44,0,19,15,'escape',8,4,true);
      // Pallet stones alternately lock the escape wheel. Fork shares the beat clock.
      out+='<g transform="translate(18 0)"><g data-motion="fork"><path d="M -13 -2 L -2 -3 L 10 -15 L 16 -11 L 4 0 L 16 11 L 10 15 L -2 3 L -13 2 Z" fill="'+steel+'" stroke="#b0c6c5" stroke-width=".7"/><path d="M 11 -14 l 4 2 -2 4 -4 -2 Z M 11 14 l 4 -2 -2 -4 -4 2 Z" fill="'+ruby+'" stroke="#f8a4c9" stroke-width=".6"/></g></g>';
      out+='<g transform="translate(-12 0)"><g data-motion="balance"><circle cy="2" r="42" fill="none" stroke="#000" stroke-width="5"/><circle r="42" fill="none" stroke="'+gold+'" stroke-width="4"/><circle r="39" fill="none" stroke="#bfb88f" stroke-width=".6"/>';
      for(var ba=0;ba<4;ba++)out+='<path d="M 6 -1.7 L 40 -3 L 40 3 L 6 1.7 Z" fill="'+gold+'" stroke="#dccaa2" stroke-width=".5" transform="rotate('+(ba*90)+')"/>';
      for(var bs=0;bs<12;bs++)out+='<g transform="rotate('+(bs*30)+')"><rect x="40" y="-1.8" width="4" height="3.6" rx=".5" fill="'+steel+'"/><path d="M 42 -1 v 2" stroke="#273a42" stroke-width=".6"/></g>';
      out+='<circle r="6" fill="'+steel+'"/><circle cx="9" r="1.6" fill="'+ruby+'"/></g><path data-motion="spring" d="'+hairspring(0)+'" fill="none" stroke="#9cbad0" stroke-width=".65"/><circle cx="31" r="2.1" fill="'+steel+'"/></g>';
      // The balance cock travels WITH the cage; lower support keeps it flying.
      out+='<path d="M -68 -25 Q -40 -24 -12 -6 L -8 3 Q -40 -11 -69 -16 Z" transform="translate(0 2.5)" fill="#000"/><path d="M -68 -28 Q -40 -27 -12 -9 L -8 0 Q -40 -14 -69 -19 Z" fill="'+steel+'" stroke="#d4decf" stroke-width=".8"/>';
      out+='<path d="M 70 -17 Q 55 -12 40 -5 L 40 4 Q 60 -2 74 -9 Z M 4 -20 L 21 -5 L 22 4 L 15 4 L 0 -12 Z" transform="translate(0 2)" fill="#000"/><path d="M 70 -17 Q 55 -12 40 -5 L 40 4 Q 60 -2 74 -9 Z M 4 -20 L 21 -5 L 22 4 L 15 4 L 0 -12 Z" fill="'+steel+'" stroke="#c0cdbd" stroke-width=".7"/>';
      out+=jewel(-12,0,4.3)+jewel(44,0,2.7)+jewel(18,0,2)+screw(-65,-24,3);
      out+='<path d="M 0 -74 l -3.5 -8 h 7 Z" fill="'+ink+'"/></g></g>';
      // Skeletonized lance hands sit above the mechanism, readable at a distance.
      out+='<path d="M 300 320 L 291 274 L 300 166 L 309 274 Z" fill="#0b1710" stroke="'+ink+'" stroke-width="3" transform="rotate('+(hour*30)+' 300 300)"/>';
      out+='<path d="M 300 324 L 293 265 L 300 93 L 307 265 Z" fill="'+gold+'" stroke="'+ink+'" stroke-width="1" transform="rotate('+(minute*6)+' 300 300)"/>';
      out+=dot(0,0,11,steel)+dot(0,0,6,ruby)+text(300,214,c.hour24?pad(t.h)+':'+pad(t.m):t.h<12?'AM':'PM',11,a)+'</g>';
    }else if(c.style==='monolith'){
      out=text(300,270,pad(h),246,ink,'Arial, sans-serif','700')+text(300,478,pad(t.m),246,a,'Arial, sans-serif','700');
      out+='<line x1="110" y1="292" x2="490" y2="292" stroke="#53645f"/>';
      if(!c.hour24)out+=text(86,325,t.h<12?'AM':'PM',18,a);
      if(c.seconds)out+=text(515,325,pad(t.s),21,ink);
    }else if(c.style==='ribbon'){
      out=text(300,321,digital,128,ink,'Arial, sans-serif','200');
      out+='<line x1="45" y1="374" x2="555" y2="374" stroke="#53645f" stroke-width="2"/><circle cx="'+(45+t.m/59*510)+'" cy="374" r="6" fill="'+a+'"/>';
      out+=text(300,421,c.hour24?'24 HOUR':t.h<12?'AM':'PM',16,a);
      if(c.seconds)out+=text(300,206,pad(t.s),24,a,'monospace');
    }else{
      if(!c.hour24)out+=text(300,133,t.h<12?'AM':'PM',18,a);
      var previous=flip&&flip.from?time(flip.from,zone):null;
      for(var k=0;k<2;k++)out+=flap(34+k*276,k?pad(t.m):pad(h),k?a:ink,previous?(k?pad(previous.m):pad(c.hour24?previous.h:previous.h%12||12)):undefined);
      if(c.seconds)out+=text(300,463,pad(t.s),26,a,'monospace');
    }
    function calendarPart(kind,content){return '<g data-calendar="'+kind+'">'+content+'</g>';}
    var dayArt='',dateArt='',shortDay=t.weekdayName.slice(0,3),dateLabel=t.month+' '+pad(t.day);
    if(c.style==='orbit'){
      // Seven small satellites: the illuminated one is today, Monday first.
      for(var w=0;w<7;w++){var active=w===(t.weekday+6)%7,x=198+w*34;
        dayArt+='<circle cx="'+x+'" cy="569" r="'+(active?3.5:1.5)+'" fill="'+(active?a:dim)+'"/>';
      }
      dayArt+=text(300,592,shortDay,15,ink);
      dateArt=text(300,c.day?614:592,dateLabel,20,a,'Georgia, serif');
    }else if(c.style==='tourbillon'){
      dayArt=text(c.date?228:300,596,shortDay,18,ink,'Georgia, serif');
      dateArt=text(c.day?361:300,596,dateLabel,18,a,'Georgia, serif');
      if(c.day||c.date)out+='<path d="M 169 577 H 431 M 169 606 H 431" stroke="#556a5b" stroke-width=".7"/>';
      if(c.day&&c.date)out+='<path d="M 296 585 l 4 6 -4 6 -4 -6 Z" fill="'+a+'"/>';
    }else if(c.style==='atelier'){
      // A watchmaker's day/date complication, beneath the dial.
      var width=c.day&&c.date?222:126,left=300-width/2;
      if(c.day||c.date)out+='<rect x="'+left+'" y="571" width="'+width+'" height="40" rx="3" fill="none" stroke="'+dim+'"/>';
      if(c.day&&c.date)out+='<path d="M 291 578 V 604" stroke="'+dim+'"/>';
      dayArt=text(c.date?245:300,598,shortDay,19,ink,'Georgia, serif');
      dateArt=text(c.day?350:300,598,dateLabel,19,a,'Georgia, serif');
    }else if(c.style==='meridian'){
      // Graphic offset blocks echo the dial's bold cardinal typography.
      dayArt='<rect x="120" y="571" width="'+(c.date?158:360)+'" height="40" rx="3" fill="'+a+'"/>'+text(c.date?199:300,599,shortDay,26,'#14231e','Arial, sans-serif','700');
      dateArt=text(c.day?384:300,600,dateLabel,29,ink,'Arial, sans-serif','700');
    }else if(c.style==='monolith'){
      // An architectural colophon: broad weekday, generous month/day baseline.
      dayArt=text(300,547,t.weekdayName,26,a,'Arial, sans-serif','700');
      dateArt=text(300,c.day?597:555,dateLabel,38,ink,'Arial, sans-serif','200');
    }else if(c.style==='ribbon'){
      // A second, quieter horizon for the calendar.
      dayArt=text(300,484,t.weekdayName,25,ink,'Georgia, serif');
      dateArt='<path d="M 225 '+(c.day?505:467)+' H 375" stroke="'+a+'"/>'+text(300,c.day?540:502,dateLabel,26,a,'Arial, sans-serif','200');
    }else{
      // Small split-flap companions to the two time tiles.
      function calendarTile(x,width,value){return '<rect x="'+x+'" y="503" width="'+width+'" height="67" rx="8" fill="none" stroke="'+dim+'"/>'+text(x+width/2,545,value,26,a,'monospace')+'<path d="M '+x+' 533 H '+(x+width)+'" stroke="#263b35"/>';}
      dayArt=calendarTile(c.date?120:244,112,shortDay);
      dateArt='<g data-calendar-segment="month">'+calendarTile(c.day?244:182,112,t.month)+'</g><g data-calendar-segment="day-number">'+calendarTile(c.day?368:306,112,pad(t.day))+'</g>';
    }
    if(c.day)out+=calendarPart('day',dayArt);
    if(c.date)out+=calendarPart('date',dateArt);
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 600 620" width="100%" height="100%" role="img" aria-label="'+esc(digital+(c.hour24?'':t.h<12?' AM':' PM'))+'">'+out+'</svg>';
  }
  // A tiny per-surface player: normal ticks must not destroy an in-flight flap.
  function mount(el,c,d,zone,previewFrom){
    c=normalize(c);var key=JSON.stringify(c)+'|'+(zone||''),last=el._glassClock,win=typeof window==='undefined'?null:window;
    var reduced=win&&win.matchMedia&&win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var hidden=win&&win.document&&win.document.hidden;
    if(last&&last.frame&&(last.key!==key||reduced||hidden)){win.cancelAnimationFrame(last.frame);last.frame=null;}
    if(c.style==='tourbillon'&&win&&win.requestAnimationFrame){
      // Rebuild only when the minute/calendar/configuration changes, not each frame.
      var dialKey=key+'|'+Math.floor(d.getTime()/60000);
      if(!last||last.dialKey!==dialKey){
        if(last&&last.frame)win.cancelAnimationFrame(last.frame);
        el.innerHTML=scene(c,d,zone);last={key:key,date:d,frame:null,dialKey:dialKey,nodes:el.querySelectorAll('[data-motion]')};el._glassClock=last;
      }
      if(last.frame||reduced||hidden||!c.seconds)return;
      var origin=d.getTime(),started=null,painted=-100;
      function movement(stamp){
        last.frame=null;if(el._glassClock!==last||el.hidden||(win.document&&win.document.hidden))return;
        if(started===null)started=stamp;
        if(stamp-painted>=33){
          // Bound the period to the barrel's eight-hour revolution for precision.
          var seconds=((origin+stamp-started)/1000)%28800,state=movementState(seconds);
          for(var ni=0;ni<last.nodes.length;ni++){var node=last.nodes[ni],kind=node.getAttribute('data-motion');
            if(kind==='spring')node.setAttribute('d',hairspring(state.balance));
            else if(Object.prototype.hasOwnProperty.call(state,kind))node.setAttribute('transform','rotate('+(state[kind]%360)+')');
          }
          painted=stamp;
        }
        last.frame=win.requestAnimationFrame(movement);
      }
      last.frame=win.requestAnimationFrame(movement);return;
    }
    if(last&&last.frame)return;
    var from=previewFrom||(last&&last.key===key&&d-last.date>0&&d-last.date<2500?last.date:null);
    var before=from&&time(from,zone),now=time(d,zone);
    var next={key:key,date:d,frame:null};el._glassClock=next;
    if(c.style!=='split'||!from||!before||(before.h===now.h&&before.m===now.m)||!win||!win.requestAnimationFrame||reduced||hidden){el.innerHTML=scene(c,d,zone);return;}
    var start=null;
    el.innerHTML=scene(c,d,zone,{from:from,progress:0});
    function frame(stamp){
      if(el._glassClock!==next)return;
      if(start===null)start=stamp;
      var p=Math.min(1,(stamp-start)/680);
      if(win.document&&win.document.hidden)p=1;
      el.innerHTML=scene(c,d,zone,p<1?{from:from,progress:p}:null);
      next.frame=p<1?win.requestAnimationFrame(frame):null;
    }
    next.frame=win.requestAnimationFrame(frame);
  }
  var api={styles:styles,colors:colors,defaults:defaults,valid:valid,normalize:normalize,geometry:geometry,scene:scene,time:time,mount:mount,movementState:movementState,movementSpec:movementSpec,hairspring:hairspring};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GlassClock=api;
}(typeof window==='undefined'?globalThis:window));
