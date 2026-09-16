// Isolated visual QA: no key, microphone, planner, provider calls or live-state edits.
import {readFileSync} from 'node:fs';
import {createApp} from '../server.mjs';
const port=8783;
const app=createApp({origins:['http://localhost:'+port,'http://127.0.0.1:'+port]});
const source=JSON.parse(readFileSync(new URL('../data/research-smoke.json',import.meta.url),'utf8'));
app.session.state={...app.session.state,research:source.research,panel:'research',reusableViews:source.reusableViews,researchCache:source.researchCache};
app.server.listen(port,'127.0.0.1',()=>console.log('Isolated research preview: http://localhost:'+port));
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>app.close());
