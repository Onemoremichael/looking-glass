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
2. **Creative studio** — pending: current GPT Image model, bounded paid jobs,
   persisted assets and reusable creative recipes, generated game artwork.
3. **Playroom** — adult-rehearsal foundation implemented: four generated animal
   assets, conservative answer judgment with uncertainty, retry/hint/skip state,
   bounded bear choices and audio-reactive animation. Hardware animal display was
   inspected; the first physical spoken answer did not advance. Full multi-turn
   audio, child-speech coverage and provider privacy requirements remain gates.
   See [evidence and limitations](PLAYROOM.md). Generated artwork is not completion
   of the application's image-generation API integration.
4. **Adaptable workflows** — pending: durable multi-step task progress, resume,
   refinement and cancellation; reusable parameterized flows; sandboxed custom
   UX/code creation with validation and promotion, not arbitrary host execution.
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
