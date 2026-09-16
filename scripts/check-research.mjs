// One paid research turn, isolated state. Explicit flag; shared allowance only.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {Session} from '../session.mjs';
import {Assistant} from '../assistant.mjs';
import {AgentsPlanner} from '../agents-planner.mjs';
import {ApiBudget} from '../api-budget.mjs';
import {researchIntent} from '../research-board.mjs';
if(!process.argv.includes('--run-paid'))throw Error('Pass --run-paid to spend from the shared allowance');
process.loadEnvFile(new URL('../.env',import.meta.url).pathname);
const session=new Session();
const planner=new AgentsPlanner({budget:new ApiBudget(new URL('../data/api-test-budget.json',import.meta.url).pathname)});
let calls=0;const decide=planner.decide.bind(planner);planner.decide=(...args)=>{calls++;return decide(...args);};
const assistant=new Assistant({session,planner});
try{
  const started=Date.now();
  const result=await assistant.execute('research-smoke','Research three animals for an adult to introduce to a three-year-old: elephant, giraffe and penguin. Use authoritative zoo or conservation sources. Make a compact comparison board with one interesting, accurate, gentle fact for each. This is an adult research request, not a game yet.');
  assert.equal(session.state.panel,'research');assert.ok(session.state.research.savedId);
  assert.equal(session.state.research.cards.length,3);
  writeFileSync(new URL('../data/research-smoke.json',import.meta.url),JSON.stringify(session.state,null,2),{mode:0o600});
  console.log(JSON.stringify({elapsedMs:Date.now()-started,result,board:session.state.research},null,2));
  const id=session.state.research.savedId;
  assert.ok(researchIntent('Open '+session.state.research.spec.title,session.state),'Reuse must route locally before testing it');
  const reuseStart=Date.now();await assistant.execute('research-reuse','Open '+session.state.research.spec.title);
  assert.equal(session.state.research.savedId,id);
  assert.equal(calls,1,'Fresh reuse must not call the provider');
  console.log('Fresh cached reuse: '+(Date.now()-reuseStart)+'ms; no second provider call.');
}finally{console.log(JSON.stringify({researchEvidence:planner.lastResearchEvidence}));await planner.drain();}
