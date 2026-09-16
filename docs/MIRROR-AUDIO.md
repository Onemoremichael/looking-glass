# Native Mirror audio over USB (September 16, 2026)

Android 6 can now be the microphone/speaker endpoint. The Mac still runs Looking
Glass, Live, the planner and storage. Browser/WebRTC Mac mode remains available as
**This computer**. The display has no touch controls or browser microphone access.

## Use

Run `npm start` on the Mac. HTTP 8780 and native audio 8782 bind to **127.0.0.1**,
not LAN. Install the updated Afterglow APK from `mirror-mirror`:

```sh
./mirror-build-clock.sh
adb -s be9d0af install -r artifacts/android-apps/afterglow-debug.apk
adb -s be9d0af shell pm grant dev.mirror.clock android.permission.RECORD_AUDIO
adb -s be9d0af reverse tcp:8780 tcp:8780
adb -s be9d0af reverse tcp:8782 tcp:8782
adb -s be9d0af shell am force-stop dev.mirror.clock
adb -s be9d0af shell am start -n dev.mirror.clock/.ClockActivity \
  --es url 'http://127.0.0.1:8780/?timeZone=America%2FNew_York' \
  --es orientation portrait --ez audioBridge true
```

Open `/remote`, select **Mirror · USB**, press **Start conversation**, wait for
Listening and speak toward the Mirror. The Mac browser neither captures nor plays
audio in this mode. Wait until replies finish before talking: this first version
suppresses microphone upload during audible playback to avoid feedback.

End with the companion. Mute suppresses input, not billing or playback. Sessions
still cap at three minutes. Both USB tunnels must be recreated after reconnect or
reboot. The audio-enabled intent is intentionally not saved: ordinary Afterglow
launches remain display-only. Leaving its Activity releases capture/playback.
No boot service, wake word, camera capture or automatic paid-session restart.

## Implementation and privacy

- `AudioRecord` (VOICE_RECOGNITION) and `AudioTrack` (STREAM_MUSIC): mono signed
  PCM16LE at 16 kHz, 20 ms microphone packets. Existing speaker volume is respected.
- The Android helper connects to device loopback:8782 over ADB reverse. Frames are
  byte type + uint32 big-endian length + bounded payload. Version/rate handshake;
  one native endpoint. This is not HTTP or a public network protocol.
- Frames: 1 hello JSON, 2 input PCM (640 bytes), 3 numeric diagnostics, 4 ping;
  server: 10 start, 11 stop, 12 mute flag, 13 output PCM, 14 pong.
- Idle bridge does not open audio devices. A native teal listening / gold reply
  waveform is visible during capture; muted input shows a static amber pause mark
  and “Muted” label. Motion follows audio levels and respects disabled Android
  animations. End hides it. Mute and playback gating replace samples with silence;
  End releases AudioRecord. No audio files; existing transcript telemetry applies.
- Platform echo cancellation is enabled if available, but full-duplex is unverified.
  Only nontrivial output amplitude extends the 350 ms gate: Live streams silence
  too, which must not suppress the user's microphone indefinitely.
- Mac uses the official Live primary WebSocket: `gpt-live-1`, Marin, `store:false`.
  Both adapters reuse transcript routing, fast actions, planner, budget and closure.
- Companion heartbeat remains the 20-second paid-session lease. Native keepalive
  cannot extend it. USB loss stops the session; native socket read timeout is 5s.
- Frames/queues are bounded; slow endpoints disconnect rather than accumulate audio.
  Keys stay on the Mac. No firmware/driver changes.
- No authentication/encryption on this **loopback/USB-only** channel. Do not expose
  8782 to LAN or the internet or treat it as a multi-user service.

`GET /api/mirror-audio` exposes flags, numeric mic RMS/peak and frame counts, not
audio. `/api/voice/start` accepts `{device:"mirror"}` instead of SDP; disconnected
preflight fails before API reservation. Start/heartbeat/stop/mute retain loopback,
exact-Origin and JSON checks. Controls require the ownership token. LAN phone
start is not enabled. Alternate `MIRROR_AUDIO_PORT` is Mac-side only; configure
ADB reverse device port 8782 to that host port when overriding it.

## Verification and limits

- Built/installed on actual Android 6.0.1. Native input has nonzero signal; a local
  440 Hz test submitted 25 frames to AudioTrack. Human audibility not inferred.
- Short paid Live test streamed both directions and closed with confirmed usage.
  This is transport verification, **not** a full spoken-task test.
- 132 deterministic tests pass across Looking Glass: native framing, disconnected preflight, PCM routing,
  budget closure, disconnect cleanup and browser-free companion startup included.
- The owner subsequently confirmed the real spoken Mirror test worked. Far-field
  range and echo robustness still need broader testing. Full-duplex interruption
  is deferred.
- Prior APK rollback backup is ignored at
  `mirror-mirror/.work/afterglow-before-native-audio.apk`.

Official API contract:
[Live primary WebSocket](https://developers.openai.com/api/reference/resources/live/primary-websocket).
