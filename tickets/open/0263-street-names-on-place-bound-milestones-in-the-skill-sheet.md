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
started: 2026-10-15T01:38:30Z
---

## Description

Found closing `0256`. `06-ui-ux.md` §6's skill sheet mockup labels a place-bound milestone with a
street name, and the doc says that *"needs a reverse geocoder nothing has"*. D-302 now has one:
`lib/place-names.ts` reads street and place names from the basemap archive. A `Landmark` row (D-301)
carries `lng`/`lat`, so the sheet's `ON THE MAP` rows can say `Cairn at Level 50 — Kelp Street`.

## Acceptance criteria

- [x] An `ON THE MAP` row with a location names the street (or, failing that, the place) at it,
      through `PlaceNames`; one without a location, or with no name in reach, reads as today.
- [x] `06-ui-ux.md`'s "needs a reverse geocoder nothing has" sentence is replaced with a pointer to
      D-302.

## Notes

Names are derived at read time from the immutable archive, not stored (D-302's reasoning applies).

## Resolution

- `lib/skills/detail.ts` — `nameMilestones(places, names)`: for each located row, the street
  (`PlaceNames.street`, 60 m) or failing that the place (`PlaceNames.place`, 3 km), appended as
  `Cairn at Level 50 — Kelp Street`. No location, no name in reach, or a rejected lookup → the
  label as before. Takes `Pick<PlaceNames, "place" | "street">` (type-only import), so the model
  module stays free of the PMTiles client, as `namesFor` in `chronicle-server.ts` does.
- `app/skills/skill-sheet-route.tsx` — the rows are set as soon as `fetchLandmarks` answers, then
  replaced by the named rows when the basemap does. A slow or failing archive costs the name,
  never the row or the sheet. Nothing is stored (D-302's reasoning: derived from an immutable
  archive at read time).
- `lib/skills/detail.test.ts` — two tests: street, place fallback, no name in reach, no location;
  and a rejected street lookup keeping the label rather than dropping the row.
- `docs/06-ui-ux.md` §6 `ON THE MAP` — the "needs a reverse geocoder nothing has" clause is replaced
  with the D-302 pointer and the read-time/no-wait behaviour.
- No new decision: this applies D-302 to a second surface.
- The route has no test of its own (it had none before); the async upgrade is three lines over the
  tested helper. Not widened here.

## Operator validation

**Smoke test (agent):** `tmp/0263/smoke.ts` — `placeMilestones` → `nameMilestones` against the live
basemap archive on CloudFront, at public downtown-Orlando coordinates:
- Orange Ave & Central Blvd → `Cairn at Level 50 — South Orange Avenue` (street);
- mid Lake Eola → `Shrine at Level 99 — Orlando` (no street within 60 m, falls back to place);
- offshore → `Cairn at Level 50` (nothing in reach, unchanged);
- no location → `Shrine at Level 99` (unchanged).
- Four cold lookups in 433 ms.
- Full suite: 3408 passed. The one failure is the pre-existing `tmp/` polyline-guard false positive.

**Perceptual (operator, desktop browser) — owed, not yet possible:** a scan of the `Landmark` table
returned **0 rows** — no skill has crossed 50, so there is no sheet with an `ON THE MAP` row to
look at. When the first one is earned, open that skill's sheet (`/skills/<skill>`) and judge
whether `Cairn at Level 50 — <street>` reads, and whether it names a street you recognise. Seeding a
fake landmark would draw a cairn on the real home map, so it was not done.
