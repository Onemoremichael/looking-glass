import test from 'node:test';
import assert from 'node:assert/strict';
import {plannerResponseSchema,matches,validatePlannerResponse,validateDecision} from '../assistant-contract.mjs';
import {AgentsPlanner} from '../agents-planner.mjs';
import {Assistant} from '../assistant.mjs';
import {Session} from '../session.mjs';
import {Workflows} from '../workflows.mjs';

const decision=(status='execute',extra={})=>({status,outcome:'Prepare a picnic',message:'Requested',actions:status==='execute'?[{action:'add_todo',text:'Water'}]:[],options:[],selectedOptionId:null,quickAction:null,...extra});
function provider(response,{complete=true}={}){
  const calls={created:0,deleted:0,finished:[]};
  const planner=new AgentsPlanner({client:{beta:{agents:{sessions:{
    create:async body=>{calls.created++;assert.deepEqual(body.agent.text.format.schema,plannerResponseSchema);return {controller:{abort(){}},async *[Symbol.asyncIterator](){
      yield {type:'agent.session.created',session:{id:'fixture'}};
      yield {type:'agent.session.turn.output_text.done',text:JSON.stringify(response)};
      if(complete)yield {type:'agent.session.turn.completed'};
    }};},delete:async()=>{calls.deleted++;},events:{create:async()=>{}},
  }}}},budget:{reserve:()=> 'fixture',finishAgent:(_id,value)=>calls.finished.push(value)}});
  return {planner,calls};
}
test('provider schema uses an object envelope and disjoint action/clarification shapes',()=>{
  assert.equal(plannerResponseSchema.type,'object');assert.equal(plannerResponseSchema.anyOf,undefined);
  assert.deepEqual(plannerResponseSchema.required,['decision']);
  for(const status of ['execute','clarify','answer','unsupported']){
    const d=decision(status),branches=plannerResponseSchema.properties.decision.anyOf;
    assert.equal(branches.filter(s=>matches(s,d)).length,1);
    assert.deepEqual(validatePlannerResponse({decision:d}),d);
    assert.equal(matches(plannerResponseSchema,{decision:d}),true);
  }
});
test('status/actions/options/cardinality contradictions cannot pass the generation schema',()=>{
  const wrong=[decision('execute',{actions:[]}),decision('clarify',{actions:[{action:'add_todo',text:'Water'}]}),decision('answer',{actions:[{action:'get_time'}]}),decision('unsupported',{actions:[{action:'get_time'}]}),decision('execute',{options:[{id:'a',label:'Which?'}]}),decision('answer',{options:[{id:'a',label:'Which?'}]}),decision('execute',{actions:Array(6).fill({action:'get_time'})}),decision('clarify',{options:Array(5).fill({id:'a',label:'Which?'})}),decision('clarify',{quickAction:{kind:'show_panel',panel:'home'}})];
  for(const d of wrong){assert.equal(matches(plannerResponseSchema,{decision:d}),false);assert.throws(()=>validatePlannerResponse({decision:d}),{code:'planner_contract_invalid'});}
});
test('provider rejects missing or extra fields and duplicate options; local legacy decisions still work',()=>{
  const d=decision(),{quickAction,...legacy}=d;
  for(const response of [d,{decision:legacy},{decision:d,explanation:'extra'},{decision:{...d,code:'extra'}},null,{decision:null}])assert.throws(()=>validatePlannerResponse(response),{code:'planner_contract_invalid'});
  assert.doesNotThrow(()=>validateDecision(legacy));
  assert.throws(()=>validatePlannerResponse({decision:decision('clarify',{options:[{id:'a',label:'One'},{id:'a',label:'Two'}]})}),{code:'planner_contract_invalid'});
});
test('inconsistent completed provider decisions never mutate state, retry inference, or skip cleanup',async()=>{
  for(const d of [decision('execute',{actions:[]}),decision('clarify',{actions:[{action:'add_todo',text:'PRIVATE CONTENT'}]})]){
    const {planner,calls}=provider({decision:d}),session=new Session(),before=structuredClone(session.state);
    const assistant=new Assistant({session,planner});
    await assert.rejects(assistant.execute('bad','Private request'),{code:'planner_contract_invalid'});
    await planner.drain();
    assert.deepEqual(session.state,before);assert.equal(calls.created,1);assert.equal(calls.deleted,1);
    assert.equal(calls.finished[0].complete,true);assert.equal(calls.finished[0].cleaned,true);
    assert.deepEqual(planner.lastContractFailure,{envelope:true,status:d.status,actionCount:d.actions.length,optionCount:0});
    assert.doesNotMatch(JSON.stringify(planner.lastContractFailure),/PRIVATE|Water|picnic/);
  }
});
test('provider-wrapped workflow execution persists missing input question without further inference',async()=>{
  const spec={title:'Picnic in {{city}}',outcome:'Prepare for a picnic',inputs:[{name:'city',question:'Which city?'}],steps:[{title:'Pack',kind:'confirm',request:'Pack a blanket for {{city}}'}]};
  const {planner,calls}=provider({decision:decision('execute',{actions:[{action:'create_workflow',spec,values:[],parentId:null}]})});
  const session=new Session(),assistant=new Assistant({session,planner}),workflows=new Workflows({session,assistant});assistant.workflows=workflows;
  try{
    const result=await assistant.execute('plan','Make a picnic plan and ask which city');
    assert.equal(result.status,'completed');assert.equal(session.state.workflows.length,1);
    assert.equal(session.state.workflows[0].status,'needs_input');assert.equal(session.state.workflows[0].inputQuestions[0].name,'city');
    assert.equal(workflows.active,null);assert.equal(calls.created,1);
  }finally{await workflows.close();await planner.drain();}
});
test('ordinary provider clarification remains a question with no mutation',async()=>{
  const d=decision('clarify',{message:'How many minutes?',options:[]}),{planner}=provider({decision:d}),session=new Session();
  const result=await new Assistant({session,planner}).execute('ask','Set a timer');await planner.drain();
  assert.equal(result.status,'needs_input');assert.equal(session.state.timers.length,0);assert.equal(session.state.assistant.message,d.message);
});
test('completed schema-valid decision cannot execute from an incomplete provider turn',async()=>{
  const {planner,calls}=provider({decision:decision()},{complete:false}),session=new Session();
  await assert.rejects(new Assistant({session,planner}).execute('interrupted','Add water'),/interrupted/);await planner.drain();
  assert.equal(session.state.todos.length,0);assert.equal(calls.finished[0].complete,false);assert.equal(calls.deleted,1);
});
