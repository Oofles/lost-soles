---
id: 232
slug: min-units-for-credit-gates-discovery
title: minUnitsForCredit does not gate discovery: a sub-250 m run reveals cells
type: feature
priority: med
status: open
size: s
capability: 07-fog-projection-and-cells
depends_on: [218]
blocked_by: []
source: agent
created: 2026-10-01T20:31:55Z
---

## Description

Split out of `0218`. `04` §3.5 (*"Very short activities"*) says `minUnitsForCredit` (0.25 km on
the distance rows) **gates discovery, not XP**: a run below it earns its Wayfaring XP in full but
reveals no cells and earns no Cartography, because the sub-250 m case is almost always a
mis-started recording and a bad reveal is permanent (D-020). D-269 confirmed that reading.

Nothing reads the field. Today a 200 m run reveals its cells and is paid Cartography for them.

The gate has to sit on the **reveal**, not on the Cartography row. Zeroing Cartography while the
fog still writes the cells would spend those cells' discovery value for nothing: they would no
longer be `new` the next time a real run covered them. `0218` refused to do it in scoring for
exactly that reason. Gate the reveal and Cartography follows, because `award` is then empty.

`revealsGround()` (`src/rules/reveals-ground.ts`) is the single question both ingest
(`process-activity.ts`) and the replay (`xp-replay.ts`) already ask. Today it takes only
`MatchableActivity`, deliberately with no distance, and that narrowing has a doc comment. The
gate needs the matched revealing row's measured units, so either that function or a sibling next
to it has to see the activity's work.

## Acceptance criteria

- [ ] An activity reveals ground only if a matched `revealsGround: true` row's measured units are
      at or above that row's `minUnitsForCredit`. The threshold is read off the row, never a literal
      (D-031).
- [ ] Ingest and the XP replay apply the same gate through the same function, so a replay cannot
      reveal or credit what ingest refused.
- [ ] Below the threshold: no `ExploredCell` writes, no Cartography row. The activity XP rows are
      unchanged (Wayfaring is still paid).
- [ ] On a row with `revealsGround: false` the field changes nothing (D-269).
- [ ] Tests: just under and just over 0.25 km, at ingest and through the replay.

## Notes

Check whether any live activity under 0.25 km has already revealed cells. If one has, those cells
stay revealed (D-020) and the Cartography stays paid (D-135). Record it, do not try to undo it.

## Operator validation

TODO
