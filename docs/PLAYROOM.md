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
  reduced-motion support, and a bear speaking animation driven by native output audio.
- Explicit companion start and finish controls. Finish stops voice and wake capture.
  Starting a game alone does not start the microphone.

See [artwork prompts and provenance](PLAYROOM-ART.md).

## Privacy and release gates

Game progress is ephemeral and does not resume after server restart. Playroom
conversation history and transcript telemetry are suppressed; no local audio
recording is added. Starting voice still sends microphone audio to OpenAI. Local
suppression does not guarantee provider-side zero data retention.

Review the [OpenAI under-18 guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance)
before child deployment. Provider retention eligibility/configuration, parental
controls, content-safety behavior and realistic speech coverage remain release gates.

## Verification — September 16, 2026

- Deterministic tests cover judging, uncertainty, branching, replay rejection,
  persistence boundaries, escaped noninteractive markup, explicit adult entry,
  isolated voice instructions, transcript suppression and audio-driven animation.
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
