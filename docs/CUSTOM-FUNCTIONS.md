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

Companion controls run saved calculations without an AI call. Simple title-based
opening and page navigation are local; arbitrary spoken input binding can still
require the planner. Saving a recipe does not guarantee every wording is fast.

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

- `npm test`: 215 passing tests, including 15 custom-function tests using the real
  QuickJS worker, cancellation, resource exhaustion, storage rollback, restart
  reuse, workflow receipts, escaped output and companion request recovery.
- Browser fixture: changed picnic headcount from six to nine, observed 18 snacks,
  nine water bottles and 27 napkins; Next displayed the second result page.
- `node scripts/preview-functions.mjs` runs that isolated, in-memory fixture at
  `http://localhost:8784/remote`; no paid API or microphone is used.
- Live model-authored function generation, spoken end-to-end reuse and physical
  Mirror acceptance remain unverified. No new paid API calls were made this pass.
