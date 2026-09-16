# Looking Glass

A practical assistant for a recovered, non-touch Android Mirror. Familiar tools
should be fast; new requests can become reusable, adaptable capabilities.

## Starter scope

Ship time/date, timers, to-dos, weather, read-only calendar review, and display
controls as built-ins. Weather is connected after choosing a city; calendar is not implemented yet.
Use local tools or cached lookups for familiar actions and agent-driven composition
for novel requests. Useful compositions can be saved and forked.

[Capability scope and current gaps](docs/CAPABILITIES.md) is the product baseline;
the runtime catalog in `session.mjs` mirrors its implementation status.

## Run

The screen covers roughly the top two-thirds of the upright mirror; the bottom
third is reflection-only. See
[physical display constraints](docs/DISPLAY.md); fullscreen UI cannot fill the
reflective-only margins outside the LCD.

Node.js 22+. Install dependencies with `npm ci`; no API key is required for the local UI.

```sh
npm test
npm start
```

- Display/workspace: http://localhost:8780/
- Phone-friendly companion: http://localhost:8780/remote

The mirror is output-only: no forms, buttons, links, or touch navigation.
The phone/computer companion owns all current controls and shares state with the
display. Voice can use the Mac or the native USB Mirror audio bridge. Active timers
stay visible across panels. The mirror has a small active-conversation indicator,
hidden when capture is off, with a static label during local wake standby. Setup controls remain on the companion. A lost display
connection still shows a stale-data warning.

## Working now

- Local clock, timers with absolute deadlines, and a to-do list.
- Open-Meteo weather: up to five saved cities, Fahrenheit by default/Celsius option,
  current conditions, hourly outlook and seven-day forecast. Oversized mirror typography,
  transparent dimensional weather artwork and a contrasting four-reading forecast strip.
  Small art uses dark-blue backplates; rain has fine independently animated hero streaks
  and static forecast marks, with reduced-motion support.
- Adaptive future-weather views: the planner assembles highlights, temperature ranges,
  and dated forecasts, automatically saving the layout in the shared repertoire. Saved
  views reuse their configuration with refreshed facts and re-resolved relative dates.
  Natural follow-ups match saved date range, location and focus, not just titles:
  “what about later in the week?” can take the local quick path while weather is shown.
  See [adaptive views and voice test flow](docs/ADAPTIVE-VIEWS.md).
- State saved atomically to ignored `data/state.json`; restart preserves items.
- Request capture and an example clarification flow for Gators sports.
- Live, read-only web research assembled into cited briefing, agenda, comparison,
  or step-by-step boards. Two large cards per page with voice paging. Recipes
  save automatically; cached results reopen locally for 15 minutes, and refresh
  re-runs the query rather than pretending old facts are current. See [research](docs/RESEARCH.md).
- Save configured requests as recipes; fork preferences without modifying originals.
- Shared live updates and reconnect status.
- Durable multi-step workflows: saved plans with fresh parameter binding, guarded
  research/weather/list/artwork execution, resumable questions, human confirmations,
  pause/cancel, and evidence-backed progress. Companion controls and a non-touch
  mirror progress view are implemented and tested offline. A live planning smoke
  test was safely rejected for an inconsistent provider response. The structured
  contract is now hardened and regression-tested; a paid live retest remains a
  prerequisite for live readiness. Custom code
  execution is not yet available. See [workflows](docs/WORKFLOWS.md).
- Image studio: asynchronous GPT Image 2.5 Sunburst adapter, progress, cancellation,
  persistent artwork/recipes and free local reopening. Real telemetry integration
  is regression-tested; ledger settlement failures pause new generation. Provider access is still
  unverified; offline tests and physical-mirror fixture rendering pass. See
  [image workflow, budget accounting and limits](docs/IMAGE-STUDIO.md).
- Adult-only playroom rehearsal: four illustrated animal cards and a bounded Pip
  bear adventure, with local game state and isolated voice instructions. Physical
  spoken gameplay is not yet verified; this is not ready for children. See
  [implementation, privacy gates and test evidence](docs/PLAYROOM.md).
- GPT-Live-1 WebRTC adapter with Mac mic/speakers, Start/End/Mute, server-side tools,
  three-minute session cap and disconnect watchdog. Owner confirmed the first spoken test worked.
- Agents API outcome planning for natural-language timer, to-do and display requests:
  execute, clarify, answer, or explain a limitation. No memorized command phrases.
- Clear timer starts bypass cloud planning after 700 ms of transcript quiet, even
  without a Live handoff. Conversational prefixes (“Thanks. Now…”), countdown
  wording and explicit in-turn duration replacements are understood locally.
  Late handoffs do not duplicate the timer; unclear corrections, missing durations
  and contextual requests retain the planner fallback. Traces explain each fallback.
- “Clear/cancel/stop the timer” also takes the local fast lane when exactly one
  timer exists. After successful planning, the model can nominate eligible wording
  for a persisted quick-action repertoire. Current learned templates cover single-timer
  cancellation and home/time/timers/to-dos navigation; every reuse checks live context.
- Shared numbered clarification cards, recent conversation context, surface render
  acknowledgments, and stable choice IDs for replies such as “yeah, the second one.”
- Validated, atomic batches and durable receipts; stale or cancelled decisions cannot commit.
- Quiet result-first UI: no routine success cards. Questions and options remain visible;
  slower work supplies factual progress context for natural acknowledgments and a
  later update, without scripted chatter or guaranteed speed promises.
- Completed decisions return before cloud-session cleanup; cleanup still gates the next
  paid call and is awaited on shutdown. Separate planning/cleanup traces expose the cost.

Timers have visual alerts only, not sound or background notifications. Devices must
have accurate clocks. The Mac server must run for control access; timers calculate
remaining time from their saved deadlines. This is not a safety-critical alarm.

## Try Mac voice

Open [the companion](http://localhost:8780/remote), choose **This computer**, click **Start conversation**, and
allow microphone access. Say “Set a timer for two minutes”, wait for confirmation,
then “cancel it”. Keep [the output display](http://localhost:8780/) open separately.
Use **End conversation** when done. Mute stops input, not billing or spoken output.
Audio controls provide playback volume and a Play fallback if autoplay is blocked.
Startup shows its current connection stage and times out instead of waiting indefinitely.
Keep one companion in use; other tabs identify an active conversation as belonging
to another tab. Hidden idle pages release update streams, while the voice-owning tab
stays connected. Reload after frontend changes, once your conversation has ended.

For the Mirror's mic/speakers, select **Mirror · USB** after installing the native
bridge and setting up both USB tunnels. See [setup and current limits](docs/MIRROR-AUDIO.md).
Android 6.0.1 remains supported; Android 7 is not required. Mirror mode is currently
half-duplex: wait for replies to finish before speaking. See [voice UX](docs/VOICE.md).

**Hands-free Mirror:** [set up local “Hey Mirror” detection](docs/WAKE.md), then
enable it explicitly in the companion. Standby audio stays on the Mac; wake starts
a bounded Live session on the Mirror mic/speakers. Wait for the chime, ask, and say
“That’s all” to return to standby. A local-only phrase-test mode avoids API charges.
No camera or automatic arming at startup. Turn wake microphone off to stop capture.

## API setup and remaining connections

API transport diagnostics are separate from the app: see [API testing](docs/API-TESTING.md).
The owner approved a $25 total test budget. Normal app startup makes no API calls.

For API integration, copy `.env.example` to `.env` if it does not already
exist, then set `OPENAI_API_KEY` locally. The server loads this file on startup;
restart after editing it. `.env` is git-ignored and is not served to browsers.
Adding a key alone does not start a paid session. The local approved-budget ledger
is also required; this prototype fails closed if it is absent. It is not an account-wide billing cap.

Agents API is connected for outcome planning and read-only web research. Weather
uses the separate Open-Meteo adapter; calendar and camera are not connected.
Typed prototype requests still use limited local rules—not language-model reasoning.
Saved research recipes are configurations; their timestamped result cache is separate.
No automatic or scheduled work runs. The broader build is tracked in
[the ambitious-pass ledger](docs/AMBITIOUS-PASS.md), including experimental games,
image capabilities and custom workflow construction.
The old enchanted-face direction has been replaced by this practical foundation.

See [the outcome-first assistant](docs/ASSISTANT.md) for architecture, limits and
verification. GPT-Live-1 handles audio; `OPENAI_AGENT_MODEL` defaults to GPT-5.4 Mini
for decisions with `OPENAI_AGENT_REASONING=low`. A `none` trial guessed a missing
timer duration, so it was not adopted. `OPENAI_AGENT_ENABLED=0` restores the legacy
phrase parser. `OPENAI_TIMER_FAST_PATH=0` disables the entire local voice accelerator,
including cancellation and learned routes. `OPENAI_LEARNED_FAST_PATH=0` disables
only promotion and learned reuse, without deleting saved entries.
Timer fast-path tests commit at 700 ms after the last transcript fragment without an
Agents call; actual speech-to-display/audio latency still needs a fresh human test.
Latest synthetic planner decisions returned in 11.6–13.5 seconds, excluding
3.1–4.2 seconds of background cleanup; these are not full speech-to-audio timings.
Other requests still have substantial planning latency. The old UI-only request form still uses local rules.

The owner's “clear the timer” trace took 16.54 seconds from the final transcript
fragment to commit, including 14.09 seconds planning. Deterministic replay now
commits at +700 ms with zero planner calls. Learning is a constrained phrase-to-template
cache, not arbitrary code generation or model training; see the
[quick-action learning contract](docs/ASSISTANT.md#guarded-quick-action-repertoire).

## Weather setup

Open Weather in [the companion](http://localhost:8780/remote), then use **Your places**
to search and select cities. Up to five are saved; the selected city persists. °F is
the default, with a °C setting. No IP/GPS location is inferred. Say “show the weather”,
“weather tomorrow”, “forecast this week”, or “weather in [saved city]”. Common requests
use the cached local fast path; ambiguous/other phrasing keeps the planner.

The provider is free for this non-commercial prototype; no weather API key is needed.
Saved places refresh every ten minutes while the Mac server runs. Stale/offline data
is labeled, and data older than six hours is hidden. This is model-based weather,
not radar or a severe-weather warning service. [Weather design and data contract](docs/WEATHER.md).

For an isolated **synthetic** rain design preview: `node scripts/preview-weather.mjs rain`
then open http://localhost:8781/. This never changes real settings or starts voice.
The `/art` page compares every weather state on black and on the forecast strip.
See [artwork provenance and prompts](public/assets/weather/COLLECTION.md).

## Private-LAN preview

Default binding is localhost. For a trusted home LAN, substitute the Mac's address:

```sh
HOST=0.0.0.0 LAN_ORIGINS=http://192.168.0.29:8780 npm start
```

No pairing key. Anyone with network access to this service can view and control
its local data. Do not expose it publicly. Origin/Host checks are not authentication.
Paid voice routes reject non-loopback clients even when the display is LAN-shared.
Phone voice needs a separate transport/access implementation; Mirror audio uses
the loopback-only native USB bridge, not the browser or a public audio endpoint.

## Architecture

[Telemetry and traces](docs/TELEMETRY.md): local trace viewer at `/diagnostics`,
`npm run traces` for reports, optional Langfuse-compatible OTLP export. Local transcript
logging is enabled for owner-approved testing; raw audio is not recorded. Cloud export
is off and would contain metadata only. Automated tests use no paid API calls.

[Plan](docs/PLAN.md) · [Protocol and boundaries](docs/INTEGRATION.md)

Looking Glass owns application UI, capability recipes, task orchestration and
AI integration. [mirror-mirror](https://github.com/Onemoremichael/mirror-mirror)
owns device recovery, drivers and Android controls. No device changes in this pass.
