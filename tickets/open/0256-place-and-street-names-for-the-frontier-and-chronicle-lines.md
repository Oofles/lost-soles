---
id: 256
slug: place-and-street-names-for-the-frontier-and-chronicle-lines
title: Place and street names for the frontier and chronicle lines
type: feature
priority: med
status: open
size: m
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-13T21:54:04Z
---

## Description

Found closing `0083`. Both of beat 4 and beat 5's design examples name a place —
*"Unclaimed ground 1.2 km north — **Millbrook**"*, *"You returned to **Ashgrove Lane** after two hundred
and eleven days"* — and **no design doc says where a name comes from.** `0083` shipped without them
(operator decision, 2026-10-13): the frontier line reads `◇ Unclaimed ground 1.2 km north`, and the
chronicle rows that need a name (`rearmed-returned-named`, `rearm-soon-named` in
`rules/chronicle.json`) sit in the table but are never selectable, because the selector skips a row
whose placeholders have no fact to fill them.

This ticket is a **decision first, code second.** Candidate sources:

- **The basemap's own label features**, read in the browser (`queryRenderedFeatures` /
  `querySourceFeatures` on the place and road label layers near a point). No new dependency, no
  request, no cost — but only names what the loaded tiles contain at the current zoom, and the
  adventure-mode labels sit *under* the fog for unexplored places (05 §5.2), which is the point of the
  discovery beat. Naming an unexplored place in the frontier line may spoil exactly that.
- **A reverse geocoder** (Amazon Location Service, in-account; or an OSM Nominatim instance). A new
  external call, a cost line, and a privacy question — coordinates of the operator's runs leave the
  browser (`08-security-privacy.md`).
- **Server-side at ingest**, stored beside the run's classes: names for the run's re-armed ground and
  its frontier, computed once, so a Relive reads the same name (the chronicle's determinism
  requirement).

The chronicle's street names additionally need **each re-armed cell's previous `lastRunAt`** (the
"after two hundred and eleven days" gap), which ingest has in hand (`ClassifiedCell.record`) but does
not persist; `rearmInDays` needs per-cell `lastRunAt` for cells near this run.

## Acceptance criteria

- [ ] A `D-xxx` records the name source, its cost, and whether naming unexplored ground spoils the
      fog's discovery beat.
- [ ] The frontier line names a real place when one is known — `◇ Unclaimed ground 1.2 km north —
      Millbrook` — and reads exactly as today when none is.
- [ ] A run that re-armed ground can select `rearmed-returned-named`, with the street and the gap in
      days coming from stored facts, and the same activity selects the same line on every read.
- [ ] No template or code change is needed to name a place in a new row: a name is a fact like any
      other (`{street}`, `{place}`).

## Notes

`0083`'s selector already treats a missing fact as "row not eligible", so this ticket supplies facts
and touches no selection logic. The forward-looking `rearm-soon-named` row is the only one permitted
in the app (`0083` Notes) — a second needs its own decision record.

## Operator validation

In the desktop browser, open a run whose frontier names a place and judge whether the name helps or
spoils the fog — that is the perceptual question the decision turns on.
