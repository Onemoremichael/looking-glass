# Research experiences

Ask by voice to research a subject or compare choices. The Agents API has a
read-only live web-search tool, with no shell, host filesystem or external-write
tools. The existing planner still handles local tasks without needing a search.

## Outcome-first presentation

The agent chooses `briefing`, `agenda`, `comparison` or `steps`, then assembles up
to six sourced cards. The mirror and companion display the same two numbered
cards per page. Say **next page** or **previous page**. Large pastel surfaces add
contrast where dense reflections would obscure text; surrounding black preserves
the mirror. Links are clickable on the companion only. Android rendering is ES5
and plain CSS, with no browser microphone, modern build runtime or third-party UI.

`compose_research` is one atomic validated action. Its sources must correspond to
provider-reported opened web pages, or to an independently retrieved public text
page after actual provider search activity. Hosted search sometimes emits page
opening as `other`, so URL-less events alone are not accepted as evidence. The
fallback pins public IPv4 DNS, revalidates redirects, sends no credentials, caps
pages at 512 KiB, and has a ten-second deadline. Every card cites a known source
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

## Verification

September 16 check: a real, isolated animal-comparison research turn produced a
validated three-card board in 28.35 seconds. That run exposed a hyphenated-title
reuse mismatch; normalization was corrected and offline reuse then completed in
3 ms without calling the planner. The initial three-card page overflowed the
portrait hardware viewport, so pagination now uses two cards. Final two-card
physical-screen fit remains a visual verification item; bounded long text may
still need further layout tuning. These are research-board checks, not proof of
a completed children's game or general semantic reuse.

- `npm test`: contract, provenance, escaping, same-page presentation, atomicity,
  persisted recipe/cache separation, fresh reuse and stale refresh.
- `node scripts/check-research.mjs --run-paid`: one real research turn followed by
  a local cache reuse, isolated from live application state. Uses the existing
  approved allowance; no microphone. Writes ignored `data/research-smoke.json`
  only after a successful validated board. Failed provenance must not be bypassed.

The former typed Gators/request forms remain prototype configuration capture, not
the voice research path. Multi-turn durable work plans, code generation, games,
and image generation are separate pending passes, not implied by this feature.
