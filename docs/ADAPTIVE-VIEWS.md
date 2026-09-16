# Outcome-first adaptive weather views

Implemented September 16, 2026. This is the first working component-composition
flow, not a general-purpose code-writing agent.

## Try it

Start a conversation with the Mirror or computer audio. Ask “Show me next week's
weather, especially rain” or “What does later this week look like?” The planner
chooses the period, emphasis, title, and component order. After a connected surface
acknowledges rendering, the assistant gives the takeaway. Usable layouts save
automatically without a question. Later, use natural wording such as “what about
later in the week?” while weather is shown, “show me next week's forecast,” or
“will it rain this weekend?” Matching saved capabilities can skip planning. “Open
[the saved title]” also works; views are listed on the companion's Saved views panel.

## Lifecycle and conversation

1. Check cached/provider weather for saved places; ask when a meaningful choice
   cannot be resolved from the request and current context.
2. Plan an outcome using the capability catalog, shared presentation and history.
3. Validate a typed composition, calculate its facts locally, and commit atomically.
4. Wait for a fresh visible surface's revision acknowledgment. This proves the
   client rendered state, not that a human saw it or that optical contrast is ideal.
5. Retain populated, validated configurations automatically in the same atomic
   commit. Cancelled or invalid work and no-data attempts are not promoted.
6. Reuse suitable saved specs; adapt into separate variants when needed. No save
   invitation. Storage success is distinct from confirmed screen visibility.

The shared task-progress tracker sends factual checking-data, planning, and
presenting context. It allows an initial cue after 1.8 seconds and a fresh update
after 10 seconds, avoiding speech within 2.5 seconds of existing assistant speech.
GPT-Live chooses natural wording: no mandatory script, invented ETA, unsupported
“first time” claim, or promise that next time must be faster. Timers stop on
completion/cancellation. These cues are guidance, not guaranteed exact spoken timing.
The OpenAI Docs skill's Live delegation guidance informed this split between
[application-owned progress and natural model speech](https://developers.openai.com/api/docs/guides/live-delegation).

## Component and data contract

`compose_weather` accepts a saved location and a strict spec:

- `title`: up to 60 characters.
- `range`: `next_seven_days`, `rest_of_week`, `next_week`, `weekend`, or `dates`.
- `startDate` / `endDate`: ISO calendar dates for `dates`; null otherwise.
- `focus`: `general`, `rain`, or `temperature`.
- `components`: ordered unique selection of `highlights`, `temperature_band`, and
  `daily_forecast`; dated daily rows are required.

The model controls the composition, not numerical facts, HTML, CSS, scripts,
provider URLs, or an unlimited component vocabulary. Existing generated weather
art is reused. High-contrast summary islands and compact dated rows work on the
non-touch Android 6 display without requiring modern browser APIs.

Open-Meteo requests up to 16 days; each composition displays at most seven dates.
Next week means the next Monday–Sunday in the selected city's time zone, not the
next seven days. Later this week starts tomorrow and ends Sunday. A fixed date
range is inclusive and bounded to seven days. Missing data stays missing, partial
coverage is labeled, and longer-range forecasts carry an uncertainty note. Existing
stale-data and six-hour hard-expiry rules still apply. No invented distant forecast.

## What becomes durable

`reusableViews` in ignored `data/state.json` stores kind, scope, version, ID,
validated spec, and creation time. It does **not** freeze weather measurements or
schedule background research. Relative periods re-resolve when opened and weather
refreshes through the existing provider/cache. Fixed dates remain fixed.

`weatherViews` is a compatibility projection. Legacy saved IDs are preserved.
The common library retains up to 64 configurations, deduplicates matching specs,
and tracks variant lineage. Saved-title recall, supported capability matching and
explicit saving of the current layout are local; new adaptations still use the planner. This is a shared
policy for assembled experiences, not just weather. See [durable-by-default design](REUSABLE-VIEWS.md)
for adapter boundaries and non-replayed actions. It is not a self-modifying code system.

### Intent-based quick reuse

The weather adapter parses conversational framing, date range, optional saved city,
and rain/temperature focus separately. It resolves these against validated saved
specs; titles are not the semantic key. The transcript prefix `’kay` / `'kay` is
recognized as conversational framing. Negations and arbitrary prefixes are not
stripped, and the entire request must match (not a command buried inside chatter).

Implicit follow-ups require the current panel to be weather; explicit weather
requests can work from another panel. A clarification in progress prevents local
reuse. Location defaults to the active saved city, and an explicit city must match
uniquely. Removed places and ambiguous alternatives fall back. Among compatible
views, the current selected variant wins, then a unique general view, then a sole
match. New focus/layout/range requirements do not silently reuse an incompatible
view. Fixed-date views are never substituted for relative date requests.

Newly retained specs become eligible immediately and after restart without another
planner call or a separate phrase-training step. This is compositional parsing over
supported intents, not unrestricted semantic understanding or speaker attention
detection. Unrecognized phrasing still needs the planner. New experience domains
still require trusted adapters; weather is the implemented domain here.

The voice lane retains its 700 ms quiet window, revision check, and late-delegation
deduplication. The September 16 `'kay. What about later in the week` fragment replay
now opens the already saved rain-focused view after that window with zero planner
calls. Dates and facts bind afresh; stale/partial/missing warnings remain intact.
149 deterministic tests pass, including paraphrases, rejection cases, restart reuse,
and the recorded fragment timings. This is an offline replay, not a new measured
human voice latency result. No paid API call was used to validate this change.

## Tests and boundaries

`npm test` includes calendar/DST boundaries, schema rejection, grounded summaries,
partial/stale data, honest rendering, auto-save/deduplication, atomic persistence,
relative-date reuse, unit/location changes, ES5 escaping and delay cancellation.

`node scripts/check-adaptive-weather.mjs --run-paid` runs two actual planner requests
against an isolated in-memory session and exercises auto-save/local reuse. It uses
the shared approved API budget ledger; it does not overwrite the owner's display
state or save test views. Both cases passed September 16: approximately 14 seconds
of planning each, so first-time composition still needs honest progress speech.

The seven-day rain-focused composition with all three components and its save
question was also rendered on the physical Android 6 Mirror at 1080×1920. It fits
without scrolling. This checks device rendering, not reflective-room contrast or
the exact wording/timing of a live human conversation.

Not implemented: arbitrary generated components/code, forecast ranges longer than
seven visible dates, deleting/renaming saved weather views, guaranteed speedups,
or general-purpose long-running research jobs.

### Follow-up failure and recovery validation

Historical validation before auto-save: the September 16 failed human follow-up was blocked by an unresolved cancelled
Agents session, not by unsupported next-week components. See [voice recovery](VOICE.md#interruption-recovery-september-16).
After confirmed cleanup, both paid isolated checks passed again: later-this-week
planning 14.6 seconds and next-week planning 11.5 seconds (17.6 / 14.7 seconds
including cleanup). Next week produced seven dated rows with a rain-focused layout
and a save offer; local approval/reuse passed. At that checkpoint 128 deterministic tests passed.
These are API/replay results, not a claim that the new human microphone test passed.

The owner then verified the real later-this-week voice flow. A declined save offer
followed by a correction exposed unnecessary planning and a timeout. The owner
changed the product policy to durable-by-default for all supported assembled
experiences, not only weather. The shared repertoire now retains validated specs
automatically; the existing “Later This Week” layout was saved successfully.
The current suite passes 132 deterministic tests. Automatic retention and local
reuse are tested; fresh voice wording under the revised policy is not yet a new
human benchmark. No additional paid model call was needed for that policy change.
