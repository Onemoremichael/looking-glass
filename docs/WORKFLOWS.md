# Durable multi-step work

The mirror can now turn a complex request into a saved, ordered plan, work through
supported steps, pause for answers, and resume the same run later. This is separate
from the older **Requests** prototype, which only captured preferences.

Example request: “Help me plan a picnic: research places, ask me which one, and make
a packing list.” The planner chooses the actual steps and necessary questions;
this example is not a keyword-only trigger. Use **Workflows** in the companion to
review progress, answer questions, confirm human steps, pause/cancel, or start a
fresh run from a saved flow. The mirror remains output-only.

## Execution contract

A plan has a title, outcome, up to four named inputs and one to eight ordered steps.
Inputs use literal `{{city}}`-style substitution, not executable templates. Missing
inputs produce a saved question before any step executes. Starting a run confirms
acceptance, **not completion**. Supported steps continue in the background even if
the conversation ends; there is no scheduled execution or spoken completion alert.

| Step | Permitted work | Completion evidence |
| --- | --- | --- |
| Research | One sourced research board or fresh cached board | Committed receipt plus a snapshot of the board, sources and fetch time |
| Weather | One basic or composed forecast | Committed result with fresh, available coverage; incomplete compositions do not complete |
| To-dos | One to five list additions | Created item IDs; this does not mean the real-world errands are done |
| Artwork | One generated or saved image | A completed image job, not its acceptance message |
| Human confirmation | A task the person performs | Explicit user confirmation of the current waiting step, or companion confirmation |
| Custom capability | One bounded pure calculation via create/run function | Example tests, validated output and committed receipt; unavailable integrations remain blocked |

See [custom functions](CUSTOM-FUNCTIONS.md) for the execution boundary and limits.
This does not enable arbitrary host code, purchases, or new service integrations.

The existing Agents planner interprets each supported step with the full run's
outcome, inputs, prior findings and current question. A local guard rejects actions
outside that step's scope, including recursive workflow creation and unrelated
mutations. An answer paragraph, successful provider turn, or model assertion of
“done” cannot complete a tool step. A human confirmation is user-reported evidence,
not sensor verification. Natural-language confirmation still depends on model
interpretation; the companion's explicit confirmation button is deterministic.

The official [Agents turn contract](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/agents/subresources/sessions/subresources/turns/methods/list)
provides provider turn status and best-effort usage. Those records are not proof
that an application action committed. The application therefore owns durable
plans and tool receipts rather than treating provider conversation state as the
task ledger. No new provider endpoint or agent session persistence is required.

## Recovery and multi-turn state

- `data/state.json` holds `workflows`, selected `workflowId`, command receipts and
  workflow recipes in `reusableViews`. Private answers/findings stay out of Git.
- Each step's operation ID is persisted **before** calling the assistant. A tool
  receipt is saved in that step in the same atomic write as the mutation, even if
  the rolling conversation receipt window later expires. Restart/resume can close
  the commit-to-progress crash window without repeating list additions.
- Research evidence stays with its step, including citations and fetch time, even
  after another board replaces the display. Old findings remain dated evidence,
  not a claim of newly refreshed facts.
- A clarification saves its question and ordered choices. A follow-up starts a
  new attempt with the same outcome and earlier evidence. Numbered answers require
  current surface confirmation and bind to the displayed option before execution.
- Restart pauses running workflows. It never automatically starts paid work.
  ImageStudio separately marks unfinished images interrupted.
- Pause/cancel abort local continuation and owned image waiting; already completed
  results/list items remain. Cancellation cannot retract external processing or
  billing. Late results do not advance a paused/cancelled plan.
- Explicit retry can re-fetch failed or partial work. Successful committed actions
  are not discarded. Each step is bounded to twelve attempts, and the library to
  32 runs; no silent eviction occurs. A library-management UI remains future work.

## Reuse and adaptation

Every accepted plan saves a validated recipe automatically. If the shared 64-entry
repertoire is full, creation fails before execution instead of claiming it saved.
An adapted plan gets a new recipe with its parent ID; originals are preserved.

`open_workflow` resumes viewing an existing run. `reuse_workflow` starts a fresh
run with new inputs, pending steps and no prior completion evidence. Relative
research/weather requests resolve with current context. Re-running a list-building
flow can intentionally add new list items; it is not a replay of the old run.

Recognized “show [title] workflow”, “resume this plan”, and “run [saved title]
again” routes bypass plan creation. Ambiguous names or nuanced paraphrases go to
the planner. Research/generation still have their own latency and charges. The
promotion layer below now compiles eligible pure calculations; this does **not**
make arbitrary semantic requests or every kind of step instant.

### Learned calculation executors

After a custom step commits a verified function result, the workflow can retain
a typed executor in its recipe's `executors` array (bounded to 32). Function input
names must match declared workflow inputs, the step request must explicitly use
their `{{name}}` placeholders, and the first committed values must agree exactly
after type conversion. Numbers, text and booleans are supported. Inferred constants,
unmatched names, zero-input functions and steps with clarification replies do not
promote. No arbitrary string replacement or fuzzy parameter guessing occurs.

A fresh run binds new values, then calls the existing sandbox execution path. It
reruns examples, repeatability and output validation and renders a new result;
it does not replay the old output or ask the planner to regenerate the function.
The recipe pins the full function specification, workflow specification, preceding
evidence and any workflow inputs not bound into that function. Different prior
answers, changed code/layout/tests, missing recipes or invalid values cause a miss
and normal planning. Previous research/weather evidence is conservatively pinned,
including its timestamp; refreshed evidence may require reasoning again. A sandbox
failure after a match blocks the step instead of automatically spending on repair.

Pure workflow planning receives only its run, inputs, prior evidence and function
catalog, not ambient chat, current time or unrelated display/weather state. Its
provider turn has no web-search tool. Live facts must come from an explicit prior
research/weather step or supplied inputs, rather than becoming hidden dependencies.
Example checks are not an independent proof of a generated calculation's correctness.

The function binding is saved with the same receipt as the successful mutation.
Progress and executor promotion save atomically; a later persistence failure can
recover from that receipt without executing the calculation again. Restart still
pauses work. `OPENAI_LEARNED_FAST_PATH=0` disables promotion and executor reuse.
Companion completion evidence marks **reused locally**; `workflow.step_reuse`
traces contain typed timing/outcome metadata, not inputs, code or results.

Simple weather step requests also take the existing built-in weather intent route
without a planner call, but call the normal forecast refresh service first. Its
fresh-cache TTL still applies. Missing/stale/incomplete data cannot complete a step.
List mutations, paid artwork jobs and research retrieval are not compiled by this
layer; ordinary receipts still prevent duplicate execution within a run.

## Surfaces and access

The mirror has a large current-step card, a completion rail and up to three nearby
steps. A compact progress strip remains with research, artwork or to-do output.
The companion shows all steps, evidence, answers, controls and saved flows.
All generated text is escaped; the renderer is ES5-compatible for the recovered
Android 6 WebView. No touch interaction is required on the mirror.

`POST /api/workflows` requires Mac-loopback, same-origin JSON, a validated action,
request ID, and optional expected revision. Paid planning follows the same shared
allowance as other agent work. Active workflows must pause before adult playroom
rehearsal. No new microphone or camera behavior is enabled by this feature.

## Verification and remaining gaps

Deterministic tests exercise tool-evidenced completion, parameter reuse, input
validation, multi-turn questions, scope guards, restart/receipt recovery, late
planning and image cancellation, retained research, numbered choices, unavailable
weather, storage rollback, custom-capability blocking, idempotent routing, escaped
rendering and HTTP authorization. The current full suite has 250 passing tests,
including 18 workflow tests, 15 workflow-reuse/voice-disclosure tests and seven
provider-contract tests. Real local `workflow.run` spans group delegated step traces;
only typed counts, duration and outcomes enter telemetry, not plan text, inputs
or research snapshots.

The native browser companion was exercised through human confirmation, completion,
and fresh-run reuse. The physical Android mirror's 1080×1920 portrait layout was
inspected using the offline fixture below. One guarded paid planning smoke test
was attempted with isolated state and no microphone. It failed local validation
because the provider's declared status did not agree with its action list
(`Actions require execute status`). No workflow was created or executed; the
provider session was completed and cleaned up. The raw response was not retained,
so the precise conflicting status/action combination is unknown.

**Implemented follow-up:** the provider schema now encodes the status/action
relationship in an object envelope with exclusive decision branches. Execute
requires 1–5 actions and no options; the other statuses cannot contain actions.
Only clarification can contain options, and non-execution decisions cannot nominate
a quick action. The same provider envelope is validated locally before extracting
the flat decision used by existing application code and persisted receipts.
Creating a plan with missing inputs is execution of plan creation; the workflow
then owns those questions. Ordinary clarification remains mutation-free.

Seven new provider-boundary regressions cover contradictory responses, envelope
shape and cardinality, unchanged state and cleanup after rejection, ordinary
questions, incomplete streams, and plan creation with a saved input question.
Failure diagnostics expose only typed status/count metadata, not raw model text.
There is no automatic normalization of invalid output or paid repair/retry.
See [planner contract](PLANNER-CONTRACT.md) for the schema and migration boundary.

**Still unverified:** rerun the paid smoke test before calling live workflows ready.
Natural spoken plan creation
and longer mixed-provider runs remain unverified. The existing $25 test allowance
is conservatively accounted at approximately $24.97; another paid planning
reservation requires additional budget approval. No automatic paid retry is made.

```sh
node scripts/preview-workflows.mjs
# Isolated in-memory fixture, http://localhost:8784/; no API calls.
node scripts/preview-workflow-reuse.mjs
# Alternative fixture on the same port: actual sandbox, fake first planner turn.
# After obtaining sufficient approved allowance (live retest still pending):
node scripts/check-workflow-plan.mjs --paid
```

The reuse fixture verified 6 → 9 guests and 12 → 18 snacks with one initial fixture
planner call. Through native-browser companion controls, a third fresh run asked
for its input and produced 24 snacks for 12 guests. Fresh-input reuse measured
approximately 37–38 ms in isolated local runs, not end-to-end voice latency.
Restart, changed dependencies, typed bindings, storage rollback/recovery,
cancellation and unavailable weather are covered by deterministic regressions.
No microphone capture, new API spend or new physical-device acceptance occurred.

General compiled step execution, editing a run in place, plan archive/delete
controls, simultaneous workflows and proactive completion speech remain future
work. Custom calculation/code/UX foundations exist, but live generation acceptance
and arbitrary integrations remain unverified. The broader build goal is active.
