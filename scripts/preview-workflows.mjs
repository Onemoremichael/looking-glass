// Deterministic UI/workflow fixture. No API key, microphone or paid inference.
import {createApp} from '../server.mjs';
const origin='http://localhost:8784';
const app=createApp({origins:[origin,'http://127.0.0.1:8784'],assistantOptions:{planner:{decide:async()=>({status:'execute',outcome:'Prepare the picnic',message:'Added',actions:[{action:'add_todo',text:'Pack the picnic blanket'},{action:'add_todo',text:'Bring water bottles'}],options:[],selectedOptionId:null})}}});
const result=app.workflows.handle('fixture',{action:'create_workflow',parentId:null,values:[],spec:{title:'A slower Saturday',outcome:'A picnic, a little sunshine, and everything ready before we leave.',inputs:[],steps:[{kind:'todos',title:'The little essentials',request:'Add a blanket and water bottles to the list'},{kind:'confirm',title:'Pack the picnic basket',request:'Your list is ready. Tell me when the basket is packed, and we’ll move on.'},{kind:'confirm',title:'Ready for a little adventure',request:'Check the door is locked before leaving.'}]}});
if(app.workflows.active)await app.workflows.active.promise;
app.workflows.handle('open-fixture',{action:'open_workflow',runId:result.runId});
app.server.listen(8784,'127.0.0.1',()=>console.log('Offline workflow fixture: '+origin));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close());
