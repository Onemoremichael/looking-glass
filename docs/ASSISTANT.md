# Outcome-first assistant

## Interaction contract

Interpret the desired outcome, assess available capabilities and missing context,
then execute, clarify, answer, or explain the limitation. Do not ask permission for
every ordinary local action. Ask a focused question when the answer materially
changes the outcome. Do not invent progress or promise future background delivery.

GPT-Live-1 remains the quiet-start conversational frontend. Clear standalone timer
starts, explicit single-timer cancellations, and eligible learned phrases take a
deterministic local accelerator (see [VOICE.md](VOICE.md)); the
same atomic action contract, durable receipts and shared history still apply.
Unmatched task requests and clarification answers delegate to an Agents API session (not the Agents SDK).
The backend uses GPT-5.4 Mini, low reasoning, schema-constrained JSON, no tools,
no sandbox and no subagents. The model proposes actions; only the local app executes
them. The cloud session is deleted after completion; interrupted sessions are
cancelled first. Deletion is not a claim of zero provider retention.

## Capabilities

`assistant-contract.mjs` defines the runtime manifest and validated schemas:
time, panel selection, named timers, timer cancellation, to-do additions, explicit
completion/incompletion, removal. Up to five actions commit atomically. No partial
mutation if an action fails. Weather is connected through a cached Open-Meteo adapter;
`get_weather` selects now/today/tomorrow/week and an optional saved location ID, then
returns an actual cache-derived summary. Calendar remains a placeholder. Weather
context includes source timestamps and stale/setup/unavailable states. See [WEATHER.md](WEATHER.md).
No web research, external messages, scheduled reminders, camera or background jobs.

An execute message is composed from actual local results, not the model's proposed
success wording. Clarification/limitation wording comes from the model and still
needs behavioral evaluation. Model interpretation is not an authorization oracle;
the app enforces the narrow action vocabulary and current target IDs.

## Guarded quick-action repertoire

The app learns a bounded mapping after successful reasoning, not executable code.
The planner's structured decision includes `quickAction`: `null`,
`cancel_only_timer`, or `show_panel`. Its instructions ask it to assess whether the
whole standalone request can be reused without another reasoning step. No extra
model call is needed for this assessment. Internal learning is not announced aloud.

1. Unfamiliar wording goes through ordinary outcome planning and action validation.
2. The model may nominate a template. Local code independently checks the whole
   normalized phrase, template/action agreement, and the pre-action context.
3. Only a successful, single-action commit saves a versioned entry in the same atomic
   write as the action and receipt. Failure, cancellation, stale revision, pending
   clarification, option selection, or a multi-action plan cannot promote it.
4. Later, the exact normalized phrase selects a template. Known polite framing is
   stripped; no substring match, embeddings, model-authored regex, or code is run.
   Target IDs are resolved fresh and guards are rechecked at execution.

Example: “get rid of the timer” initially reaches the planner. If one timer exists,
the planner cancels it and nominates `cancel_only_timer`; the app records the phrase
and eligibility reason, **not that timer's ID**. With a different single timer later,
the same wording can run locally. Two timers means planner fallback, not a guess.
“Clear/cancel/stop the timer” is built in already and does not need a learning run.

Initial templates are deliberately narrow: cancel the only current timer, or show
home/time/timers/to-dos when the phrase names that exact destination. A limited
whole-request grammar gates promotion as well as reuse. Pronouns (“cancel it”),
named targets, ambiguous card dismissal, conditions, negations and compound requests
stay contextual. “Hide the timer card” must not silently become timer cancellation.
This is a first reusable repertoire mechanism, not general self-programming: adding
new action families still requires implementation, guards and deterministic tests.

Up to 64 entries persist in ignored `data/state.json` as `quickActions`, deduplicated
by phrase, with a template version, eligibility reason and learned timestamp.
Incompatible versions are ignored. Entries contain user wording and are shared with
trusted local surfaces as part of app state; they are not exported as telemetry.
Older state files need no migration. Old transcript history is not automatically
promoted because it lacks sufficient pre-action and validated-action evidence.

`OPENAI_LEARNED_FAST_PATH=0` disables learning and learned reuse without erasing
entries; built-in timer starts/cancellation remain available. The broader
`OPENAI_TIMER_FAST_PATH=0` disables all local voice acceleration. Restart after
changing environment configuration.

Diagnostics record `quick_action.promoted` on the planner decision and
`source: learned|builtin`, `template`, and the committed action on the existing
`voice.timer_fast` span (legacy name retained). No phrase or entity ID is attached
to exported trace metadata. The existing receipts, transcript-range reconciliation,
quiet window, revision check and correction handling also protect learned actions.

This follows the [OpenAI latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization)
to avoid unnecessary model round trips for deterministic work. It removes planning
from eligible reuse, not Live transcription, network, or spoken-response latency.

## Shared visual context

Each decision gets an immutable app snapshot, capabilities, the recent eight
request/result summaries, the panel and per-surface content, and pending choices.
Both surfaces render the same ordered clarification card, with stable option IDs.
Routine execute results do not render a success card: the updated list/timer/panel
is the visual confirmation, with a brief spoken result. Questions, actual answers
and limitations remain visible without an internal intent heading. Hidden success
cards stay in receipts/history, but are excluded from visible presentation context.
Exact ordinal replies bind to that card locally and the decision must return the
same selected ID. Other natural references are interpreted by the model against
the supplied context. All decisions must still match the current state revision.
Existing entities are sent as short snapshot aliases (`timer_1`, `todo_2`), then
translated locally back to storage IDs. Unknown aliases, duplicate mutations and
a mutation aimed at a different explicitly selected entity are rejected. This was
added after a real model test returned an invalid target ID; no action committed.

`surface.js` reports rendered revision and browser visibility every five seconds;
reports expire after fifteen seconds. Ordinal/explicit screen references require
a current visible report. This is evidence of browser rendering, not a screenshot,
eye tracking, viewport intersection measurement, or proof the physical Mirror is on.
The mirror shows the first five to-dos; the companion shows all. Overflow paging
and fuller viewport-aware selection remain future work. Background tabs can be
reported hidden; stale tabs must not be described as current.

To-do and timer mutations, clarification cards and operation receipts persist in
ignored `data/state.json`. Cards have no touch controls on the mirror. User text
is escaped, never executed as markup. Current report and conversation data are
sent to OpenAI when planning; local transcript permission is not being treated as
permission to enable Langfuse. External telemetry remains off.

## Cancellation, concurrency and recovery

New speech or a newer delegation aborts the in-flight decision. End Conversation
does likewise. Late model results cannot commit after abort or revision changes.
Completed operation IDs deduplicate repeats within the last 500 receipts.
Process crashes leave a budget reservation for review, not an automatic retry.
The budget ledger records cloud session IDs as soon as received for recovery.
Replacement requests wait for the preceding session's cleanup before reserving a
new call; aborted queued requests never start inference. An unresolved cleanup
still blocks the next request for review rather than launching more paid work.
Completed, schema-validated decisions return without awaiting deletion of the idle
cloud session. That cleanup promise remains tracked; normal server shutdown drains
it before closing telemetry. Failed/interrupted decisions still await cleanup before
rejecting. Accounting failures remain visible and do not enable further paid calls.
If creation fails without returning an ID, cleanup may be uncertain; keep the
reservation and inspect the API before retrying. Local mutations are synchronous
and atomic; there is no durable background job runner.

## Budget and latency

The timer accelerator makes no Agents call: tests commit after 700 ms of server-side
transcript quiet even when Live emits no delegation. This removes planning, cleanup
queue and handoff dependency for matched requests, not microphone/transcription,
network, rendering or voice-generation latency. Human end-to-end timing is pending.
Uncertain/contextual requests still use the planner below; no guessed durations.
No broad model speedup is claimed. Each fast operation is a separate measured
`voice.timer_fast` span and can proceed even if an old Agents cleanup is unresolved.

Uses the existing $25 test allowance, reserving $0.50 per planning call and retaining
the full allowance conservatively after completion (not an actual billing quote).
No inference retries. A 30-second planning deadline plus bounded cancellation and
cleanup applies. An unresolved prior agent reservation blocks further planning.
This is an application guard, not a provider-enforced maximum bill.

Initial synthetic tests: Astra/low passed four cases at about 16–24 seconds each.
Mini/low passed natural multi-add, clarification, and a follow-up at about 16–17
seconds; one cleanup timeout was detected and recovered by verifying/deleting the
idle test session. Faster warm-session reuse/routing remains work, not a claimed
optimization. Each decision still creates a fresh cloud session. The initial
numbered-timer test passed with Mini: about 12.5 seconds planning and 15.5 seconds
including cleanup for each of its two turns.
The owner's subsequent human add/remove test worked, but measured decision spans
were 19.7 and 23.1 seconds (then including cleanup).

September 15 latency pass: keep Mini/low. Mini/none took 13.6 seconds to plan a
multi-add, then invented a one-minute timer for “Start a timer.” It failed the
clarification test and was rejected, despite being an available configuration.
Completed-session cleanup now runs outside the user-result path:

| Synthetic case (Mini/low) | Result ready | Background cleanup |
| --- | ---: | ---: |
| Add two items and show list | 12.24 s | 4.19 s |
| Ask for missing timer duration | 13.54 s | 3.05 s |
| Resolve five-minute follow-up | 11.68 s | 3.31 s |
| Explain unavailable weather | 11.63 s | 3.61 s |

All four passed and cleanup was confirmed. These timings isolate the removed wait
within each run; they do not establish a model speedup or a speech-to-audio benchmark.
New `agent.decision` spans include queue wait, planning and local commit, but exclude
successful background cleanup. `agent.planning` and `agent.cleanup` measure those
stages separately. Older decision spans are not directly comparable. Scripts await
`planner.drain()` for final cleanup metrics and accounting before exiting.

After 1.5 seconds of a still-pending backend request (including any cleanup queue
wait), the app sends one interim Live commentary cue. The voice prompt asks
for a short natural acknowledgment such as “Give me a sec,” not a progress recital
or success claim. Fast completion, cancellation, session closure and existing Live
output since the request suppress the app cue to avoid doubled waiting messages.
The cue is feedback, separate from the cleanup optimization; exact spoken wording
and playback still need human verification.

## Verification

- `npm test`: no network, no paid calls, no microphone.
- `node scripts/check-assistant.mjs --run-paid`: four isolated synthetic model cases.
- `node scripts/check-assistant-choices.mjs --run-paid`: ambiguity and numbered follow-up.

Paid tests share the real allowance but use in-memory app state. Human voice
validation of the new planner remains distinct from successful synthetic tests.
The old local-grammar voice path remains available with `OPENAI_AGENT_ENABLED=0`.

Official references consulted:
- [Agents configuration](https://developers.openai.com/api/docs/guides/agents-api/configuration)
- [Agents sessions](https://developers.openai.com/api/docs/guides/agents-api/quickstart)
- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation)
- [GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
