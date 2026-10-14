---
id: 229
slug: concurrent-ingest-undercounts-visitcount-an-overtaken-write
title: Concurrent ingest undercounts visitCount: an overtaken write lands nowhere
type: bug
priority: low
status: closed
size: s
capability: 07-fog-projection-and-cells
depends_on: []
blocked_by: []
source: agent
created: 2026-10-01T19:11:58Z
started: 2026-10-14T18:15:37Z
closed: 2026-10-14T18:22:34Z
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

- [x] An activity whose unclaimed cell write is overtaken by a later activity still has its visit
      counted exactly once, or marks the §3.4 replay so the fold recounts it. A test drives the
      interleaving.
- [x] Replaying an activity still does not grow `visitCount` (`0228`'s replay test stays green).

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

## Resolution

**The ticket's candidate fix, done through the existing D-268 re-judge loop rather than a third
write shape.** `writeCells` (`src/pipeline/explored-cells.ts`), unclaimed path: when both the primary
`max` and the `firstRunBackfill` `min` fail on a cell whose verdict was NOT `deferred`, and the
`lastRunAt` it was read against is not this activity's own `startedAt`, the cell is returned to the
re-read queue as **overtaken** instead of settling `unchanged`. The re-read finds the later run's
`lastRunAt`, `classifyCells` calls it `deferred`, `awardOf` counts it, and `process-activity` step 7's
existing `needsReplay` marks §3.4's replay. The replay's fold (§2.9) recounts the visit and
`mergeFolded` takes `max(fold, stored)`, so the visit lands exactly once.

- **Redelivery stays free.** A replayed activity reads its own write (`lastRunAt === startedAt`),
  both conditions are false at equality, and the cell settles `unchanged` with no re-read, no replay
  mark and no counter movement. `0228`'s replay test is unchanged and green.
- **Bounded.** `lastRunAt` only rises, so an overtaken cell's re-read is `deferred` or (at equal
  `startedAt`) `cooled` with a matching record. Either way it settles in the next round.
  `MAX_CLAIM_ROUNDS` still applies.
- **No credit or scoring change.** `cooled` and `deferred` both award 0, and `ground.ts` maps both to
  `"recent"`. The only effects are the replay mark and the award's `cooled`/`deferred` split.
- `settled.push` moved after each unclaimed write, so `classified` carries the re-judged verdict
  rather than the stale `cooled` one.
- **New log counter `overtaken`** on `CellWriteResult`, kept apart from `contested` so that
  `contested` still means *lost credit claims* (D-268), as agreed when the approach was proposed.
  `process-activity.ts`'s traceless zero literal gained the field.
- `firstRunBackfill`'s "hole" doc now notes that concurrency makes the hole routine, and how
  `writeCells` closes it.

**Tests** (`src/pipeline/explored-cells.test.ts`, new `describe("an overtaken cooled write (0229)")`
inside the D-268 block): three runs R0 < A < B over a shared disk. A and B both read `cooled`, B lands
first, then A. The tests assert that (1) every shared cell is re-judged `deferred`, `overtaken` equals
the disk size, `contested` is 0 and `needsReplay` is true; (2) the fold of R0+A+B merged over the
stored rows gives `visitCount` 3 and `discoveryCount` 1 everywhere; (3) a redelivery of B has
`overtaken` 0, no replay and an identical store. Test (1) fails against the pre-fix writer. Existing
`toEqual` shapes gained `overtaken: 0`. Pipeline suite: 550/550.

**No design doc change.** Neither `02` T6 nor `05` describes the concurrent case. The fix reuses
§3.4 as written, so there is no new `D-xxx`.

**Went wrong along the way:** nothing in the fix. Locally the full suite shows one failure
(`adapter.test.ts`'s polyline grep) and `tsc` shows errors, all from gitignored `tmp/` leftovers
(`tmp/008x/seed.ts`, `tmp/0248/sdl.ts`). The known false failure. On a clean copy (no `tmp/`) every `amplify.yml` `scripts/` guard passes, `tsc` and `eslint --max-warnings 0` are clean, and vitest passes 3252 with 1 skipped. The 12 `amplify/` CDK suites cannot load there because of the `node_modules` symlink, and all 14 pass in the real repo.

## Operator validation

None needed from the operator: `visitCount` is invisible today (no heat view), so there is nothing
perceptual to judge.

**Smoke test (agent, `AWS_PROFILE=devault`, us-east-1, 2026-10-14):** `tmp/0229/smoke.ts`
(gitignored; `0228`'s script plus a replay step) created a throwaway PAY_PER_REQUEST T6
`lost-soles-0229-smoke-<ts>`. Five synthetic runs near Point Nemo, all within one week, sharing a
`gridDisk(…, 4)` with 61 cells. All five read first, then all wrote concurrently against the real
service:

- `overtaken: [0, 0, 60, 47, 0]` — the race fired. Runs 2 and 3 settled 60/61 `deferred` and
  `markedReplay: [false, false, true, true, false]`. **Before `0229` these were silent `unchanged`.**
- `visitCount` sum straight after ingest: 219 / 340. The undercount is still there, but now the
  replay marker owns it.
- Then `mergeFoldedCells(foldActivities(runs))`, the replay's T6 half, against the same table:
  **`visitCount` sum 340 / 340**. `maxDiscoveryCount` 1, AGG 96 at res 6/7/8 (D-268 still holds).
- Table deleted in `finally` (`deleted lost-soles-0229-smoke-1792001959646`).
