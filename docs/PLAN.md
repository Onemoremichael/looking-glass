# Build plan — September 15, 2026

## Product contract

The starter set, execution paths, implementation gaps, and exclusions are defined
in [CAPABILITIES.md](CAPABILITIES.md). Built-in does not mean already connected.

Generate when a request is new. Reuse reliable components and sources. Save a
useful configuration only when asked; fork it when requirements diverge. Keep
persistent structure separate from fresh data.

Be honest about work: ask consequential clarifying questions, explain substantial
setup, report real progress and failures, and never promise a later notification
without a delivery mechanism. Estimates should come from measured work, not theater.

## Implemented foundation

Local clock, durable timers/to-dos, example clarification, blocked task state,
saved recipes and forks. Both clients share server state. UI renders data as text
through an escaping boundary; no agent-generated JavaScript executes.

The example request flow is needs_input → blocked (provider not connected), or
cancelled. Saving the configuration is not completing the task. No worker, research,
completion notifications, or artificial progress animation exists yet.

## Outcome-first pass and next slices

The original Mac voice/timer slice passed its human test. The default path now uses
GPT-Live-1 delegation → Agents API planning → validated local actions. It handles
natural requests, consequential clarification, capability limitations, atomic batches,
shared numbered choices and per-surface context. See [ASSISTANT.md](ASSISTANT.md).
Paid synthetic tests passed multi-add, missing duration, follow-up, unsupported weather,
and selecting the second displayed timer. The expanded human voice loop still needs
validation. Hardware audio and Android upgrades remain deferred.

1. Validate natural speech, corrections and both-surface references end to end. Measure
   the new `agent.decision` traces; fresh Mini sessions currently take about 15 seconds
   including cleanup. Optimize routing/session lifecycle without losing context or
   bypassing validation. Never claim unmeasured instant responses.
2. Complete built-in gaps: timer sound/pause/resume, to-do text editing, UI dismiss/
   paging, and preferences. Keep default capabilities separate from future forks.
3. Add a durable job runner: queued/running/needs_input/blocked/completed/failed/
   cancelled, event log, task revisions and explicit cancellation. Recover interrupted
   jobs on startup. Only then promise background work and in-app completion delivery.
4. Weather: explicit city/units, provider, timestamps and cache expiry. Calendar:
   explicit account authorization and read-only first. Do not infer account access.
5. Gators vertical slice: resolve sports/watch/attend scope, verify schedules against
   authoritative sources, normalize events, render an agenda, then offer Keep.
6. Recipe execution: schema version, source adapter, query parameters, component
   specification, freshness policy, last successful result, validation and migrations.
   Refresh data independently of layout; show stale/error states.
7. Mirror deployment/audio: compatible client, remote Home/Back, mic permission,
   echo cancellation test. No firmware changes. No camera needed for initial assistant.

## AI architecture decision

GPT-Live-1 is the conversational frontend. Our Mac bridge routes delegated work
to Agents API sessions and execute allowlisted local functions. Do not substitute
Agents SDK for Agents API. Start without sandbox/shell access. Fast deterministic
operations should avoid unnecessary agent loops once intent is reliably established.

References researched in the preceding exploration:
- https://developers.openai.com/api/docs/guides/live-delegation
- https://developers.openai.com/api/docs/guides/agents-api/overview
- https://developers.openai.com/api/docs/guides/agents-api/tools/functions

Live WebRTC, sideband and Agents API planning are implemented. Credentials remain
server-side; the shared test allowance is $25 total. Live uses store:false. Agents
sessions have no tools/sandbox and are deleted after completion; this does not imply
zero provider retention. Research and background job execution are not implemented.

## Verification gates

Test local persistence, input limits, cancelled requests and isolated forks first.
Then test duplicate tool calls, late results, disconnects and worker restart.
Measure end-of-speech to first audio, confirmed action to displayed card, and
interruption to silence. No latency promises until measured.
