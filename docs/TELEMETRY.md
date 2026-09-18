# Voice observability and deterministic tests

The owner confirmed the first human timer voice test worked on September 15, 2026.
That session predates instrumentation: no trace or transcript can be reconstructed.
Subsequent sessions are instrumented; the original recording cannot be recovered.

## Available now

- [Local trace viewer](http://localhost:8780/diagnostics), linked from the companion.
  Refresh during/after a conversation. GET `/api/telemetry` is Mac-loopback-only.
- `npm run traces` reads recent disk records without starting a session or exporting
  data. It prints metadata only, not transcripts. I can use it to inspect later tests.
- Actual OpenTelemetry trace/span IDs and parent-child relationships:
  `voice.session` → `voice.startup`, `voice.delegation` → `agent.decision`, `voice.close`.
  `agent.planning` and `agent.cleanup` are children of `agent.decision`; background
  cleanup can outlive the decision span. Shutdown drains cleanup before export stops.
  The legacy grammar path uses `voice.tool` instead of `agent.decision`.
  Explicit context propagation across WebSocket callbacks; no auto-instrumentation.
- Phase transitions, duplicate events, readiness, watchdog reason, tool status and
  action category, state revision/timer count, final usage and estimated cost.
- Recent-window counts, failures, p50/p95 span durations in the local viewer.
  These summaries are derived from traces, not a separate OTel Metrics exporter.
- `waiting.acknowledgment` records sending the one-shot slow-request cue. It confirms
  a sideband send, not audible playback or exact wording.

New `agent.decision` spans measure queue wait, planning and local commit. Successful
cloud-session cleanup is excluded and measured separately by `agent.cleanup`;
failed/interrupted decisions still wait for cleanup. `agent.planning` includes API
session creation, stream completion and schema validation, not just model inference.
Older decision spans included cleanup: do not interpret mixed-window p50/p95 as a
controlled before/after benchmark. Compare stage spans from fresh conversations.
No raw proposed JSON or app-state payload is attached to telemetry spans.

Startup measures server session creation plus sideband attachment, not when the mic
starts. `voice.timer_fast` measures local timer validation/commit, with
`quiet_window_ms: 700` and `since_last_fragment_ms` at execution. It is parented to
the delegation when one exists, otherwise directly to the voice session; expect no
`agent.planning` for a matched request. `timer.delegation_reconciled` marks a late
handoff resolved without repeating the action. Confirmation/context transport failures
are recorded separately from an already successful commit. No audio/transcript content
is added to these metadata spans.

`timer.fast_fallback` records one bounded `fallback_reason` when a timer-like request
dispatches to the fallback: unsupported wording, unrecognized/missing duration,
uncertain language, pending clarification, state change, commit failure or a disabled
accelerator. It does not log every incomplete fragment or add raw utterances to
metadata. `npm run traces` and the telemetry snapshot include `timerFallbacks` counts
over the retained 1000-record window. This measures why the shortcut was missed,
not whether the fallback ultimately understood the request.

Fallback tool duration excludes the deliberate 900 ms quiet window; the delegation
span includes it. `since_last_fragment_ms` measures server receipt-to-action, not
true speech-end latency. `playback.detected` is the first subsequent client-reported
audio signal, sampled about once a second; it may be unrelated continuing speech,
not proof the user heard the result. No fabricated precise speech-to-audio metric.

## Transcript choice and retention

Owner approved **local text transcript logs** for development. The local `.env` now
sets `TELEMETRY_TRANSCRIPTS=1`; example config defaults off. Set it to `0` and restart
to stop new transcript logging. This does not delete existing logs. No raw audio files.

User/assistant transcript fragments carry the local trace ID and arrival timestamp.
Fragments may be unfinished, inaccurate, or out of semantic turn order. No prompt,
SDP, provider IDs, control tokens, headers, timer labels or arbitrary exception text
is attached to spans. Obvious key/Bearer patterns in transcript text are redacted;
this is not general PII detection, so transcripts still contain private conversation.

Logs: ignored `data/telemetry/events.jsonl`, mode 0600, about 2 MiB then rotated to
`events.jsonl.previous`. The next rotation overwrites that oldest segment. Total is
about 4 MiB plus one record. Memory retains 1000 records; the viewer shows 200.
On restart only the current bounded file is loaded. There is no date-based expiry.
Copy a segment elsewhere if a particular investigation must survive rotation.
Log write failures are counted and do not throw into the voice interaction.

## Optional Langfuse / OTLP export

External export is **off**. No Langfuse account was created, keys entered or data sent.
Choose a project/region (cloud or your self-hosted instance), then set locally:

```dotenv
OTEL_EXPORT_ENABLED=1
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=your-project-public-key
LANGFUSE_SECRET_KEY=your-project-secret-key
```

Restart the server. Direct OTel export uses OTLP/HTTP protobuf, Basic auth and
`x-langfuse-ingestion-version: 4` at `/api/public/otel/v1/traces`. Both keys and an
explicit base URL are required. Or leave Langfuse variables empty and configure
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` plus optional `OTEL_EXPORTER_OTLP_TRACES_HEADERS`
for a generic backend. HTTPS required except loopback HTTP. No browser SDK or keys.

**Only allowlisted metadata is exported. Local transcript records never enter OTel
spans or export queues, even when transcript logging is enabled.** Export contains
timestamps, random local trace IDs, action categories and performance/usage metadata.
External export failures are counted; bounded queues/timeouts do not block local tools.
Cloud end-to-end ingestion remains unverified until a project is configured.

Research diagnostics include `planner_stage` (provider/contract/source_fetch/
provenance), bounded failure codes and `research.source_checked` with check type
and count. Raw exceptions, source URLs and generated source content are excluded.
Background speech uses distinct `background.submitted`, `background.accepted`,
and `background.audio_started` events. Submission is not speech; non-silent generated
audio is not proof of physical audibility. The older `background.announced` event
is retained for historical trace reads only. Native provider command errors use
`live_command_rejected` without exporting their raw payload or error text.
Successful temporary local page commands emit `wake.shortcut` with the allowlisted
`research_page` action and committed revision. No PCM or standby transcripts are
retained. A keyword detection without a valid visible-page capability cannot commit.

Official references checked September 15, 2026:
- [Langfuse OTLP ingestion](https://langfuse.com/integrations/native/opentelemetry)
- [OpenTelemetry JavaScript exporters](https://opentelemetry.io/docs/languages/js/exporters/)

## Automated verification

`npm test` never uses the API, mic, camera or a cloud exporter. Tests cover:

- Complete grammar, ambiguous/compound/corrected requests, duplicate receipts and restart.
- Model-decision schemas, atomic batches, missing/stale surface reports, selected-target
  alias binding, cancellation, revision conflicts and mocked Agents stream cleanup.
- Virtual-clock quiet-window boundary, stop-before-execution, late events, heartbeat
  timeout, hangup fallback and missing/invalid final usage blocking.
- Actual SDK trace hierarchy and in-memory export; secrets excluded from metadata;
  transcript opt-in stays local; exporter opt-in and endpoint validation.
- Local log permissions, rotation/reload, disk failure isolation and metrics arithmetic.
- Existing persistence, HTTP origin controls and ES5-style output-client separation.

Run the same human timer loop after enabling tracing. Inspect outcomes and transcripts
together; add a deterministic fixture whenever a new failure is found. Synthetic test
traces use temporary directories and are not mixed with actual conversation logs.
