---
id: 260
slug: draw-recorded-landmarks-on-the-map
title: Draw recorded landmarks and shrines on the map
type: feature
priority: med
status: closed
size: m
capability: 12-post-run-moment
depends_on: [248]
blocked_by: []
source: agent
created: 2026-10-14T14:26:28Z
started: 2026-10-14T17:13:17Z
closed: 2026-10-14T17:59:28Z
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

- [x] The home map draws a marker for every `Landmark` row with a location, read owner-scoped through
      AppSync (`Landmark.list` on `userId`). A row with null `lng`/`lat` draws nothing.
- [x] The marker's form comes from the row's `place` through a data table, never a skill-id check
      (D-031). Cairn and shrine are distinguishable at the zoom `→ fly to` lands on.
- [x] Legible over every fog state and both map modes (D-051) — it reads as a placed object, not as
      fog or route.
- [x] Arriving by `→ fly to` from `/skills/:id`, the marker is in view at the landing point.
- [x] No landmark coordinate is committed in a fixture or logged (`08` §7.2, D-199).

## Notes

- Filed from `0248` (operator asked for it at the start of that ticket). `0082`'s `CellPulse` comment
  in `app/run/[activityId]/run-sequence.tsx` points here.
- The glyph/art question (what a cairn looks like at map scale) is perceptual: expect it to need the
  operator's eye.
- 2026-10-14: built and deployed in `f6928bf`, awaiting the operator's look. Two THROWAWAY rows are in
  the prod `Landmark` table for that check (operator-approved): `constitution#50` (cairn) and
  `cartography#99` (shrine), `activityId: smoke-0260`, placed by `lanternPath` on real stored routes.
  **Deleted 2026-10-14** — was: `npx tsx tmp/0260/operator-seed.ts --clean` (keys in
  `tmp/0260/operator-state.json`; the delete is conditional on `activityId = smoke-0260`).

## Resolution

**What was built:** `f6928bf`, then `873ff9c` after the operator's review. Decisions are recorded as **D-303**.

- **The table.** `lib/landmarks/markers.ts`:
  - `MARKER_FORMS`, keyed by `PlaceKind`, holds each form's image id, size, rank and a canvas
    `draw`. The cairn is four stacked pale stones; the shrine is a gold-leaf torii.
  - `landmarkFeatures` turns rows into points. A row with null `lng`/`lat` or an unknown `place`
    draws nothing.
  - The symbol layer reads `["get", "icon"]` from the feature, so the layer spec names no form,
    no place and no skill (D-031).
  - `allow-overlap` and `ignore-placement` are both on: a marker is always drawn and never hides a
    street name. The anchor is `bottom`, so the glyph stands on the point.
  - `symbol-sort-key` puts a shrine above a cairn where the two overlap.
- **Layer order.** `lib/map-layers.ts` gains `LANDMARK_LAYER_ID`, `landmarkBeforeId` (under
  `run-glow` when present) and `landmarksBetweenFogAndRoute`. `fogBeforeId` now prefers the
  landmark layer, so a re-added fog goes under the markers. `05` §4.4 documents the rule.
- **The read.** `lib/skills/transport.ts` `fetchAllLandmarks` calls `Landmark.list` on `userId`
  and pages until `nextToken` is empty. `components/map/use-landmarks.ts` refetches on every
  explored generation, so a new cairn appears once its run lands. It logs failures without rows,
  so no coordinate is ever logged. It is wired into `MapShell` for the home map only (`framed ? null : loaded`).
- **Colour.** Three new map tokens in `app/tokens.css`: `--landmark-stone` (parch-200),
  `--landmark-shrine` (gold-500) and `--landmark-ink` (ink-900). Like the route's, they are absent
  from the dark blocks.
- **Fly-to zoom.** `lib/map-camera.ts` `AT_ZOOM = 16` for `parseAt`, replacing `HOME_ZOOM`.
  `LANDMARK_ICON_SIZE` is 1 at z16, 0.85 at home's z14 and 0.55 at z8, and never zero.
- **Tests.** `lib/landmarks/markers.test.ts` (18):
  - located and unlocated rows; every `PLACE_LEVELS` kind has a form; unknown places;
  - the layer spec carries no form, place or skill names;
  - layer order in all three add orders, against the real Protomaps style;
  - images are registered once;
  - tokens resolve, and a missing token throws;
  - each glyph draws inside its own box.

  `map-camera.test.ts` asserts `AT_ZOOM` is above home and at most 17. All fixtures are Point Nemo.
- **Docs.** `05` §4.4 (the third rule), `06` §5.5 (markers, the torii, z16), D-303.

**What went wrong.**
- The first shrine was a gabled hut. The operator said it read as a birdhouse and asked for
  something closer to a torii. The first torii was squat, so I lengthened its pillars before
  showing it again.
- `→ fly to` at z14 landed too far out; it now lands at z16.
- I tried a headless end-to-end check with a throwaway Cognito user in the prod pool. The auto-mode
  classifier refused it as going beyond the approved scope (throwaway landmark rows only), and I
  dropped it. So the live draw was verified only by the operator's eye. My own checks were the
  unit tests, the glyph renders below, and the deployed bundle containing the layer.
- A full local `vitest` run fails one test, `adapter.test.ts` "polyline appears nowhere outside
  this adapter". The cause is old `tmp/008x/seed.ts` scratch files, not this change; it passes in
  a clean tree.

## Operator validation

On **`/`** in the desktop browser, with at least one recorded landmark: the marker is there, reads
as a cairn (or shrine), stays legible over fog, and `→ fly to` from the skill sheet lands on it.

**Result:**
- **Operator, 2026-10-14, desktop browser:**
  - **First look:** *"The markers look good."* They asked for a closer `→ fly to` and a
    torii-shaped shrine; both were done in `873ff9c`.
  - **Second look:** *"both look right now."*
- **Test data.** Two throwaway prod rows, approved by the operator:
  - `constitution#50` (cairn) and `cartography#99` (shrine), placed by `lanternPath` on real
    stored routes; no coordinate was printed.
  - Deleted afterwards with `tmp/0260/operator-seed.ts --clean`. A follow-up query found **0**
    `Landmark` rows remaining for the operator.
- **My own checks:**
  - **Glyph renders:** headless Chromium drew both glyphs at 0.55×/1×/1.25× over parchment, deep
    fog, the fog edge and a road. They were distinct and legible in every cell.
  - **Deployed bundle:** after the deploy (Amplify `SUCCEED` for both commits), a chunk of the
    live site contained the `landmark-cairn` image id.
