# Durable by default

Product policy: any successfully assembled, supported experience becomes reusable
automatically. The assistant should inspect the repertoire, reuse a suitable view,
or adapt it into a separate variant. No “keep this?” conversation is necessary.

`reusable-views.mjs` implements domain-neutral retention. `state.reusableViews`
stores ID, version, kind, binding scope, validated spec, optional parent ID, and
creation time. Object-key order does not create duplicates. The library caps at
64 entries; it never silently deletes older work to admit a new view. A full library
does not prevent displaying a result, but the response must disclose that it was
not saved. Retention and display-state changes are one atomic persistence operation.

This is a repertoire of configurations, not recordings of facts, audio, credentials,
generated executable code or action sequences. A saved timer-related layout must
not replay “start a timer.” New external writes still require their own authorization.
Simple built-in navigation and existing guarded quick-action learning remain separate.

## Adapter contract

Each implemented domain needs trusted application code to:

1. Validate a bounded spec and bind its inputs/resources.
2. Determine whether assembly produced a usable result before retention.
3. Refresh data and resolve relative inputs on reuse.
4. Render the spec using supported components and report display state separately.
5. Expose a safe open/reuse action to the planner and companion.

Weather is the first production adapter. Other domains are an architectural
extension point, not a claim that calendar, sports research, or arbitrary generated
apps are implemented. A test-only agenda adapter verifies the library isn't tied to
weather. Weather's compatibility `weatherViews` index preserves the current UI;
legacy IDs migrate unchanged. New weather variants preserve their active parent's
ID; exact duplicates reuse the same entry. Reopening by a unique saved title is
local; nuanced requests still use planning to choose or adapt a layout.

## Weather behavior

Populated, validated compositions save on commit without waiting for speech or
approval. Render acknowledgment is still required before claiming the view is
visible; storage success and screen visibility are distinct. Empty/no-data attempts
are not promoted. Forecast snapshots are never stored in reusable specs. Relative
dates and current units resolve again on open; fixed dates stay fixed.

Old save invitations are retired on load. “Save it” is idempotent and local for a
displayed composition, including a layout created before this policy change.
The model is told not to ask about saving and not to promise measured speedups.

Tests cover duplicate keys, another domain's adapter, unsupported specs, parent
lineage, atomic rollback, capacity, migration, cancellation, restart and local reuse.
