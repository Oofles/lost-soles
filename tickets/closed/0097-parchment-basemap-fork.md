---
id: 97
slug: parchment-basemap-fork
title: Fork @protomaps/basemaps light into the parchment style, in two variants
type: feature
priority: high
status: closed
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [52]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-19T13:08:21Z
closed: 2026-10-19T15:40:59Z
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
- [x] Basemap lightness measured on the ~~parchment~~ **stock `light`** ground is ≥ 80 L\* and
      **CIELAB saturation** (C\*/√(C\*²+L\*²)) ≤ 25% in both variants, with HSV saturation
      reported beside it — recorded as sampled values in the capability doc. *(Amended at 0097,
      operator: "saturation" named no metric, and HSL fails the design's own `--parch-100` at 58%;
      see the capability doc. "0.80 L\*" read as L\* 80 on the 0–100 scale.)* *(Amended again,
      D-373: the colours are stock `light`; re-measured — ground L\* 88.9 / 3.1%, background
      L\* 82.0 / 0.0% — and the intent "lightness high, the fog does the darkening" holds.)*
- [x] No layer in either variant uses gold (`--gold`) as a text colour (D-148). *(D-373: holds
      trivially for the stock flavour; still asserted against the real `--gold-*` tokens.)*
- [x] Style loads from cache offline and paints ~~flat parchment~~ **the flat stock background
      colour** *(D-373)* where tiles are missing — never a checkerboard, never a spinner
      (`06-ui-ux.md` §4.8, §9.5). *(Per D-287, in a running app: the style is a bundled JS object
      with no fetch of its own, tiles come from the browser's HTTP cache, and the background layer
      is stock `light`'s `#cccccc`. No service worker.)*

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

**Recorded (operator, 2026-10-19, desktop browser, on the deployed parchment version, 1805ec5):**
*"I don't like the coloring at all... it just looks like an unappealing filter applied on top of
the map. I liked the standard colors that just existed with the openstreetmap before. And I think
that the fog layer accomplishes the objective well enough. The basemap atlas view is perfect for
planning and viewing the roads!"* The atlas layout, Arkansas and the other out-of-Florida areas,
and the fog were judged good. The parchment colouring was rejected; the rework below (D-373)
restores the stock colours and keeps the structure.

**Recorded (operator, 2026-10-19, desktop browser, on the deployed rework, Amplify build 417,
commit `bb054dd`):** `/` (adventure) and `/?basemap=atlas` show the stock map colours with no warm
filter, and the atlas layout is unchanged. *"Looks right, close it."*

**Smoke test (orchestrator), against the deployed bundle** (the 20 public
`/_next/static/chunks/*.js` served by `soles.devaultsecurity.com`): the stock `earth` colour
`#e2dfda` and the `lost-soles:above-fog` layer tag are each present in one chunk; `--map-ground` and
`documentMapPalette` are present in none, so no parchment palette code shipped.

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

**Decisions (operator, 2026-10-19, relayed; recorded at merge as D-368 to D-371)**
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

### Rework 2026-10-19 (D-373)

The operator rejected the parchment colouring on the deployed build (see Operator validation) and
chose: both variants back to the stock `@protomaps/basemaps` 5.7.2 `light` colours, structure kept.
D-373 supersedes D-053's parchment ground and D-369; D-368 and D-370 stand; D-371's metric stands
with new numbers.

**Files touched**
- `lib/basemap-style.ts` — `parchmentFlavor`, `MAP_TOKENS`/`MapPalette`, `mapPaletteFrom`,
  `documentMapPalette`, `parseColor`, `over`, `LOOK` (adventure's ageing toward `--parch-300`, the
  water wash, ink casings) and `cssTokenReader` removed. Both variants call `layers()` once with
  `BASEMAP_FLAVOR = namedFlavor("light")`. `parchmentLayers(source, variant, palette)` →
  `basemapLayers(source, variant)`; `PARCHMENT_UPSTREAM` → `BASEMAP_UPSTREAM`. The post-pass is
  unchanged: adventure's dropped layers and park-only POIs; atlas's `atlas_road_ghost_*` copies
  (the stock fill colour, so still invisible over explored ground) and every label tagged
  `ABOVE_FOG_METADATA`, address labels from z16.
- `lib/basemap.ts` — `basemapStyle(variant)`; the palette argument is gone.
- `components/map/map-shell.tsx` — no `documentMapPalette()` call.
- `app/tokens.css` — the eleven `--map-*` tokens and their comment removed. App-chrome parchment
  ramps untouched.
- `lib/fog/debug-flags.ts`, `lib/map-layers.ts` — comment wording only.
- Tests: `lib/basemap-style.test.ts` (palette/`over` tests dropped; new "D-373" block asserting
  every non-copy layer of both variants has upstream's exact paint and that `tokens.css` holds no
  `--map-*`; criterion 4 measures `earth` and `background`; criterion 6 asserts the stock
  background), `lib/basemap.test.ts`, `lib/map-layers.test.ts`, `lib/landmarks/markers.test.ts`
  (new signatures).
- Docs: `docs/capabilities/15-two-map-modes-and-cold-territory.md` (stock samples replace the
  parchment table; the water-vs-trace ΔE table and the paper-grain note replaced by a line
  pointing at D-373); `docs/05-fog-of-war.md` §1, §4 stack table, §4 noise-scale bullet, §5.1 (superseded
  block, reasoning kept), §5.2 basemap row; `docs/06-ui-ux.md` D-053 bullet, §2 diagram, empty
  and offline states, §4.8, §8.1, §8.3's night parchment, §9.5; `docs/01-architecture.md` and
  `docs/09-roadmap.md` one annotation each. App-chrome "parchment" references were left alone.

**Decisions inside D-373**
- "Ground" for criterion 4 is the `earth` fill (what land looks like); `background` shows only
  where no tile is loaded and is held to the same floor. Stock light's two differ (`#e2dfda` vs
  `#cccccc`), unlike the parchment version where they were one token.
- With colour gone, the two variants differ only in label density and layer order. 05 §5.2's
  basemap-style row says so.

**Findings**
- Stock water `#80deea` is cyan (L\* 83.3, CIELAB sat. 32.7%), so the old water-vs-trace ink
  collision is gone; `0294` can be declined on that basis.
- Stock POI labels keep upstream's eight category hues in atlas; `tangerine` `#CB6704` is orange,
  not a `--gold-*` value, and the no-gold test passes.
- Glyphs and sprites still load from protomaps.github.io (unchanged from the first pass).
