# Research experiences

Ask by voice to research a subject or compare choices. The Agents API has a
read-only live web-search tool, with no shell, host filesystem or external-write
tools. The existing planner still handles local tasks without needing a search.

## Outcome-first presentation

The agent chooses `briefing`, `agenda`, `comparison` or `steps`, then assembles up
to six sourced cards. Short boards show two numbered findings per page. Dense
boards show an overview (summary and limitations), then one finding per page.
The shared ES5 page planner keeps the mirror, companion, agent-visible card
numbers and navigation in agreement. Nothing is truncated to fit. Say **next page**
or **previous page**; finding pages retain a pointer back to the limitations.
Large pastel surfaces add
contrast where dense reflections would obscure text; surrounding black preserves
the mirror. Links are clickable on the companion only. Android rendering is ES5
and plain CSS, with no browser microphone, modern build runtime or third-party UI.

`compose_research` is one atomic validated action. Its sources must correspond to
provider-reported opened web pages, or to an independently retrieved public text
page after actual provider search activity. Hosted search sometimes emits page
opening as `other`, so URL-less events alone are not accepted as evidence. The
fallback pins public IPv4 DNS, revalidates redirects, sends no credentials, caps
downloads at a 512 KiB nonempty text prefix, and has a ten-second deadline. Larger
valid pages pass this reachability check; their remaining body is not downloaded.
Every card cites a known source
ID. This proves the source was opened, not that every sentence is true: relevance and faithful
summarization still require model evaluation. Private/local URLs and executable
markup are rejected or escaped. Web pages remain untrusted data, never instructions.
At most ten completed search/open calls and a 90-second total planning deadline
bound a research turn. Existing budget reservations and cleanup still apply; the
allowance is conservative accounting, not a provider billing hard limit.

## Reuse

The generic repertoire retains `{title, query, layout}` with `kind: research`.
Facts are separately cached in up to twelve timestamped boards. Fresh cached
results reopen without inference for fifteen minutes through **open/show [title]**;
**refresh/update [title]** always researches again. Old cache entries never qualify
for the fast route. A stale saved recipe is sent to the planner with current time.
Changing the query/layout creates a separate variation. Duplicate configurations
keep their ID. At library capacity the display still works but reports not saved.

Cache age is not a guarantee that a schedule or recommendation remains unchanged.
The UI shows when research was checked and retains limitations supplied by the
agent. The renderer does not invent data, dates, images or arbitrary HTML.
Broader semantic recognition beyond saved titles remains follow-up work.
Page navigation itself is local: “next page,” “show me the next page,” and “go back”
do not invoke the planner when a research board is active. Negated/compound commands
and pending clarifications do not use that shortcut. Mirror page hints now reflect
whether voice is listening, wake standby is armed, or voice must be started on the
companion; displayed text no longer implies a closed microphone is listening.
Armed local standby now grants a view-scoped temporary **next page / previous page**
keyword profile for a current, visible mirror page. These two phrases navigate
without Hey Mirror or a cloud session; only available directions are enabled.
The footer advertises direct speech only while that capability is valid. Other
phrasing still needs an active conversation. See [scope and limits](WAKE.md).

## Verification

September 17 failure investigation: a stadium-capacity query completed at the
provider, then failed locally because official athletics HTML exceeded the old
512 KiB rejection threshold. Bounded-prefix reading fixes that false failure
without raising the download limit or bypassing public-address, redirect, MIME
or HTTP-status checks. The same isolated paid query then produced a validated
three-card board in 26.4 seconds. This verifies pipeline completion, not factual
ranking accuracy, live mirror rendering or spoken success. Research remains
fallible and should not be treated as an independently fact-checked ranking.
All 316 offline tests pass, including large-page streaming cutoff, empty/error
responses, cleanup after source failure and private-error redaction.

Planning failures now expose bounded categories and stages in local diagnostics:
provider, contract, source fetch, and provenance. `research.source_checked` records
the check type and source count, never raw URLs or source content. The user-facing
source-access failure is distinct from a provider failure; no automatic paid retry.

September 16 check: a real, isolated animal-comparison research turn produced a
validated three-card board in 28.35 seconds. That run exposed a hyphenated-title
reuse mismatch; normalization was corrected and offline reuse then completed in
3 ms without calling the planner. The initial three-card page overflowed the
portrait hardware viewport, so initial pagination used two cards. A subsequent
physical Android check confirmed that short two-card result fits, but a fixture
at the schema's maximum prose lengths still overflowed. Content-aware pagination
now gives that fixture seven pages: overview plus six findings. Both its overview
and finding page were inspected at the physical 1080×1920 framebuffer with the
footer/source count visible. This verifies those portrait fixtures, not every
font, viewport or reflection/room-lighting condition. These are research-board checks, not proof of
a completed children's game or general semantic reuse.

Captured test-only framebuffers: [overview](evidence/portrait-research/overview.png)
and [finding](evidence/portrait-research/finding.png). These contain deliberately
repeated fixture prose, not user content or researched claims.

- `npm test`: contract, provenance, escaping, same-page presentation, atomicity,
  persisted recipe/cache separation, fresh reuse and stale refresh. Page tests
  cover all four layouts, dense/short boards, preservation of every card,
  summary and caveat, model context, navigation boundaries and script MIME/order.
- `node scripts/preview-display-qa.mjs research-long`: isolated, explicitly
  non-factual maximum-length fixture on port 8784. No provider calls, microphone
  capture or production-state changes. Stop it after inspection; restore the
  Android wrapper's production URL if using the hardware display.
- `node scripts/check-research.mjs --run-paid`: one real research turn followed by
  a local cache reuse, isolated from live application state. Uses the existing
  approved allowance; no microphone. Writes ignored `data/research-smoke.json`
  only after a successful validated board. Failed provenance must not be bypassed.

The former typed Gators/request forms remain prototype configuration capture, not
the voice research path. Multi-turn durable work plans, code generation, games,
and image generation are separate pending passes, not implied by this feature.
