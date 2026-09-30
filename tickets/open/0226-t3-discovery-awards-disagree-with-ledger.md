---
id: 226
slug: t3-discovery-awards-disagree-with-ledger
title: Five real T3 discovery awards disagree with the ledger's Cartography credit
type: bug
priority: med
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: [220]
blocked_by: []
source: agent
created: 2026-09-30T03:33:03Z
---

## Description

Found while smoke-testing `0220`, 2026-09-29. `0220` stops **future** deliveries overwriting T3's
discovery award. It does not repair rows that were already wrong. On the operator's real data, 5 of
17 `Activity` rows disagree with their own ledger. The check compares T3's
`newCellCount + 0.5 × rearmedCellCount` against the `units` on the activity's non-floor
`cartography` rows in T4:

| activity | startedAt | T3 credit | ledger credit | likely cause |
|---|---|---|---|---|
| `7d6c71cf…` | 2026-09-28 | 0 (121 cooled) | 32 | **`0220`'s bug.** Receipt `attempts: 2`, reprocessed 2026-09-29T18:28Z; the reingest's all-`cooled` reclassification overwrote the first award |
| `42286384…` | 2026-08-21 | 0 (70 deferred) | 16 | T3 still holds the provisional §3.4 award; the XP replay (`0066`) folded the history and rewrote T4, but not T3 |
| `4ab05c72…` | 2026-08-26 | 0 (116 deferred) | 46 | same |
| `ab00f078…` | 2026-09-07 | 46 | 0 | T3 holds a first-delivery award that the fold gave to an earlier activity |
| `0232ac74…` | 2026-09-10 | 16 | 0 | same |

Two different defects are involved. The first row is `0220`'s bug, already fixed for future
deliveries but not repaired in stored data. The other four are the **fold's** result never
reaching T3. That is the award counterpart of `0224` (`xpAwarded`/`xpRulesVersion` go stale after
an XP replay). `05` §3.4 says the deferred count marks a row as provisional until a replay folds
the history. The replay folds the history and leaves the row provisional.

What reads the wrong numbers: the post-run card and the activity list (`05` §3.2). Neither is built
yet, so nothing user-visible is wrong today. It will be from capability 12 onward.

## Acceptance criteria

- [ ] Decide which source is authoritative for a repaired award. Probably the fold, since T4 is
      the ledger of record, but the ledger stores only credits (`new + 0.5 × rearmed`), not the
      split, so the split has to be re-derived from the fold rather than read back.
- [ ] The XP replay (or a step beside it) writes the folded award back to T3, so a replayed
      activity's row stops being provisional. Coordinate with `0224`, which touches the same
      rows for `xpAwarded`.
- [ ] A one-off repair runs against the operator's data, and the check above reports 0 mismatches
      afterwards.

## Steps to reproduce

1. Scan T4 for non-floor rows whose `id` contains `#cartography#` and sum `units` per `activityId`.
2. Scan T3 for `newCellCount` and `rearmedCellCount` per `id`.
3. Compare `new + 0.5 × rearmed` against the T4 sum for each activity.

## Expected vs actual

**Expected:** every activity's T3 credit equals its ledger credit.

**Actual:** 5 of 17 differ (table above), in both directions.

## Notes

The audit query is a two-table scan: T4 filtered on `#cartography#` in `id`, and T3's award
columns. It was run from the scratchpad and is simple to re-create. Consider keeping it as a
script, since "T3 agrees with T4" is exactly the kind of invariant that drifts silently.

Filed from `0220` (D-260). Related: `0224`, `0066`, `0050`.

## Operator validation

TODO — the audit query above, before and after, reporting 0 mismatches.
