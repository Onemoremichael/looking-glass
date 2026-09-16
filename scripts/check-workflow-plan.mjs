// Explicit paid smoke test: one planner call, isolated state, no microphone.
// Shares the owner's real budget ledger; never creates/resets an allowance.
import {fileURLToPath} from 'node:url';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {AgentsPlanner} from '../agents-planner.mjs';
import {Workflows} from '../workflows.mjs';
import {ApiBudget} from '../api-budget.mjs';
import {Telemetry} from '../telemetry.mjs';
if(!process.argv.includes('--paid'))throw Error('Requires --paid; uses one reservation from the existing approved allowance');
process.loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));
const directory=mkdtempSync(join(tmpdir(),'glass-workflow-live-check-'));
const session=new Session({file:join(directory,'state.json')}),telemetry=new Telemetry({file:join(directory,'traces.jsonl')});
const planner=new AgentsPlanner({budget:new ApiBudget(fileURLToPath(new URL('../data/api-test-budget.json',import.meta.url))),telemetry});
let calls=0;
const assistant=new Assistant({session,telemetry,planner:{decide:async(...args)=>{if(++calls>1)throw Error('Smoke test permits only one planning call');return planner.decide(...args);}}});
const workflows=new Workflows({session,assistant,telemetry});assistant.workflows=workflows;
try{
  const result=await assistant.execute('live-workflow-smoke','Create a reusable three-step preparation workflow for a picnic. Make city a named input and ask me which city before starting. All three steps should be things I do myself and confirm: pack a blanket, fill the water bottles, and check the door before leaving. Do not research or generate images; I only want the saved plan and your first question for now.');
  if(workflows.active)await workflows.active.promise;
  const run=session.state.workflows?.[0];
  const passed=!!run&&run.status==='needs_input'&&run.inputQuestions.length===1&&run.steps.length===3&&run.steps.every(s=>s.kind==='confirm'&&s.status==='pending')&&session.state.reusableViews.some(v=>v.id===run.recipeId&&v.kind==='workflow');
  console.log(JSON.stringify({passed,plannerCalls:calls,result,run,directory},null,2));
  if(!passed)process.exitCode=1;
}catch(error){
  console.log(JSON.stringify({passed:false,plannerCalls:calls,directory,errorCode:error.code==='planner_contract_invalid'?error.code:'smoke_failed',contract:planner.lastContractFailure||null},null,2));
  process.exitCode=1;
}finally{await workflows.close();await planner.drain();await telemetry.close();}
