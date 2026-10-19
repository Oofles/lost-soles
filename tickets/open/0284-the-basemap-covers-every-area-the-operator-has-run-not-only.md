---
id: 284
slug: the-basemap-covers-every-area-the-operator-has-run-not-only
title: The basemap covers every area the operator has run, not only Florida
type: feature
priority: med
status: open
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: []
blocked_by: []
source: agent
created: 2026-10-16T15:35:14Z
started: 2026-10-19T13:08:21Z
---

## Description

The app hosts one street map, `basemap-fl-20260908.pmtiles` (Florida, 1.1 GB, D-226). `0177`'s
backfill (2026-10-16) imported the operator's whole history, and four activities lie outside it.
By the 1° tiles of activity starts (south-west corners):

| Tile | Area | Activities |
|---|---|---|
| `36,-94` | north-west Arkansas | 1 |
| `34,-93` | central Arkansas | 1 |
| `37,-86` | south-central Kentucky | 1 |
| `26,-78` | Grand Bahama | 1 |

Their ground is revealed (the fog data is global), but it sits on a blank background with no
streets. D-051 says the map must stay a legible street map. The run page also names no street or
place there, because `lib/place-names.ts` reads the same archive (D-302).

This ticket gives those areas streets. The tile list above is a snapshot. Derive the real
coverage from the operator's activities when the ticket is worked, since more may have arrived.

## Acceptance criteria

- [x] Every area holding an imported traced activity has street tiles at the zooms the map uses
      (z10–z18, D-253), checked against the activity bounding boxes, not the tile list above.
      *(z10–z15 present for every tile over each of the 4 out-of-Florida bboxes; z16–z18 are
      MapLibre overzoom of z15, the planet build's own max, as in Florida.)*
- [x] Florida's tiles and behaviour are unchanged. *(Same bbox and z0–15; tile presence over
      every in-Florida activity bbox z10–z15 identical, 1,218/1,218. The tile CONTENTS are the
      2026-10-18 OSM build, not 2026-09-08; D-226 forbids rewriting the old key and D-302 accepts
      a changed name.)*
- [x] Place and street names resolve in the new areas through the same lookup (D-302), and
      `lib/place-names.ts` still reads from the hosted basemap.
- [x] The new archive has a new filename (D-226: an archive is never rewritten under its name),
      and the old one stays until nothing references it.
- [x] The monthly hosting cost stays inside D-083's budget, measured from the object size and
      CloudFront's free tier.

## Notes

Filed by the orchestrator after `0177`'s import, at the operator's request (2026-10-16).

**Undecided, so settle it with the operator first (D-152):** one widened archive (Florida plus a
small box around each area, built in one `pmtiles extract` with a multi-region shape) or one
archive per region as separate sources. One archive keeps one MapLibre source and leaves
`BASEMAP_ARCHIVE` single-valued. Per-region archives are cheaper to add to later, but every
reader of `BASEMAP_ARCHIVE` (the map style and the place-name lookup) would have to learn more
than one. A new build may rename a street on an old run's page; D-302 accepts that.

`0097` (capability `15`) forks the basemap style. Coordinate so the extract and the style land
against the same archive.

## Operator validation

- (operator) On the desktop browser, pan to each out-of-Florida area and judge whether the streets
  under the revealed ground read as a real, legible map (D-051).

## Resolution

**One widened archive** (operator, 2026-10-19, settling the Notes' D-152 question): Florida plus a
1° tile around each area run outside it, cut in one multi-region `pmtiles extract`. One MapLibre
source; `BASEMAP_ARCHIVE` stays single-valued, so `lib/place-names.ts` needed no change.

**Coverage, derived from the real activities, not the ticket's list.** Read every archived raw
Strava activity (114 with a `latlng` stream) and every stored route trace (112) from the user-data
bucket into `~/lost-soles-basemap-build/data/` (outside the repo). Computed each activity's bbox,
padded 0.05°, and floored to 1° tiles. Exactly 4 activities have a bbox not wholly inside Florida's
`-87.7,24.4,-79.9,31.1`. Each one sits inside a single 1° tile, and they are the same four tiles the
ticket lists: `36,-94`, `34,-93`, `37,-86`, `26,-78` (south-west corners, floored). No new area has
arrived since 0177.

**The archive.** `basemap-20261018.pmtiles`, cut from `https://build.protomaps.com/20261018.pmtiles`
with `--region=docs/capabilities/assets/0284/basemap-region.geojson --maxzoom=15`.
1,200,756,660 bytes, sha256 `97a4572f95a975da4fcebec039a4d26fba9e33d304d76eb17090ec92d8782090`,
`pmtiles verify` clean. Same Protomaps basemap schema (`version 4.15.2`) and planetiler as the old
archive, so 0097's style fork reads both alike. The maxzoom check (D-253): the old archive's header
says z0–15, and the planet build's own max is z15, so z15 is the most any extract can carry; the map
overzooms z16–18 exactly as it already does in Florida. The orchestrator uploads it to
`s3://lost-soles-tiles/tiles/` before the push. The old `basemap-fl-20260908.pmtiles` stays in the
bucket. After this commit nothing in code references it; only history docs and decisions do.

**Verification against the built file** (a scratch script reading it through the real `PlaceNames`
class, printing counts only):
- Tiles: for each of the 4 activities, every z10–z15 tile over its bbox is present (z15: 8/8, 2/2,
  9/9, 4/4).
- Names: sampling 21 points per activity, `street()` resolves 21, 6, 20 and 12, and `place()`
  resolves 21, 0, 0 and 14. Every count is **identical to the same lookup run against the planet
  build**. The zeros are rural ground with no locality or neighbourhood within `PLACE_MAX_M`, not
  missing coverage.
- Florida: z10–z15 tile presence over every in-Florida activity bbox matches the old archive,
  1,218 of 1,218.

**D-249's "extract bounds" fallback.** Nothing reads the archive header's bounds or centre. The
fallback is the hard-coded `EXTRACT_FALLBACK` (Florida's centre, z6). That stays right: the new
header's bounds are the union of the regions, and their centre (−85.5, 31.2) is inland Alabama,
in the gap. Added a comment there, and a test in `lib/map-camera.test.ts` pinning the fallback
inside the committed region file's Florida polygon.

**Privacy (D-199, `08` §7.2).** The committed region file holds Florida's already-public bbox and
four whole 1° tiles, nothing finer. A second test asserts that every non-Florida region is exactly
one integer-aligned 1° square matching its `tile` label. A padded run box can therefore never be
committed there by mistake. The per-activity bboxes and raw data stay in
`~/lost-soles-basemap-build/`.

**Cost (D-083, D-226).** S3 Standard at $0.023/GB-month: the new object (1.118 GiB) is
**$0.026/month**. While the old one (1,134,014,639 bytes, 1.056 GiB) is kept, both together are
**$0.050/month**. Delivery is inside CloudFront's always-free 1 TB and 10M requests a month
(usage is ~1 GB and a few thousand requests, D-226), and S3→CloudFront origin transfer is free.
The total is about 5 cents a month, well inside D-083's few dollars.

**Files touched**
- `lib/basemap.ts`: `BASEMAP_ARCHIVE` → `basemap-20261018.pmtiles`, plus a comment on the
  multi-region archive and the doc-comment filename pattern. No style layers touched (0097).
- `lib/map-camera.ts`: a comment on why `EXTRACT_FALLBACK` is not the archive's centre.
- `lib/map-camera.test.ts`: the region-file tests (fallback inside Florida; nothing finer than 1°).
- `docs/capabilities/assets/0284/basemap-region.geojson`: new, the extract's region.
- `docs/capabilities/08-map-and-fog-renderer.md`: "Regenerating the extract" now uses the
  multi-region command and the new archive's figures, and says how to add an area.

