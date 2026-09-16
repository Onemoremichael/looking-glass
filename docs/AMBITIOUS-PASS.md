# Adaptable mirror build ledger

Owner goal (September 16, 2026): research-backed custom UX, current OpenAI image
generation, animal flashcards for a three-year-old, an animated talking bear for
a four-year-old, outcome-first multi-turn reasoning and task tracking, automatic
durable reuse, and a path for constructing missing capabilities. Preserve the
non-touch mirror, old Android compatibility, native mic/speakers, and budget.

## Passes and completion evidence

1. **Research experiences** — foundation implemented: live search, structured
   boards, citations, reusable recipes, fresh/cache distinction, voice access.
   Contract and provider checks passed; portrait overflow prompted two-card
   pagination. Final hardware fit and broader semantic reuse remain follow-up.
2. **Creative studio** — implemented adapter and job foundation: current GPT Image
   2.5 Sunburst, single-request jobs, progress/cancel/restart handling, persisted
   PNGs and prompt recipes, local reopening and voice-planner actions. Offline
   tests and Android portrait fixture rendering pass. Actual provider access,
   image editing and spoken end-to-end acceptance remain pending. See
   [image studio](IMAGE-STUDIO.md). Existing game artwork is generated separately.
   **Reliability follow-up:** fixed an unregistered trace that could strand real
   jobs at queued; real-telemetry HTTP tests now verify acceptance through saved
   PNG delivery. Observer failures no longer break jobs. Unsettled usage blocks
   further image spend across restart, and shutdown preserves completed work.
   175 offline tests pass; no new paid calls or provider-access claims.
3. **Playroom** — adult-rehearsal foundation implemented: four generated animal
   assets, conservative answer judgment with uncertainty, retry/hint/skip state,
   bounded bear choices and audio-reactive animation. Hardware animal display was
   inspected; the first physical spoken answer did not advance. Full multi-turn
   audio, child-speech coverage and provider privacy requirements remain gates.
   See [evidence and limitations](PLAYROOM.md). Generated artwork is not completion
   of the application's image-generation API integration.
   **Local speech acceptance:** replaced the onset-sensitive streaming recognizer
   with local Silero VAD + Whisper small.en, bounded transient audio context and
   macOS synthesis. Physical bear replay completed three spoken ordinal choices
   and final playback, then shut capture off; the speaking frame was inspected.
   Animal replay advanced elephant/giraffe but requested a retry for unclear
   penguin. Short names and spoken squeak still fail acceptance; no forced aliases
   or child-ready claim. Four synthetic safety fixtures and 235 offline tests pass.
   Repeatable local acceptance scripts and transcript-free classification metrics
   make the remaining failures inspectable without spending API budget.
   **Voice experience correction:** GPT-Live/Marin remains the primary voice.
   Companion copy now clearly distinguishes optional Samantha local diagnostics,
   collapsed by default; no silent fallback or newly started paid session.
   **Live playroom lifecycle:** structured verified game-turn receipts now guide
   expressive Marin replies. Both transports mute input on completion, ignore late
   game turns, wait for observed speech plus fresh playback-drain evidence and
   finalize the session; missing evidence has a bounded 30-second fallback. Explicit
   stop closes immediately, and game end disarms wake. Native hardware capture is
   released at close, not by mute alone. Tests exercise both transports and failure
   paths; 265 repository tests pass. The paid rehearsal script now requires automatic close and native capture
   release. No new API spend, paid session, physical audio test or allowance increase
   in this pass. Live sound quality and child readiness remain unverified.
4. **Adaptable workflows** — implemented durable ordered plans, named inputs,
   background guarded step execution, tool/human completion evidence, resumable
   questions, cancellation and restart recovery. Plans auto-save; parameterized
   fresh runs and separate adapted recipes preserve prior work. Local plan routes
   bypass plan creation, but general compiled step fast paths remain follow-up.
   Browser controls and physical portrait layout verified offline. One live plan
   creation test failed closed on a provider status/action mismatch. The structured
   contract now encodes exclusive action/question branches, with boundary tests;
   a paid retest remains required. Spoken mixed-provider
   runs remain unverified. See [workflows](WORKFLOWS.md).
   **Custom-function foundation:** pure JavaScript calculations execute in a
   bounded QuickJS VM, pass example tests and output validation before saving,
   and reuse with fresh inputs. Declarative metric/list/bar/note layouts keep
   generated code off both display clients. Companion calculation and pagination
   were verified in the browser; 215 offline tests pass. Live model generation,
   spoken reuse, broader integrations and physical layout acceptance remain
   unverified. See [custom functions](CUSTOM-FUNCTIONS.md).
   **Conversational reuse:** successful numeric utterances now promote bounded
   typed-slot routes tied to the saved specification. Named fresh-input requests,
   one-at-a-time questions and short current-function follow-ups bypass planning
   when unambiguous. Context expires/invalidation prevents stale shorthand;
   conflicts and unsupported wording still require reasoning. 226 offline tests
   pass. Two Android framebuffer pages and companion input/paging were inspected;
   local reuse measured 31–32 ms in the fixture (not voice latency). Paid/spoken
   end-to-end acceptance remains pending; no new API spend or microphone capture.
   **Workflow executor reuse:** verified pure calculation steps now auto-save
   typed named-input bindings. Fresh runs execute saved code through the same
   sandbox/test/output gates, with specification and prior-evidence invalidation.
   Pure step planning is isolated from unrelated ambient state and web tools.
   Weather steps can use built-in intent routing after refresh. 250 offline tests
   pass; native-browser fixture reused 6/9/12 guest inputs to render 12/18/24 snacks,
   without another planner call after the initial fixture calculation. Local reuse
   measured 37–38 ms, not voice latency. General step compilation and paid/spoken
   acceptance are still pending. Docs and a repeatable preview script are included.
   **Validation-driven repair:** new pure-function builds get one normally budgeted
   code-only correction from real checker feedback. Original tests, input values,
   layout and outcome cannot change; a second failure stops without saving.
   Host/storage/input failures and existing recipe execution never silently retry.
   279 offline tests pass, including real sandbox and allowance-gate checks.
   A native-browser fixture corrected a deliberately wrong planter formula, reused
   it for fresh values without planning, and rendered paginated assumptions on both
   surfaces. Fixture decisions are not live model acceptance; paid/spoken repair
   remains pending. No new API spend or microphone capture in this pass.
5. **Integration/polish** — pending: expectation-setting, timer language gaps,
   wake calibration, microphone/speaker replay, restart/reuse verification.

After each pass: update docs with evidence and limitations, commit, push, merge.
Do not mark the overall goal complete while any requested capability is pending.
Tests use isolated state; paid checks share the existing $25 allowance. Never
reset the ledger, silently retry paid inference, or start recording by default.

## Architecture decisions

- Live voice handles conversation; validated backend actions own mutations.
- Display output is an assembled, bounded scene with semantic sections rather
  than an answer paragraph or unrestricted HTML. Existing weather stays native.
- Research sources are untrusted data. They cannot grant permissions, introduce
  tools, change prompts, or become executable code.
- Reuse stores intent/layout separately from dated facts. Cache hits can be fast;
  fresh web research still has network/model latency and must say so honestly.
- Children get a dedicated game state, not a free-form general-agent session with
  incidental animal pictures. No secret-keeping, emotional dependency, identity
  claims, purchases, external contact, or requests for personal information.

## Official API investigation

The [Agents API](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/agents)
provides live web search with no shell environment required. Current image docs
recommend GPT Image 2.5, including `gpt-image-2.5-sunburst`; account access must be
verified before treating it as available. “Imagen” is not the OpenAI API model name.
See [image generation](https://developers.openai.com/api/docs/guides/image-generation).
