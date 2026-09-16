# Voice assistant

## Product and hardware boundaries

Choose Mac browser audio or the native USB Mirror audio bridge while the Mac hosts
application logic. See [Mirror setup and validation](MIRROR-AUDIO.md).
Audio remains separate from rendering.
Android 6.0.1 is the current baseline; Android 7 is a possible later mirror-mirror
investigation, not a prerequisite. Native audio requires an Afterglow APK update
and microphone permission, but no firmware changes.

The mirror is output-only: clock, selected content, persistent timers and shared
assistant cards on black. No branding, text input or touch controls. The Mac companion
owns Start, End, Mute and playback controls. No wake word or automatic microphone start.

Start Conversation is listening-first: no greeting, tutorial, capability recital or
unsolicited question. `prompts/live-instructions.mjs` contains the policy. Prompt and
transport tests cannot guarantee audio-level model behavior; human checks still matter.

For delegated work, the shared progress tracker can send factual stage context at
1.8 seconds and a delayed-work update at 10 seconds. Suppress a cue within 2.5 seconds
of existing assistant speech, rather than suppressing all later updates after a
single acknowledgment. Live chooses warm, concise wording suited to the actual state.
No startup filler, repeated narration, invented ETA, premature success, unsupported
“first time” story, or guaranteed speedup. Completion/correction/stop clears timers.
See [adaptive views](ADAPTIVE-VIEWS.md) for rendering and explicit save consent. Official
[Live delegation guidance](https://developers.openai.com/api/docs/guides/live-delegation)
supports separate progress and result commentary; append acceptance is not proof
the requested words were played. The new cue has deterministic tests, not yet a
human audio check.

## Default interaction loop

Clear standalone timer starts have an application-owned fast path described below.
For other requests, GPT-Live-1 delegates task requests, clarification answers, corrections and visual
references to the Agents API planner. It receives capabilities, recent context, current
state, both surface presentations and browser render reports. It proposes one of:
execute, clarify, answer, unsupported. Only schema-validated local actions can commit.
See [ASSISTANT.md](ASSISTANT.md) for the full contract and measured latency.

Named timer start/cancel, time, panel navigation, to-do add/complete/incomplete/remove
are supported. A batch of up to five actions is atomic. Missing meaningful details
prompt a focused question; ordered options appear on both surfaces. “Yeah the second
one” can resolve against the active card. Display-dependent selections require a fresh
visible render report; ambiguous or stale references must not silently guess.

Weather now uses the cached Open-Meteo adapter (see [WEATHER.md](WEATHER.md)); calendar
remains an unconnected placeholder. No research, account access, scheduled
reminders or durable background jobs. Timer alerts are visual only, not safety-critical
alarms. Pause/resume, audible alarms, list text editing, overflow paging and real Back
history remain gaps. Going Back/Home or dismissing a panel does not cancel timers.

The previous exact-grammar implementation remains available with
`OPENAI_AGENT_ENABLED=0`. It supports selected timer/list/display phrases, not general
natural language or compound requests. Its parser tests remain as fallback regressions.

## Turn handling and cancellation

**Timer accelerator:** `timer-intent.mjs` matches the entire unconsumed transcript,
accepting clear standalone starts with explicit numeric/spoken durations (including
ordered hour/minute/second combinations). After 700 ms with no new fragment, the app
commits through the same validated, revision-checked, durable action transaction,
publishes the timer immediately and supplies the verified result to Live. It does
not create an Agents session or wait for Live to delegate. An existing delegation
ID is used when available; otherwise commentary uses `delegation_id: null`, the
application-owned result channel. There is no extra inference call to classify intent.

Conversational framing is normalized only at the edges of the whole request:
“Thanks. Now…”, “Could you please…”, “Would you mind setting…”, “Let's…” and
trailing “for me, please”. Timer/countdown synonyms and “Give me five minutes”
are local timer starts. Unknown earlier clauses are never discarded to find a
command substring. Quotes, negation and hypothetical requests do not execute locally.

An explicit same-turn replacement, “Set thirty seconds—actually, make it a minute”,
starts one sixty-second timer if the correction arrives before the first commit.
Both original and replacement durations must be explicit and valid. Unfinished,
multiple or unclear corrections go to the contextual planner. This is bounded
deterministic interpretation, not general semantic understanding; no additional
lightweight model route has been added yet.

This is acceleration, not a replacement language interface: named timers, contextual
references, missing/uncertain durations, negations, unclear corrections, compound commands
and active clarification questions bypass it. They retain ordinary delegated planning.
Only an explicit duration of 1–86400 whole seconds is accepted; capacity remains 20.
Disable independently with `OPENAI_TIMER_FAST_PATH=0` and restart.

Receipts are keyed by voice-session token and consumed transcript range, not text.
Late/repeated handoffs resolve quietly without another timer or spoken confirmation.
A handoff with no new text waits for transcript delivery before reconciliation; known
old offsets cannot supersede a newer pending request. Repeating the same words as a
new request can intentionally create another timer. Fast results enter shared history
so the planner can interpret a subsequent correction or cancellation. Persistence
failure cannot confirm success; confirmation transport failure cannot undo the timer.

Fallback planning begins after client delegation and 900 ms without a fragment.
Live provides no transcript-done event: both quiet windows are heuristics, not proof
of a complete utterance. New speech, replacement delegation or End aborts an in-flight
decision. Late results cannot commit after cancellation or a state revision change.
A correction after an already committed action needs a separate operation. A pause
longer than 700 ms before a correction can therefore start the first timer; do not
extend this speculative shortcut to consequential tools. Speech recognition mistakes
and pauses still require human evaluation.

Operation receipts persist atomically with state (last 500); duplicate deliveries do
not repeat mutations. There is no automatic inference retry or reconnect. Pending
work is not a durable background task. Full natural-speech turn-taking still needs
human evaluation before introducing consequential tools.

States: off → connecting → listening; thinking during delegated work; speaking based
on the received audio signal; muted; needs_input; stopping; error. Playback detection
is not proof the speakers were audible. Mute stops microphone delivery, not billing
or response playback. End stops microphone tracks immediately and requests closure.

## Transport and compatibility

Startup now shows separate microphone, browser-network, voice-service, answer-attach
and ready-channel stages, with bounded waits. Microphone capture is requested directly
from Start; the optional AudioContext meter is created only after an incoming audio
track, and meter failure cannot prevent playback or connection. Microphone access times out after 15 s;
SDP creation/local application after 5 s each; ICE gathering after 10 s; local start
HTTP after 30 s; remote answer application after 8 s; ready-channel wait after 15 s.
Ending during preflight cancels it, and a late microphone grant is immediately stopped.
If a start response is lost, the server lease watchdog remains responsible for closing
any allocated session; a client timeout is not proof that no session was allocated.

The companion shares one EventSource for display and voice updates instead of two.
Display and companion use the ES5-compatible subscription lifecycle in `surface.js`:
hidden idle tabs and unloaded pages close their streams; visible pages reconnect for
a fresh state snapshot. The companion owning a voice session remains subscribed when
backgrounded. Idle companions label a session in another tab explicitly and disable
Start until it ends, instead of misleadingly claiming their own microphone is listening.
Older already-loaded tabs require a reload to receive these safeguards.
`[voice startup]` console messages contain stage
names only, never SDP, audio, transcripts, credentials or control tokens. A server
close updates and releases the owning browser controls instead of leaving them connecting.
Mock-browser tests cover stalled audio metering, ignored mic permission, cancellation,
stalled local HTTP/remote answer, shared-stream closure, hidden-tab cleanup and ownership.
September 15 verification: a real Chrome session reached ready/listening in roughly
2.6 s and closed with confirmed usage. A fresh in-app companion subsequently received
speech and executed requests; the owner reported it worked much better. Earlier
attempts reached the API but missed browser heartbeats, and another in-app attempt
stopped at microphone access. The exact original cause was not isolated; these are
observed recovery results, not proof that every earlier stall had one cause. The
additional lifecycle/meter safeguards passed deterministic tests after that human run;
they do not hot-reload into an existing conversation.

`public/voice-client.js` is a modern Mac-only ES module using WebRTC. The API key and
immutable Live configuration stay on the Mac in `voice.mjs`. A trusted sideband handles
transcripts/delegation; the browser cannot supply model instructions or execute tools.
The fast timer backend is voice.mjs → timer-intent.mjs → session.mjs. Other requests
use assistant.mjs → agents-planner.mjs → session.mjs.
This uses the Agents API, not the Agents SDK. Cloud sessions have no tools or sandbox.

The Android display loads ES5-style display/surface scripts and SSE, no WebRTC,
microphone APIs, ES modules or native bridge. CSS fallbacks exist; this new pass has
been visually verified on the physical Android WebView for clock and live timer
rendering via USB forwarding (see INTEGRATION.md). Native
AudioRecord/AudioTrack, permissions and echo cancellation remain separate work.

## Lifecycle, privacy and budget

One paid Live session per Mac server; explicit Start required. Paid routes require
loopback, allowed Host, exact matching Origin, bounded JSON and the active transient
control token. The token is transport ownership, not remote-user authentication.
No public/LAN paid voice endpoint is enabled.

The existing $25 test allowance covers both transports and planning reservations.
Each Live session reserves $0.50; final usage estimates use max(15, reported seconds)
at $0.05/minute. Each planning call conservatively retains its full $0.50 allowance,
not a claim of actual model billing. Platform billing is authoritative; the ledger
is not a provider-enforced account cap. See [ASSISTANT.md](ASSISTANT.md) for cleanup
failure guards and recovery. Unrelated account usage is not visible to this ledger.

Live has a three-minute limit and approximately 20-second missing-heartbeat watchdog.
Graceful closure waits for final usage; missing usage retains its reservation and
blocks further Live sessions in that process. Hangup is attempted on failure. A killed
server cannot guarantee cleanup: end conversations before stopping it.

Audio goes to OpenAI only after Start and browser permission. Delegated requests send
app state, recent request/result history and surface context for planning. Camera is
never requested; no local audio files are written. Owner-approved local transcript
text logging is enabled during testing; external telemetry stays off. See
[TELEMETRY.md](TELEMETRY.md) for retention and export boundaries. Live uses store:false;
Agents sessions are deleted after completion, neither implying zero provider retention.
In-memory Live transcripts clear on cleanup; recent assistant history, cards and
receipts persist in ignored app state and are shared on trusted local surfaces.

## Verification

`npm test` uses no network, API, microphone or camera. It covers schemas, aliases,
atomicity, replay, stale results, surface visibility, aborts, mock API streams,
quiet-window timing, final usage, origin checks, telemetry and ES5 display isolation.
Paid synthetic test scripts require `--run-paid` and use isolated in-memory state.

The owner confirmed the original human timer loop worked. The expanded outcome planner
passed synthetic API tests. The fast timer lane has deterministic coverage for
missing/early/late handoffs, identical new requests, corrections, stop, stale state,
clarifications, failed storage/confirmation and blocked paid planning. It still
needs a fresh human latency check:

1. Reload both surfaces. Start; verify quiet Listening, then speak naturally.
2. Start a 30-second timer; verify one timer appears promptly, one confirmation, and
   a `voice.timer_fast` trace with no `agent.planning` for that request. Repeat as a
   new request; verify a second timer. Then try a corrected duration.
3. Request a timer without a duration; answer the clarification in a second turn.
4. With two timers, ask for options, then choose the second displayed option.
5. Ask for weather without a configured place or while the provider is unavailable;
   verify honest setup/stale/unavailable messaging. With a configured place, verify
   the result against timestamped cached data. Calendar remains unavailable.
6. Try correction/interruption, mute, End, a stale tab and connection failure.
7. Inspect traces for speech-to-action and speech-to-audio; no instant-response claim.

Conversational regression: the owner's recorded “Thanks. Now add a timer for thirty
seconds” originally missed the accelerator and took 19.56 seconds from the final
transcript fragment to commit (17.37 seconds planning). Replay now uses the original
fragment-arrival spacing, creates one timer at +700 ms after the final fragment,
makes zero planner calls, and reconciles the late handoff without another timer.
This is a deterministic replay result; a fresh human run still needs measurement.

Official references checked September 15, 2026:
- https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
- https://developers.openai.com/api/docs/guides/voice-server-controls?api=live
- https://developers.openai.com/api/docs/guides/live-delegation
- https://developers.openai.com/api/docs/models/gpt-live-1

## Clearing timers and learning quick actions

The owner’s September 15 evening “clear the timer” run took 16.54 seconds from
the final transcript fragment to commit; 14.09 seconds was Agents planning.
The recorded three-fragment replay now cancels at +700 ms after the final fragment,
with zero planner calls and one verified confirmation, even with a late handoff.
This is a deterministic result, not a new measured human speech-to-audio benchmark.

Explicit single-timer cancellation is now built in. Successful planner work can also
nominate a supported phrase-to-template mapping for future local reuse, saved with
the action. See [eligibility and persistence](ASSISTANT.md#guarded-quick-action-repertoire).
The fast lane does not use stale target IDs or infer which of multiple timers to cancel.
The new runtime changes are server-side; Android's old WebView remains output-only.

Regression checks (99 automated tests across the repository pass as of September 16,
2026, with no paid calls in the test suite):

- Create one timer; say “clear the timer.” Verify prompt removal and one confirmation.
- Ask “get rid of the timer” with one timer. If the planner nominates it, diagnostics
  show `quick_action.promoted`. Create another timer and repeat: look for
  `voice.timer_fast` with `source: learned` and no planning for that request.
- Repeat with two timers or a pending clarification: no speculative cancellation.
- “Hide the timer card” and “cancel it” still need contextual interpretation.
- Learning survives server restart; failed storage, stale results and interrupted
  planning never save a shortcut. Subsequent corrections within the quiet window
  cancel the tentative fast route.

No paid API validation was run for the new nomination field in this pass. Its schema,
commit/persistence behavior, recorded cancellation flow, and learned reuse are tested
locally; the model's nomination behavior still needs a human or paid synthetic run.

## Interruption recovery (September 16)

The failed “what about next week” test exposed a lifecycle bug, not missing weather
data: a new transcript fragment cancelled planning, cleanup was unconfirmed, and the
budget guard then blocked all later planner calls. The voice reply incorrectly
suggested a changed display or repeating the request.

New speech now holds the application's commit immediately. After 900 ms of quiet,
a narrow neutral acknowledgment (e.g. “okay” or “thank you”) resumes the same work;
a meaningful follow-up replaces it once, preserving the original request plus the
refinement. Explicit “stop” cancels without replacement. Repeated Live handoffs
update the reply destination rather than starting another plan. This is not an
attempt to identify all background speech or to steer an already-running cloud turn.
The commit gate prevents an old decision from applying while a correction is pending.

Cleanup uses independent, bounded lifecycle requests. Before another paid decision,
the planner reconciles saved **unconfirmed** session IDs with the provider and retries
deletion, not inference. Only successful deletion or a 404 settles the blocker; an
idle observation alone does not. The entire original $0.50 allowance remains charged
conservatively. Unknown session IDs, fresh pending owners and failed remote cleanup
remain blocked. Repeated failed recovery is throttled for 30 seconds per process.
`agent.recovery` traces distinguish recovery from new `agent.planning` work; typed
failure messages explain blocked planning or exhausted allowance without a retry loop.

Deterministic coverage includes lost delete replies, restart recovery, still-active
sessions, abort during recovery, backchannels, duplicate handoffs, settled refinements,
commit races, explicit cancellation and accurate failure replies. `npm test` runs
these without paid API calls.

Lifecycle implementation follows the [official session-management documentation](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage).
