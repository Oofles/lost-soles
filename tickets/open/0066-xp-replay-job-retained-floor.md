---
id: 66
slug: xp-replay-job-retained-floor
title: Replay job — clear non-floor rows, write retained_floor, ReplayRun audit, levelHighWater
type: feature
priority: high
status: open
size: m
capability: 09-xp-engine-and-ledger
depends_on: [61, 62, 63, 64]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] The job runs per user and is resumable: killing it mid-step-3 and restarting produces the
      same final state.
- [ ] Step 2 deletes only rows with `isFloor = false`; a test asserts every `isFloor = true` row
      survives a replay.
- [ ] Replay order is `startedAt` ascending with ties broken by `activityId`, and the ground
      fold reconstructs `firstRunAt`/`lastRunAt` from `cells.bin`, not from `ExploredCell`.
- [ ] Applying a **stingier** ruleset to the fixture produces: (a) no skill's `displayedXp`
      falls, (b) the shortfall appears as `retained_floor` rows summing to exactly the gap,
      (c) replaying twice produces the **same** floor rows, not doubled ones (I-16).
- [ ] Applying a ruleset that changes **only** `stepFormula` leaves XP untouched and no displayed
      level falls; `levelHighWater` ratchets (I-17).
- [ ] `displayedXp == SUM(xpAwarded)` holds for every skill **after** the replay (I-15).
- [ ] A `ReplayRun` row is written in step 0 with `status: RUNNING`, updated to `DONE`/`FAILED`,
      and carries `waterline`, `recomputed` and `floorsWritten`.
- [ ] `ReplayRun.xpAwarded === 0` and a SUM over the user's partition is unaffected by it.
- [ ] `Profile.replayInProgress` gates the read path so no displayed number changes during the
      run; a manual test with the app open confirms nothing flickers.
- [ ] `generation` is bumped exactly once, at the end of step 4.
- [ ] The chronicle entry is written on completion (*"The rules of the world shifted… nothing was
      taken away."*).
- [ ] A replay with an **unchanged** ruleset is a no-op: identical rows, zero floor rows.

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

On the **`/skills` panel** on the **Pixel 8 Pro**, with the app open and the panel visible: run
a replay against a deliberately stingier v2 ruleset from your laptop while watching the phone.
**No tile's level or bar may visibly decrease at any point**, including during the run. When it
finishes, pull to refresh: every level must be the same or higher. Then open the detail sheet for
whichever skill was rated down and confirm a "retained" line is present and legible — the
retention must be visible, not silent.
