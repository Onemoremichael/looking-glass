# Image studio

The assistant can propose `generate_image` for requested artwork, `open_image`
for stored results, and `cancel_image` for an active job. Generation is asynchronous:
the tool confirms acceptance, **not completion**. The mirror shows a quiet progress
view and then the finished image if that view is still selected. Completion never
steals a newer panel. No automatic spoken completion notification is implemented.

The companion has an **Image studio** form and a **Studio** navigation tab with the
job library. The mirror remains output-only. Paid HTTP controls are loopback-only,
same-origin JSON, just like voice. LAN viewers can see saved artwork; do not share
the service outside a trusted network.

## Provider contract

Verified against official documentation on September 16, 2026:

- [GPT Image 2.5 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
  is the selected current model (`gpt-image-2.5-sunburst`). “Imagen” is not its API name.
- [Images generation API](https://developers.openai.com/api/reference/typescript/resources/images/methods/generate):
  one 1024×1024 PNG, medium quality, transparent or opaque background, automatic
  moderation. One request at a time, 1,200-character prompt maximum, three-minute
  deadline and **no SDK retries**. Response URLs are not fetched; base64 PNG only.
- This is text-to-image generation. A new prompt can describe a variation, but
  uploaded-image editing and pixel-preserving edits are not implemented.

The existing `.env` key is loaded server-side. No extra client credential is needed.
Provider access and a real generated result have **not yet been verified for this
account**. Documentation and mock tests do not establish account eligibility.

## Durable results and fast reuse

Jobs, request receipts and complete prompt recipes persist in `data/state.json`.
Artwork is written atomically under ignored `data/artwork/<job-id>.png`, served
only for a known completed job. Prompts and images are private local application
data, not repository assets. Back up the state file and artwork directory together.

Identical normalized prompt/background pairs reopen a completed result, or join
the existing pending job; they do not buy another generation. Replayed request
IDs are idempotent. Completed named artwork can take the local voice fast path
with “show [title]”; nuanced references and adaptations use the planner and its
current artwork context. A changed prompt creates a separately saved result.
This does not train a model or guarantee semantic matching for every paraphrase.

The library currently holds 32 jobs, including failed jobs. No automatic deletion
occurs. A user-facing archive/delete workflow remains follow-up work.

## Failure, cancellation and spending

Restart marks unfinished jobs interrupted and never automatically resubmits them.
Cancellation aborts local waiting and suppresses late artwork publication. It
does not guarantee that provider processing or billing stopped. Unknown outcomes
keep their allowance reserved. Successful jobs keep at least the conservative
$0.50 reservation; reported token costs exceeding that are also accounted for.
The local ledger is **not a provider-side hard spending cap or billing invoice**.
It shares the owner's existing $25 testing allowance; this pass did not raise or
reset that limit. New work fails closed when allowance is unavailable.

If settlement cannot be written to the usage ledger, the job records
`accounting: "unconfirmed"`, the internal reservation ID and any numeric usage
evidence; new image generation is blocked, including after
restart. There is no automatic ledger retry or refund. Reconcile the original
reservation against provider usage and local records before clearing that flag;
do not reset the budget file. Previously completed artwork can still reopen.

The real telemetry layer registers `image.generate` and exposes duration/outcome
metrics without prompts, artwork, or provider payloads. An observer failure cannot
stop generation or discard an otherwise completed image. Shutdown only marks
unfinished jobs interrupted; completed results retain their status.

The playroom does not expose image creation. Exit active generation before entering
adult rehearsal; child deployment still has separate privacy release gates.

## Verification

175 offline tests pass, including eleven image-specific tests covering completion,
saved reuse, cancellation/late results, interruption recovery, spending accounting,
failed storage rollback, payload/path validation, origin controls, local routing
and noninteractive escaped rendering. All image fixtures now use real local
OpenTelemetry, including the HTTP acceptance-to-PNG integration test. Additional
fault injection covers trace start/end failure, ledger settlement failure,
restart with unresolved accounting, and shutdown during completed-job publication.
No paid API call is made by the tests.

This closes a production integration defect discovered after the first pass:
`image.generate` had not been registered, so tracing threw before error handling
and could leave a job queued. Prior mock-only checks did not cover that boundary.

Native browser checks exercised the companion form, visible failed-job state and
library reopening. The completed-art layout was inspected on the Android 6 mirror
at portrait 1080×1920 using an existing elephant illustration as an **offline
fixture**, not a new provider-generated result. Provider generation and spoken
generation-to-display acceptance remain pending.

```sh
node scripts/preview-studio.mjs
# Offline layout fixture at http://localhost:8784/ — generation disabled.
```

Remaining work: provider access/live smoke test, image edits, voice completion
notifications, library management, and deeper parameterized creative workflows.
