// Explicit opt-in only: four paid synthetic decisions, no microphone or user-state writes.
import { fileURLToPath } from 'node:url';
import { Session } from '../session.mjs';
import { Assistant } from '../assistant.mjs';
import { SurfaceRegistry } from '../assistant-contract.mjs';
import { AgentsPlanner } from '../agents-planner.mjs';
import { ApiBudget } from '../api-budget.mjs';
import assert from 'node:assert/strict';
if(!process.argv.includes('--run-paid'))throw Error('Pass --run-paid to spend from the shared test allowance');
process.loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));
const budget=new ApiBudget(fileURLToPath(new URL('../data/api-test-budget.json',import.meta.url)));
const session=new Session(),surfaces=new SurfaceRegistry();
const planner=new AgentsPlanner({budget});
const assistant=new Assistant({session,surfaces,planner});
async function run(id,text){
  const started=Date.now();const result=await assistant.execute(id,text);
  const elapsedMs=Date.now()-started;await planner.drain();
  console.log(JSON.stringify({case:id,elapsedMs,timing:planner.lastTiming,model:planner.model,effort:planner.effort,result,card:session.state.assistant}));return result;
}
await run('natural-list','Could you put milk and eggs on my to-do list, and bring the list up?');
assert.equal(session.state.todos.length,2);assert.equal(session.state.panel,'todos');
await run('clarify','Start a timer.');
assert.equal(session.state.assistant.status,'clarify');assert.equal(session.state.timers.length,0);
await run('answer','Make that five minutes.');
assert.equal(session.state.timers.length,1);
await run('unsupported','What will the weather be tomorrow?');
assert.equal(session.state.assistant.status,'unsupported');
console.log('Four synthetic model decisions passed; live application state was not modified.');
