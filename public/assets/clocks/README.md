# Clock material assets

`tourbillon-bezel-v1.png` was generated with the built-in image-generation tool,
then copied unchanged into this repository. It is a 1254 × 1254 RGBA PNG.
It supplies only the static bezel; live SVG draws the dial, hands and mechanism.
Image generation produces a raster asset, not editable vector geometry.

## Generation prompt

Use case: product-mockup. Asset type: transparent PNG material component for a live
animated luxury tourbillon clock UI. Generate ONE isolated precision-machined
circular watch bezel, perfectly front-on orthographic view, centered in a square
canvas. Ring occupies 94% of canvas width, inner hole diameter 85% of canvas width,
so the metal ring is narrow. Genuinely transparent alpha outside AND through the
entire large central hole. No dial inside. Champagne platinum / pale warm gold,
exquisitely realistic brushed radial metal grain, stepped concentric bevels, thin
polished silver inner lip, darker recessed channel, bright controlled upper-left
studio highlights and lower-right shaded edges. Three-dimensional thickness
conveyed by bevel shading, but geometrically perfectly circular, not tilted.
Premium macro product photography quality. This ring will frame software-drawn
clock hands and gears. No numbers, tick marks, letters, text, logos, crown, strap,
watch body, glass, gear wheels, background, floor or drop shadow outside the ring.
Output a true transparent cutout, not a checkerboard image.

The generated ring is wider than requested; the live mechanism is inset to fit
its actual opening rather than painting over the metal. The bezel has a fixed
warm-metal finish while the live accents continue to follow the selected palette.

## Folio paper

`folio-paper-v1.png` is a 1254 × 1254 paper texture generated with the built-in
image-generation tool and copied unchanged into the repository. The renderer
places it beneath the vector engraving at 82% opacity over an ivory fallback.
No text, hands or mechanism are baked into it; it is static and locally served.

### Generation prompt

Use case: photorealistic-natural. Asset type: square opaque paper texture background
for a live SVG antique clock engraving. Primary request: blank warm ivory antique
laid rag paper, scanned straight-on, filling the entire image edge to edge. Fine
organic cotton fibers, very gentle cloudy tonal variation, subtle shallow paper
tooth and delicate laid-paper lines, a tactile but quiet surface like a clean
eighteenth-century engineering plate. Color palette: pale neutral ivory around
#e9e5d3, slightly warmer tiny fibers; restrained low contrast. Lighting: flat, even
archival scanner lighting, no directional shadows. Composition: only the material,
uniformly detailed across the full square, no visible sheet edge or objects.
Constraints: absolutely NO text, numbers, ink, drawing, border, folds, tears,
stains, foxing spots, vignette, burned edges, watermark or transparent area.
Not crumpled parchment, not fabric. Texture should be visible at normal UI scale
but subtle enough for thin black engraved linework to remain legible.
