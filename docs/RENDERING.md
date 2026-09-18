# Rendering continuity

The screen is part of a physical mirror. Routine state updates must not look like
page navigation. Preserve the visual object; update the facts inside it. Do not
hide full redraws behind fades, loading overlays, or repeated entrance animations.

## What caused the reset

The original clock player replaced its entire SVG every minute for Tourbillon and
Folio, and every 500 ms for the other faces. This discarded decoded image elements
and reset mechanical transforms. Split replaced the whole dial on each flip frame.
Separately, every server state snapshot replaced all panel HTML on both surfaces;
weather also replaced its markup every minute. Those operations restarted rain,
artwork and progress animations, and could discard companion input drafts.

## Shared contract

- `public/dom-patch.cjs` reconciles trusted, escaped renderer output in place using
  ES5 and ordinary DOM APIs. Load `/dom-patch.js` before display, remote or clock code.
  It is **not** an HTML sanitizer or permission to render raw model-generated HTML.
- Identical markup does nothing. Changed text/attributes update only when needed.
  Retained images keep their `src`/`href`, SVG namespaces, and decoded elements.
  No whole-panel transitions are added; actual panel changes remain immediate.
- Use unique `data-render-key` values on repeated, stateful siblings, especially
  those that reorder. Timers are keyed by ID across panels; to-dos and saved places
  retain identity too. Root content is scoped to its panel so unrelated forms do
  not inherit drafts. DOM IDs and existing control identities supply other keys.
- Local input values, checked/selected state, textarea drafts and open disclosures
  survive ordinary server updates. Explicit form actions own clearing/resetting
  them. Countdown children belong to the local clock, not to empty HTML placeholders.
- Display, companion panels, navigation and weather refreshes use the same patcher.
  Thus research, artwork, workflows, custom-function outputs and playroom views
  also retain unchanged nodes rather than replaying their presentation on every event.
- Even when the HTML is unchanged, the latest revision is still acknowledged to
  the server. Reconnects apply the latest snapshot without clearing the last good
  view; the connection warning remains explicit while offline.

## Clock lifecycle

Each mounted clock has stable SVG material IDs and at most one animation loop.
Moving/scaling the container does not change the artwork's lifetime. Mechanical
parts are animation-owned: reconciling calendar/time labels must not overwrite
their phase. Each regular tick re-anchors animation time so suspension and clock
changes do not accumulate drift. Hidden surfaces pause, reduced-motion users get
static/stepped time updates, and stale split-flap catch-up sequences are skipped.

Clock Studio thumbnails are static. Only visual configuration changes redraw their
attributes; position/scale edits and unrelated state updates do not regenerate them.
Use `GlassClock.mount` for live clocks and `scene` for initial/static markup, not a
repeated assignment of `scene()` to a live element's `innerHTML`.

## Verification and limits

`test/render-stability.test.mjs` uses a development-only DOM implementation to assert
element identity, not just matching HTML strings. Coverage includes all eight clock
styles, minute/midnight rollover, geometry edits, mechanism phase, suspension/resume,
reduced motion, split animation, nested rendering caches, weather/rain during state
and freshness updates, reconnect snapshots, timer IDs, input drafts and disclosures.
Existing clock and display behavior tests remain in place. No paid model calls.

Browser checks verified a timer draft survives another state update and the live
Tourbillon retains its material IDs across multiple minute boundaries. The Android
mirror was reloaded and its clock render checked with no reported JavaScript errors.
DOM tests cannot prove GPU frame pacing on every device; an extended physical
viewing check is still useful. A deliberate reload, true new image load, or native
WebView recovery after a failed connection can still visibly change the screen.
This change removes routine destructive rendering, not those genuine transitions.
