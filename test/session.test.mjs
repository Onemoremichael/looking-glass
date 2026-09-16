import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../session.mjs';
import { createApp } from '../server.mjs';

test('persistent timer and todo survive reload', t => {
 const dir=mkdtempSync(join(tmpdir(),'looking-glass-test-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'state.json'); const s=new Session({file,now:()=>1000});
 s.command('start_timer',{seconds:120}); s.command('add_todo',{text:'Read'});
 const restored=new Session({file}); assert.equal(restored.state.timers[0].endsAt,121000);
 assert.equal(restored.state.todos[0].text,'Read');
});
test('clarify, save, fork, cancel; no fake completion',()=>{
 const s=new Session(); s.command('request',{text:'UF Gator games this week'}); const task=s.state.tasks[0];
 assert.equal(task.status,'needs_input'); assert.throws(()=>s.command('save_recipe',{id:task.id}));
 s.command('answer',{id:task.id,text:'Football to watch'}); assert.equal(s.state.tasks[0].status,'blocked');
 s.command('save_recipe',{id:task.id}); s.command('save_recipe',{id:task.id}); assert.equal(s.state.recipes.length,1);
 const original=s.state.recipes[0];
 s.command('fork_recipe',{id:original.id,title:'All sports',preferences:'All sports to attend'});
 assert.equal(s.state.recipes[0].parentId,original.id); assert.equal(s.state.recipes[1].preferences,'Football to watch');
 s.command('cancel_task',{id:task.id}); assert.equal(s.state.tasks[0].status,'cancelled');
 assert.throws(()=>s.command('answer',{id:task.id,text:'late result'}));
});
test('invalid commands do not mutate state; timer routing is bounded',()=>{
 const s=new Session(); const before=JSON.stringify(s.state);
 for(const seconds of [-1,0,86401,1.5])assert.throws(()=>s.command('start_timer',{seconds}));
 assert.equal(JSON.stringify(s.state),before);
 s.command('request',{text:'Set a 5 minute timer'});assert.equal(s.state.timers.length,1);
 s.command('request',{text:'Set a timer for 2 minutes'});assert.equal(s.state.timers.length,2);
});
test('HTTP controls require same-origin JSON; static paths bounded',async t=>{
 const origins=[];const app=createApp({origins});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port;origins.push(base);
 const post=(body,origin=base)=>fetch(base+'/api/command',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await fetch(base)).status,200);assert.equal((await fetch(base+'/.env')).status,404);
 assert.equal((await post({action:'show',panel:'home'},'https://bad.example')).status,403);
 assert.equal((await post({action:'erase'})).status,400);
 assert.equal((await post({action:'start_timer',seconds:2})).status,200);
 const state=await (await fetch(base+'/api/state')).json();assert.equal(state.timers.length,1);
});
