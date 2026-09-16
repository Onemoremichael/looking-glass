# Local contract v1

GET /api/state and GET /api/events return the same shared snapshot (SSE on events).
POST /api/command accepts same-origin JSON, bounded to 2048 bytes:

- show: panel home/time/timers/todos/weather/calendar/tasks/saved
- start_timer: integer seconds 1–86400, optional label
- cancel_timer: id
- add_todo: text; toggle_todo: id; set_todo_done: id, done; remove_todo: id
- request: text (limited local routing, otherwise clarification)
- answer: id, text (needs_input requests only)
- cancel_task: id
- save_recipe: id (configured blocked requests only, repeated saves deduplicated)
- fork_recipe: id, title, preferences
- open_recipe: id (reports unconnected source; no fabricated results)

Snapshots include version, revision, panel, message, timers, todos, tasks, recipes,
and capability catalog. Timer deadlines are epoch milliseconds. State commits before
broadcast; failed writes restore previous in-memory state. Malformed persisted state
fails startup rather than silently destroying user data.

Data lives in ignored data/state.json, no public file route. One Node process owns
this file; multiple simultaneous writers are unsupported. No authentication: trusted
localhost/LAN only for display/data controls. No API keys or audio/images are included
in shared snapshots. Optional explicit Mac voice sessions transmit audio to OpenAI;
see [VOICE.md](VOICE.md) for privacy and access boundaries.

GET /api/voice returns transient voice status. SSE emits a named `voice` event, separate
from persisted display snapshots. POST /api/voice/start accepts an SDP offer (64 KiB
request ceiling), returns an answer and transient ownership token. POST heartbeat/stop
require that token. All voice POSTs require loopback and exact same-origin JSON.
The default outcome planner commits `assistantReceipts`, an `assistant` presentation
card and the last eight `assistantHistory` request/result summaries atomically with
state. The legacy grammar path uses `voiceReceipts`. These histories are part of the
trusted-local shared snapshot, not a private multi-user conversation store.

POST /api/surface accepts same-origin JSON (1024 bytes): clientId, surface
(mirror/companion), revision, visible. Reports are transient, expire after 15 seconds,
and acknowledge browser-rendered revision/visibility, not physical screen power or
viewport intersection. The planner receives these alongside each surface's content.
Both render the same ordered clarification options. See [ASSISTANT.md](ASSISTANT.md)
for selection, stale-result, cancellation and capability contracts.

Recipes currently use the fixed agenda component with configuration only. A future
validated component registry will support agent-selected layouts, not arbitrary HTML
or scripts. sourceStatus is not_connected until a real adapter is implemented.

Port 8780 is independent of mirror-mirror Android remote 8765 and clock lab 8766.
The server makes no ADB calls or device modifications. Timers are local application data, not Codex
automations or operating-system alarms.

## Physical Mirror test (September 15, 2026)

The existing Afterglow WebView wrapper successfully renders Looking Glass in
1080×1920 portrait on the recovered Android 6.0.1 device. A temporary timer was
created, visually verified on the device, and removed. No APK or firmware was flashed.
This is display verification; microphone and spoken responses still use the Mac.

With the local server running and authorized USB connected:

```sh
adb -s be9d0af reverse tcp:8780 tcp:8780
adb -s be9d0af shell am start -n dev.mirror.clock/.ClockActivity \
  --es url 'http://127.0.0.1:8780/?timeZone=America%2FNew_York' \
  --es orientation portrait
```

The USB reverse tunnel keeps the server bound to Mac loopback; no LAN listener or
firewall change is required. Keep USB connected for this test and repeat `reverse`
after reconnecting. The wrapper remembers the URL; if unreachable, its existing
fallback shows the bundled Afterglow clock and retries. Android Home is unchanged.
The optional `timeZone` query sets the display clock/date to a valid IANA zone,
because this Android image defaults to UTC. Invalid/absent zones use device time.
Timer deadlines are absolute timestamps and unaffected by this formatting option.

Wi-Fi ADB remains configured at `192.168.0.51:5555`, but the Mac reported “No route
to host” during this deployment despite the Mirror reaching the Mac by ping.
Wireless deployment is not verified in this pass; USB is the confirmed path.

### Refresh after frontend changes (September 16, 2026)

SSE updates application state, not already-loaded JavaScript or CSS. The first
weather voice test selected the weather panel successfully, but the physical
Mirror still rendered the old “not connected” placeholder. Restarting just the
wrapper loaded the new frontend; a device screenshot verified the Gainesville
current conditions, hourly forecast, three-day rows, and Fahrenheit units.

If an already-running wrapper merely reports “task has been brought to the front”,
explicitly restart it before the `am start` command above:

```sh
adb -s be9d0af shell am force-stop dev.mirror.clock
```

This stops only the display wrapper; it does not erase app data, weather settings,
or timers. No firmware or APK update is needed. A reconnect alone does not update
the loaded frontend, so repeat this refresh after deploying new display assets.
