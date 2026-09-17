# Hands-free Mirror: local wake phrase

Implemented September 16, 2026. The phrase is **Hey Mirror**. The Android 6 native
bridge captures 16 kHz PCM; a small sherpa-onnx keyword spotter runs on the Mac.
No camera, cloud transcription, model inference API or audio recording in standby.
The Mac must stay awake, the server must run, and USB/ADB reverse must remain attached.
This is keyword detection, not speaker identity or authentication: TV audio or
another person can trigger it. Do not use it as authorization for sensitive actions.

## Setup and use

1. On the Mac, with Python 3.11+ available, run `npm run wake:setup`. This installs
   pinned Python dependencies into `data/wake/venv`, downloads the upstream 17 MB
   model archive and verifies its SHA-256 before extraction. Everything downloaded
   stays in ignored `data/wake/`; no runtime downloads or new cloud account/key.
2. Build/install the updated Afterglow APK from `mirror-mirror`, grant the existing
   microphone permission and launch with `audioBridge=true`. Follow
   [Mirror audio setup](MIRROR-AUDIO.md). The handshake must report `wakeCapable:true`.
3. Open `/remote`. **Test wake phrase only** starts local listening and chimes on
   detection without opening Live. **Turn wake microphone off** stops capture.
4. Choose **Enable “Hey Mirror”** for real conversations. Say the phrase, pause,
   **wait for the chime**, then give the request. The wake phrase itself and words
   spoken during connection are not replayed to the API. There is no audio pre-roll.
5. Say **“That’s all”**, **“end conversation”**, or **“goodbye”**
   as a standalone utterance to end the conversation. The companion's End button
   also ends a wake-owned conversation. It returns to standby after four seconds.
6. To stop ALL microphone capture, use **Turn wake microphone off** or say
   **“stop listening”** during a conversation. Ending a
   conversation is not the same as disabling standby. Disconnecting USB, leaving
   the Android activity or stopping the server also stops capture.

The small static native teal dot (no text) means local standby; **Connecting** means
wait. After readiness, a quiet two-note cue plays through Mirror speakers and the
existing animated conversation indicator takes over. Speaker volume is unchanged.
The current half-duplex playback gate remains: wait for a reply to finish before
speaking. End phrases consequently are not reliable while the assistant is talking;
the companion's off button is always the fallback.

## Ownership, privacy and bounded operation

- Disabled by default, not persisted, never automatically rearmed after restart,
  model failure, audio stall, USB disconnect, unexpected Live closure or startup
  failure. No automatic paid retries.
- Explicit arming lasts at most **30 minutes / 10 sessions**, including detections,
  test mode and background-completion reconnects.
  Reloading/closing the companion does not disable it; it is server-owned. The
  control page explains this and retrieves current state when reopened.
- Each paid session retains the **three-minute absolute cap** and budget reservation.
  **10 seconds of conversational inactivity** ends a wake session. Eligible delegated
  work continues independently; completion can reconnect once, still within the
  original arming and budget. Input/output activity, actual playback and unsettled
  corrections prevent idle timeout, but not the absolute cap. This is a heuristic,
  not VAD. See [background voice lifecycle](VOICE.md#background-task--voice-separation-september-17).
- Manual sessions still use the existing 20-second companion heartbeat lease.
  Wake-owned sessions explicitly use the server lifecycle; native ping packets
  do not masquerade as browser heartbeats. Manual Start is excluded while armed.
- Standby packets have a separate `standby-audio` event route, connected only to
  the local detector. Conversation startup restarts Android capture; the Mac
  drops old packets until a fresh-capture acknowledgment arrives. No queued
  standby audio crosses the cloud boundary. Audio during startup is discarded.
- Wake detector receives a minimal environment without API credentials. Its
  pipes/queues are bounded, processing progress has a five-second watchdog, and
  disabling kills the process. It emits wake events and counters, not transcripts.
- `/api/wake` exposes state, not tokens/audio. POST enable/disable/end require
  loopback + exact Origin + JSON. This is a local single-user control, not LAN auth.
- Existing active-session transcript logging still applies **after wake**. Wake
  telemetry records allowlisted state transitions and stop reasons, never PCM.
  Camera capture stays off. Synthetic speech smoke-test files are temporary and
  deleted; this does not create a microphone recording facility.

## Detector and verification

Model: `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01` (English), quantized
chunk-16 encoder and joiner, unquantized decoder, CPU / one thread. The keyword
tokens `▁HE Y ▁MI R R OR` were generated from its bundled `bpe.model` with
SentencePiece 0.2.1; the tokenizer is not needed at runtime. Score 1.5, threshold
0.25, one trailing blank. Stream initialization supplies synthetic silent left
context so a phrase immediately after arming is detectable. Phrase/sensitivity
are not user settings yet. `--model bilingual` retains the previous model for
offline comparison if its files are already installed; new setup installs English only.

- `npm test`: 149 passing deterministic tests across the repo, including lifecycle/route tests, start/disarm races, local-only
  audio routing, fresh-capture gating, no-API test mode, wake count/time limits,
  idle/busy handling, exact spoken end and unchanged manual voice flow.
- `npm run wake:check`: optional **offline Mac** baseline with Samantha, Daniel
  and Moira synthetic voices, non-wake passages, and delayed/quiet wake speech.
  `npm run wake:check -- --accents` also tests Karen and Rishi; these currently
  expose known misses and the command intentionally exits nonzero. Do not describe
  the detector as accent-independent. Neither suite proves far-field accuracy or
  TV immunity. Synthetic audio is generated locally and deleted after the test.
- Hardware acceptance still requires speaking toward the actual Mirror, checking
  wake range, hearing the readiness cue, completing a request and returning to
  standby. First test locally, then enable paid conversations.
- Actual USB standby was checked on the Mirror: capture frames and local detector
  progress advanced while Live stayed off. Disabling released capture. Updated APK
  built/installed on Android 6; no paid wake session was opened during this pass.
- The original bilingual model missed both a Mac-speaker playback and the owner's
  repeated human tests. Mic levels during the latter rose from roughly 20 RMS to
  over 2100 RMS, with peaks over 6000 (PCM16), but no wakes/chimes. Increasing mic
  volume blindly was therefore not the first fix.
- September 16 acceptance: switching to the English model produced **two local
  wake detections**, speaker output advanced by 15 frames per readiness cue, and
  the owner confirmed hearing the chime. This verifies the actual mic → detector
  → speaker path for those attempts, not general reliability or a wake-owned paid
  conversation. No audio recording or paid session was needed. Test listening was
  disabled afterward. Conversation/side-talk attention work remains separate.
- A subsequent owner test needed three wake attempts. Both weather flows were
  fast, including contextual saved-view reuse about 0.7 seconds after the final
  transcript fragment. The timer took about 17 seconds: “You set a timer for a
  minute and a half” missed the quick parser and used planning. Both the opening
  “You set…” and post-unit fraction “a minute and a half” remain unsupported by
  that parser. These are known follow-ups, not fixes included in this release.
  Missed standby utterances are not recorded, so their cause cannot be inferred
  from the successful wake event alone.

Upstream references:
[keyword spotting model/customization](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html),
[Python API example](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/keyword-spotter-from-microphone.py).
The model is downloaded, not vendored; review upstream model/dependency licenses
before redistributing an installer or commercial product.

Possible later work: far-field sensitivity calibration, echo-tested barge-in,
moving local detection to Android, optional camera presence (not conversation
intent), or an explicit physical mic switch. None is required for this first loop.
