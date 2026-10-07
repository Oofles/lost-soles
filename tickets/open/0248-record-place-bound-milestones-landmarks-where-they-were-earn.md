---
id: 248
slug: record-place-bound-milestones-landmarks-where-they-were-earn
title: Record place-bound milestones (landmarks) where they were earned
type: feature
priority: med
status: open
size: m
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-07T20:57:39Z
---

## Description

`04` §4.3: *"Every milestone that can be a landmark should be a landmark."* A level-50 milestone
places a landmark (a cairn) where it was earned, and 99 places a shrine at the exact cell. `06`
§3.2 Beat 3 flies the level-up card into that cell. `06` §5.5's `ON THE MAP` lists them with
`→ fly to`.

**Nothing records where a milestone was earned.** `0082` animates the placement at the moment it
happens, but no table holds it afterwards. So `0074` shipped `ON THE MAP` against an always-empty
list (`NO_PLACES` in `app/skills/skill-sheet-route.tsx`, D-290), and every sheet omits the section.

Persist a place-bound milestone when it is crossed: skill, milestone level, the activity that
crossed it, and the cell (or coordinate) where the cumulative XP passed the threshold. Then feed
it to the sheet.

## Acceptance criteria

- [ ] Crossing a place-bound milestone writes one durable, owner-scoped record: skill, level,
      activity, location. It is written once. Re-ingesting or replaying the same activity does not
      duplicate it, and a ruleset replay that moves the crossing does not delete it (D-020, D-135 —
      a landmark, like the map, never un-happens).
- [ ] Which levels are place-bound is data, not a skill-id check (D-031). `04` §4.3 says 50 and 99.
- [ ] The location is where the threshold was crossed along the trace, or the activity's end cell
      when the activity has no trace. Pick one rule, record it as a decision, and test it.
- [ ] `app/skills/skill-sheet-route.tsx` reads these records instead of `NO_PLACES`. `ON THE MAP`
      appears for a skill that has one, and `→ fly to` lands the map on it.
- [ ] Existing history is backfilled once. A skill already past 50 gets its landmark at the
      activity that crossed it.

## Notes

- Filed from `0074` (D-290). The sheet's side is built and tested against a fixture; this ticket
  is only the data.
- The home coordinate rules apply (`08` §7.2, D-199). A landmark is a real coordinate near home.
  It must never be committed in a fixture, and must be served only to the owner.

## Operator validation

On **`/skills/<a skill past level 50>`** in the desktop browser: `ON THE MAP` lists its landmark.
`→ fly to` closes the sheet, and the map comes to rest on a place where that milestone could
plausibly have been earned.
