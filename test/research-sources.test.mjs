import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {publicIPv4,readPublicPage} from '../research-sources.mjs';
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
