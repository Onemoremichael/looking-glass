// Isolated, in-memory acceptance fixture. Real sandbox; no API calls or audio.
import {createApp} from '../server.mjs';
const origin='http://localhost:8784';let plannerCalls=0;
const spec={title:'Party portions',outcome:'Two snacks per guest',inputs:[{name:'people',label:'People',type:'number'}],code:'input => ({portions: input.people * 2})',tests:[{inputJSON:'{"people":4}',expectedJSON:'{"portions":8}'},{inputJSON:'{"people":0}',expectedJSON:'{"portions":0}'}],layout:{accent:'peach',blocks:[{kind:'metric',label:'Snacks to pack',key:'portions',unit:'pieces'}]}};
const app=createApp({origins:[origin,'http://127.0.0.1:8784'],assistantOptions:{planner:{decide:async context=>{
  plannerCalls++;
  return {status:'execute',outcome:'Calculate party portions',message:'Requested',actions:[{action:'create_function',spec,inputJSON:JSON.stringify({people:Number(context.workflowContext.inputs[0].value)}),parentId:null}],options:[],selectedOptionId:null};
}}}});
const first=app.workflows.handle('fixture-first',{action:'create_workflow',parentId:null,values:[{name:'people',value:'6'}],spec:{title:'Party prep',outcome:'Have enough snacks for everyone',inputs:[{name:'people',question:'How many guests?'}],steps:[{kind:'custom',title:'Snacks to pack',request:'Calculate two snacks each for {{people}} people'}]}});
await app.workflows.active.promise;
const recipeId=app.workflows.get(first.runId).recipeId;
const second=app.workflows.handle('fixture-second',{action:'reuse_workflow',viewId:recipeId,values:[{name:'people',value:'9'}]});
await app.workflows.active.promise;
const run=app.workflows.get(second.runId);
if(run.status!=='completed'||run.steps[0].evidence.functionOutput.portions!==18||plannerCalls!==1)throw Error('Workflow fixture failed');
app.workflows.handle('open-fixture',{action:'open_workflow',runId:run.id});
app.server.listen(8784,'127.0.0.1',()=>console.log('Verified fresh-input reuse: 6 → 9 guests, 12 → 18 snacks; one fixture planner call. '+origin+'/remote'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close());
