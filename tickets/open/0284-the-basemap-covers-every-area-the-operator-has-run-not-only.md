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

- [ ] Every area holding an imported traced activity has street tiles at the zooms the map uses
      (z10–z18, D-253), checked against the activity bounding boxes, not the tile list above.
- [ ] Florida's tiles and behaviour are unchanged.
- [ ] Place and street names resolve in the new areas through the same lookup (D-302), and
      `lib/place-names.ts` still reads from the hosted basemap.
- [ ] The new archive has a new filename (D-226: an archive is never rewritten under its name),
      and the old one stays until nothing references it.
- [ ] The monthly hosting cost stays inside D-083's budget, measured from the object size and
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
