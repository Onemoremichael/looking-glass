(function(root){
  function command(){
    return {action:'create_workflow',parentId:null,values:[],spec:{
      title:'Gators at home',outcome:'Find opportunities to attend HOME events across ALL UF sports in Gainesville, Florida, over the next 14 days. No past, away or neutral-site events.',inputs:[],
      steps:[{title:'Check the official Gators schedule',kind:'research',request:
        'Find ALL UF sports HOME events to ATTEND in Gainesville FL, next 14 days from now, America/New_York. Exclude past, away and neutral sites; verify official floridagators.com schedules. Compose agenda Gators at home. One card/event: sport + opponent heading, date/time ET kicker, venue body, verified admission in detail (else Admission not confirmed). Include official event/ticket sources; no TV. Summary: exact date range, max 140 chars. Caveat max 100 chars. All events on one page; concise, chronological rows. No events? Say so with sources. Never invent.'}]
    }};
  }
  var api={command:command};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GlassGators=api;
}(typeof window==='undefined'?globalThis:window));
