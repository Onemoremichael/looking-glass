# Looking Glass

A practical assistant for a recovered, non-touch Android Mirror. Familiar tools
should be fast; new requests can become reusable, adaptable capabilities.

## Starter scope

Ship time/date, timers, to-dos, weather, read-only calendar review, and display
controls as built-ins. Weather/calendar require setup; they are not implemented yet.
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
display. A Mac-only voice prototype is now available on the companion. Active timers
stay visible across panels. The mirror has a small active-conversation indicator,
hidden when voice is off. Setup controls remain on the companion. A lost display
connection still shows a stale-data warning.

## Working now

- Local clock, timers with absolute deadlines, and a to-do list.
- State saved atomically to ignored `data/state.json`; restart preserves items.
- Request capture and an example clarification flow for Gators sports.
- Explicit blocked status when research requires an unconnected data provider/worker.
- Save configured requests as recipes; fork preferences without modifying originals.
- Shared live updates and reconnect status.
- GPT-Live-1 WebRTC adapter with Mac mic/speakers, Start/End/Mute, server-side tools,
  three-minute session cap and disconnect watchdog. Owner confirmed the first spoken test worked.
- Agents API outcome planning for natural-language timer, to-do and display requests:
  execute, clarify, answer, or explain a limitation. No memorized command phrases.
- Clear timer starts bypass cloud planning after 700 ms of transcript quiet, even
  without a Live handoff. Conversational prefixes (“Thanks. Now…”), countdown
  wording and explicit in-turn duration replacements are understood locally.
  Late handoffs do not duplicate the timer; unclear corrections, missing durations
  and contextual requests retain the planner fallback. Traces explain each fallback.
- Shared numbered clarification cards, recent conversation context, surface render
  acknowledgments, and stable choice IDs for replies such as “yeah, the second one.”
- Validated, atomic batches and durable receipts; stale or cancelled decisions cannot commit.
- Quiet result-first UI: no routine success cards. Questions and options remain visible;
  a slow pending request cues one brief natural acknowledgment before the final result.
- Completed decisions return before cloud-session cleanup; cleanup still gates the next
  paid call and is awaited on shutdown. Separate planning/cleanup traces expose the cost.

Timers have visual alerts only, not sound or background notifications. Devices must
have accurate clocks. The Mac server must run for control access; timers calculate
remaining time from their saved deadlines. This is not a safety-critical alarm.

## Try Mac voice

Open [the companion](http://localhost:8780/remote), click **Start conversation**, and
allow microphone access. Say “Set a timer for two minutes”, wait for confirmation,
then “cancel it”. Keep [the output display](http://localhost:8780/) open separately.
Use **End conversation** when done. Mute stops input, not billing or spoken output.
Audio controls provide playback volume and a Play fallback if autoplay is blocked.
Startup shows its current connection stage and times out instead of waiting indefinitely.
Keep one companion in use; other tabs identify an active conversation as belonging
to another tab. Hidden idle pages release update streams, while the voice-owning tab
stays connected. Reload after frontend changes, once your conversation has ended.

Only the Mac mic/speakers are used now. Long-term, the Mirror's own mic and speakers
will replace that adapter; Android 6.0.1 remains the display target. Exploring Android
7 in `mirror-mirror` is optional later work, not a dependency. See [voice UX and testing](docs/VOICE.md).

## API setup and remaining connections

API transport diagnostics are separate from the app: see [API testing](docs/API-TESTING.md).
The owner approved a $25 total test budget. Normal app startup makes no API calls.

For API integration, copy `.env.example` to `.env` if it does not already
exist, then set `OPENAI_API_KEY` locally. The server loads this file on startup;
restart after editing it. `.env` is git-ignored and is not served to browsers.
Adding a key alone does not start a paid session. The local approved-budget ledger
is also required; this prototype fails closed if it is absent. It is not an account-wide billing cap.

Agents API is connected for outcome planning (not web research). Weather, calendar,
live sports data, and camera are not connected.
Typed requests use limited local rules—not language-model reasoning. Saved views
are configurations, not researched results. No automatic or scheduled work runs.
The old enchanted-face direction has been replaced by this practical foundation.

See [the outcome-first assistant](docs/ASSISTANT.md) for architecture, limits and
verification. GPT-Live-1 handles audio; `OPENAI_AGENT_MODEL` defaults to GPT-5.4 Mini
for decisions with `OPENAI_AGENT_REASONING=low`. A `none` trial guessed a missing
timer duration, so it was not adopted. `OPENAI_AGENT_ENABLED=0` restores the legacy
phrase parser. `OPENAI_TIMER_FAST_PATH=0` independently disables the timer accelerator.
Timer fast-path tests commit at 700 ms after the last transcript fragment without an
Agents call; actual speech-to-display/audio latency still needs a fresh human test.
Latest synthetic planner decisions returned in 11.6–13.5 seconds, excluding
3.1–4.2 seconds of background cleanup; these are not full speech-to-audio timings.
Other requests still have substantial planning latency. The old UI-only request form still uses local rules.

## Private-LAN preview

Default binding is localhost. For a trusted home LAN, substitute the Mac's address:

```sh
HOST=0.0.0.0 LAN_ORIGINS=http://192.168.0.29:8780 npm start
```

No pairing key. Anyone with network access to this service can view and control
its local data. Do not expose it publicly. Origin/Host checks are not authentication.
Paid voice routes reject non-loopback clients even when the display is LAN-shared.
Phone voice and Mirror audio need a separate transport/access implementation.

## Architecture

[Telemetry and traces](docs/TELEMETRY.md): local trace viewer at `/diagnostics`,
`npm run traces` for reports, optional Langfuse-compatible OTLP export. Local transcript
logging is enabled for owner-approved testing; raw audio is not recorded. Cloud export
is off and would contain metadata only. Automated tests use no paid API calls.

[Plan](docs/PLAN.md) · [Protocol and boundaries](docs/INTEGRATION.md)

Looking Glass owns application UI, capability recipes, task orchestration and
AI integration. [mirror-mirror](https://github.com/Onemoremichael/mirror-mirror)
owns device recovery, drivers and Android controls. No device changes in this pass.
