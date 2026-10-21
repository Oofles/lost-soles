---
id: 302
slug: rebuild-drill-landmark-backfill-into-the-target-stack
title: Rebuild drill: landmark backfill into the target stack
type: feature
priority: med
status: open
size: s
capability: 16-rebuild-drill
depends_on: []
blocked_by: []
source: agent
created: 2026-10-21T03:53:25Z
started: 2026-10-21T19:31:20Z
---

## Description

§8.3 step 6 (D-307) runs tools/landmarks/backfill-landmarks.ts after the XP replay, but that tool is hard-wired to the live tables, so a stack rebuilt by the drill (0103, D-406) would have no landmarks. Make the backfill accept the drill's target parameter and run it as part of the drill's step 6. Found by 0103.

## Acceptance criteria

- [x] `tools/landmarks/backfill-landmarks.ts` accepts the drill's target (D-406) and writes only to
      the target's tables, refusing live names the same way the drill does.
- [x] The drill's `--phase=rebuild` runs the backfill after step 6, before step 8.
- [x] A test asserts a drill into an in-memory target produces the same landmark set as the live
      backfill over the same fixture history.

## Notes

Found by `0103` (wave 16.2). Should land before `0105` runs the drill for real, or `0105`'s rebuilt stack will have no landmarks.

## Resolution

The drill now rebuilds landmarks. The backfill's walk-and-place is one function, used by both the
standalone tool and the drill's step 6. The target gains a sixth table role, `landmark`.

**Files touched**

- `src/pipeline/landmarks.ts`: `backfillLandmarks()` (the ledger walk, then each crossing placed on
  its route at the arc), taken out of the tool. `landmarkPutItem()` is the same row as
  `landmarkUpdateItem` written as a `PutItem` on `attribute_not_exists(userId)`. The two share
  `landmarkFields`/`landmarkItemKey`, so the attributes cannot drift apart.
- `src/pipeline/landmark-backfill.ts` (new): the tool's two reads, `readWalkRows` (T4
  `byUserAndSeq`, paginated) and `readStoredRoute` (prefix-aware).
- `src/pipeline/rebuild-drill-back.ts`: `DrillTarget.tables.landmark`; `TARGET_TABLE_ROLES`, which
  `targetCollisions` now iterates in place of `Object.entries`, so a target file without
  `landmark` (pre-`0302`) is refused with "target landmark table is empty"; `DrillStore.putLandmarks`;
  `backfillTargetLandmarks()` runs at the end of step 6, after T1 and before step 7's generation
  raise. It reads the routes back from the target, as step 5 reads its cells. The summary gains
  `landmarks: { written, placed }`.
- `src/pipeline/rebuild-drill-store.ts`: `putLandmarks`, one conditional `PutItem` per landmark
  into `target.tables.landmark` (D-408).
- `tools/landmarks/backfill-landmarks.ts`: `--target <target.json>` reads the target's ledger,
  SkillState/Profile (for the rules version) and routes (behind its prefix), and writes only the
  target's `landmark` table, through `dynamoDrillStore().putLandmarks`. A live target is refused
  before any client exists, by `targetCollisions` + `liveNamesFromOutputs` (exit 4). An existing
  landmark in the target exits 5 (D-408: rerun into fresh tables). With no `--target`, behaviour
  is unchanged: live tables, `if_not_exists`, dry run by default.
- `tools/drill/rebuild-drill.ts`: one doc line, adding `landmark` to the target JSON. The CLI
  needed no other change because step 6 lives in `runDrillBackHalf`.
- `src/pipeline/rebuild-drill-back.test.ts`: `TARGET.landmark`, `MemoryStore.putLandmarks`, and a
  new `0302` describe. Criterion 3 runs a drill into an in-memory target and a "live" backfill
  through the tool's own reads (paginated `byUserAndSeq`, S3 routes) over a clean run's ledger and
  routes, and asserts equal sets: more than one landmark, including a 99, at least one placed on a
  route. It uses rules paying 10,000x so the fixture's sub-km lines cross 50 and 99. The describe
  also covers ordering (after `t1`, before `gen`), none below 50, refusal of a missing or live
  `landmark` role, and the wire shape (`attribute_not_exists(userId)` in the target table).
- `src/pipeline/landmarks.test.ts`: `landmarkPutItem` equals the row `landmarkUpdateItem` leaves
  on a fresh key.
- `docs/02-data-model.md` §8.3 step 6: a `0302` note on the in-process backfill, the sixth role,
  the conditioned put and the tool's `--target`.

**Decisions (proposed to the orchestrator, not recorded):** the target has six table roles, not
D-406's five. Drill landmark writes are conditioned creates, not `if_not_exists`. The drill reads
ledger rows from step 6's memory (check 5 then proves they persisted) and routes from the target.

**Why in the back half and not by shelling out to the tool:** criterion 3 needs the in-memory
target. One `backfillLandmarks` keeps the drill and the tool from ever placing a landmark
differently, as D-413 does for the fold.

## Operator validation

Smoke test, agent's to run: the in-memory rehearsal from `0103`, with the landmark count compared against the live `Landmark` table. No perceptual check.

- **Rehearsal (read-only, 2026-10-21):** the live front half for `5488e4b8-…` ran, then steps
  4–8 went into an in-memory `DrillStore`. No AWS writes. 116 activities, 5,211 cells, rules v3,
  total XP 70,994, all six step-8 checks pass. **Rebuilt landmarks: 0. Live `Landmark` table
  (full Scan): 0 rows.** The counts agree. It is a weak comparison, because no skill has reached
  50 yet (the highest XP sits far below the 161,700 that level 50 needs). The non-empty case is
  proven by the criterion-3 test.
- Guards from `amplify.yml`, `typecheck`, `lint`, `vitest` (4,293 passed) and `build` all green.
