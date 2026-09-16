# Weather on a reflective surface

## Source and boundaries

Use [Open-Meteo Forecast API](https://open-meteo.com/en/docs) plus its
[geocoding API](https://open-meteo.com/en/docs/geocoding-api). The
[free tier](https://open-meteo.com/en/pricing) supports this non-commercial prototype
without a key, with a 10,000-call/day limit and no uptime guarantee. A commercial
deployment must revisit licensing and service level. Weather data is CC BY 4.0;
geocoding uses GeoNames. Attribution appears on the mirror and links are on the companion.

This supplies model-derived conditions/forecasts, not a private weather station,
live radar, minute-by-minute rain onset, or emergency alerts. Precipitation chance
is labeled as probability, not certainty. The forecast is not a safety warning system.

## Places and units

The owner chose Fahrenheit by default, with Celsius available. Save up to five cities
from confirmed search results on the companion, and select one to make it the active
place. The choice survives restarts. No city is inferred from past chat, IP or GPS.
City centers—not home addresses—are sent to Open-Meteo. Search queries, coordinates,
and the Mac's request IP reach that provider. Saved settings/cache are in ignored
`data/state.json`, shared with trusted local surfaces. Do not expose this server publicly.

Requests are server-side to two fixed HTTPS origins. User-supplied URLs/coordinates
are not accepted. Search results expire after ten minutes before confirmation;
search is bounded to five results, with short throttling/cache. All weather controls
require same-origin JSON. They do not need an OpenAI key or incur OpenAI usage.

## Cache, freshness and failure

- Warm all saved cities at startup and refresh on a one-minute scheduler when the
  ten-minute cache TTL expires. Max five cities; in-flight work deduplicates by city/units.
- Eight-second provider timeout. Failures retry no sooner than one minute; no tight retries.
- Fetch timestamp and model-current timestamp are separate. After 30 minutes by
  either timestamp, or a failed refresh, retain a clearly labeled last-available forecast.
- After six hours, hide conditions rather than present old numbers as current.
- Persist normalized data. Null measurements stay unavailable, never become zero.
- A units change clears old-unit data. Late responses from removed places or old units
  cannot publish. Shutdown aborts outstanding weather fetches and stops scheduling.
- Unix timestamps are formatted in the place's IANA zone, not Android's potentially UTC clock.
  This matters for today/tomorrow, hourly labels and sunset. The separate mirror clock
  keeps its existing deployment timezone override.

## Voice and model integration

`get_weather` takes a period (`now`, `today`, `tomorrow`, `week`) and `locationId`
(null for the active place, otherwise a saved ID). Execution produces a verified
summary from the current cache; the model's proposed success message is not used.
The seven-day display is paired with a shorter three-day spoken week summary.
No forecast yet means an honest fetching/setup/unavailable response, not invented numbers.
On first cold lookup, the display updates when data arrives; there is no automatic
second spoken announcement. Ask again once loaded for the spoken summary.

Whole-request matches such as “show the weather”, “weather tomorrow”, “forecast this
week” and “weather tomorrow in [unique saved city]” use the 700 ms transcript-quiet
local lane. No extra model call or provider fetch is required to read a warm cache.
Late delegations still reconcile through durable receipts. Pending clarification,
ambiguous city names, unsaved cities and complex requests retain contextual planning.
Weather state and presentation are available to the planner; unknown places must not
silently fall back to the active city. Settings/adding new cities remain companion-only.

The [structured output contract](https://developers.openai.com/api/docs/guides/structured-outputs)
remains bounded: one new action, no new model or API transport. Prompt integration
distinguishes actual provider data from the still-unconnected calendar/research features.

## Mirror design

Black pixels preserve the mirror appearance as much as this backlit LCD permits;
there is no true pixel transparency or physical reflection manipulation. The owner's
physical photo showed small text disappearing into room clutter. The September 16
revision deliberately uses **selective luminous contrast**, not transparency everywhere:
one pale blue (warm ivory for clear skies/night) forecast strip with dark lettering.
It competes with reflected light; it does not physically mask the reflection. Avoid
full-screen fills, opaque photos, and heavy blur/shader work.
The LCD covers roughly the physical mirror's top two-thirds; all layout is within
that LCD, not the reflection-only lower glass. No interactive controls on the mirror.

- Quiet clock, large city and plain-language period; a 210px temperature at the
  Mirror's 720 CSS-pixel width, filled sky symbols, and gentle floating motion.
- Current temperature/condition, feels-like, and daily high/low are the visual hierarchy.
  Wind, humidity and sunset remain in provider data, not this simplified display.
- Four three-hourly samples on the contrasting strip replace six tiny columns and
  the thin temperature chart. Precipitation probabilities appear only at 20% or above;
  omission does not mean zero. The generic precipitation label also covers snow.
- Two upcoming days with larger names/highs/lows. Tomorrow view starts those rows
  with the following day rather than duplicating its hero. Seven-day mode omits the
  hourly strip and compacts the hero to make room for all seven rows without touch.
- Filled cloud art does not guess sun/moon behind clouds without day/night evidence.
- Seven matching generated PNGs cover cloud, sun, moon, rain, storm, snow and fog,
  with genuine transparent alpha. Hero art floats on black; hourly art sits inside
  compact dark-blue sky windows on the pale strip, keeping ivory vapor distinct.
  Daily art is larger and floats directly on black beside the labels. Rain now reuses
  the cloud PNG with a separate lightweight rain layer: four faint staggered streaks
  for the hero, three short static marks for hourly/daily forecasts. The original
  oversized-drop rain PNG is retained as source history but no longer rendered.
  The rain container stays still while only its cloud gently floats; streaks fall
  independently. Reduced-motion freezes both layers with visible static rain marks.
  Small forecast artwork stays still for scanning. The crescent is a night
  symbol, not a calculated moon phase. Cloud codes still never guess day/night.
  Assets, exact generation prompts and alpha verification are in
  [assets/weather/README.md](../public/assets/weather/README.md). No runtime image
  generation or additional API key is involved.
- Condition-driven rain trails at the edges of the weather area: eight dim elements,
  slow transform/opacity motion, no camera, video, canvas loop, WebGL or backdrop filter.
  Rain in a daily forecast animates that forecast view; it does not claim rain right now.
- Reduced-motion disables the trails and moving symbols. Essential information is static.
- ES5 JavaScript, SVG and ordinary flexbox for the Android 6 / Chromium 44 target;
  unsupported decorative CSS may fall back without hiding the forecast.

Future rain study: droplets joining, occasional rivulets, sparse rim glints and
rain-intensity-dependent motion after physical device profiling. A rich wet-window
illusion cannot actually refract the viewer's real reflected image. Do not solve that
by secretly enabling the camera. Optional **explicitly requested** IP-based suggestions
could prefill settings later, with VPN/ISP ambiguity and privacy disclosure.

## Verification

`npm test` covers normalization/nulls, timestamps, cache dedupe/expiry, stale/offline
behavior, units/removal races, persisted settings, bounded location selection, origin
checks, structured action results, escaping, ES5/no-touch output, and fast voice routing.
Tests mock all network calls and use no paid API or microphone.

A live read-only smoke test fetched geocoding and current/hourly/seven-day data for
New York in an isolated in-memory session. That did not set the owner's location.
The owner verified a real weather quick action and physical display transition after
the old loaded frontend was refreshed (see INTEGRATION.md). No extra paid OpenAI
test was run for the visual redesign.

`node scripts/preview-weather.mjs rain` starts a read-only synthetic fixture at
http://localhost:8781/ (also sun/snow/moon/cloud/storm/fog). `/art` compares the full
collection using the production artwork renderer. The forecast is marked DEMO, never
touches real state, and has no voice or provider access. Production stays on 8780.
Use this to inspect effects independent of today's weather. Native browser QA checks
the portrait 1080×1920 output and a narrow companion layout; physical reflection
contrast and rain visibility should be tuned with the owner.

The contrast redesign was checked on the physical Android 6 device in current and
seven-day modes (1080×1920 physical pixels, approximately 720×1280 CSS pixels).
Both fit without scrolling. A 390px companion check showed no horizontal overflow.
99 deterministic tests pass, including the four-hour/two-day presentation limits,
seven-day layout mode, precipitation threshold, omission of redundant details,
all seven asset routes/alpha formats, and hero-only layered rain with reduced-motion.
Generated cloud/sun/daily-rain rendering was verified on the physical Mirror;
the animated rain hero and static forecast marks were checked in the native browser.
Device screenshots verify rendering, not room-reflection contrast; owner feedback
on the bright forecast strip remains the final optical check.
