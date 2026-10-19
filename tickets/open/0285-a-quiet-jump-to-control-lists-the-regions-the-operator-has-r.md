---
id: 285
slug: a-quiet-jump-to-control-lists-the-regions-the-operator-has-r
title: A quiet jump-to control lists the regions the operator has run in
type: feature
priority: low
status: open
size: s
capability: 15-two-map-modes-and-cold-territory
depends_on: [284]
blocked_by: []
source: agent
created: 2026-10-16T15:35:14Z
started: 2026-10-19T15:53:10Z
---

## Description

With street maps outside Florida (`0284`), the operator's territory is spread over several areas
hundreds of kilometres apart, and finding one means a long pan or zoom-out. The operator asked for
"a quick jump-to per state that's not too intrusive".

A small control on the map pane lists the regions the operator has actually run in. Choosing one
moves the camera to the territory there.

## Acceptance criteria

- [x] The region list is derived from the operator's own data (activity starts or the explored
      set, clustered), never a hard-coded list of states. A new area appears with no code change.
- [x] The control is closed by default and sits with the other map-pane controls (D-313): one
      40px button. It is mouse and keyboard operable (D-253), with arrow keys and Enter in the list
      and Esc to close.
- [x] Choosing a region frames that region's territory (its explored-cell bounds) without changing
      the mode, and the stored camera then updates as it does after any pan (D-249).
      *Amended in place:* the box framed is the bounds of the region's traced lines, the lines its
      explored cells were revealed from, so it is the cells' box to within one cell. The explored
      set carries no per-cell time or run, so it cannot be clustered by recency.
- [x] With only one region the control does not appear at all.
- [x] Region labels come from the basemap's place names (D-302). With no name, a plain fallback such
      as the coordinate area; never an error.

## Notes

Filed by the orchestrator after `0177`'s import, at the operator's request (2026-10-16). It depends
on `0284`: jumping to an area with no streets is not worth building first.

**Settle with the operator before building (D-152):** the region granularity (state, metro
cluster, or N km clusters), and whether the list is ordered by most recent run or by amount of
ground. "Per state" was the operator's phrase; a cluster rule may read better where one state
holds two far-apart areas, as Arkansas does today.

## Operator validation

- [x] (operator) On the desktop browser, open the control, jump between regions, and judge whether it
  is quiet enough when closed and quick enough when open. — verified 2026-10-19: passed

**Result.** Operator, desktop browser, 2026-10-19 — **passed**: the ⚑ button under ⚙ is quiet when closed and reads as jump-to; the list is quick and the jumps read as jumps; the region labels are recognisable.

Smoke test (orchestrator, after Amplify job 418, commit e5bdae0): `/` 200; `/api/runs/web` signed-out 404; the deployed chunks contain `Jump to a region`.

## Resolution

The operator settled both of the Notes' questions on 2026-10-19, before the build: **distance
clusters of roughly 50 km**, each labelled with the most prominent place the basemap names inside
it, and **most recent run first**. Both are proposed as decisions in the wave report.

**What was built.** A 40px button on the map pane, directly under `⚙` (top-right, `top: 64px`,
the 8px gap §2.2 uses between stacked map controls), clear of `0098`'s top-left mode toggle and of
`0101`'s bottom-right fit and `⌖`. Closed by default. Open, it drops a short listbox under
itself; ↑/↓, Home/End, Enter/Space, Esc (focus back to the button), Tab and a click outside close
it. Choosing a region flies the camera to that region's ground with §3.2's 12% padding and
`maxZoom` 15. The mode is never read or written. The stored camera updates through the map's own
`moveend` handler, exactly as after a pan (D-249). A jump also marks the camera as placed, so
the first-load run centring (`0186`) cannot land on top of it if the latest run arrives later.

**Where the regions come from.** The trace web's runs (`webRuns`): the request the permanent web
already makes once per explored generation, so the control adds no fetch. `regionsOf` clusters the
run **starts** with single linkage at `REGION_LINK_KM = 50`, so a sprawling metro stays one region.
Each region keeps the box of every traced point of its runs and its latest `startedAt`, and the list
is ordered on that, newest first. A run somewhere new is a new region with no code change.

**The threshold, checked against the real data** (read-only S3 read of the operator's
`traces/web.json.gz`, 112 traced runs, kept in the scratchpad and never committed): 50 km gives
five regions: the home metro (108 runs), central Arkansas, south-central Kentucky, the Bahamas and
north-west Arkansas. **Arkansas's two areas come out as two entries.** Every threshold from 25 km
to 100 km gives the same five, so 50 sits in a wide gap. At 10 km the home metro splits into three,
which is the failure the lower bound guards against. Clustering takes ~5 ms.

**Labels (D-302).** `PlaceNames.prominent(bounds)` in `lib/place-names.ts` widens the box by 5 km,
so a short run on a town's edge still finds the town. It then reads the `places` layer at the
highest zoom from z12 down to z6 that covers the box in at most 4 tiles, and picks a locality over
a neighbourhood, then the larger `population` (now decoded into `NamedFeature`), then the name. It
uses the same `places` filter as `place()`, so the two share one tile cache safely. With no name, or
on any failure, the label is the box centre to 0.1° (`48.9°S 123.4°W`). It never shows an error.
Against the real archive, four of the five regions got a town name and the Bahamas region fell back
to its coordinates, because no town lies within 5 km of that run. Each lookup took 36–576 ms cold.
The names themselves are left out of this file on purpose: the repo is public (D-199), and the
home region's name is a neighbourhood.

**Files touched**
- `lib/regions.ts` (new): `regionsOf`, `REGION_LINK_KM`, `coordinateLabel`, `LngLatBounds`.
- `lib/regions.test.ts` (new): clustering, the Arkansas-shaped split, chaining, recency order, bounds, the fallback label.
- `lib/place-names.ts`: `population` on `NamedFeature`, `tilesCovering`, `padBounds`, `prominentNamed`, `PlaceNames.prominent`.
- `lib/place-names.test.ts`: the encoder carries integer values; prominence, padding and zoom-choice tests.
- `components/map/region-jump-control.tsx` (new): the button and listbox, `listKey` (keys as data), its CSS.
- `components/map/region-jump-control.test.tsx` (new): closed by default, the open list, placement, keys.
- `components/map/region-jump.tsx` (new): data (runs → regions → labels), `jumpItems`, `frameRegion`.
- `components/map/region-jump.test.ts` (new): hidden with fewer than two regions, label fallback, framing.
- `components/map/map-shell.tsx`: renders `RegionJump` on home only, before the map in DOM order.
- `docs/06-ui-ux.md` §2.2: row 13 for the control; added to the map-chrome list and the focus order.

**Decisions made here, beyond the operator's two:** the 5 km label pad, the z12→z6 / 4-tile read,
the town-then-population ranking, the 0.1° fallback, `maxZoom` 15, the `⚑` glyph, and placement
under `⚙`. All are local and tunable constants.

**Decisions recorded at merge (orchestrator):** granularity as D-381, order and labels as D-382.
