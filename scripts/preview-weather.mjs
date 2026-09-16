// Isolated, read-only design fixture. No real settings, provider traffic or voice.
// node scripts/preview-weather.mjs [rain|sun|snow|moon|cloud|storm|fog]
// /art shows the complete artwork collection on both display surfaces.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {Session} from '../session.mjs';
const now=Date.now(),midnight=Math.floor(now/86400000)*86400000;
const kinds=['cloud','sun','moon','rain','storm','snow','fog'];
const kind=kinds.includes(process.argv[2])?process.argv[2]:'rain';
const label={rain:'Light rain',sun:'Clear skies',snow:'Snow',moon:'Clear night',cloud:'Partly cloudy',storm:'Thunderstorms',fog:'Fog'}[kind];
const session=new Session();session.state.panel='weather';
session.state.weather={locations:[{id:'demo',name:'Rain study · DEMO',label:'Synthetic design fixture',timeZone:'UTC'}],activeId:'demo',units:'fahrenheit',view:'now',errors:{},forecasts:{demo:{locationId:'demo',units:'fahrenheit',timeZone:'UTC',fetchedAt:now,current:{time:now,temp:72,feels:74,wind:8,humidity:81,kind,label},
  hourly:Array.from({length:48},(_,i)=>({time:now+i*3600000,temp:72+Math.sin(i/3)*5,rain:Math.max(0,70-i*5),kind:i<5?kind:'cloud',label})),
  daily:Array.from({length:7},(_,i)=>({time:midnight+i*86400000,high:78+i,low:67+i,rain:Math.max(0,70-i*20),kind:i===0?kind:i===1?'cloud':'sun',label:i===0?label:i===1?'Partly cloudy':'Clear skies',sunrise:midnight+i*86400000+6*3600000,sunset:midnight+i*86400000+19*3600000}))}}};
const allowed=['index.html','surface.js','weather-ui.js','display.js','style.css','voice.css','weather.css'].concat(['cloud','sun','moon','rain','storm','snow','fog'].map(k=>'assets/weather/'+k+'-volume-v1.png'));
const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/art'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    return res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weather artwork studies</title><link rel="stylesheet" href="/weather.css"><style>body{background:#000;color:#f5f3e9;font:20px system-ui;padding:24px}h1{font-size:28px;font-weight:400}main{display:flex;flex-wrap:wrap}.sample{width:190px;margin:10px}.hero-art.wx-sky{width:100%;margin:0;animation:none}.hero-art>.wx-atmosphere{height:150px}.hero-art{height:150px;display:flex;align-items:center;justify-content:center}.hero-art img{max-width:100%;max-height:100%}.wx-horizon{padding:16px}.wx-hours{justify-content:center}.wx-hour-slot{width:100%}.label{text-transform:capitalize;color:#c1d1db}</style><h1>Weather artwork · design study</h1><p>Floating on the mirror / framed on the forecast strip</p><main>'+kinds.map(k=>'<section class="sample"><p class="label">'+k+'</p><div class="hero-art wx-sky" data-weather="'+k+'" data-hero="yes"></div><div class="wx-horizon"><div class="wx-hours"><div class="wx-hour-slot"><span class="wx-hour">9 AM</span><div data-weather="'+k+'"></div><strong>72°</strong></div></div></div></section>').join('')+'</main><script src="/weather-ui.js"></script><script>Array.prototype.forEach.call(document.querySelectorAll("[data-weather]"),function(el){el.innerHTML=GlassWeather.renderArt(el.getAttribute("data-weather"),"",el.getAttribute("data-hero")==="yes");});</script></html>');
  }
  if(path==='/api/surface'){res.writeHead(200);return res.end('{}');}
  if(path==='/api/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});res.write('data: '+JSON.stringify(session.state)+'\n\nevent: voice\ndata: {"phase":"off"}\n\n');return;
  }
  const name=path==='/'?'index.html':path.slice(1);if(!allowed.includes(name)){res.writeHead(404);return res.end();}
  try{res.writeHead(200,{'Content-Type':name.endsWith('.png')?'image/png':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store'});res.end(await readFile(new URL('../public/'+name,import.meta.url)));}catch{res.end();}
});
server.listen(8781,'127.0.0.1',()=>console.log('Synthetic weather preview only: http://localhost:8781/'));
