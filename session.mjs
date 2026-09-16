import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateDecision } from './assistant-contract.mjs';
import {promoteQuickAction} from './quick-actions.mjs';
import {emptyWeather,weatherSummary} from './weather.mjs';
import {validateWeatherSpec,composeWeather,compositionSummary,refreshComposition,viewOfferCurrent} from './weather-composition.mjs';
import {ReusableViews,weatherViewIndex} from './reusable-views.mjs';

export const catalog = [
  { id: 'time', title: 'Time & date', status: 'ready', tier: 'builtin', execution: 'local', scope: 'Device clock and date', gaps: ['Explicit time-zone preference'] },
  { id: 'timers', title: 'Timers', status: 'ready', tier: 'builtin', execution: 'local', scope: 'Named timers, list, cancel; durable deadlines and receipts; model-driven intent', gaps: ['Audio alerts', 'Pause/resume', 'Human validation of new planner'] },
  { id: 'todos', title: 'To-do list', status: 'ready', tier: 'builtin', execution: 'local', scope: 'Add, list, complete/uncomplete, remove; persistent atomic voice actions', gaps: ['Edit text', 'Human validation of new planner'] },
  { id: 'weather', title: 'Weather', status: 'ready', tier: 'builtin', execution: 'cached_lookup', scope: 'Open-Meteo conditions and up to 16 forecast days; seven-day component compositions; automatically retained reusable views; five saved places; F/C', gaps: ['Choose a saved location', 'No severe-weather alerts or radar', 'No arbitrary generated code or longer-range forecasts'] },
  { id: 'calendar', title: 'Calendar review', status: 'needs connection', tier: 'builtin', execution: 'cached_lookup', scope: 'Read-only today, next event, upcoming week', gaps: ['Account authorization', 'Read-only adapter', 'Freshness state'] },
  { id: 'display', title: 'Display controls', status: 'partial', tier: 'builtin', execution: 'local', scope: 'Voice/companion panels; shared numbered questions; per-surface render context', gaps: ['Navigation history', 'Human validation of new planner', 'Non-touch overflow navigation'] }
];
function text(value, max = 300) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid text');
  return value.trim();
}
export class Session {
  constructor({ onChange = () => {}, file, now = Date.now, learnQuickActions=process.env.OPENAI_LEARNED_FAST_PATH!=='0' } = {}) {
    this.onChange = onChange; this.file = file; this.now = now; this.learnQuickActions=learnQuickActions;
    this.repertoire=new ReusableViews({weather:validateWeatherSpec});
    this.state = { version: 1, revision: 0, panel: 'home', message: 'What would you like to do?', timers: [], todos: [], tasks: [], recipes: [], weatherViews:[],viewOffer:null,weather:emptyWeather(), catalog };
    if (file) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        if (data.version !== 1 || !['timers','todos','tasks','recipes'].every(k => Array.isArray(data[k]))) throw new Error('Invalid state file');
        this.state = { ...this.state, ...data, catalog };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    // Preserve legacy IDs so existing shortcuts and saved-view links still work.
    if(!this.state.reusableViews)this.state.reusableViews=(this.state.weatherViews||[]).map(v=>({id:v.id,version:1,kind:'weather',scope:v.locationId,spec:v.spec,createdAt:v.createdAt,parentId:null}));
    weatherViewIndex(this.state);
    this.state.viewOffer=null; // Retire old opt-in invitations under auto-save policy.
  }
  save() {
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify(this.state, null, 2), { mode: 0o600 });
      renameSync(this.file + '.tmp', this.file);
    }
  }
  editWeather(edit){
    const before=structuredClone(this.state);
    try{edit(this.state.weather);refreshComposition(this.state,this.now());this.state.revision++;this.save();}
    catch(error){this.state=before;throw error;}
    this.onChange(this.state);
  }
  voiceCommand(id, intent) {
    const prior = (this.state.voiceReceipts || []).find(r => r.id === id);
    if (prior) return prior;
    if (typeof id !== 'string' || id.length > 300) throw Error('Invalid operation ID');
    if (!['start_timer','cancel_timer','add_todo','show','get_weather'].includes(intent.action)) throw Error('Unsupported voice tool');
    const before = structuredClone(this.state);
    try {
      this.apply(intent.action, intent);
      const receipt = { id, action:intent.action, timerId:intent.action === 'start_timer' ? this.state.timers[this.state.timers.length-1].id : null };
      this.state.voiceReceipts = [...(this.state.voiceReceipts || []), receipt].slice(-500);
      this.state.revision++; this.save(); this.onChange(this.state); return receipt;
    } catch (error) { this.state = before; throw error; }
  }
  command(action, args = {}) {
    const before = structuredClone(this.state);
    try { this.apply(action, args); this.state.assistant=null; this.state.revision++; this.save(); }
    catch (error) { this.state = before; throw error; }
    this.onChange(this.state);
  }
  commitDecision(id,revision,decision,utterance) {
    if(typeof id!=='string'||!id||id.length>300)throw Error('Invalid operation ID');
    validateDecision(decision);
    const prior=(this.state.assistantReceipts||[]).find(r=>r.id===id);if(prior)return prior.result;
    if(this.state.revision!==revision)throw Error('Display changed while deciding');
    const before=structuredClone(this.state);
    try {
      if(decision.actions.some(a=>a.action==='compose_weather')&&decision.actions.length!==1)throw Error('Compose one view at a time');
      if(decision.actions.some(a=>a.action==='resolve_view_offer')&&decision.actions.length!==1)throw Error('Resolve a save offer on its own');
      if(!decision.actions.some(a=>a.action==='resolve_view_offer'))this.state.viewOffer=null;
      const confirmations=[];
      for(const a of decision.actions) {
        if(a.action==='get_time'){confirmations.push('It is '+new Date(this.now()).toLocaleTimeString()+'.');continue;}
        this.apply(a.action,a);
        if(a.action==='compose_weather'||a.action==='open_weather_view'){confirmations.push(compositionSummary(this.state.weather.composition.data));if(a.action==='compose_weather')confirmations.push(this.state.weather.composition.savedId?'This layout is saved automatically for reuse; do not ask to save it.':'This view was not saved: '+this.state.weather.composition.saveReason+'.');continue;}
        if(a.action==='resolve_view_offer'||a.action==='save_current_view'){confirmations.push(this.state.message);continue;}
        if(a.action==='get_weather'||(a.action==='show'&&a.panel==='weather')){confirmations.push(weatherSummary(this.state.weather,this.state.weather.view,this.now()));continue;}
        confirmations.push(a.action==='start_timer'?`Started ${a.label} for ${a.seconds} seconds (visual alert only).`:a.action==='cancel_timer'?'Timer cancelled.':a.action==='add_todo'?'Added to your to-do list.':a.action==='set_todo_done'?(a.done?'Marked the item complete.':'Marked the item incomplete.'):a.action==='remove_todo'?'Removed the to-do item.':`${a.panel} displayed${['weather','calendar'].includes(a.panel)?'; no data source connected':''}.`);
      }
      const message=decision.status==='execute'?confirmations.join(' '):decision.message;
      const card={id:randomUUID(),status:decision.status,outcome:decision.outcome,message,options:decision.options};
      this.state.assistant=card;this.state.message=message;
      this.state.assistantHistory=[...(this.state.assistantHistory||[]),{user:utterance,assistant:message,outcome:decision.outcome,status:decision.status}].slice(-8);
      const result={status:decision.status==='clarify'?'needs_input':'completed',action:'assistant',message:message+(decision.options.length?' Options: '+decision.options.map((o,i)=>`${i+1}. ${o.label}`).join('; '):'')};
      if(decision.actions.some(a=>a.action==='compose_weather'))result.compositionId=this.state.weather.composition.id;
      const promotion=this.learnQuickActions?promoteQuickAction(before,decision,utterance,this.now()):null;
      if(promotion)this.state.quickActions=[...(this.state.quickActions||[]).filter(e=>e.phrase!==promotion.phrase),promotion].slice(-64);
      this.state.assistantReceipts=[...(this.state.assistantReceipts||[]),{id,result}].slice(-500);
      this.state.revision++;this.save();this.onChange(this.state);return result;
    }catch(e){this.state=before;throw e;}
  }
  offerComposition(compositionId){
    return null; // Compatibility only; assembled views now save on commit.
  }
  retainComposition(parentId=null){
    const c=this.state.weather.composition;
    if(!c)return;
    if(!c.data.days.length){c.saveReason='no forecast data is available';return;}
    const saved=this.repertoire.retain(this.state,{kind:'weather',scope:c.locationId,spec:c.spec,parentId},this.now());
    if(saved){c.savedId=saved.id;delete c.saveReason;}
    else c.saveReason='the reusable-view library is full';
    weatherViewIndex(this.state);
  }
  apply(action, args) {
    const s = this.state;
    if(action==='compose_weather'){
      validateWeatherSpec(args.spec);
      const locationId=args.locationId||s.weather.activeId;
      if(!s.weather.locations.some(l=>l.id===locationId))throw Error('Choose a saved weather location first');
      const parentId=s.weather.composition?.savedId||null;
      s.weather.activeId=locationId;s.weather.view='custom';s.panel='weather';s.viewOffer=null;
      s.weather.composition={id:randomUUID(),locationId,spec:structuredClone(args.spec),data:composeWeather(s.weather,args.spec,this.now())};
      this.retainComposition(parentId);return;
    }
    if(action==='save_current_view'){
      if(s.panel!=='weather'||!s.weather.composition)throw Error('No assembled view is displayed');
      this.retainComposition();s.viewOffer=null;
      s.message=s.weather.composition.savedId?'This layout is already saved for reuse.':'Could not save: '+s.weather.composition.saveReason;return;
    }
    if(action==='open_weather_view'){
      const v=s.weatherViews.find(v=>v.id===(args.viewId||args.id));if(!v)throw Error('Saved view not found');
      this.apply('compose_weather',{locationId:v.locationId,spec:v.spec});s.weather.composition.savedId=v.id;return;
    }
    if(action==='resolve_view_offer'){
      if(!viewOfferCurrent(s,this.now())||s.viewOffer.id!==args.offerId||!['save','discard'].includes(args.choice))throw Error('No matching active save offer');
      if(args.choice==='save'){
        const c=s.weather.composition;
        if(s.weatherViews.length>=24)throw Error('Saved view limit reached');
        const existing=s.weatherViews.find(v=>v.locationId===c.locationId&&JSON.stringify(v.spec)===JSON.stringify(c.spec));
        if(!existing)s.weatherViews.push({id:randomUUID(),version:1,locationId:c.locationId,spec:structuredClone(c.spec),createdAt:this.now()});
        s.message='Saved '+c.spec.title+'. Ask to open '+c.spec.title+' next time. I can reuse its layout with current forecast data; no scheduled work was created.';
      }else s.message='Just this time, then. The view stays open, but I have not saved it for reuse.';
      s.viewOffer=null;return;
    }
    if(action==='get_weather'){
      if(!['now','today','tomorrow','week'].includes(args.period))throw Error('Unknown forecast period');
      if(args.locationId!==null&&!s.weather.locations.some(l=>l.id===args.locationId))throw Error('Unknown weather location');
      if(args.locationId)s.weather.activeId=args.locationId;
      s.weather.view=args.period;s.weather.composition=null;s.viewOffer=null;s.panel='weather';return;
    }
    if (action === 'show') {
      if (!['home','time','timers','todos','weather','calendar','tasks','saved'].includes(args.panel)) throw new Error('Unknown panel');
      s.viewOffer=null;s.panel = args.panel; return;
    }
    if (action === 'start_timer') {
      if (!Number.isInteger(args.seconds) || args.seconds < 1 || args.seconds > 86400 || s.timers.length >= 20) throw new Error('Use 1–86400 seconds; maximum 20 timers');
      s.timers.push({ id: randomUUID(), label: args.label ? text(args.label, 80) : 'Timer', endsAt: this.now() + args.seconds * 1000 });
      s.panel = 'timers'; s.message = 'Timer started. Visual alert only for now.'; return;
    }
    if (action === 'cancel_timer') {
      if (!s.timers.some(t => t.id === args.id)) throw new Error('Timer not found');
      s.timers = s.timers.filter(t => t.id !== args.id); return;
    }
    if (action === 'add_todo') {
      if (s.todos.length >= 100) throw new Error('Maximum 100 items');
      s.todos.push({ id: randomUUID(), text: text(args.text), done: false }); s.panel = 'todos'; return;
    }
    if (action === 'toggle_todo') {
      const todo = s.todos.find(t => t.id === args.id); if (!todo) throw new Error('Item not found');
      todo.done = !todo.done; return;
    }
    if(action==='set_todo_done'||action==='remove_todo') {
      const todo=s.todos.find(t=>t.id===args.id);if(!todo)throw Error('Item not found');
      if(action==='remove_todo')s.todos=s.todos.filter(t=>t.id!==args.id);
      else {if(typeof args.done!=='boolean')throw Error('Invalid completion status');todo.done=args.done;}
      s.panel='todos';return;
    }
    if (action === 'request') {
      const request = text(args.text);
      const match = request.match(/(?:set|start).*?(\d+)\s*(second|minute|hour)s?.*timer|(?:set|start).*?timer.*?(\d+)\s*(second|minute|hour)s?/i);
      if (match) return this.apply('start_timer', { seconds: Number(match[1] || match[3]) * ({second:1,minute:60,hour:3600}[(match[2] || match[4]).toLowerCase()]) });
      if (/^(show )?(the )?(time|clock)$/i.test(request)) return this.apply('show', { panel:'time' });
      if (/^(show )?(the )?(weather|calendar|todos|timers)$/i.test(request)) return this.apply('show', { panel:request.toLowerCase().split(' ').pop() });
      if (s.tasks.length >= 100) throw new Error('Maximum 100 requests');
      const sports = /gator|\buf\b/i.test(request);
      s.tasks.unshift({ id: randomUUID(), request, kind: sports ? 'sports' : 'custom', status: 'needs_input',
        question: sports ? 'All UF sports or football only? Games to watch, attend, or both?' : 'What should this show, and what would make it useful to keep?',
        createdAt: this.now(), answers: '', recipeId: null });
      s.panel = 'tasks'; s.message = 'A few details first. No AI worker is connected yet.'; return;
    }
    if (action === 'answer') {
      const task = s.tasks.find(t => t.id === args.id);
      if (!task || task.status !== 'needs_input') throw new Error('Request is not waiting for an answer');
      task.answers = text(args.text, 600); task.status = 'blocked';
      task.question = ''; task.detail = 'Preferences captured. Live research needs the agent connection; no schedules have been fetched.';
      s.message = 'Ready for the research integration—not working in the background yet.'; return;
    }
    if (action === 'cancel_task') {
      const task = s.tasks.find(t => t.id === args.id); if (!task) throw new Error('Request not found');
      task.status = 'cancelled'; task.question = ''; task.detail = 'Cancelled. No background work is running.'; return;
    }
    if (action === 'save_recipe') {
      const task = s.tasks.find(t => t.id === args.id);
      if (!task || task.status !== 'blocked') throw new Error('Configure the request first');
      if (!task.recipeId) {
        task.recipeId = randomUUID();
        s.recipes.unshift({ id: task.recipeId, version:1, title: task.kind === 'sports' ? 'Gators this week' : task.request.slice(0,60),
          query:task.request, preferences:task.answers, component:'agenda', freshness:'refresh_on_open',
          sourceStatus:'not_connected', parentId:null, createdAt:this.now() });
      }
      s.panel = 'saved'; s.message = 'Saved the configuration, not a completed result. No automatic refresh scheduled.'; return;
    }
    if (action === 'fork_recipe') {
      const recipe = s.recipes.find(r => r.id === args.id); if (!recipe) throw new Error('View not found');
      s.recipes.unshift({ ...recipe, id:randomUUID(), parentId:recipe.id, title:text(args.title,80), preferences:text(args.preferences,600), createdAt:this.now() });
      s.message = 'Saved a separate variation. The original is unchanged.'; return;
    }
    if (action === 'open_recipe') {
      const recipe = s.recipes.find(r => r.id === args.id); if (!recipe) throw new Error('View not found');
      s.panel = 'saved'; s.message = recipe.title + ': configuration ready; data source is not connected. No results to display yet.'; return;
    }
    throw new Error('Unknown command');
  }
  close() {}
}
