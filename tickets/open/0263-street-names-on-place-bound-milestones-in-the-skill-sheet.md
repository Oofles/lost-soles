---
id: 263
slug: street-names-on-place-bound-milestones-in-the-skill-sheet
title: Street names on place-bound milestones in the skill sheet
type: feature
priority: low
status: open
size: s
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-14T15:47:35Z
---

## Description

Found closing `0256`. `06-ui-ux.md` §6's skill sheet mockup labels a place-bound milestone with a
street name, and the doc says that *"needs a reverse geocoder nothing has"*. D-302 now has one:
`lib/place-names.ts` reads street and place names from the basemap archive. A `Landmark` row (D-301)
carries `lng`/`lat`, so the sheet's `ON THE MAP` rows can say `Cairn at Level 50 — Kelp Street`.

## Acceptance criteria

- [ ] An `ON THE MAP` row with a location names the street (or, failing that, the place) at it,
      through `PlaceNames`; one without a location, or with no name in reach, reads as today.
- [ ] `06-ui-ux.md`'s "needs a reverse geocoder nothing has" sentence is replaced with a pointer to
      D-302.

## Notes

Names are derived at read time from the immutable archive, not stored (D-302's reasoning applies).

## Operator validation

In the desktop browser, open a skill sheet with a landmark and judge whether the label reads.
