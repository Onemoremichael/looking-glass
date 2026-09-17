// Isolated adult UI rehearsal. No model, audio, device or persistent state.
import {createApp} from '../server.mjs';
const origin='http://localhost:8784';
const app=createApp({origins:[origin,'http://127.0.0.1:8784']});
app.session.startPlayroom('animals',{deck:'familiar',shuffle:false});
app.server.listen(8784,'127.0.0.1',()=>console.log('Offline playroom: '+origin+'/remote'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close());
