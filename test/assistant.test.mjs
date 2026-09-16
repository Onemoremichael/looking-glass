import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../session.mjs';
import { Assistant } from '../assistant.mjs';
import { SurfaceRegistry, validateDecision, presentation } from '../assistant-contract.mjs';
import { AgentsPlanner } from '../agents-planner.mjs';
const decision=(actions=[],extra={})=>({status:actions.length?'execute':'clarify',outcome:'Manage my day',message:'Which one?',actions,options:[],selectedOptionId:null,...extra});
const setup=(decide)=>{
  const session=new Session(),surfaces=new SurfaceRegistry();
  return {session,surfaces,assistant:new Assistant({session,surfaces,planner:{decide}})};
};
test('natural outcome batch applies atomically and delegation replay is idempotent',async()=>{
  let calls=0;
  const {session,assistant}=setup(async()=>{calls++;return decision([{action:'add_todo',text:'milk'},{action:'add_todo',text:'eggs'},{action:'show',panel:'todos'}]);});
  await assistant.execute('a','Can you put milk and eggs on my list and bring it up?');
  await assistant.execute('a','repeat delivery');
  assert.equal(calls,1);assert.deepEqual(session.state.todos.map(t=>t.text),['milk','eggs']);assert.equal(session.state.panel,'todos');
  assert.throws(()=>session.commitDecision('bad',session.state.revision,decision([{action:'add_todo',text:'bread'},{action:'cancel_timer',id:'missing'}]),'bad'));
  assert.equal(session.state.todos.length,2);
});
test('clarification creates the same ordered options on both surfaces; second resolves by ID',async()=>{
  let step=0;
  const {session,surfaces,assistant}=setup(async ctx=>{
    if(!step++)return decision([],{options:[{id:'five',label:'Five minutes'},{id:'ten',label:'Ten minutes'}]});
    assert.equal(ctx.resolvedSelection.id,'ten');assert.equal(ctx.presentation.clarification.options[1].id,'ten');
    return decision([{action:'start_timer',seconds:600,label:'Tea'}],{selectedOptionId:'ten'});
  });
  const r=await assistant.execute('ask','Set a timer for my tea');assert.equal(r.status,'needs_input');assert.equal(session.state.timers.length,0);
  surfaces.report({clientId:'m',surface:'mirror',revision:session.state.revision,visible:true},session.state);
  await assistant.execute('answer','yeah the second one');assert.equal(session.state.timers[0].endsAt>0,true);assert.equal(session.state.assistant.status,'execute');
});
test('stale and missing surface acknowledgments do not resolve numbered options',async()=>{
  const {session,assistant}=setup(async()=>decision([],{options:[{id:'a',label:'A'},{id:'b',label:'B'}]}));
  await assistant.execute('q','choose something');
  const before=session.state.revision;
  assert.equal((await assistant.execute('reply','the second one')).status,'needs_input');assert.equal(session.state.revision,before);
});
test('existing-item options use snapshot aliases and bind the selected mutation exactly',async()=>{
  let step=0,wrong=false;
  const {session,surfaces,assistant}=setup(async ctx=>{
    assert.deepEqual(ctx.state.timers.map(t=>t.id),['timer_1','timer_2']);
    if(!step++)return decision([],{options:ctx.state.timers.map(t=>({id:t.id,label:t.label}))});
    assert.equal(ctx.resolvedSelection.id,'timer_2');
    return decision([{action:'cancel_timer',id:wrong?'timer_1':'timer_2'}],{selectedOptionId:'timer_2'});
  });
  session.command('start_timer',{seconds:300,label:'Tea'});session.command('start_timer',{seconds:600,label:'Laundry'});
  const second=session.state.timers[1].id;
  await assistant.execute('ask','Show timer options');
  assert.equal(session.state.assistant.options[1].id,second);
  surfaces.report({clientId:'m',surface:'mirror',revision:session.state.revision,visible:true},session.state);
  wrong=true;await assert.rejects(assistant.execute('bad','yeah the second one'),/Selected target mismatch/);
  assert.equal(session.state.timers.length,2);
  wrong=false;await assistant.execute('good','yeah the second one');
  assert.deepEqual(session.state.timers.map(t=>t.label),['Tea']);
});
test('unknown raw IDs and duplicate target writes are rejected before any mutation',async()=>{
  let actions;
  const {session,assistant}=setup(async()=>decision(actions));
  session.command('add_todo',{text:'Milk'});
  actions=[{action:'remove_todo',id:session.state.todos[0].id}];
  await assert.rejects(assistant.execute('raw','Remove milk'),/Unknown target alias/);
  actions=[{action:'set_todo_done',id:'todo_1',done:true},{action:'remove_todo',id:'todo_1'}];
  await assert.rejects(assistant.execute('duplicate','Complete milk'),/Duplicate target action/);
  assert.equal(session.state.todos.length,1);assert.equal(session.state.todos[0].done,false);
});
test('state changes and cancellation discard late decisions without mutations',async()=>{
  let finish;const {session,assistant}=setup(()=>new Promise(r=>finish=r));
  const work=assistant.execute('r','Add milk');session.command('show',{panel:'time'});
  finish(decision([{action:'add_todo',text:'milk'}]));await assert.rejects(work,/changed/);assert.equal(session.state.todos.length,0);
  const controller=new AbortController(),next=assistant.execute('r2','Add eggs',{signal:controller.signal});controller.abort();finish(decision([{action:'add_todo',text:'eggs'}]));
  await assert.rejects(next,/cancelled/);assert.equal(session.state.todos.length,0);
});
test('unsupported responses never mutate tools; unknown fields and IDs fail validation',()=>{
  assert.throws(()=>validateDecision(decision([{action:'add_todo',text:'milk'}],{status:'unsupported'})));
  assert.throws(()=>validateDecision(decision([{action:'shell',command:'anything'}])));
  assert.throws(()=>validateDecision({...decision(),code:'evil'}));
  assert.throws(()=>validateDecision({...decision(),constructor:'unexpected'}));
  const session=new Session();session.commitDecision('u',0,decision([],{status:'unsupported',message:'Weather is not connected.'}),'Forecast?');
  assert.equal(session.state.timers.length,0);assert.equal(session.state.assistant.status,'unsupported');
});
test('surface TTL, hidden reports and mirror/companion item limits are explicit',()=>{
  let now=0;const surfaces=new SurfaceRegistry(()=>now),session=new Session();
  for(let i=0;i<7;i++)session.command('add_todo',{text:'Item '+i});
  surfaces.report({clientId:'r',surface:'companion',revision:7,visible:false},session.state);
  assert.equal(surfaces.snapshot(session.state)[0].visible,false);
  const p=presentation(session.state);assert.equal(p.mirror.todos.length,5);assert.equal(p.companion.todos.length,7);
  now=15001;assert.equal(surfaces.snapshot(session.state).length,0);
});
test('presentation includes result cards and each surface’s actual saved/request limits',()=>{
  const session=new Session();session.state.panel='saved';
  session.state.recipes=Array.from({length:5},(_,i)=>({id:String(i),title:'View '+i}));
  session.state.assistant={status:'answer',message:'These are configurations, not live research.',options:[]};
  const saved=presentation(session.state);
  assert.equal(saved.mirror.recipes.length,3);assert.equal(saved.companion.recipes.length,5);
  assert.equal(saved.assistantCard.status,'answer');
  session.state.panel='weather';assert.equal(presentation(session.state).disconnectedPlaceholder,'weather');
});
test('Agents API adapter requires completed JSON, cleans its session and accounts for use',async()=>{
  const calls=[],d=decision([{action:'show',panel:'todos'}]);
  const stream={controller:{abort(){}},async *[Symbol.asyncIterator](){yield {type:'agent.session.created',session:{id:'test'}};yield {type:'agent.session.turn.output_text.done',text:JSON.stringify(d)};yield {type:'agent.session.turn.completed',usage:{input_tokens:10,output_tokens:20}};}};
  const planner=new AgentsPlanner({client:{beta:{agents:{sessions:{create:async body=>{assert.equal(body.environment.type,'none');assert.deepEqual(body.agent.tools,[]);return stream;},delete:async id=>calls.push(id)}}}},budget:{reserve:()=> 'b',finishAgent:(id,result)=>calls.push(result)}});
  assert.deepEqual(await planner.decide({utterance:'Show my list'}),d);await planner.drain();assert.equal(calls[0],'test');assert.equal(calls[1].complete,true);
});
test('Agents stream failure cancels, deletes and never accepts an incomplete decision',async()=>{
  const calls=[];
  const stream={controller:{abort(){}},async *[Symbol.asyncIterator](){yield {type:'agent.session.created',session:{id:'test'}};yield {type:'agent.session.turn.output_text.done',text:JSON.stringify(decision())};}};
  const planner=new AgentsPlanner({client:{beta:{agents:{sessions:{create:async()=>stream,events:{create:async()=>calls.push('cancel')},delete:async()=>calls.push('delete')}}}},budget:{reserve:()=> 'b',finishAgent:()=>{}}});
  await assert.rejects(()=>planner.decide({}));assert.deepEqual(calls,['cancel','delete']);
});
test('replacement planning waits for previous cleanup; aborted queued requests never run',async()=>{
  const planner=new AgentsPlanner(),calls=[];let release;
  planner.runDecision=async context=>{calls.push(context);if(context==='first')await new Promise(r=>release=r);return context;};
  const first=planner.decide('first');await Promise.resolve();
  const controller=new AbortController();const dropped=planner.decide('dropped',{signal:controller.signal});
  const rejected=assert.rejects(dropped,/cancelled/);controller.abort();
  const next=planner.decide('replacement');await Promise.resolve();assert.deepEqual(calls,['first']);
  release();await first;await rejected;assert.equal(await next,'replacement');assert.deepEqual(calls,['first','replacement']);
});
test('validated result arrives before cleanup; next call and drain still wait for cleanup',async()=>{
  const calls=[];let release;const deletion=new Promise(r=>release=r);
  const d=decision([{action:'show',panel:'todos'}]);
  const stream=()=>({controller:{abort(){}},async *[Symbol.asyncIterator](){yield {type:'agent.session.created',session:{id:'test'}};yield {type:'agent.session.turn.output_text.done',text:JSON.stringify(d)};yield {type:'agent.session.turn.completed'};}});
  const planner=new AgentsPlanner({client:{beta:{agents:{sessions:{create:async body=>{assert.equal(body.agent.reasoning.effort,'low');calls.push('create');return stream();},delete:async()=>{calls.push('delete');await deletion;}}}}},budget:{reserve:()=>{calls.push('reserve');return 'b';},finishAgent:()=>calls.push('finish')}});
  assert.deepEqual(await planner.decide({}),d);
  assert.deepEqual(calls,['reserve','create','delete']);
  let drained=false;const draining=planner.drain().then(()=>drained=true);
  const controller=new AbortController();const queued=planner.decide({},{signal:controller.signal});
  const rejected=assert.rejects(queued,/cancelled/);controller.abort();
  const next=planner.decide({});await new Promise(r=>setImmediate(r));
  assert.equal(drained,false);assert.deepEqual(calls,['reserve','create','delete']);
  release();await draining;await rejected;assert.deepEqual(await next,d);await planner.drain();
  assert.deepEqual(calls,['reserve','create','delete','finish','reserve','create','delete','finish']);
  assert.equal(typeof planner.lastTiming.cleanupMs,'number');
});
test('unconfirmed background cleanup retains accounting and does not silently retry inference',async()=>{
  let creates=0,deletes=0,blocked=false;const finished=[];
  const stream={controller:{abort(){}},async *[Symbol.asyncIterator](){yield {type:'agent.session.created',session:{id:'test'}};yield {type:'agent.session.turn.output_text.done',text:JSON.stringify(decision())};yield {type:'agent.session.turn.completed'};}};
  const planner=new AgentsPlanner({client:{beta:{agents:{sessions:{create:async()=>{creates++;return stream;},delete:async()=>{deletes++;throw Error('offline');}}}}},budget:{reserve:()=>{if(blocked)throw Error('Unconfirmed cleanup');return 'b';},finishAgent:(_id,result)=>{finished.push(result);blocked=!result.cleaned;}}});
  await planner.decide({});await planner.drain();
  assert.equal(finished[0].cleaned,false);assert.equal(finished[0].complete,true);
  await assert.rejects(planner.decide({}),/Unconfirmed cleanup/);
  assert.equal(creates,1);assert.equal(deletes,2);
});
