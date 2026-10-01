---
id: 229
slug: concurrent-ingest-undercounts-visitcount-an-overtaken-write
title: Concurrent ingest undercounts visitCount: an overtaken write lands nowhere
type: bug
priority: low
status: open
size: s
capability: 07-fog-projection-and-cells
depends_on: []
blocked_by: []
source: agent
created: 2026-10-01T19:11:58Z
---

## Description

**Found by `0228`'s smoke test, 2026-10-01.** Five overlapping synthetic runs, read together and
written concurrently against a throwaway T6 table: credit and AGG settled exactly (D-268), but
`visitCount` summed to **164 against 340 real visits**.

The cause is the hole `explored-cells.ts`'s `firstRunBackfill` doc already names: an activity
strictly between a cell's `firstRunAt` and `lastRunAt` satisfies neither the `max` nor the `min`
condition and writes nothing, so its visit is never counted. Sequentially that only happens to
an out-of-order middle arrival, which §3.4 replays and the fold (§2.9) recomputes. Concurrently
it is routine: a run reads the cell, classifies it `cooled`, and before its write lands a LATER
run has moved `lastRunAt` past it. That run is not `deferred`, so it marks no replay, and nothing
repairs its visit unless some other activity in the batch happened to.

`visitCount` is not scored and feeds no XP (`02` T6: *"most-run ground; a future heat view"*), so
this is cosmetic today. It is filed so the heat view does not inherit it silently.

## Acceptance criteria

- [ ] An activity whose unclaimed cell write is overtaken by a later activity still has its visit
      counted exactly once, or marks the §3.4 replay so the fold recounts it. A test drives the
      interleaving.
- [ ] Replaying an activity still does not grow `visitCount` (`0228`'s replay test stays green).

## Steps to reproduce

1. `tmp/0228/smoke.ts` (gitignored; recreate from `0228`'s Resolution if gone): five runs within
   one week sharing a disk of cells, all `readCells` first, then `writeCells` concurrently.
2. Sum `visitCount` over the cell rows; compare with the sum of each run's distinct cells.

## Expected vs actual

**Expected:** `visitCount` sums to 340, one per activity per cell.

**Actual:** 164. Every overtaken `cooled` write landed nowhere.

## Notes

- Candidate, **not decided**: when both conditional writes fail and the verdict was not
  `deferred`, re-read and, if `lastRunAt` is now in this run's future, treat it as `deferred`
  (mark the replay) rather than `unchanged`. That reuses §3.4 instead of a third write shape.
- Low priority because nothing reads `visitCount` yet. Raise it when the heat view is planned.

## Operator validation

None beyond a smoke test: the reproduction above, with `visitCount` summing to the real visits.
