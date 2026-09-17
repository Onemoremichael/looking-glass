// Isolated layout stress fixtures. No research claim, paid calls, mic or storage.
import {createApp} from '../server.mjs';
const origin='http://localhost:8784',app=createApp({origins:[origin,'http://127.0.0.1:8784']});
const scenario=process.argv[2]||'research-long';
const fill=(text,n)=>text.repeat(Math.ceil(n/text.length)).slice(0,n);
if(scenario==='research-long'){
  app.session.state.panel='research';
  app.session.state.research={id:'layout-stress',page:0,fetchedAt:Date.now(),
    spec:{title:fill('Portrait layout rehearsal with longer research headings. ',70),query:'Offline layout fixture, not researched facts',layout:'comparison'},
    summary:fill('Offline layout fixture. This text deliberately fills the allowed summary length to test reading without a touchscreen. ',300),
    caveat:fill('Layout test only, not a researched recommendation. Long caveats must remain reachable without scrolling on the mirror. ',300),
    cards:Array.from({length:6},(_,i)=>({heading:fill('Example '+(i+1)+' with a deliberately long descriptive heading. ',80),kicker:fill('LAYOUT REHEARSAL ',60),body:fill('This is test content, not a factual finding. It checks whether longer paragraphs remain readable from a distance on the portrait display. ',350),detail:fill('Extra context should not vanish below the physical display edge. ',100),sourceIds:['fixture']})),
    sources:[{id:'fixture',title:'Fixture source label, not evidence of research',url:'https://example.com/'}]};
}else if(['dog','cat','duck','bear-complete'].includes(scenario)){
  app.session.startPlayroom(scenario==='bear-complete'?'bear':'animals',{deck:'familiar',shuffle:false});
  const g=app.session.state.playroom;
  if(scenario==='bear-complete')for(const text of ['the second one','the second one','the third one'])app.session.command('playroom_turn',{gameId:g.id,turn:g.turn,text});
  else g.index=g.cards.indexOf(scenario);
}else throw Error('Unknown display scenario');
app.server.listen(8784,'127.0.0.1',()=>console.log('Offline display fixture: '+scenario+' '+origin));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close());
