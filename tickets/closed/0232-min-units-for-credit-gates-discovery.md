---
id: 232
slug: min-units-for-credit-gates-discovery
title: minUnitsForCredit does not gate discovery: a sub-250 m run reveals cells
type: feature
priority: med
status: closed
size: s
capability: 07-fog-projection-and-cells
depends_on: [218]
blocked_by: []
source: agent
created: 2026-10-01T20:31:55Z
started: 2026-10-01T20:42:21Z
closed: 2026-10-01T21:47:15Z
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

- [x] An activity reveals ground only if a matched `revealsGround: true` row's measured units are
      at or above that row's `minUnitsForCredit`. The threshold is read off the row, never a literal
      (D-031).
- [x] Ingest and the XP replay apply the same gate through the same function, so a replay cannot
      reveal or credit what ingest refused.
- [x] Below the threshold: no `ExploredCell` writes, no Cartography row. ~~The activity XP rows are
      unchanged~~ Wayfaring is still paid, *amended 2026-10-01 (D-270):* at the recent-ground
      rate, not "unchanged". With no reveal
      there is no ground split, and `rateGround`'s no-path default applies. The operator chose this
      over a read-only classify; see Resolution.
- [x] On a row with `revealsGround: false` the field changes nothing (D-269).
- [x] Tests: just under and just over 0.25 km, at ingest and through the replay.

## Notes

Check whether any live activity under 0.25 km has already revealed cells. If one has, those cells
stay revealed (D-020) and the Cartography stays paid (D-135). Record it, do not try to undo it.

## Resolution

**The gate.** `revealsGround(activity, registry)` (`src/rules/reveals-ground.ts`) now takes a
`ScorableActivity` (the matcher's three fields plus `distanceM` and `sets`). A matched row
reveals only if its `revealsGround` is true **and** `measureUnits(activity, row.match.measure) >=
row.minUnitsForCredit`. The threshold is inclusive and comes from the row. On a
`revealsGround: false` row the `&&` short-circuits, so the threshold is never read (D-269).
`MatchableActivity` and the matcher are untouched: distance still never decides *which* skill
matches. `matchable()` had no callers left, so I removed it along with its test.

**Callers.** There are three, not the two the ticket named: `process-activity.ts` (ingest),
`xp-replay.ts` (replay) and `t3-repair.ts` (T3 repair). All three now pass the full activity. The
repair path was missing from the ticket. Without the change it would have planned a Cartography
award for a run that ingest refused.

**A question the criteria didn't settle (D-152), asked and answered.** A refused reveal leaves no
ground split. `rateGround` then pays the ground-scored skill as one `recent_ground` row at 0.5×,
so a 200 m run earns 10 Wayfaring XP instead of 20. That conflicts with criterion 3's "unchanged".
The operator chose to keep the recent rate. It is the lowest rate (D-135), and it does not pay a
new-ground premium for cells that stay unrevealed. Recorded as **D-270**. `04` §3.5 is amended
with one paragraph, and the criterion is amended in place.

**Tests.**
- `src/rules/reveals-ground.test.ts`: 249 m vs 251 m, exactly at 250 m (inclusive), no
  distance at all, the threshold moving when the row's value is raised, and a 40 km ride still
  revealing nothing even with its row's threshold zeroed. The fixture now carries `distanceM: 5000`
  and `sets: []`.
- `src/pipeline/process-activity.test.ts`: 249 m writes no cells and produces ledger rows
  `[recent_ground, constitution_share]`. 251 m writes cells and produces
  `[new_ground, cells_new, constitution_share]`. The shared `TRACED_RUN` fixture had no
  `distanceM`, and 18 existing tests failed under the gate until I gave it 280 m. That matches the
  `RUN` fixtures the `0062` tests already used.
- `src/pipeline/xp-replay.test.ts`: a 249 m / 251 m pair seeded by ingest, where a v1 → v1 replay
  agrees and writes no floors. Also a 249 m run whose cells are already on disk, as if ingested
  before this gate: the replay still writes no Cartography row and leaves T3 `cellCount` at 0, and
  `planT3Repair` plans no award for it.
- Mutation check: with the `measureUnits` clause removed, 6 of the new tests fail.
- Full suite: 2519 passed, 1 skipped. `tsc` and `check-boundaries` are clean. Lint is clean
  except for 2 errors in `tmp/0198/verify.ts`, a stray local file outside git that CI never sees.

**Live data (the Notes' check).** A DynamoDB scan of `Activity` found 18 rows, all traced runs
from 1,043 m to 8,562 m. None is under 250 m, so there are no already-revealed cells to record and
the change has no live effect.

**Found along the way, filed as `0233`.** The read-only T3 audit reports 1 mismatch and plans 6
rewrites on live data. The output is identical with and without this change, so it predates it.

## Operator validation

No perceptual check. The change is invisible on the live map today, because no live activity
is under the threshold.

Smoke test (agent, 2026-10-01, `devault` profile, us-east-1):
- `aws dynamodb scan` on `Activity-…-NONE` with filter `distanceM < 250`: Count 0 of 18 scanned.
- `tools/xp-replay/repair-t3.ts --user <sub>` (dry run, nothing written), run against the live
  tables with and without this change: byte-identical output. The new gate changes nothing on
  live data, and the replay and repair paths load and run against the real store with the new
  signature.
