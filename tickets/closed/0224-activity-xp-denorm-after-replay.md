---
id: 224
slug: activity-xp-denorm-after-replay
title: Activity.xpAwarded and xpRulesVersion go stale after an XP replay
type: bug
priority: med
status: closed
size: s
capability: 09-xp-engine-and-ledger
depends_on: [66]
blocked_by: []
source: agent
created: 2026-09-29T13:55:21Z
started: 2026-09-30T19:11:44Z
closed: 2026-09-30T19:14:52Z
---

## Description

Found while building `0066`. T3 `Activity` carries `xpAwarded` and `xpRulesVersion`,
denormalised from the ledger at ingest (`src/pipeline/persist.ts`, `0062`) for the activity list.
The XP replay rewrites every ACTIVE activity's ledger rows under the new ruleset, but it does not
touch T3, so after a rebalance each row still shows the old award and the old version. The ledger
is authoritative, so no total is wrong. But the run list and `/run/:id` would show a per-run number
that disagrees with the rows the skill sheet itemises.

## Acceptance criteria

- [x] After a replay, every ACTIVE activity's `xpAwarded` equals the `SUM` of its ledger rows and
      `xpRulesVersion` names the target version. *(Amended in closing: `null` for an activity
      with no ledger rows, which is ingest's rule. See Resolution.)*
- [x] A tombstoned activity's T3 row is not modified (its rows are kept as awarded, D-258).
- [x] Idempotent: re-running the same replay writes identical T3 values.

## Steps to reproduce

1. Replay a user from v1 to a stingier v2 (`tools/xp-replay/replay-xp.ts`).
2. Read any of their `Activity` rows.

## Expected vs actual

**Expected:** `xpAwarded` is the v2 sum and `xpRulesVersion: 2`.

**Actual:** the v1 values.

## Notes

The natural place is step 3 of `replayUser`, as one `UpdateItem` per activity through a new
`ReplayStore` method. It needs only the per-activity sums that step 3 already computes.

## Resolution

**What changed.** Replay step 3 now writes each ACTIVE activity's score back to its T3 row, right
after `putLedger` and before the T6 merge.
- `src/pipeline/xp-replay.ts`: new `ActivityScoreWrite` type and `ReplayStore.writeActivityScores`.
  Step 3 keeps each activity's scored rows and records `sumXp(rows)` and the version. The write
  comes after the ledger, so T3 never shows a number T4 does not hold yet. A crash between the
  two is healed by the re-run, which writes the same values.
- `src/pipeline/xp-replay-store.ts`: `activityScoreItem`, one `UpdateItem` per row. It sets
  `xpAwarded`, `xpRulesVersion` and `updatedAt` only, conditioned on
  `attribute_exists(id) AND status = ACTIVE`. The orchestrator already skips tombstoned
  activities. The condition is the table-level guard, in the same style as the file's other
  writes, and it also stops a stray id creating a half-row.

**Criterion 1 amended.** An active activity that earned nothing has no ledger rows. Ingest writes
`xpRulesVersion: null` for such an activity (`LedgerCommit`), so the replay does too. Stamping the
target version would make a v1 → v1 replay stop being a no-op on T3, and a version with nothing
citing it means nothing. The criterion's "names the target version" holds for every activity that
has rows.

**Tests.** `xp-replay.test.ts`: the MemoryStore gained a T3 map, seeded the way ingest writes it.
The v1 → v1 no-op test now also asserts T3 is unchanged. A new describe covers:
- a stingier replay makes T3 match the ledger's sum and v2, and the fixture must really change
  some numbers for this to count
- a tombstoned row stays exactly as awarded
- a second replay writes identical rows
- the write is ordered after `putLedger` and before `mergeCells`

`xp-replay-store.test.ts` asserts the command shape. 44/44 pass, and `tsc` and lint are clean.

**Snag.** The first run failed the 0067 rebuild-drill test. The drill's rebuilt stack had no T3
rows, so the MemoryStore refused the write. A rebuilt stack re-ingests T3, so the store now
creates an unscored T3 row for every fixture activity in its constructor.

**Finding, carried to `0226`.** The smoke test showed that **15 of the operator's 17 T3 rows**
hold `xpAwarded: 0` with no `xpRulesVersion`. Most were ingested on 2026-09-07, before `0062`
added the columns, and only the two newest rows carry real values. This ticket only corrects rows
when a replay runs, so it does not repair them. `0226`'s one-off repair writes the same columns
from the ledger.

## Operator validation

None needed. Nothing user-visible reads these columns yet (capability 12). Smoke test against the
real tables (`Activity-…-NONE`, profile `devault`, 2026-09-30), running `dynamoReplayStore`'s
`writeActivityScores` directly. A full replay was not run, because it would add a
`ReplayRun` chronicle entry (D-258) for a test:
- A same-value write to `2460ebe8…` (T3 1388 XP, v1, equal to its ledger sum) was accepted.
  `GetItem` afterwards shows `xpAwarded 1388`, `xpRulesVersion 1` and a new `updatedAt`. The
  condition and the local credentials both work against the real table.
- A write to a nonexistent id was refused with `ConditionalCheckFailedException`, and no row
  was created.
- The operator has no tombstoned rows, so the ACTIVE half of the condition was checked only in
  unit tests.
