---
id: 97
slug: parchment-basemap-fork
title: Fork @protomaps/basemaps light into the parchment style, in two variants
type: feature
priority: high
status: open
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [52]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Fork the `@protomaps/basemaps` `light` style into a Lost Soles **parchment** style and emit two
style-layer variants from one source: `atlas` (high contrast) and `adventure` (aged).

**D-053 is the load-bearing call and it is counter-intuitive.** The dark-fantasy brief (D-050)
invites a dark basemap; do not build one. `05-fog-of-war.md` §5.1: with a dark basemap the dark
fog has almost no contrast against unexplored ground and **the reveal does not read at all**. The
only fix would be brightening explored ground, which means a framebuffer readback and throws away
the additive-only fog shader (05 §4.3). Warm parchment plus near-black-blue fog gives maximum
known/unknown contrast on a phone screen, the correct metaphor, and lets `u_rimGlow` pick up the
parchment hue at the frontier so the two layers stitch together.

Corollary that must hold in both variants: **keep basemap lightness high and saturation moderate.
The fog does the darkening.** A mid-dark basemap leaves the fog nowhere to go.

Both variants share **one PMTiles archive and one style source** (05 §5.2) — no second tileset,
no second code path. They differ only in layer paint, label density, and layer ordering:

| | Atlas | Adventure |
|---|---|---|
| Contrast | Dark road casings, strong hierarchy, water clearly separated from land | Lower contrast, warmer, paper grain, hand-drawn casings |
| Label density | Full: streets down to residential, POIs, park names, house-number-scale at z≥16 | Reduced: place names, major roads, parks; small POIs suppressed |
| Label layer position | **Above** the fog | **Below** the fog |
| Road layer position | Road geometry **above** the fog at ~0.5 opacity | Below the fog |

The tile bucket is the generic basemap only. Per `08-security-privacy.md` §2.4 C-1 the explored
set is **never** baked into a tile on R2 — that would fire the D-123 Trigger C gate.

D-148 binds the style: gold leaf is a fill or a rule, never body text at 2.1:1 on parchment. No
gold road labels.

## Acceptance criteria

- [ ] One PMTiles source and one style module produce both variants; a grep shows no second
      tileset URL and no duplicated layer array.
- [ ] Atlas renders street names down to residential at z16; adventure suppresses small POIs but
      still renders place names, major roads and parks.
- [ ] In the built style JSON, atlas places the label layers and the 0.5-opacity road layer
      **above** the fog layer id; adventure places both **below** it.
- [ ] Basemap lightness measured on the parchment ground is ≥ 0.80 L\* and saturation ≤ 25% in
      both variants — recorded as sampled values in the capability doc.
- [ ] No layer in either variant uses gold (`--gold`) as a text colour (D-148).
- [ ] Style loads from cache with the radio off and paints flat parchment where tiles are missing
      — never a checkerboard, never a spinner (`06-ui-ux.md` §4.8, §9.5).

## Notes

Deliberately first in this capability: the mode toggle (0098) is a style-variant swap plus a
uniform swap, and there is nothing to swap until both variants exist.

The fork is a fork, not a dependency patch — pin the upstream version it was taken from in a
comment so a future upstream diff is reviewable.

## Operator validation

On the Android phone (D-124), open `/` outdoors in daylight. Compare the parchment ground against
the fogged region: the boundary should be obvious at arm's length without shading the screen. Then
force-load the adventure variant and confirm the paper feels warmer and older but the street grid
is still traceable through the fog ghost. If you find yourself cupping a hand over the screen to
tell explored from unexplored, the lightness target is not met and this ticket is not done.
