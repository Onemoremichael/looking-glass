# Clock studio

Open `/clocks` from the companion's **Clock studio** link. The mirror remains
output-only. Seven SVG clock faces require no network fonts, graphics packages,
or newer Android browser APIs. Tourbillon includes one local generated alpha PNG
bezel; all hands, numerals and moving mechanism parts remain vector-rendered.

- **Orbit**: subtly heavier hour ring, finer minute ring, 60 second dots and
  orbiting markers. Turning seconds off hides the dots and current-second marker.
- **Atelier**: serif numerals, fine indices and watch-style hands.
- **Meridian**: bold cardinal numerals and geometric, high-contrast hands.
- **Tourbillon**: open-work Roman dial, skeletonized lance hands, machined bridges,
  a compound gear train and a one-minute flying cage with a breathing hairspring,
  oscillating balance and stepped escapement. A coherent illustrative kinematic
  model, not an engineering-ready caliber or physical contact-force simulation.
- **Monolith**: oversized stacked hour/minute typography.
- **Ribbon**: minimal digital time and a minute-progress horizon.
- **Split**: paired outlined departure-board tiles.

Split changes use a 680 ms two-stage hinged flap with clipped old/new numeral
halves and a moving shadow. Only changed hour/minute tiles animate; seconds stay
quiet. The shared requestAnimationFrame player survives ordinary clock ticks,
skips stale catch-up transitions after suspension, and respects reduced motion.
SVG transforms avoid CSS 3D/Web Animations dependencies on the old mirror browser.
**Preview flip · here only** rehearses the transition in Clock Studio without
changing the mirror's time, saved settings or any other surface.

Drag the preview (mouse or touch), use arrow keys (Shift for larger steps), position
sliders, or presets. Scale ranges from 25–100% of the display's shorter dimension.
Across/down values express travel within remaining available space, so the design
stays inside the viewport at every scale. Position and scale follow portrait or
landscape resizing. The preview represents only the active screen, roughly the
upper two thirds of the physical mirror—not its reflective-only lower portion.

Choose jade, amber, ice or rose accents; independently toggle day of week, date,
seconds and 12/24-hour digital
time. `Show clock on mirror` opens home; active timers still take precedence. The
full composition appears on home/time only without timer cards or an assistant
question/answer. Other panels retain their existing compact clock. Background
work and native voice indicators remain independent.

## Persistence and compatibility

`clockDesign` lives in the existing local session file. `set_clock` validates an
exact finite schema, persists atomically and broadcasts through the normal stream.
Changing a clock design preserves pending assistant clarification. Old session
files receive default settings; invalid saved clock settings fall back to defaults.
Legacy settings gain `day` from their old combined `date` toggle, preserving hidden
details and the existing style, placement and scale.
Companion edits are debounced and serialized; intermediate drag changes coalesce.
Failed saves are visibly reported and retry on the next edit.

The shared `public/clock-art.cjs` renderer uses ES5-style JavaScript and basic SVG.
The native wrapper needs no APK update. Existing mirror URL `timeZone` overrides
apply to every clock face; the companion preview follows the companion's local
time zone. Rendering is time-based, not an incrementing counter. Black unpainted
space preserves the reflection; this does not switch LCD backlight pixels off.
There are no clock-edit voice tools yet; customization is through the companion.

## Calendar treatments

Both day and date can be shown, either alone, or neither, on all seven faces.
Orbit uses seven Monday-first weekday satellites (today illuminated) and a serif
month/day caption. Atelier has a watch-style day/date window. Meridian pairs an
accent weekday badge with a bold date. Monolith has a two-tier typographic colophon.
Ribbon adds a restrained calendar horizon. Split uses separate miniature split-flap
tiles for weekday, month and day number. The Date toggle controls the month/day
pair; the remaining tiles recenter when the weekday or date is hidden.
Tourbillon frames a serif calendar inscription with fine rules and a diamond divider.
All use the clock's time zone, accent and scale; these are decorative companions,
not touch targets. No new browser APIs are required.

## Tourbillon movement

The mechanism is inspired by [Breguet's explanation of tourbillon principles](https://www.breguet.com/en/magazine-quai-de-l-horloge/272465/principles-tourbillon)
and [IWC's description of the flying tourbillon](https://www.iwc.com/ww-en/journal/the-flying-tourbillon-where-time-flies).
These establish the rotating regulator assembly, fixed wheel/escape-pinion
relationship, anchored outer hairspring, and lower-supported flying construction.
The tooth counts and layout below are our own illustrative design, not a replica.

- A 96-tooth barrel wheel drives a 12-leaf pinion on the center shaft. That
  shaft's 60-tooth wheel drives the third shaft's 8-leaf pinion; its 80-tooth
  wheel drives the cage's 10-leaf pinion. Pitch radii and center distances agree
  at each mesh, including the separate modules on compound shafts.
- The cage turns once per minute, third wheel once per eight minutes in the
  opposite direction, center wheel once per hour, and barrel once per eight
  hours. All derive from one timebase, not unrelated animation speeds.
- An 80-tooth fixed wheel beneath the cage engages an orbiting 8-leaf escape
  pinion. The escape wheel makes ten turns relative to each cage revolution.
  Its 15 teeth release half a tooth per beat: five beats per second / 18,000 bph.
  Each short advance has a locked dwell; the train advances from the same beat.
- The balance swings at 2.5 Hz, approximately ±235 degrees. The pallet fork
  alternates near the balance's center crossing. The hairspring's inner end
  follows the balance while its outer stud stays fixed **relative to the cage**.
  The spring deformation is a bounded visual approximation, not elastic physics.
- The balance, fork and escape wheel travel inside the cage. Its bearing fingers
  travel too; no stationary upper bridge spans the flying cage.
- Fixed bridge mounting posts are outside every swept gear/cage envelope.
  Raised posts, side faces and offset shadows distinguish bridge height from
  wheel planes. Ruby jewels at axle centers are bearings, not mounting bolts.
  Gear spokes can pass underneath a raised bridge without striking a fixed post.
- Cutaway barrel spring, perlage, beveled rims, balance screws, inset jewels and
  layered steel fingers provide depth. The barrel spring is static at this scale;
  winding, torque, backlash, tooth-contact forces and power reserve are not simulated.

## Verification

Tourbillon's lightweight player updates eight mechanism transforms and one short
hairspring path, capped at approximately 30 fps; the SVG dial is rebuilt only when the minute or design changes. Hidden
surfaces stop the animation. Turning Seconds off or enabling reduced motion keeps
the mechanism still. The photoreal bezel is a static local asset; movement does not
call a model. Metal gradients, recessed plates, offset shadows and ruby bearings
provide depth without expensive blur filters. Gradient IDs are unique per SVG.

Fifteen clock-specific tests cover all seven renderers, split-flap transitions/player lifecycle,
tourbillon motion/pause/reuse behavior, compound gear pitch and ratios,
escapement dwell/beat frequency, anchored spring endpoints and fixed-post clearance,
independent day/date combinations,
legacy migration, time zones/format/detail choices,
portrait and landscape edge placement, strict validation, migration/defaults,
persistence, preserving clarification, asset MIME types and HTTP origin checks.
Tourbillon was also rendered on the native Android mirror.
Browser checks exercised independent day/date controls,
style changes, scale, accent,
presets, drag positioning and opening the clock. Native Android screenshots verified
Monolith, Orbit and Tourbillon rendering. Human reflection and
across-room readability checks remain useful for choosing the preferred scale.
