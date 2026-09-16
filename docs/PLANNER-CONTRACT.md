# Planner output contract

The cloud planner proposes an action; a successful provider turn is not permission
to skip local validation. The application checks completion, schema, scope, targets,
current revision and cancellation before committing anything.

## Why the envelope exists

A live workflow smoke test returned a decision whose declared status disagreed
with its action list. The old schema validated each field independently, leaving
that relationship to a later local check. The request was correctly rejected but
had already spent a paid planning turn. The raw response was not retained, so we
do not infer which conflicting combination the model returned.

The provider now receives `plannerResponseSchema`:

```text
{ decision: one of
    execute      -> 1–5 allowlisted actions; no options
    clarify      -> no actions; 0–4 options
    answer       -> no actions; no options
    unsupported  -> no actions; no options
}
```

All branches include outcome, message, selectedOptionId and quickAction. Only an
execute branch can nominate a quick action. Duplicate option IDs and references
to unavailable choices remain local semantic checks. Schema validity alone is not
proof that an action is appropriate or that external data is correct.

The root is an object and its decision property uses nested `anyOf`. This follows
the documented [Structured Outputs schema subset](https://developers.openai.com/api/docs/guides/structured-outputs),
which supports nested alternatives and array cardinality while disallowing root
`anyOf`. The installed Agents SDK exposes `text.format` with `type` and `schema`;
no unrelated Responses-only format parameters are added. Live acceptance of this
revised schema remains unverified until the paid retest.

## Compatibility and failure behavior

Only the provider wire format changes. `validatePlannerResponse` strictly validates
the envelope, then returns the existing flat application decision. Local quick
paths, mocked application planners, saved state and command receipts keep their
format. The adapter deliberately does not accept an old flat provider response as
a fallback: a provider ignoring the active contract must not silently execute.

Missing input is not always a reason to return clarify: saving a requested plan
is an executable action even when the plan will subsequently ask for its inputs.
No tool work starts until required workflow inputs are provided.

Invalid decisions never trigger an automatic status correction or repair call.
Session cancellation/deletion and budget settlement run even when validation
fails. `lastContractFailure` records only whether an envelope existed, a bounded
status enum, and action/option counts. Raw text, user content and IDs are excluded.
The opt-in smoke script prints this shape metadata and its temporary artifact
directory on failure; it never resets the real allowance or opens a microphone.

## Verification

`test/planner-contract.test.mjs` covers every decision branch, contradictions,
missing/extra fields, duplicate options, cardinality, unchanged state on rejected
completed turns, no inference retry, provider cleanup/accounting, a saved workflow
question, ordinary clarification and incomplete streams. Existing provider research
and lifecycle fixtures now use the envelope as well. Tests are deterministic and
do not establish model behavior or production latency.

The original live failure is preserved in [workflow verification](WORKFLOWS.md).
Budget approval is still needed before another paid planning reservation.
