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
started: 2026-10-19T13:08:21Z
---

## Description

Fork the `@protomaps/basemaps` `light` style into a Lost Soles **parchment** style and emit two
style-layer variants from one source: `atlas` (high contrast) and `adventure` (aged).

**D-053 is the load-bearing call and it is counter-intuitive.** The dark-fantasy brief (D-050)
invites a dark basemap; do not build one. `05-fog-of-war.md` §5.1: with a dark basemap the dark
fog has almost no contrast against unexplored ground and **the reveal does not read at all**. The
only fix would be brightening explored ground, which means a framebuffer readback and throws away
the additive-only fog shader (05 §4.3). Warm parchment plus near-black-blue fog gives maximum
known/unknown contrast on screen, the correct metaphor, and lets `u_rimGlow` pick up the
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

- [x] One PMTiles source and one style module produce both variants; a grep shows no second
      tileset URL and no duplicated layer array.
- [x] Atlas renders street names down to residential at z16; adventure suppresses small POIs but
      still renders place names, major roads and parks.
- [x] In the built style JSON, atlas places the label layers and the 0.5-opacity road layer
      **above** the fog layer id; adventure places both **below** it. *(The fog is a custom layer
      the style JSON cannot hold; asserted on the built layers with the fog inserted by the real
      `fogBeforeId`, in either add order.)*
- [x] Basemap lightness measured on the parchment ground is ≥ 80 L\* and **CIELAB saturation**
      (C\*/√(C\*²+L\*²)) ≤ 25% in both variants, with HSV saturation reported beside it — recorded
      as sampled values in the capability doc. *(Amended at 0097, operator: "saturation" named no
      metric, and HSL fails the design's own `--parch-100` at 58%; see the capability doc. "0.80
      L\*" read as L\* 80 on the 0–100 scale.)*
- [x] No layer in either variant uses gold (`--gold`) as a text colour (D-148).
- [x] Style loads from cache offline and paints flat parchment where tiles are missing
      — never a checkerboard, never a spinner (`06-ui-ux.md` §4.8, §9.5). *(Per D-287, in a
      running app: the style is a bundled JS object with no fetch of its own, tiles come from the
      browser's HTTP cache, and the background layer is the parchment ground. No service worker.)*

## Notes

Deliberately first in this capability: the mode toggle (0098) is a style-variant swap plus a
uniform swap, and there is nothing to swap until both variants exist.

The fork is a fork, not a dependency patch — pin the upstream version it was taken from in a
comment so a future upstream diff is reviewable.

## Operator validation

In the desktop browser, open `/`. Compare the parchment ground against the fogged region: the
parchment/fog boundary should be obvious at a glance. ~~outdoors in daylight~~ ~~at arm's length
without shading the screen~~ *(D-251, 0215)* Then force-load the ~~adventure~~ **atlas** variant (`/?basemap=atlas`; adventure is the
default, 05 §5.3 — operator, 0097) and confirm street names and the pale road grid read over the
fog, and that adventure's paper by comparison feels warmer and older with the street grid still
traceable through the fog ghost. If you
have to study the screen to tell explored from unexplored, the lightness target is not met and this
ticket is not done. ~~cupping a hand over the screen~~ *(D-251, 0215)*

## Resolution

**Files touched**
- `lib/basemap-style.ts` *(new)* — the fork: `parchmentFlavor` maps every field of upstream's
  `Flavor` (`@protomaps/basemaps@5.7.2`, `light`, pinned in `PARCHMENT_UPSTREAM` and the header)
  onto a `--map-*` role; `parchmentLayers` makes ONE `layers()` call per variant and post-passes
  it. Adventure drops `roads_labels_minor`, `address_label`, `roads_oneway`, `roads_shields` and
  narrows `pois` to park-like kinds. Atlas copies each road FILL layer (`atlas_road_ghost_*`, fill
  colour, `line-opacity` 0.5) in just under the first label and tags the copies and every label
  `ABOVE_FOG_METADATA`; `address_label` from z16. Also `mapPaletteFrom`/`documentMapPalette`
  (resolve tokens once, throw on an empty one), `over` (a token laid on the ground at an opacity,
  made opaque) and `cssTokenReader` (tests read the real `tokens.css`).
- `lib/basemap.ts` — `basemapStyle(variant, palette)` binds the fork to the one source and archive.
  `BASEMAP_ARCHIVE`, the tiles URL and hosting untouched (0284 owns them).
- `lib/map-layers.ts` — `ABOVE_FOG_METADATA`, `isAboveFogLayer`, `fogSplitsBasemap`;
  `fogBeforeId` inserts the fog under the first above-fog layer when the style declares one,
  otherwise unchanged (landmarks, then `run-glow`). Rule 1's comment states the atlas exception.
- `lib/trace-web/layer.ts` — comment only. `traceBeforeId` is unchanged: "before the first label"
  already lands the web above the fog in atlas (Q1 = B) and below it in adventure. The proposed
  "earlier of fog and first symbol" fix belonged to option A and would have contradicted B, so it
  was not made.
- `lib/fog/debug-flags.ts` — `basemapVariant(search)`: `?basemap=atlas|adventure`, default
  adventure.
- `components/map/map-shell.tsx` — builds the style with the URL's variant and the document palette.
- `app/tokens.css` — eleven `--map-*` semantic tokens, parchment and ink primitives only, none gold,
  absent from the dark blocks.
- Tests: `lib/basemap-style.test.ts` *(new, 27)*; `lib/basemap.test.ts` (0052's "byte-identical to
  stock" is replaced by "is the fork", the slot that criterion held); `lib/map-layers.test.ts`,
  `lib/landmarks/markers.test.ts` (new signature, adventure).
- `docs/05-fog-of-war.md` §4.4 — the atlas layer order and the trace web above the fog in atlas.
- `docs/capabilities/15-two-map-modes-and-cold-territory.md` — sampled L\*/C\*/saturation, why
  not HSL, the water-vs-trace ΔE table, and what was not built.

**Decisions (operator, 2026-10-19, relayed; proposed as D-xxx in the wave report)**
- Q1 = B: in atlas the trace web sits above the fog, between the 0.5 road copy and the labels
  (amends D-307 for atlas). Q2: default adventure, `?basemap=` debug flag. Q3: parchment and ink
  ramps only, through `--map-*` tokens; water is an ink wash; no §8.2 amendment. Q4: CIELAB
  saturation with HSV beside it; HSL rejected.
- Agent calls inside those: above-fog layers are declared by layer `metadata`, not an id list, so
  `map-layers.ts` never learns upstream's layer names. The road copy is the fill layers in their own
  colour and width, so on explored ground it is the fill colour at 0.5 over the identical fill,
  which is invisible. Adventure ages fills and lines 30% toward `--map-tint-deep`, never text.

**Findings**
- Water and a well-worn trace are the same ink (ΔE 1.6–3.0 at wear ≥ 0.44). That is for the
  `--trace-line` retune, not this ticket.
- Paper grain and the night-parchment variant are not built. Glyphs and sprites still load from
  protomaps.github.io, against 06 §9.5's "no third-party requests"; proposed as its own ticket.

