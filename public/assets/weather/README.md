# Volumetric cloud v1

Generated September 16, 2026 with the built-in imagegen tool (not the API/CLI).
Used for cloudy conditions in the hero, hourly strip and daily rows. The expanded
[seven-state collection and exact prompts](COLLECTION.md) provides separate sun,
moon, rain, storm, snow and fog artwork. Hourly images use dark-blue contrast
backplates; daily images float on black. No sun/moon is invented for cloudy conditions.

`cloud-volume-v1.png`: original 1536×1024 RGBA PNG, about 1.4 MB. Copied without
flattening, recoloring or removing its generated alpha. Pixel inspection confirmed
962,945 fully transparent pixels and 609,919 partially transparent pixels; alpha
range 0–254. No opaque rectangular background. One decoded image is approximately
6 MiB; no canvas, video or shader processing is used on Android.

## Final generation prompt

Use case: stylized-concept
Asset type: transparent PNG weather hero for a real smart mirror, displayed about 260 CSS pixels wide on pure black.
Primary request: ONE beautiful sculptural cloud, floating in empty transparent space. A luminous miniature of real atmospheric vapor, volumetric and dimensional, not a flat icon or plastic toy. Soft billowing asymmetric lobes, a broad natural base made of vapor rather than a straight line, pearly ivory highlights above and sophisticated cool silver-blue shadow depth beneath. Enough bold large-scale form to read from across a room, with fine wispy feathered alpha edges. Elegant, quietly magical, like a tiny piece of sky suspended on the mirror.
Composition: single centered cloud, landscape silhouette roughly 1.5:1, fits entirely inside a square canvas with modest transparent padding; no cropping.
Lighting: softly illuminated from upper left, bright readable body, delicately luminous edges, restrained shading. No external glow halo.
Background: genuinely transparent alpha channel, including all empty space and gradual wispy boundary transparency. This will be composited on black and over a user's physical reflection.
Constraints: cloud only, no sun, moon, stars, precipitation, text, UI, logos, border, checkerboard, ground plane, drop shadow, backdrop, or rectangular haze. Not a screenshot, not a weather card, not flat vector art.
