# Starter capabilities and reusable experiences

This is the product baseline. **Built-in describes what ships with the assistant,
not whether it is already implemented or needs account setup.** The runtime catalog
in `session.mjs` records current scope, execution path, and missing pieces.

## Out of the box: the intended starter release

| Capability | Starter scope | Execution after intent is established | Current reality |
| --- | --- | --- | --- |
| Time & date | Local time/date; explicit time-zone preference | Local clock | Device clock/date work; preference pending |
| Timers | Start, name, list, cancel, pause/resume; visual and audible completion | Local timer service with durable deadlines | Start/list/dismiss persist; visual only; pause/resume and sound pending |
| To-dos | Add, review, complete, edit, remove | Local persistent list | Add/list/complete/incomplete/remove work; text editing pending |
| Weather | Current, hourly and seven-day forecast for up to five saved cities; F/C | Open-Meteo lookup with ten-minute shared cache; common voice requests local | Implemented; city selection required; no alerts/radar/IP guessing |
| Calendar review | Today, next event, upcoming week | Authorized read-only adapter with freshness tracking | Setup placeholder; no account connected |
| Display controls | Show, dismiss, home, next/previous when content overflows | Local UI state | Voice/companion panel selection, shared clarification cards and render reports; paging/history pending |

Weather needs a location and units. Calendar needs explicit account authorization.
They should have packaged tools and UI, not require an agent to invent an integration
each time. Calendar creation, editing, invitations, and outbound messages are not
part of the read-only starter scope.

Voice is the primary intended interaction; the phone/computer companion is the
fallback and setup surface. Mac GPT-Live-1 delegates natural task requests to an
Agents API planner with a capability manifest, recent context and both presentations.
Local validation executes supported actions; unsupported requests explain the gap.
The original human voice loop passed; the expanded planner has synthetic verification
and still needs human voice validation. See [ASSISTANT.md](ASSISTANT.md). The Mirror
itself has no inputs, buttons, links, or touch navigation. Its LCD occupies roughly
the top two-thirds of the upright glass; the bottom third is reflection-only.

## Common infrastructure, not extra widgets

- Confirmed intent and validated arguments before side effects; never act on a
  speculative partial transcript. Ask when duration, location, or target is unclear.
- Durable operation IDs and receipts before model-driven writes, preventing duplicate
  timers or list items on retries. Distinguish stop-speaking from cancel-the-task.
- Mic mute/stop, playback volume, connection/error handling, and explicit active-mic
  state on the appropriate control surface. Do not fake connected status.
- Render confirmed tool results immediately; do not wait for narration to finish.
- Data timestamps, expired-cache states, offline behavior, and accessible formatting.
- No touch or scrolling requirement on the physical mirror; overflow needs paging
  controlled by voice/companion before physical deployment.

## The two execution paths

**Familiar operation:** interpret → validate → local tool or cached lookup → update
the display → return confirmed facts for speech. Execution itself stays local. In the
current default implementation, interpretation does make an Agents API round trip;
safe fast-path routing is a future optimization. The opt-in legacy grammar path uses
local rules. Neither mode implies offline speech recognition.

**Novel request:** clarify → explain scope → start a real job → research/compose →
verify → deliver → offer to save. Agents API belongs here for research, comparison,
multi-step work, and new capability construction. GPT-Live-1 remains the intended
conversational frontend. Agents planning exists, but research, durable jobs and new
capability construction are not enabled. The current planner must explain that limit.

Measure end-of-speech to first audio, end-of-speech to confirmed UI/action, and
interruption to stopped playback. Keep connections warm only within an active
session; do not assume always-on paid sessions or promise unmeasured latency.

## What is composed rather than built in?

- UF Gators events this week, with chosen sports and watch/attend preferences.
- Nearby activities for a free afternoon, researched against current sources.
- A customized morning briefing combining weather, calendar, and to-dos.
- A football-only variation with broadcast details.

These should reuse adapters and trusted UI components. Start with an agenda,
event cards, forecast, list, countdown, and status/question components. A model can
propose a validated UI specification, not execute arbitrary browser JavaScript.
The generic renderer/schema system is planned; current screens are hand-authored.

## Persistence and forks

Save structure separately from results: query parameters, source adapter references,
component layout, preferences, schema version, parent lineage, and refresh policy.
On reuse, render available valid state promptly and refresh stale data. Show its age;
never make a saved view look current merely because it opened quickly.

Built-ins should eventually support preference/layout variants without changing
their validated execution code. Keep default definitions intact and store overlays.
Today only configured custom requests can be saved/forked; built-in forking and
actual recipe execution are not implemented.

“Keep this” saves a capability. It does not authorize recurring work or notification
permissions. Background refresh requires a separate explicit decision.

## Honesty on first-time work

Ask only questions that materially change the outcome. Explain significant work
without invented time estimates. Progress must come from worker events, not a timer
animation. Offer cancellation and preserve corrections. Report incomplete data.
Only promise later delivery when a durable worker and real delivery channel exist.

The current example honestly stops at **blocked: provider not connected** after
clarification. Saved configurations are not completed research or live schedules.

## Not in the initial starter release

Always-on wake-word listening, camera/vision, arbitrary installed apps, home automation,
calendar writes, purchases/messages, and scheduled proactive research. These can be
added intentionally after the core interaction and permission model work.
