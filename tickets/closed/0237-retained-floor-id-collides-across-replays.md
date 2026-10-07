---
id: 237
slug: retained-floor-id-collides-across-replays
title: A second replay over the same version pair collides on the retained_floor id and wedges ingest
type: bug
priority: med
status: closed
size: s
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-10-02T15:19:39Z
started: 2026-10-07T12:01:28Z
closed: 2026-10-07T12:07:01Z
---

## Description

**Found by capability 09's drift audit (2026-10-02).** The `retained_floor` row id is
`__floor__#<skill>#v<from>-<to>` (`src/scoring/floorId`, `src/scoring/reconcile.ts:41`), unique only
per (skill, from-version, to-version). The floor put is conditional on `attribute_not_exists(id)`
(`src/pipeline/xp-replay-store.ts:~389-396`).

A second replay over the **same version pair** that finds a fresh shortfall writes a floor with
an id that already exists. That happens on a repeated v1 → v1 replay (the D-271 remedy) after a
tombstone, or v1 → v2 → v1 → v2. The put throws at step 5, the ReplayRun goes FAILED, and
`replayInProgress` stays up — so every ingest is refused (D-273) until someone clears the flag
by hand.

`reconcile.test.ts:62` only covers re-running the *same* run, which is why this went unseen.

## Acceptance criteria

- [x] The floor id includes the ReplayRun id (or another per-run discriminator), so two replays
      over the same version pair each write their own floor row. Re-running the *same* run is
      still idempotent.
- [x] A test replays twice over the same version pair with a shortfall between them, and asserts
      both floors are present and the second run completes.
- [x] 02-data-model §4.6 states the new id shape, and the known-defect note pointing here is removed.
- [x] Existing live floor rows keep working: the reader does not depend on the old id shape.

## Steps to reproduce

1. Replay v1 → v1 for a user (`replay-xp.ts --confirm`); a shortfall writes floor `__floor__#<skill>#v1-1`.
2. Tombstone an activity that contributed to that skill.
3. Replay v1 → v1 again: the new shortfall's floor has the same id.

## Expected vs actual

- **Expected:** the second replay writes its own floor and completes; ingest resumes.
- **Actual:** the conditional put throws, the ReplayRun is FAILED, `replayInProgress` stays up, and every ingest is refused.

## Notes

- 2026-10-07: `0243` (kind override, D-284) depends on this. A per-activity re-score that leaves a
  skill short writes a floor too, and it needs the same per-writer discriminator.

## Resolution

**Fix.** `floorId(skill, from, to, runKey)` now gives `__floor__#<skill>#v<from>-<to>#<runKey>`,
and `seq` carries the same suffix. `runKey` is the ReplayRun id's time-sortable tail. A resumed
run reuses its RUNNING row's id, so re-running the *same* run still finds its own floor among
`existingFloors` and writes nothing twice. Two *different* runs over one version pair now each
write their own floor.

**Files touched:**
- `src/scoring/reconcile.ts`: `floorId` and `ReconcileInput.runKey`. `reconcile` puts the key in
  both the id and the seq.
- `src/pipeline/xp-replay.ts`: new `replayRunKey(runId)`, passed to `reconcile` at step 5.
- `src/pipeline/xp-replay-store.ts`: `replayRunItem` uses `replayRunKey` instead of its own
  inline `split`, so the run id's shape is parsed in one place.
- `docs/02-data-model.md` §4.6: the new id and seq shapes. The known-defect note is replaced
  with the reason for `runKey` and the note that legacy ids coexist. Property 3 (idempotent) is
  restated per run.

**Tests:**
- `xp-replay.test.ts`, "a second run over the same version pair…": v1→v2→v1→v2 with a stingy
  v2 gives a fresh shortfall over (1, 2). It asserts the third run is DONE, both runs' floors
  are on the ledger with distinct ids, nothing fell, and `replayInProgress` is down.
  **It was checked against the unfixed `floorId`** and fails there with exactly the defect:
  `ConditionalCheckFailed: floor __floor__#constitution#v1-2`.
  - I used v1→v2→v1→v2 rather than the ticket's tombstone repro. A tombstoned activity's rows
    are kept as awarded (D-258), so the tombstone route needs more setup to produce a shortfall.
    The version round-trip reaches the same collision directly.
- `xp-replay.test.ts`, "a floor in the pre-0237 id shape…": rewrites the floors to the legacy
  id and seq. It then checks that a same-version re-run counts them and writes no floor, and that
  a v2→v1→v2 round-trip floors beside them without colliding. This criterion matters for live
  data (below).
- `reconcile.test.ts`: fixtures carry `runKey`, plus a test that two run keys give distinct ids.
  `xp-replay-store.test.ts`: the floor id fixture.

**What went wrong:**
- Five resumability tests broke at first. They compare a resumed run's final state with a clean
  run's, and the shared `runIds` counter gave the two runs different ids, which now reach floor
  ids. I fixed this by pinning one run id (`deps(…, "RUN-R")`) on both sides, not by hiding
  floor ids in `snapshot()`, so the comparison stays strict.
- The full suite first showed 212 failures in unrelated files. They were caused by the agent
  shell's system Node v20 (`webidl.util.markAsUncloneable`, an undici mismatch) and fail on
  clean `main` too. Under fnm's Node 22: 2758 passed, 1 skipped.

**No new decision.** This implements the fix D-276 recorded as known.

## Operator validation

None for the operator: this has no UI, and the replay is an operator CLI tool, not a deployed
Lambda. Smoke tests by the agent, 2026-10-07, against the live stack (`devault`, us-east-1):

- **Live T4 floors, read only.** I scanned `XpLedgerEntry-nog4xy2l7baqlhghpndh2565qe-NONE` for
  `isFloor` and ReplayRun rows. There is exactly one floor, `__floor__#cartography#v1-2`
  (13,342 XP, legacy shape), and three DONE ReplayRuns.
  - So the legacy-shape criterion covers real data.
  - Before this fix, any future replay that floored Cartography over (1, 2) again would have
    collided with this exact row and wedged ingest. Rolling back to v1 and forward again is
    enough to cause that.
  - Nothing parses a floor id: readers key on `isFloor` and `skillId`, which I checked by grep.
- **`replay-xp.ts` dry run** on the live user `--to 2`. It reads live state cleanly (19 ACTIVE
  activities, four skills at v2) and writes nothing. This shows the tool still loads and runs
  with the changed modules. It stops before reconcile, so it does not exercise the fix itself.
- **Not done: a `--confirm` replay against live data.** It would freeze ingest and rewrite the
  user's real ledger only to prove what the in-memory store already proves. The floor put's
  `ConditionExpression` is unchanged; only the id string differs. If the operator wants it, a
  v2→v2 `--confirm` should write zero floors, because the legacy Cartography floor is counted.
