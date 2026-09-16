import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateDecision } from './assistant-contract.mjs';

export const catalog = [
  { id: 'time', title: 'Time & date', status: 'ready', tier: 'builtin', execution: 'local', scope: 'Device clock and date', gaps: ['Explicit time-zone preference'] },
  { id: 'timers', title: 'Timers', status: 'ready', tier: 'builtin', execution: 'local', scope: 'Named timers, list, cancel; durable deadlines and receipts; model-driven intent', gaps: ['Audio alerts', 'Pause/resume', 'Human validation of new planner'] },
  { id: 'todos', title: 'To-do list', status: 'ready', tier: 'builtin', execution: 'local', scope: 'Add, list, complete/uncomplete, remove; persistent atomic voice actions', gaps: ['Edit text', 'Human validation of new planner'] },
  { id: 'weather', title: 'Weather', status: 'needs connection', tier: 'builtin', execution: 'cached_lookup', scope: 'Current conditions and short forecast', gaps: ['Location/units', 'Provider', 'Timestamped cache'] },
  { id: 'calendar', title: 'Calendar review', status: 'needs connection', tier: 'builtin', execution: 'cached_lookup', scope: 'Read-only today, next event, upcoming week', gaps: ['Account authorization', 'Read-only adapter', 'Freshness state'] },
  { id: 'display', title: 'Display controls', status: 'partial', tier: 'builtin', execution: 'local', scope: 'Voice/companion panels; shared numbered questions; per-surface render context', gaps: ['Navigation history', 'Human validation of new planner', 'Non-touch overflow navigation'] }
];
function text(value, max = 300) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid text');
  return value.trim();
}
export class Session {
  constructor({ onChange = () => {}, file, now = Date.now } = {}) {
    this.onChange = onChange; this.file = file; this.now = now;
    this.state = { version: 1, revision: 0, panel: 'home', message: 'What would you like to do?', timers: [], todos: [], tasks: [], recipes: [], catalog };
    if (file) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        if (data.version !== 1 || !['timers','todos','tasks','recipes'].every(k => Array.isArray(data[k]))) throw new Error('Invalid state file');
        this.state = { ...this.state, ...data, catalog };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  save() {
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify(this.state, null, 2), { mode: 0o600 });
      renameSync(this.file + '.tmp', this.file);
    }
  }
  voiceCommand(id, intent) {
    const prior = (this.state.voiceReceipts || []).find(r => r.id === id);
    if (prior) return prior;
    if (typeof id !== 'string' || id.length > 300) throw Error('Invalid operation ID');
    if (!['start_timer','cancel_timer','add_todo','show'].includes(intent.action)) throw Error('Unsupported voice tool');
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
      const confirmations=[];
      for(const a of decision.actions) {
        if(a.action==='get_time'){confirmations.push('It is '+new Date(this.now()).toLocaleTimeString()+'.');continue;}
        this.apply(a.action,a);
        confirmations.push(a.action==='start_timer'?`Started ${a.label} for ${a.seconds} seconds (visual alert only).`:a.action==='cancel_timer'?'Timer cancelled.':a.action==='add_todo'?'Added to your to-do list.':a.action==='set_todo_done'?(a.done?'Marked the item complete.':'Marked the item incomplete.'):a.action==='remove_todo'?'Removed the to-do item.':`${a.panel} displayed${['weather','calendar'].includes(a.panel)?'; no data source connected':''}.`);
      }
      const message=decision.status==='execute'?confirmations.join(' '):decision.message;
      const card={id:randomUUID(),status:decision.status,outcome:decision.outcome,message,options:decision.options};
      this.state.assistant=card;this.state.message=message;
      this.state.assistantHistory=[...(this.state.assistantHistory||[]),{user:utterance,assistant:message,outcome:decision.outcome,status:decision.status}].slice(-8);
      const result={status:decision.status==='clarify'?'needs_input':'completed',action:'assistant',message:message+(decision.options.length?' Options: '+decision.options.map((o,i)=>`${i+1}. ${o.label}`).join('; '):'')};
      this.state.assistantReceipts=[...(this.state.assistantReceipts||[]),{id,result}].slice(-500);
      this.state.revision++;this.save();this.onChange(this.state);return result;
    }catch(e){this.state=before;throw e;}
  }
  apply(action, args) {
    const s = this.state;
    if (action === 'show') {
      if (!['home','time','timers','todos','weather','calendar','tasks','saved'].includes(args.panel)) throw new Error('Unknown panel');
      s.panel = args.panel; return;
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
