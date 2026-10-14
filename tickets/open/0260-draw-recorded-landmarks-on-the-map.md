---
id: 260
slug: draw-recorded-landmarks-on-the-map
title: Draw recorded landmarks and shrines on the map
type: feature
priority: med
status: open
size: m
capability: 12-post-run-moment
depends_on: [248]
blocked_by: []
source: agent
created: 2026-10-14T14:26:28Z
started: 2026-10-14T17:13:17Z
---

## Description

`04` §4.3: a level-50 milestone places a landmark where it was earned, 99 a shrine at the exact
cell — *"visible forever on a map the user already looks at."* `0248` records them (`Landmark`,
D-301) and the skill sheet lists them with `→ fly to`, but **nothing draws them on the map**. Today
the only visual is `0082`'s one-off `CellPulse` at the moment of crossing; after that the place is
blank, so `→ fly to` lands on an unmarked spot.

Draw every located `Landmark` the owner has as a persistent marker on the home map: a cairn for
`landmark`, a shrine for `shrine`.

## Acceptance criteria

- [ ] The home map draws a marker for every `Landmark` row with a location, read owner-scoped through
      AppSync (`Landmark.list` on `userId`). A row with null `lng`/`lat` draws nothing.
- [ ] The marker's form comes from the row's `place` through a data table, never a skill-id check
      (D-031). Cairn and shrine are distinguishable at the zoom `→ fly to` lands on.
- [ ] Legible over every fog state and both map modes (D-051) — it reads as a placed object, not as
      fog or route.
- [ ] Arriving by `→ fly to` from `/skills/:id`, the marker is in view at the landing point.
- [ ] No landmark coordinate is committed in a fixture or logged (`08` §7.2, D-199).

## Notes

- Filed from `0248` (operator asked for it at the start of that ticket). `0082`'s `CellPulse` comment
  in `app/run/[activityId]/run-sequence.tsx` points here.
- The glyph/art question (what a cairn looks like at map scale) is perceptual: expect it to need the
  operator's eye.

## Operator validation

On **`/`** in the desktop browser, with at least one recorded landmark: the marker is there, reads
as a cairn (or shrine), stays legible over fog, and `→ fly to` from the skill sheet lands on it.
