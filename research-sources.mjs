import {resolve4} from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import {publicSource} from './research-board.mjs';

export function publicIPv4(ip){
  if(!/^\d+\.\d+\.\d+\.\d+$/.test(ip))return false;
  const [a,b,c,d]=ip.split('.').map(Number);
  if([a,b,c,d].some(n=>n>255))return false;
  return !([0,10,127].includes(a)||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||
    a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||
    a===198&&[18,19,51].includes(b)||a===203&&b===0&&c===113);
}
// Pin DNS for each request, validate each redirect, never forward cookies/auth,
// and only read a bounded text page. This is not a general proxy endpoint.
export async function readPublicPage(value,{signal,resolve=resolve4,request}={}){
  let current=value;
  const deadline=AbortSignal.timeout(10000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
  for(let hop=0;hop<3;hop++){
    if(!publicSource(current))throw Error('Research source must be public HTTP(S)');
    const url=new URL(current);
    const addresses=await Promise.race([resolve(url.hostname),new Promise((_,reject)=>{
      if(combined.aborted)return reject(Error('Source check cancelled'));
      combined.addEventListener('abort',()=>reject(Error('Source check cancelled')),{once:true});
    })]);
    if(!addresses.length||addresses.some(ip=>!publicIPv4(ip)))throw Error('Private or reserved research source address');
    const result=await new Promise((resolveResult,reject)=>{
      const create=request||(url.protocol==='https:'?https.request:http.request);
      const req=create(url,{signal:combined,method:'GET',headers:{'User-Agent':'LookingGlass/0.1 research source verification','Accept':'text/html,text/plain','Accept-Encoding':'identity'},
        lookup:(_host,opts,cb)=>opts?.all?cb(null,[{address:addresses[0],family:4}]):cb(null,addresses[0],4)},res=>{
        if([301,302,303,307,308].includes(res.statusCode)){
          res.resume();resolveResult({redirect:res.headers.location});return;
        }
        if(res.statusCode!==200||!/^text\/(html|plain)/i.test(res.headers['content-type']||'')){res.resume();reject(Error('Research source unavailable'));return;}
        let size=0,text='';res.on('data',chunk=>{
          size+=chunk.length;if(size>512*1024){req.destroy(Error('Research source too large'));return;}
          text+=chunk.toString('utf8');
        });
        res.on('error',reject);res.on('end',()=>text.trim()?resolveResult({url:current,bytes:size}):reject(Error('Empty research source')));
      });
      req.on('error',reject);req.end();
    });
    if(!result.redirect)return result;
    current=new URL(result.redirect,current).href;
  }
  throw Error('Too many source redirects');
}
export async function verifyResearchSources(urls,{signal}={}){
  const checked=new Set();
  // Two at a time; bounded by the board's eight-source contract.
  for(let i=0;i<urls.length;i+=2)await Promise.all(urls.slice(i,i+2).map(async url=>{await readPublicPage(url,{signal});checked.add(url);}));
  return checked;
}
