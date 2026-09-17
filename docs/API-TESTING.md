# API test authorization and evidence

Owner approved **$25 total for this round of testing**, not $25 per run.
Credentials stay in ignored `.env`. Never print the key or full authenticated errors.

## Current accounting correction (2026-09-17)

The owner reported about **$2** in the API dashboard while the app had allocated
**$24.97001**. The discrepancy was principally 47 completed agent requests that
each retained a $0.50 reservation ($23.50 total). Those were not billed costs.
With owner approval, an append-only reconciliation checkpoint uses the reported
$2 for covered completed runs. All original records remain; the two unconfirmed
handshake holds still add $0.50. The $25 limit is unchanged. This is a user-reported
baseline, not an independently verified bill or account balance.

New completed, cleaned-up GPT-5.4-mini turns use recorded token usage plus observed
web-search calls. Usage is read from the terminal event or its nested turn; when
missing, one bounded turn retrieval happens before deletion, outside the response
critical path. At standard rates checked September 17, input is estimated at
$0.75/M (conservatively without cache discount), output at $4.50/M, plus $0.01 per
observed web call. Unknown models, missing/invalid usage and incomplete cleanup
retain their full reservation. Estimates can exceed their initial reservation.
No old usage is invented or retroactively inferred from an average request.

Reconciliation is an explicit operator action through `ApiBudget.reconcile`, not
a public endpoint or automatic reset. It rejects pending requests, preserves
unresolved holds and records the report/evidence and covered run IDs. Both runtime
and handshake diagnostics use the shared allocation calculation. Full history
and checkpoints remain in the ignored local ledger, never Git.

Official guidance distinguishes best-effort usage from final billing:
[Agents usage](https://developers.openai.com/api/docs/guides/agents-api/observability),
[model rates](https://developers.openai.com/api/docs/models/gpt-5.4-mini),
[tool rates](https://developers.openai.com/api/docs/pricing).
The provider dashboard remains authoritative; the app's limiter is not a
provider-side hard cap. Other model prices require explicit rate-card support.

The following startup notes are historical, not current capability status.

Initial read-only checks succeeded: GET model `gpt-live-1` and GET Agents API
session listing both returned HTTP 200. This verifies model visibility and session
read access, not end-to-end conversation or agent inference.

## Latest result: Live startup verified (2026-09-15)

After the owner reported adding $25 in API credits, one manually reviewed retry
received `session.started`, requested immediate closure, and received
`session.closed` with reason `close_requested` and `usage.seconds: 0`. The process
exited successfully. This test's estimated Live charge is $0; it does not establish
the account's total charges. No paid session was left running.

The billing blocker is cleared for Live startup. Microphone capture, spoken
responses, tool delegation, and Agents inference remain untested. Next is a bounded
end-to-end voice/tool test, not an always-on listening session. The $25 total test
cap is unchanged; earlier unresolved reservations remain in the ledger.

## Earlier billing blocker (2026-09-15)

Two bounded startup attempts ended without `session.started` or final usage. A
separate WebSocket-only handshake succeeded, but the reviewed second startup
returned `credit_balance_exhausted`: the API account had no credits remaining.
Both diagnostic processes exited without confirming a successful Live session.
No microphone or camera input was sent.

The owner subsequently added API credits through
[OpenAI Platform billing](https://platform.openai.com/settings/organization/billing/)
and authorized resuming testing. Authorizing our $25 testing cap does not itself fund that account.
Unfinalized allowances remain reserved, not recorded as actual billed spend; check
Platform billing to reconcile them. Do not automatically retry this billing error.

The explicit command `node scripts/check-live.mjs --paid-test` opens one silent
GPT-Live-1 WebSocket session with client delegation and immediately requests close.
No microphone, camera, user files, or backend inference are sent. Reconnect/retry is
disabled. A 30-second watchdog terminates the transport on failure; only a received
`session.closed` confirms final usage. Missing finalization blocks further tests.
An explicit `--reviewed-retry` permits a manually reviewed diagnostic retry while
retaining every unresolved reservation in the budget calculation. It does not
resolve missing usage or bypass the total allowance.

The ignored `data/api-test-budget.json` records the authorization and per-run usage.
The test reserves $0.25 before connecting and estimates finalized Live usage at
$0.05/minute. This local ledger is not an OpenAI project billing hard limit. Only
this test command consults it; future inference adapters must join the same budget
accounting before use. Do not reset the ledger or overwrite unresolved charges.
OpenAI billing is authoritative; pricing estimates exclude unrelated account activity.

SDK dependencies are pinned by package-lock.json. The Mac companion now has explicit
loopback-only paid Start/End controls; see [VOICE.md](VOICE.md). Adding the key alone
still starts no session. Its $0.50 reservations share this ledger, retaining unresolved
diagnostic allowances. New startup in the companion is a deliberate user action,
not an automatic diagnostic retry. Agents inference remains unimplemented.

Sources checked for this test:
- https://developers.openai.com/api/docs/guides/voice-websockets?api=live
- https://developers.openai.com/api/docs/models/gpt-live-1
- https://developers.openai.com/api/docs/guides/agents-api/quickstart
