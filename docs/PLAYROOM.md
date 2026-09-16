# Playroom: adult rehearsal prototype

This is an experimental foundation, **not a child-ready release**. The companion
requires an adult-only rehearsal acknowledgment. Do not include children in voice
tests until provider retention requirements and the child-safety review are met.

## Implemented

- Four illustrated animal cards: elephant, giraffe, penguin and bear. Recognized
  answers advance; known wrong answers receive a gentle hint. Ambiguous speech
  retries without marking an answer wrong. Hint, skip, stop and restart are supported.
- Pip the bear: a bounded three-choice adventure with ordinal references such as
  “the second one.” This is not yet an unrestricted generative story system.
- Backend-owned game IDs, turn numbers, revision checks and replay receipts.
  Answers route locally; the general agent planner and unrelated actions are blocked
  during a game. Answer recognition uses conservative phrase aliases, not a validated
  child-speech classifier.
- Output-only mirror UI, transparent generated artwork, large question panels,
  reduced-motion support, and a bear speaking animation driven by voice state.
- Explicit companion start and finish controls. Finish stops voice and wake capture.
  Starting a game alone does not start the microphone.

See [artwork prompts and provenance](PLAYROOM-ART.md).

## Opt-in local audio (Mac + Mirror)

Install with `npm run wake:setup` followed by `npm run playroom:setup`. The latter
downloads the Apache-2.0 English 20M streaming Zipformer model from the
[official Sherpa release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models)
and checks a pinned SHA-256 before extraction. Model weights remain in ignored
`data/playroom/`; the Python runtime is shared with wake detection.

In the Mac-local companion, acknowledge adult rehearsal, choose a game, then click
**Start local game audio**. Stop other voice and wake modes first. This mode uses
Mirror PCM input, local Sherpa recognition and macOS Samantha synthesis; it makes
no OpenAI requests. Microphone PCM and recognized text are processed in memory,
not recorded or added to transcript telemetry. Temporary synthesized prompt WAVs
are deleted after use. Only bounded game-engine prompts are spoken.

Recognition pauses during playback and an echo tail; generations discard stale
answers. Unrecognized/background phrases do not advance the game or trigger a
reply. This is conservative phrase filtering, not speaker identification.
Capture stops on completion, explicit stop, disconnect, audio faults, 45 seconds
without an accepted answer, or a three-minute overall limit. Closing the browser
does not immediately stop it; use **Stop local mic** or **Finish & stop microphone**.
Restarting the server does not resume capture. Local game audio cannot share the
microphone with wake listening or cloud voice.

## Privacy and release gates

Game progress is ephemeral and does not resume after server restart. Playroom
conversation history and transcript telemetry are suppressed; no local audio
recording is added. The separate cloud conversation control still sends microphone audio to OpenAI. Local
suppression does not guarantee provider-side zero data retention.

Review the [OpenAI under-18 guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance)
before child deployment. Provider retention eligibility/configuration, parental
controls, content-safety behavior and realistic speech coverage remain release gates.

## Verification — September 16, 2026

- Deterministic tests cover judging, uncertainty, branching, replay rejection,
  persistence boundaries, escaped noninteractive markup, explicit adult entry,
  isolated voice instructions, transcript suppression and audio-driven animation.
- Local-audio regression tests cover game completion, background/malformed input,
  echo/late-answer rejection, startup cancellation, disconnects, inactivity and
  capture watchdogs, synthesis failure, WAV validation, same-origin adult entry
  and exclusive microphone ownership. These use fake audio, not hardware proof.
- The full offline suite passes **234 tests**. The installed model loads and
  transcribes its bundled English sample. A Samantha-generated “I think it is an
  elephant” sample was misrecognized as “ANT”, including after native-rate synthesis
  and resampling. Synthetic game-answer recognition therefore remains a known
  failing acceptance check; local audio is experimental, not verified gameplay.
- The animal layout was visually inspected on the physical Android mirror.
- The Mac-speaker-to-Mirror-microphone test **failed to advance the first animal
  card**. It shut down its voice session and exited playroom. End-to-end spoken
  gameplay is therefore unverified; do not treat mocked audio tests as hardware proof.
- Bear hardware animation/alignment and full spoken multi-turn completion remain
  pending. No automatic paid retry or budget increase was made.

An explicit, paid adult simulation can be run after checking the shared allowance
and stopping existing voice/wake sessions:

```sh
node scripts/check-playroom.mjs --run-paid --adult-simulation
# Add --bear to rehearse the bear's three choices.
```

The script uses Mac speech playback, not a child's voice. It is a diagnostic, not
a passing acceptance test or authorization to deploy to children.
