---
id: 66
slug: xp-replay-job-retained-floor
title: Replay job — clear non-floor rows, write retained_floor, ReplayRun audit, levelHighWater
type: feature
priority: high
status: closed
size: m
capability: 09-xp-engine-and-ledger
depends_on: [61, 62, 63, 64]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-29T13:38:02Z
closed: 2026-09-29T14:09:22Z
---

## Description

A rebalance is: write `rules/xp-rules-v2.yaml`, seed T5 partition `2`, run the replay job.
**Ship the job in MVP, before it is needed** — an untested recompute path is not a recompute
path.

The procedure is `02-data-model.md` §4.4, per user (D-014: six users, one at a time, so a
partial failure is resumable rather than global):

```
0. PRE-FLIGHT   read every SkillState → waterline[skill] = {xp: displayedXp,
                level: max(level, levelHighWater)}. THIS IS THE D-135 WATERLINE.
1. FREEZE       Profile.replayInProgress = true; the UI keeps reading pre-replay SkillState,
                so no number ever visibly flickers downward.
2. CLEAR        delete every XpLedgerEntry WHERE isFloor = false (GSI2 byUserAndSeq, 25/write).
                isFloor rows SURVIVE.
3. REPLAY       Activity GSI1 byUserAndStart ascending, ties by activityId; fold
                cells/<uid>/<activityId>.cells.bin in the SAME order to reconstruct the D-120
                ground answer AS IT WAS, from facts — NOT from ExploredCell, which is a cache
                of this very fold.
4. REBUILD      ExploredCell + blobs from the same fold; bump generation ONCE at the end.
5. RECONCILE    against the waterline. The only step that may add rows.
6. THAW         write SkillState; clear the flag; write the chronicle entry.
```

**D-135 is enforced inside the ledger, not by a clamp** (D-142). If the new ruleset produces a
lower total for a skill, the shortfall is written as a deterministic **`retained_floor` row**
with `isFloor: true` and `activityId: "__floor__"`. That keeps `displayedXp == SUM(ledger)`
true (I-15), makes the retention **auditable**, and makes re-running the same replay
**idempotent** rather than additive. Clamping a computed value would hide the discrepancy and
compound it across successive rebalances.

**`levelHighWater` is a second, independent ratchet** (I-17). The XP floor covers *rate*
changes; it does not cover *curve* changes, which can lower a level at unchanged XP. Levels are
memories — the displayed level must never fall because the curve was edited.
`levelHighWater = max(levelHighWater, computedLevel)`.

`ReplayRun` is written as a reserved-partition item in T4 (`id = REPLAY#<userId>#<ulid>`) with
`waterline`, `recomputed`, `floorsWritten` and `status`, and `xpAwarded: 0` so it is harmless to
any SUM sweeping the partition. It must be written in step 0 and survive a crash in step 5.

## Acceptance criteria

- [x] The job runs per user and is resumable: killing it mid-step-3 and restarting produces the
      same final state.
- [x] Step 2 deletes only rows with `isFloor = false`; a test asserts every `isFloor = true` row
      survives a replay.
- [x] Replay order is `startedAt` ascending with ties broken by `activityId`, and the ground
      fold reconstructs `firstRunAt`/`lastRunAt` from `cells.bin`, not from `ExploredCell`.
- [x] Applying a **stingier** ruleset to the fixture produces: (a) no skill's `displayedXp`
      falls, (b) the shortfall appears as `retained_floor` rows summing to exactly the gap,
      (c) replaying twice produces the **same** floor rows, not doubled ones (I-16).
- [x] Applying a ruleset that changes **only** `stepFormula` leaves XP untouched and no displayed
      level falls; `levelHighWater` ratchets (I-17).
- [x] `displayedXp == SUM(xpAwarded)` holds for every skill **after** the replay (I-15).
- [x] A `ReplayRun` row is written in step 0 with `status: RUNNING`, updated to `DONE`/`FAILED`,
      and carries `waterline`, `recomputed` and `floorsWritten`.
- [x] `ReplayRun.xpAwarded === 0` and a SUM over the user's partition is unaffected by it.
- [x] `Profile.replayInProgress` is raised in step 1 and cleared in step 6, and `SkillState` is not
      written before step 6, so no displayed number can change during the run. *Amended
      2026-09-29 (operator's decision): the READ-side gate and the "nothing flickers" check move to
      `0073`, because the `/skills` panel they need is still a stub. See Resolution.*
- [x] `generation` is bumped exactly once, at the end of step 4.
- [x] The chronicle entry is written on completion (*"The rules of the world shifted… nothing was
      taken away."*). *It is the `ReplayRun` row with `status: DONE` (D-258); `0088` renders it.*
- [x] A replay with an **unchanged** ruleset is a no-op: identical rows, zero floor rows.

## Notes

Volume makes this cheap: 2,000–5,000 activities and 20k–50k cells at five years, so a full
replay is seconds and a few hundred thousand RRU/WRU — well under a dollar, once. There is no
reason to optimise it and every reason to keep it obvious.

The reconciliation in step 5 is the only place in the system permitted to invent a ledger row.
Keep it in one function, keep it deterministic (the floor amount is `waterline − recomputed`,
nothing else), and keep its test at the top of the file.

Do **not** implement D-135 as `Math.max(newXp, oldXp)` anywhere. If that expression appears in
the write path, this ticket has failed regardless of the tests passing.

## Operator validation

**Nothing here needs the operator today** (D-181/D-229). The screen the original text named, the
`/skills` panel, is still a stub. That perceptual check has moved, word for word, into `0073`'s
Notes (operator's decision at the start of this ticket). Everything below was run by the agent on
2026-09-29 against account `286588821906`.

**Automated.**
- `npm run typecheck` and `npm run lint` are clean.
- All 130 test files pass (2,397 tests).
- Every gate script passes. That includes `check-fog-hot-path` (I-7: *no delete reachable from
  anything that knows T6*), which caught a real problem in the first draft; see Resolution.
- `docs/INDEX.md` is regenerated, and `tickets.mjs validate` reports 0 errors.

**Deploy.** Amplify job 245 (commit `90f5cd0`) SUCCEEDED, and `Profile-nog4xy2l7baqlhghpndh2565qe-NONE`
exists. AppSync serves `create/update/deleteProfile` for the owner's preferences. The synth test
(`amplify/profile-model.test.ts`) proves the four pipeline-owned fields compile to owner-`read`.

**Live smoke test: 23/23, on the deployed tables and bucket.** It ran the shipped `replayUser` and
`dynamoReplayStore` as the synthetic user `smoke-0066-<ts>`. Five activities were seeded through
the real ingest item builders: three traced runs over two lines, a treadmill run and a strength
session, with `cells.bin` in S3 and deliberately **no T6 rows** (a lost cache).

| # | What it proved |
|---|---|
| A1–A2 | **v1 → v1 is a no-op:** identical rule rows (12), zero floors, `displayedXp` unchanged, `level`/`levelHighWater` written. |
| A3 | T1 `Profile` row created with `__typename`/`owner`, `replayInProgress: false`, and totals. |
| A4 | The `ReplayRun` in T4 is `DONE`, has `xpAwarded: 0`, and carries `waterline`, `recomputed`, `floorsWritten` and `finishedAt`. |
| A5 | Step 4 rebuilt all 84 lost T6 cells from `cells.bin`. The 42 cells run twice carry `visitCount: 2` and the fold's first/last run times. |
| A6, B6 | One generation is published per replay (1, then 2). |
| B1–B3 | **Killed mid-step-3** (a trace read throws): the `ReplayRun` is `FAILED` with its waterline, the flag is still up and SkillState is untouched. A restart **resumed the same run id** and finished `DONE`. |
| B4–B5 | **Stingier v2:** no `displayedXp` fell. The floors are exactly the gap: constitution 317, might 80, vigil 150, wayfaring 725. Ids are `__floor__#<skill>#v1-2`, with `supersedesRulesVersion: 1`. |
| C1 | Replaying v2 again writes **no** floors, and the floor rows are byte-identical (I-16c). |
| D1–D2 | **Curve-only v3** (`6 * L^2`): XP is untouched; five skills' computed level fell, and `levelHighWater` held every one; `Profile.totalLevel` = Σ displayed levels. |
| E1–E4 | **The table refuses** a lower `displayedXp`, a lower `levelHighWater`, a floor delete (I-18) and a floor overwrite. Each is `ConditionalCheckFailed` from real DynamoDB. |
| E5 / I-15 ×3 | Four ReplayRuns, all `xpAwarded: 0`. `displayedXp == xpLedgerSum == SUM(ledger)` after every replay. |

Cleanup: 20 ledger rows, 5 SkillState, 1 Profile, 5 Activity, 91 T6 items and 20 S3 objects were
deleted; 0 remain.

**Shadow replay of the operator's real data, v1 → v1 (read-only; every write captured in memory).**
It read the real T2/T3/T4, the 16 real `cells.bin` objects and **the 17 archived raw payloads
through the shipped Strava normalizer**.
- **Scoring:** 17 activities, 57 ledger rows, 0 floors. Wayfaring 4,218 XP (L15), Cartography
  13,455 (L22, which is 1,035 cells × 13), Constitution 1,405 (L10). Total Level 53, 19,078 XP.
- **The fold against real T6:** 0 of 1,035 cells missing, and first/last run times agree
  everywhere. 213 rows would have `visitCount` raised, e.g. 4 → 10. That is `firstRunBackfill`'s
  documented out-of-order hole (`explored-cells.ts`), which the merge repairs upward.
- **Not executed for real.** Your account has **no XP at all yet**: all 17 Activity rows carry
  `xpAwarded: 0` and T4 is empty. A real `--confirm` run would be the first award of your
  history, so it is left for you to decide.

The CLI dry run (`tools/xp-replay/replay-xp.ts --user <sub> --to 1`) on the real account printed
its plan and wrote nothing.

**Real run, 2026-09-29, on the operator's instruction** (after close; the operator said *"Yes, I do
want the permanent XP from the existing 17 runs"*). The command was
`replay-xp.ts --user <sub> --to 1 --confirm`, and it matched the shadow exactly:
- **Ledger:** 57 rows, 0 floors. The run is `REPLAY#…#0MUMREDT63RQHZ1`, status `DONE`.
- **Map:** T6 raised on 213 `visitCount`s, with 0 cells created; the map is at generation 62.
- **SkillState:** Wayfaring 4,218 XP (L15), Cartography 13,455 (L22), Constitution 1,405 (L10),
  and `displayedXp == xpLedgerSum == SUM(ledger)` for all three.
- **Profile:** `replayInProgress: false`, `totalXp: 19078`, `totalLevel: 53`.

## Resolution

**Scope, settled with the operator before any code (D-152).**
1. T1 `Profile` did not exist and no ticket built it. The operator chose to **build it in this
   ticket** (option c).
2. The chronicle entry **is the `ReplayRun` row with `status: DONE`**. `02` never said where the
   line lives.
3. The READ-side gate and the flicker check are **amended onto `0073`**, because there is no panel
   yet to gate. Both criteria are amended above, with the reason on each.

All of this is recorded in **D-258**.

**Files.**
- `src/pipeline/xp-replay.ts` — `replayUser` runs §4.4 steps 0–6 over a narrow `ReplayStore`.
  It is resumable by construction: an unfinished run's waterline is reused, and every step is
  idempotent.
- `src/scoring/reconcile.ts` — step 5, **the only code that invents a ledger row**, plus
  `waterlineOf` and `ratchetLevel`. Its tests sit at the top of `reconcile.test.ts`.
- `src/pipeline/xp-replay-store.ts` — DynamoDB/S3. Every number-lowering write is refused by a
  **condition**: THAW's `displayedXp`/`levelHighWater`, floor create-only, deletes require
  `isFloor = false`.
- `src/pipeline/explored-merge.ts` — step 4's monotone T6 merge.
- `src/scoring/score-activity.ts` — the scoring chain, now shared by ingest and replay so the two
  cannot drift.
- `src/scoring/levels.ts` — honours `curve.stepFormula`.
- `src/domain/fold.ts` — a per-activity observer that hands out each activity's classification.
- `amplify/data/resource.ts` — T1 `Profile`, and the T4 ReplayRun/floor fields.
- `tools/xp-replay/replay-xp.ts` — the CLI, dry run by default.
- Tests: `xp-replay.test.ts` (22), `xp-replay-store.test.ts` (12), `reconcile.test.ts` (12),
  `profile-model.test.ts` (10), plus curve tests in `levels.test.ts`.
- `docs/02-data-model.md` T1, §4.4 step 2, §4.5 and §4.6 are amended to match D-258.

**What went wrong, or differed from the plan.**
- **`stepFormula` was decorative.** `levels.ts` hard-coded `4L²`, so the I-17 criterion
  ("change only `stepFormula`") could not have failed. It now parses `"<k> * L^2"` and throws on
  anything else.
- **Tombstones contradicted the procedure.** §4.4 re-scores ACTIVE activities only, while §4.7
  keeps a tombstone's rows. Clearing them would have floored every tombstone, and v1 → v1 would
  not have been a no-op; the first test run showed exactly that. Step 2 now keeps those rows.
- **The ground split needs the path, not just the cells.** `cells.bin` gives the
  classification, but D-120's metres-by-ground needs geometry. The route GeoJSON is rounded to
  6 dp, so the replay reads the exact archived object `Activity.raw` names, through the shipped
  normalizer. If an activity has projected cells and its trace cannot be loaded, the replay
  **throws** rather than silently scoring it as pathless.
- **The I-7 gate failed the first draft.** The store both named T6 and imported
  `DeleteCommand`/`BatchWriteCommand`. The T6 merge moved to its own file. The gate was right,
  and working around it would have been the bug.
- **Step 2 uses a conditional `DeleteItem` per row**, not §4.4's 25-row batch, because a batch
  cannot carry I-18's guard.
- **`vite-node` needs `--config vitest.config.ts`** to resolve `@/`. The CLI header says so.
- The `(operator)` flicker check was never mine to tick. It moved with the operator's agreement,
  not by being ticked.

**Known limits, filed.**
- `0223`: an ingest committing mid-replay can lose or double one activity's XP. I-15 still holds.
- `0224`: T3 `Activity.xpAwarded`/`xpRulesVersion` are not refreshed by a replay.
- The 2025-08-04 run has no `cells.bin` (`0193`), so a replay scores it without a ground split,
  like ingest would score a pathless run.
