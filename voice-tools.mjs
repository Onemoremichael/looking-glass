// Deliberately narrow local grammar. Never execute a prefix of an unfinished request.
const numbers = { a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, fifteen:15, twenty:20, thirty:30, forty:40, fifty:50, sixty:60 };
export function parseVoice(text) {
  // Showing the same list is already part of add_todo: one atomic operation,
  // not a generic compound-command executor. Keep the entire utterance anchored.
  const todo = text.trim().replace(/[.!?]+$/g, '').match(/^(?:please )?add (.+?) to my (?:to-do|to do|todo) list(?:,? and (?:then )?show (?:me )?(?:(?:the|my) (?:to-do|to do|todo) list|(?:the|my) list|it))?$/i);
  if (todo && todo[1].length <= 300 && !/\b(?:actually|instead|never mind|no wait|then)\b/i.test(todo[1]) && !/[.!?;]/.test(todo[1])) return { action:'add_todo', text:todo[1] };
  const s = text.toLowerCase().trim().replace(/[.!?,]+$/g, '').replace(/-/g,' ').replace(/\s+/g,' ')
    .replace(/^(?:please |can you |could you )/, '').replace(/ please$/, '');
  const count = '(\\d+|'+Object.keys(numbers).join('|')+')';
  const m = s.match(new RegExp('^(?:set|start) (?:a timer for '+count+' (seconds?|minutes?|hours?)|(?:a )?'+count+' (second|minute|hour) timer)$'));
  if (m) {
    const n = m[1] || m[3], unit = m[2] || m[4];
    const seconds = (numbers[n] || Number(n)) * (unit.startsWith('hour') ? 3600 : unit.startsWith('minute') ? 60 : 1);
    if (Number.isInteger(seconds) && seconds > 0 && seconds <= 86400) return { action:'start_timer', seconds };
  }
  if (/^(?:cancel|stop) (?:it|that|that timer|the timer|my timer)$/.test(s) || /^dismiss (?:the|my|that) timer$/.test(s)) return { action:'cancel_timer' };
  if (/^show (?:me )?(?:my |the )?(?:to do list|todo list|todos)$/.test(s)) return { action:'show', panel:'todos' };
  if (/^show (?:me )?(?:the |my )?(?:weather|calendar)$/.test(s)) return { action:'show', panel:s.endsWith('weather') ? 'weather' : 'calendar' };
  if (/^(?:show (?:me )?(?:the |my )?)?timers$/.test(s)) return { action:'show', panel:'timers' };
  if (/^(?:show (?:me )?(?:the )?(?:clock|time)|what time is it)$/.test(s)) return { action:'show', panel:'time' };
  if (/^(?:go home|go back|dismiss that|clear the screen)$/.test(s)) return { action:'show', panel:'home' };
  return null;
}

export class VoiceTools {
  constructor(session) { this.session = session; this.lastTimer = null; this.results = new Map(); }
  execute(id, transcript) {
    if (this.results.has(id)) return this.results.get(id);
    const intent = parseVoice(transcript);
    let result;
    if (!intent) result = { status:'needs_input', message:'That wording did not match a supported action. Nothing was changed. Could you rephrase it as one request?' };
    else {
      if (intent.action === 'cancel_timer') {
        const timers = this.session.state.timers;
        intent.id = timers.some(t => t.id === this.lastTimer) ? this.lastTimer : timers.length === 1 ? timers[0].id : null;
        if (!intent.id) result = { status:'needs_input', message:timers.length ? 'There are several timers. Choose one in the companion; none was cancelled.' : 'There are no timers to cancel.' };
      }
      if (!result) {
        const receipt = this.session.voiceCommand(id, intent);
        if (intent.action === 'start_timer') this.lastTimer = receipt.timerId;
        result = { status:'completed', action:intent.action, message: intent.action === 'start_timer' ? `Timer started for ${intent.seconds} seconds. The alert is visual only.` : intent.action === 'cancel_timer' ? 'Timer cancelled.' : intent.action === 'add_todo' ? 'Added one item to your to-do list and displayed it.' : ['weather','calendar'].includes(intent.panel) ? `${intent.panel} placeholder displayed. No provider is connected; no live data was fetched.` : intent.panel === 'time' ? `Clock displayed. Mac time is ${new Date(this.session.now()).toLocaleTimeString()}.` : `${intent.panel} displayed.` };
      }
    }
    this.results.set(id, result); return result;
  }
}
