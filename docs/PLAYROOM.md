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
downloads Whisper `small.en` (about 606 MiB compressed) and Silero VAD from the
[official Sherpa release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models)
and checks pinned SHA-256 values before use. Model weights remain in ignored
`data/playroom/`; the Python runtime is shared with wake detection.
See the upstream [Whisper model instructions](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/whisper/tiny.en.html)
(which also describe selecting `small.en`) and
[VAD example](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/vad-microphone.py).

In the Mac-local companion, acknowledge adult rehearsal, choose a game, then click
**Start local game audio**. Stop other voice and wake modes first. This mode uses
Mirror PCM input, local Sherpa recognition and macOS Samantha synthesis; it makes
no OpenAI requests. Microphone PCM and recognized text are processed in memory,
not recorded or added to transcript telemetry. Temporary synthesized prompt WAVs
are deleted after use. Only bounded game-engine prompts are spoken.

Recognition pauses during playback and an echo tail; generations discard stale
answers. Silero separates utterances after 600 ms of silence; a bounded 12-second
in-memory ring preserves 250 ms around the speech boundary so quiet word beginnings
are not discarded. Utterances are bounded to eight seconds by VAD; Whisper receives
no prior conversation and no expected-answer prompt. Silence is not decoded.

Unrelated/background phrases are ignored. Short answer-shaped uncertainty such as
“a …” can request a gentle retry without marking the answer wrong or awarding credit.
Negated/ambiguous phrases are not guessed. This is conservative phrase filtering,
not speaker identification. Status diagnostics expose word counts, classification
and a boolean animal-name match, never recognized text.
Capture stops on completion, explicit stop, disconnect, audio faults, 45 seconds
without handled game input, or a three-minute overall limit. Closing the browser
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
- The full offline suite passes **235 tests**. The previous 20M streaming model
  dropped parts of short words depending on onset alignment. A newer streaming
  model and smaller Whisper variants were also evaluated, not assumed reliable.
  `small.en` improves recognition, but short-name coverage is still incomplete.
- Synthetic safety checks pass: silence yields no answer; negation, multiple-animal
  ambiguity and a background-conversation sentence are decoded without grading or
  advancing the game. This is four fixtures, not broad ambient-speech validation.
- The animal layout was visually inspected on the physical Android mirror.
- **Physical animal replay:** fuller Samantha answers at Mac volume 70 advanced
  elephant and giraffe in 3.60 and 3.15 seconds from speech-playback start. Penguin
  was unclear; the Mirror asked for a retry without advancing. Full completion
  remains unverified. Short synthetic names still fail acceptance, including
  penguin/bear; Daniel also misrecognized giraffe. No spelling aliases were added
  to force those tests to pass.
- **Physical bear replay passed all three turns** using “the second one”, “the
  second one”, “the third one”: 3.10 / 3.06 / 2.97 seconds from playback start to
  state advance. The final story correctly reflected ocean, kite and squeak. Native
  playback completed and capture stopped automatically. A prior label-based run
  passed ocean/kite but failed on spoken “squeak”; label coverage remains a gate.
- [Physical speaking-frame evidence](evidence/local-bear-speaking-2026-09-16.png)
  shows the correctly placed mouth overlay, native speaking indicator and completed
  story. The subsequent wording change removes the invitation to answer after the
  microphone shuts down. This frame is not lip-sync or real-child acceptance proof.
- Every physical test exited playroom and stopped the microphone. Mac volume was
  restored to 38 after the louder tests. No paid API calls or budget increase.

Repeatable **local** acceptance checks (no API spend):

```sh
npm run playroom:check  # broad short-name acceptance: currently fails; do not hide it
node scripts/check-local-playroom.mjs --synthetic --safety
node scripts/check-local-playroom.mjs --adult-simulation --full-answers
node scripts/check-local-playroom.mjs --adult-simulation --bear --ordinals
```

Only `--adult-simulation` opens the Mirror mic and plays speech through the Mac
speakers. It requires idle voice/wake/game state, waits for the USB audio peer and
cleans up on failure. `--daniel` provides a second synthetic voice. The script does
not change system volume. Ordinal success does not imply spoken-label accuracy.

An explicit, paid adult simulation can be run after checking the shared allowance
and stopping existing voice/wake sessions:

```sh
node scripts/check-playroom.mjs --run-paid --adult-simulation
# Add --bear to rehearse the bear's three choices.
```

The script uses Mac speech playback, not a child's voice. It is a diagnostic, not
a passing acceptance test or authorization to deploy to children.
