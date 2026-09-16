# Custom functions and assembled layouts

The assistant can propose small pure JavaScript calculations or deterministic
transformations when a built-in tool does not cover the requested outcome. A
function recipe includes named inputs, code, example tests and a trusted layout.
This is a bounded capability, not a general coding agent with host access.

## Execution and reuse

`create_function` validates the specification, runs two to five example tests,
checks the current result against its layout, and repeats the current input to
check repeatability. Only then does one atomic state write save the recipe,
display result and receipt. Failed tests, stale revisions and cancellation leave
no new saved result. `run_function` repeats these checks with fresh inputs.
`open_function` asks for inputs rather than silently replaying old values.
Adaptation creates a separate recipe with its parent's ID; originals stay intact.

Recipes live in ignored `data/state.json` under `reusableViews` with kind
`function`. The shared library holds up to 64 recipes and never silently evicts
prior work. Workflow custom steps advance only with actual function execution
evidence, saved alongside the step for crash-window recovery.

Companion controls run saved calculations without an AI call. Title-based
opening, bounded learned wording, input questions and contextual follow-ups can
also run locally. Arbitrary spoken input binding can still require the planner.
Saving a recipe does not guarantee every wording is fast.

## Conversational reuse

After successful execution, eligible numeric requests teach literal-token/typed-
slot routes in `functionRoutes`. For example, a verified “Pack snacks for six
people” can match “Please pack snacks for nine people” or “Could you pack snacks
for twenty-one people?” The app derives slots from actual validated input values,
not a model-authored regex. All numeric inputs must match distinct, explicit
numbers in the original request. An additional successful wording can teach an
additional route. Units and intent-bearing words are not discarded.

- Routes are fingerprinted to the complete saved function specification. Changed
  code/layout/input contracts invalidate old routes; two matching recipes are
  ambiguous and use planning instead. Up to 128 routes are retained without
  evicting existing routes. The learned-fast-path opt-out applies.
- While a function is active, “What about nine?” can change its sole input;
  “What if width is eight?” changes that named input while preserving the other
  values in the **current** result. Tool results include the bound values so the
  voice agent can explain which assumptions were kept.
- “Run rectangle area with width nine” starts fresh, asks for length, and retains
  that answer. Opening a function asks one missing input at a time. Bare scalar
  replies are accepted only for the current missing-input question; an unrelated
  number cannot rerun a completed result.
- Context lasts two minutes from the last function interaction. Navigation,
  unrelated state changes, a conflicting clarification, playroom mode and app
  restart invalidate short contextual replies. Durable explicit routes survive
  restart; conversational focus does not.
- Named boolean values and short quoted text are supported in focused input
  collection. Unquoted free text, complex arithmetic, unknown units, corrections,
  compound requests and uncertain wording use contextual planning. This is a
  bounded accelerator, not universal semantic similarity or speaker detection.

Reuse still validates inputs, reruns example tests and executes the saved code in
QuickJS. It skips planner regeneration, not validation. The voice transport still
needs to deliver the request to the assistant; this does not eliminate wake,
transcription, delegation or spoken-response latency. `function.reuse` traces
report local duration and route source without exporting input values or text.

## Validation-driven repair

A newly generated `create_function` can receive **one** additional planning turn
after a trusted sandbox, output-contract or example-test failure. The model gets
the original action and a small checker diagnostic, not the surrounding unrelated
conversation. An example mismatch includes the validated example output; sandbox
failures do not expose host errors or invent an explanation.

Only the code may change. Inputs, current input values, title, outcome, layout,
parent recipe and every expected example remain identical. Extra actions, weakened
tests and unchanged code are rejected. The repaired result must pass the same
sandbox, output, repeatability and persistence gates before any recipe or display
is committed. A second failure ends the attempt without another model call.

Passing first attempts incur no repair call. Existing saved recipe failures,
invalid input/specifications, host/worker timeouts, storage errors and cancellation
do not trigger repair. Revision and correction checks prevent superseded builds
from committing. Repair has no web tools or shell environment and consumes a normal
Agents reservation; an exhausted allowance blocks it before a provider call.
Progress reports testing/repairing rather than claiming success. Metadata-only
`function.repair` traces record started/verified and the checker category, not
code, inputs, examples or outputs.

This repairs implementation errors, not incorrect requirements. Model-authored
tests are still **not independent correctness proof**. If the original tests or
contract are wrong, they need a separate reasoned revision, not a weakened repair.
General integration code and unbounded self-repair remain unsupported.

## Boundaries

- Generated code runs in QuickJS WebAssembly, never Node `eval` or `vm`. The
  trusted worker receives only code and explicit input values, with an empty
  environment and no host API bridges. No filesystem, network, imports, DOM,
  microphone, device control, app mutations, clock or randomness are exposed.
- Each case gets a fresh VM: 16 MiB guest memory, 512 KiB guest stack and a
  100 ms interrupt deadline. A parent 2.5-second timeout terminates the worker.
  These are layered resource controls, not a claim of a formally proven sandbox.
- Six typed inputs maximum; code is at most 6,000 characters. Output is a bounded
  flat object with at most 12 keys. Strings and lists have explicit size limits.
  Async results, malformed output and mismatched component bindings are rejected.
- Layouts use one to four metric, list, bar or note blocks with mint, sky or peach
  contrast. Both surfaces show two blocks per page. The mirror is output-only;
  inputs and source inspection remain on the companion. Generated text is escaped
  and no generated HTML/CSS/scripts execute in the browser.
- Local mutation endpoints require loopback, same-origin JSON and validated
  commands. Functions are unavailable in playroom mode.

Example tests are model-authored checks, **not independent proof of correctness**.
The assistant must not generate high-stakes decision tools, invent facts, replace
grounded weather/research with constants, or claim unavailable integrations work.
General arbitrary-code integrations remain unsupported.

Isolation controls follow the maintained
[QuickJS runtime documentation](https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten/classes/QuickJSRuntime.md).
The dependency is pinned to `quickjs-emscripten` 0.32.0.

## Verification — September 16, 2026

- `npm test`: 226 passing tests, including 26 custom-function/reuse tests using the real
  QuickJS worker, cancellation, resource exhaustion, storage rollback, restart
  reuse, workflow receipts, escaped output and companion request recovery.
- Browser fixture: changed picnic headcount from six to nine, observed 18 snacks,
  nine water bottles and 27 napkins; Next displayed the second result page.
- `node scripts/preview-functions.mjs` runs that isolated, in-memory fixture at
  `http://localhost:8784/remote`; no paid API or microphone is used.
- Reuse fixture accepted “Pack snacks for nine people” and “What about twelve?”
  in 31 ms and 32 ms respectively on the development Mac. These are illustrative
  local timings, not voice-latency measurements or performance guarantees.
- Android 6 Mirror framebuffer inspection confirmed large result text, bars and
  companion-driven pagination. [First page](evidence/function-reuse-page1.png)
  shows the nine-person result; [second page](evidence/function-reuse-page2.png)
  shows the later four-person result. Reflection contrast and maximum-length
  content were not tested in this fixture.
- Live model-authored function generation and spoken end-to-end reuse remain
  unverified. No new paid API calls or microphone capture were used this pass.

Reproduce the local follow-up fixture:

```sh
node scripts/preview-functions.mjs 'Pack snacks for nine people' 'What about twelve?' 'Open a little picnic math'
```

The fixture rejects planner fallback, so success proves local routing rather than
an unseen inference call. The production state is not used or modified.

### Repair pass — September 16, 2026

- `npm test`: **279 passing tests**, including 14 repair tests. These exercise the
  real QuickJS checker, fixed-contract enforcement, one-attempt limit, storage
  rollback, cancellation/revision changes, telemetry privacy, and the real budget
  gate with a mocked provider. No paid inference is hidden inside these tests.
- `node scripts/preview-function-repair.mjs` serves an isolated in-memory rehearsal
  on port 8784. A fixture model first supplies an incorrect soil-volume formula,
  then corrects it from real checker feedback. Exactly two fixture planning calls
  produce a saved result; fresh numeric values reuse it without more planning.
- Native-browser verification: the initial reused result showed 78.5 liters / four
  bags; changing diameter/depth to 40/30 cm rendered 37.7 liters / two bags.
  Companion paging also updated the mirror display to the assumptions note.
  This is browser rendering evidence, not a new physical-mirror acceptance test.
- The fixture measured 34 ms for local reuse on the development Mac, not voice
  latency. Verified numeric requests beginning with “estimate” now promote bounded
  parameter routes too; negated requests still fall back rather than executing.
- Live model-authored repair and spoken end-to-end acceptance remain pending.
  No new paid API calls, microphone capture or allowance increase in this pass.
