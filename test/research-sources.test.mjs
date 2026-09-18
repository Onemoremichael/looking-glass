import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {publicIPv4,readPublicPage,SOURCE_PREFIX_BYTES} from '../research-sources.mjs';
test('source verification rejects private, loopback and reserved DNS including mixed answers',async()=>{
  for(const ip of ['127.0.0.1','10.1.1.1','172.31.2.3','192.168.0.1','169.254.1.1','100.64.0.1','::1','0.0.0.0','198.18.0.1','224.0.0.1'])assert.equal(publicIPv4(ip),false);
  assert.equal(publicIPv4('8.8.8.8'),true);
  let called=false;
  await assert.rejects(readPublicPage('https://source.example.com',{resolve:async()=>['8.8.8.8','127.0.0.1'],request:()=>{called=true;}}),/Private/);
  assert.equal(called,false);
});
test('public fetch pins DNS and rejects redirects to local addresses',async()=>{
  let count=0;
  const request=(url,opts,cb)=>{
    const req=new EventEmitter();req.end=()=>{
      opts.lookup(url.hostname,{},(e,address,family)=>{assert.equal(address,'8.8.8.8');assert.equal(family,4);});
      const res=new EventEmitter();res.resume=()=>{};res.statusCode=302;res.headers={location:'http://127.0.0.1/secrets'};count++;cb(res);
    };return req;
  };
  await assert.rejects(readPublicPage('https://source.example.com',{resolve:async()=>['8.8.8.8'],request}),/public/);assert.equal(count,1);
});
function page(chunks,{status=200,type='text/html'}={}){
  let req,count=0;
  const request=(_url,opts,cb)=>{
    req=new EventEmitter();req.destroy=()=>{req.destroyed=true;};req.end=()=>{
      const res=new EventEmitter();res.statusCode=status;res.headers={'content-type':type};res.resume=()=>{};cb(res);
      for(const chunk of chunks){if(req.destroyed)break;count++;res.emit('data',Buffer.from(chunk));}
      if(!req.destroyed)res.emit('end');
    };return req;
  };
  return {request,resolve:async()=>['8.8.8.8'],get destroyed(){return req?.destroyed;},get count(){return count;}};
}
test('large public HTML passes bounded-prefix reachability without downloading the whole page',async()=>{
  const p=page(['<html><body>Official stadium information',Buffer.alloc(SOURCE_PREFIX_BYTES,65),'unread tail']);
  const result=await readPublicPage('https://source.example.com',p);
  assert.equal(result.truncated,true);assert.equal(result.bytes,SOURCE_PREFIX_BYTES);assert.equal(p.destroyed,true);assert.equal(p.count,2);
});
test('small nonempty pages keep complete evidence; blank prefixes and bad responses fail closed',async()=>{
  const result=await readPublicPage('https://source.example.com',page(['Official capacity: 100,000']));
  assert.equal(result.truncated,false);assert.equal(result.bytes,Buffer.byteLength('Official capacity: 100,000'));
  for(const p of [page([]),page(['   ']),page([Buffer.alloc(SOURCE_PREFIX_BYTES,32),'unread real content']),page(['error'],{status:403}),page(['{}'],{type:'application/json'})]){
    await assert.rejects(readPublicPage('https://source.example.com',p),/Empty|unavailable/);
  }
});
test('opt-in table content retention still respects the byte cap',async()=>{
  const p=page(['<table>',Buffer.alloc(SOURCE_PREFIX_BYTES,65),'unread']);
  const result=await readPublicPage('https://source.example.com',{...p,retainText:true});
  assert.equal(Buffer.byteLength(result.text),SOURCE_PREFIX_BYTES);assert.equal(result.truncated,true);assert.doesNotMatch(result.text,/unread/);
  assert.equal((await readPublicPage('https://source.example.com',page(['public']))).text,undefined);
});
