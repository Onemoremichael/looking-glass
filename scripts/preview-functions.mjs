// Offline custom-code demo. QuickJS is real; no model call, mic or paid API.
import {createApp} from '../server.mjs';
const origin='http://localhost:8784',app=createApp({origins:[origin,'http://127.0.0.1:8784']});
await app.functions.handle('party-demo',{action:'create_function',parentId:null,inputJSON:'{"people":6}',spec:{
  title:'A little picnic math',outcome:'Pack enough snacks for everyone, without guesswork.',
  inputs:[{name:'people',label:'How many people?',type:'number'}],
  code:'input => { const people = Math.max(0,Math.ceil(input.people)); return {snacks:people*2,drinks:people,supplies:[{label:"Fruit pieces",value:people*2},{label:"Water bottles",value:people},{label:"Napkins",value:people*3}],note:"Two snacks, one drink and three napkins per person."}; }',
  tests:[{inputJSON:'{"people":2}',expectedJSON:'{"snacks":4,"drinks":2,"supplies":[{"label":"Fruit pieces","value":4},{"label":"Water bottles","value":2},{"label":"Napkins","value":6}],"note":"Two snacks, one drink and three napkins per person."}'},{inputJSON:'{"people":0}',expectedJSON:'{"snacks":0,"drinks":0,"supplies":[{"label":"Fruit pieces","value":0},{"label":"Water bottles","value":0},{"label":"Napkins","value":0}],"note":"Two snacks, one drink and three napkins per person."}'}],
  layout:{accent:'peach',blocks:[{kind:'metric',label:'Snacks to share',key:'snacks',unit:'pieces'},{kind:'bars',label:'In the picnic basket',key:'supplies'},{kind:'metric',label:'Water to bring',key:'drinks',unit:'bottles'},{kind:'note',label:'The recipe',key:'note'}]},
}});
app.server.listen(8784,'127.0.0.1',()=>console.log('Offline custom function: '+origin));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close());
