// Isolated, offline repair rehearsal. The two planner decisions are fixtures;
// validation, sandbox execution, saving, reuse and rendering are real app code.
// No API key, microphone, physical Mirror connection or production state used.
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {Assistant} from '../assistant.mjs';
const origin='http://localhost:8784',app=createApp({origins:[origin,'http://127.0.0.1:8784']});
const code='input => { const liters=Math.round(Math.PI*Math.pow(input.diameter/2,2)*input.depth/100)/10;return {liters,bags:Math.ceil(liters/20),note:"Approximate empty cylinder volume; allow for roots and drainage. Bags assumed to contain 20 liters."}; }';
const note='Approximate empty cylinder volume; allow for roots and drainage. Bags assumed to contain 20 liters.';
const initial={action:'create_function',parentId:null,inputJSON:'{"diameter":30,"depth":25}',spec:{
  title:'Room to grow',outcome:'Estimate soil volume for a cylindrical planter from centimeters.',
  inputs:[{name:'diameter',label:'Diameter (cm)',type:'number'},{name:'depth',label:'Soil depth (cm)',type:'number'}],
  code:code.replace('/100)/10','*10)/10'),
  tests:[{inputJSON:'{"diameter":20,"depth":20}',expectedJSON:JSON.stringify({liters:6.3,bags:1,note})},{inputJSON:'{"diameter":0,"depth":20}',expectedJSON:JSON.stringify({liters:0,bags:0,note})}],
  layout:{accent:'mint',blocks:[{kind:'metric',label:'Soil volume',key:'liters',unit:'liters'},{kind:'metric',label:'20-liter bags',key:'bags',unit:'bags'},{kind:'note',label:'The estimate',key:'note'}]},
}};
let calls=0;
const assistant=new Assistant({session:app.session,planner:{decide:async context=>{
  calls++;
  if(calls>2)throw Error('Fixture does not permit more planning');
  const action=calls===1?initial:{...context.functionRepair.original,spec:{...context.functionRepair.original.spec,code}};
  return {status:'execute',outcome:'Estimate soil',message:'Requested',actions:[action],options:[],selectedOptionId:null,quickAction:null};
}}});assistant.functions=app.functions;
await assistant.execute('build','Estimate soil for diameter 30 and depth 25');
assert.equal(app.session.state.customView.output.liters,17.7);assert.equal(calls,2);
const started=performance.now();
const result=await assistant.execute('reuse','Estimate soil for diameter 50 and depth 40');
assert.equal(result.functionOutput.liters,78.5);assert.equal(result.functionOutput.bags,4);assert.equal(calls,2);
console.log(JSON.stringify({fixturePlannerCalls:calls,repairVerified:true,reusedLocally:true,output:result.functionOutput,localReuseMs:Math.round(performance.now()-started)}));
app.server.listen(8784,'127.0.0.1',()=>console.log('Offline repair fixture: '+origin));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close());
