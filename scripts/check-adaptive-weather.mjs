// Two bounded paid decisions, isolated app state, no microphone capture.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {AgentsPlanner} from '../agents-planner.mjs';
import {ApiBudget} from '../api-budget.mjs';
import {SurfaceRegistry} from '../assistant-contract.mjs';
import {Weather} from '../weather.mjs';
if(!process.argv.includes('--run-paid'))throw Error('Pass --run-paid to use the shared test allowance');
process.loadEnvFile(new URL('../.env',import.meta.url).pathname);
const session=new Session(),surfaces=new SurfaceRegistry();
session.state.weather=JSON.parse(readFileSync(new URL('../data/state.json',import.meta.url),'utf8')).weather;
session.state.weather.composition=null;session.state.weather.view='now';session.state.panel='weather';
session.onChange=state=>surfaces.report({clientId:'synthetic-render',surface:'mirror',visible:true,revision:state.revision},state);
const weather=new Weather({session});await weather.refresh();
const planner=new AgentsPlanner({budget:new ApiBudget(new URL('../data/api-test-budget.json',import.meta.url).pathname)});
const assistant=new Assistant({session,surfaces,weather,planner});
try{
  for(const [id,utterance,range] of [['later','What’s it looking like later in the week?','rest_of_week'],['next','Could you put together next week’s weather with a focus on rain?','next_week']]){
    const start=Date.now();const result=await assistant.execute(id,utterance);await planner.drain();
    assert.equal(session.state.weather.view,'custom');assert.equal(session.state.weather.composition.spec.range,range);
    assert.equal(session.state.viewOffer,null);assert.ok(session.state.weather.composition.savedId);
    console.log(JSON.stringify({case:id,elapsedMs:Date.now()-start,planningMs:planner.lastTiming.planningMs,spec:session.state.weather.composition.spec,days:session.state.weather.composition.data.days.length,autoSaved:true}));
  }
  assert.equal(session.state.weatherViews.length,2);
  const title=session.state.weatherViews[0].spec.title;
  await assistant.execute('reuse','Open '+title);assert.equal(session.state.viewOffer,null);
  console.log('Both real planner decisions and local save/reuse passed. Only the shared budget ledger was persisted.');
}finally{await planner.drain();await weather.close();}
