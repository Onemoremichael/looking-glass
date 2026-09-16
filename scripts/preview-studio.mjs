// Offline layout fixture. No API key, microphone or provider calls.
import {mkdtempSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
const directory=mkdtempSync(join(tmpdir(),'glass-studio-preview-'));
const origin='http://localhost:8784',id='00000000-0000-0000-0000-000000000001';
copyFileSync(new URL('../public/assets/playroom/elephant-v1.png',import.meta.url),join(directory,id+'.png'));
const app=createApp({origins:[origin,'http://127.0.0.1:8784'],studioOptions:{directory,budget:{reserve(){throw Error('Offline fixture: generation disabled');}}}});
app.session.state.imageJobs=[{id,model:'Offline artwork fixture',status:'completed',spec:{title:'A little wonder',prompt:'Existing elephant artwork reused only for offline layout verification.',background:'transparent'},detail:'UI fixture, not a provider test.'}];
app.session.command('open_image',{jobId:id});
app.server.listen(8784,'127.0.0.1',()=>console.log('Offline studio fixture: '+origin));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close());
