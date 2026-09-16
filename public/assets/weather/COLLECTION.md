# Weather artwork collection

Generated with the built-in imagegen tool, using `cloud-volume-v1.png` as a style reference. Original generated PNGs are copied unmodified; alpha is preserved. No runtime image generation or API key.

Use: hero on black, miniature artwork on dark-blue backplates within the light forecast strip, daily artwork directly on black. Crescent denotes clear night, not a measured lunar phase. Only hero motion; no animated tiny icons. Cloud codes do not imply sun or moon.

Rain refinement: `rain-volume-v1.png` is retained as the original generated study,
not used in the current UI. Rain uses the unchanged `cloud-volume-v1.png` plus
separate CSS streaks: four faint staggered falling strokes in the hero, three short
static marks at forecast sizes. Reduced-motion keeps the marks visible and still.

Preview all artwork against both surfaces at `http://localhost:8781/art` with `node scripts/preview-weather.mjs`.

## Exact prompts and assets

All six new PNGs are 1254×1254 RGBA with verified zero-alpha empty pixels and
partial-alpha boundaries (0–254 or 0–255 range). Files range from 0.9–1.9 MB.
Each decoded original is about 6 MiB; the full seven-state set is about 42 MiB
before browser overhead. Repeated conditions share asset URLs. No canvas or
shader processing is used. Further resolution variants can be added if device
profiling calls for a smaller texture budget.

### sun

Asset: [sun-volume-v1.png](sun-volume-v1.png)

```text
Use case: stylized-concept
Asset type: single transparent PNG weather illustration for a smart mirror, part of a cohesive atmospheric collection.
Input image 1: style reference only, the existing luminous volumetric cloud. Match its elegant dimensional realism, ivory highlights, cool silver-blue shadows and soft natural detail; not plastic, not flat vector.
Composition: ONE centered weather symbol, square canvas, subject occupies 80% of canvas, entirely visible with modest padding. Bold forms readable at 80px as well as 260px. True transparent alpha in ALL empty space and feathered boundaries. No backdrop, black rectangle, checkerboard, floor, frame, words, logo, watermark, extra objects or external haze halo.
Primary request: A clear-weather sun: a luminous warm golden solar orb with subtly textured surface and short soft radial solar rays, compact elegant silhouette. Pale gold center, amber edge, restrained corona; no clouds. Not a face or emoji.
```

### moon

Asset: [moon-volume-v1.png](moon-volume-v1.png)

```text
Use case: stylized-concept
Asset type: single transparent PNG weather illustration for a smart mirror, part of a cohesive atmospheric collection.
Input image 1: style reference only, the existing luminous volumetric cloud. Match its elegant dimensional realism, ivory highlights, cool silver-blue shadows and soft natural detail; not plastic, not flat vector.
Composition: ONE centered weather symbol, square canvas, subject occupies 80% of canvas, entirely visible with modest padding. Bold forms readable at 80px as well as 260px. True transparent alpha in ALL empty space and feathered boundaries. No backdrop, black rectangle, checkerboard, floor, frame, words, logo, watermark, extra objects or external haze halo.
Primary request: A clear-night crescent moon: ivory-silver illuminated crescent with delicate lunar craters, cool blue shaded edge, dark part of disk absent/transparent, tips visible. No clouds, stars or external glow. A stylized weather symbol, not an astronomically measured phase.
```

### rain

Asset: [rain-volume-v1.png](rain-volume-v1.png)

```text
Use case: stylized-concept
Asset type: single transparent PNG weather illustration for a smart mirror, part of a cohesive atmospheric collection.
Input image 1: style reference only, the existing luminous volumetric cloud. Match its elegant dimensional realism, ivory highlights, cool silver-blue shadows and soft natural detail; not plastic, not flat vector.
Composition: ONE centered weather symbol, square canvas, subject occupies 80% of canvas, entirely visible with modest padding. Bold forms readable at 80px as well as 260px. True transparent alpha in ALL empty space and feathered boundaries. No backdrop, black rectangle, checkerboard, floor, frame, words, logo, watermark, extra objects or external haze halo.
Primary request: A rain cloud: broad billowing ivory and slate-blue atmospheric cloud with exactly five large distinctly separated luminous blue raindrops falling below. Precipitation occupies bottom third, crisp legible droplet shapes. No sun or lightning.
```

### storm

Asset: [storm-volume-v1.png](storm-volume-v1.png)

```text
Use case: stylized-concept
Asset type: single transparent PNG weather illustration for a smart mirror, part of a cohesive atmospheric collection.
Input image 1: style reference only, the existing luminous volumetric cloud. Match its elegant dimensional realism, ivory highlights, cool silver-blue shadows and soft natural detail; not plastic, not flat vector.
Composition: ONE centered weather symbol, square canvas, subject occupies 80% of canvas, entirely visible with modest padding. Bold forms readable at 80px as well as 260px. True transparent alpha in ALL empty space and feathered boundaries. No backdrop, black rectangle, checkerboard, floor, frame, words, logo, watermark, extra objects or external haze halo.
Primary request: A thunderstorm: moody slate-blue volumetric cloud, bright silver rim, with one bold jagged warm ivory-gold lightning bolt below. Entire bolt visible, strong readable silhouette, no sun or rain clutter.
```

### snow

Asset: [snow-volume-v1.png](snow-volume-v1.png)

```text
Use case: stylized-concept
Asset type: single transparent PNG weather illustration for a smart mirror, part of a cohesive atmospheric collection.
Input image 1: style reference only, the existing luminous volumetric cloud. Match its elegant dimensional realism, ivory highlights, cool silver-blue shadows and soft natural detail; not plastic, not flat vector.
Composition: ONE centered weather symbol, square canvas, subject occupies 80% of canvas, entirely visible with modest padding. Bold forms readable at 80px as well as 260px. True transparent alpha in ALL empty space and feathered boundaries. No backdrop, black rectangle, checkerboard, floor, frame, words, logo, watermark, extra objects or external haze halo.
Primary request: A snow cloud: softly billowing pearly ivory atmospheric cloud with three large separated crystalline snowflakes beneath, simple sixfold forms legible when small, cool ice-blue highlights. No rain.
```

### fog

Asset: [fog-volume-v1.png](fog-volume-v1.png)

```text
Use case: stylized-concept
Asset type: single transparent PNG weather illustration for a smart mirror, part of a cohesive atmospheric collection.
Input image 1: style reference only, the existing luminous volumetric cloud. Match its elegant dimensional realism, ivory highlights, cool silver-blue shadows and soft natural detail; not plastic, not flat vector.
Composition: ONE centered weather symbol, square canvas, subject occupies 80% of canvas, entirely visible with modest padding. Bold forms readable at 80px as well as 260px. True transparent alpha in ALL empty space and feathered boundaries. No backdrop, black rectangle, checkerboard, floor, frame, words, logo, watermark, extra objects or external haze halo.
Primary request: Fog: three softly layered horizontal banks of silver-blue mist, low wide flattened silhouette, luminous ivory ridges with translucent wispy gaps. Not a puffy cumulus cloud; horizontal stratified shape immediately distinct. No sun, rain or text.
```
