# Mirror display constraints

**For current UX planning: the screen occupies roughly the top two-thirds of the
upright mirror. The bottom third is reflection-only.** Position the assistant's
visible experience in that upper region; do not design as if the whole glass were
a display. This owner-provided approximation is sufficient for now, without exact
measurements or hard-coded CSS proportions.

The physical mirror is larger than its screen. The owner's September 15, 2026
photo (`IMG_9720.jpg`) shows the illuminated LCD as an inset rectangle surrounded
by reflective-only glass, with more glass beyond one end. The surrounding glass
cannot display UI.

Design rules:

- Treat the app viewport as the active LCD only, not the whole mirror surface.
- Fullscreen fills that LCD. Do not duplicate the physical glass margins as CSS
  padding, or assume UI can extend outside the viewport.
- Centering on the screen is not necessarily centering on the full mirror.
- Keep a black background and restrained elements to preserve the reflection.
- Let changed content confirm routine actions. Do not show persistent Done cards,
  internal intent headings, or duplicate success narration above the result.
  Questions/options, substantive answers and relevant limitations remain visible.
- Keep content legible at standing distance and within the active rectangle.
- This is output-only: no touch controls or text entry. Use companion/voice input.
- The rotated Android content in the reference photo does not define the desired
  orientation. Portrait/landscape choice is separate from physical panel coverage.
- Exact physical dimensions/offsets remain unmeasured. Do not hard-code proportions
  from an angled photo. A future device profile can store measured glass dimensions,
  screen dimensions, and screen offsets for accurate previews.

Hardware reference: [mirror-mirror display geometry](https://github.com/Onemoremichael/mirror-mirror/blob/main/DISPLAY-GEOMETRY.md)
(local sibling file: `../mirror-mirror/DISPLAY-GEOMETRY.md` from the repo root).
The photo itself is not copied into either repository.
