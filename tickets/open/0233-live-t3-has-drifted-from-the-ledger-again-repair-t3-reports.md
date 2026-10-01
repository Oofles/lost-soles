---
id: 233
slug: live-t3-has-drifted-from-the-ledger-again-repair-t3-reports
title: Live T3 has drifted from the ledger again: repair-t3 reports 1 mismatch and plans 6 rewrites
type: bug
priority: med
status: open
size: s
capability: 07-fog-projection-and-cells
depends_on: []
blocked_by: []
source: agent
created: 2026-10-01T21:46:19Z
started: 2026-10-01T21:59:09Z
---

## Description

Found while closing `0232`. The read-only T3 audit (`tools/xp-replay/repair-t3.ts` with no
`--confirm`), run against the live tables on 2026-10-01, reports drift that `0226` had repaired:

```
audit: 1 mismatches over 18 activities
  1fb91a42…  2025-08-04  newCellCount     T3 2  ledger 0

repair (ground rules v1): 6 rows to rewrite
  1fb91a42…  335 XP v1  new 179 rearmed 0 cooled 0 deferred 0
  66013b20…  1409 XP v1  new 49 rearmed 35 cooled 0 deferred 0
  42286384…  451 XP v1  new 6 rearmed 10 cooled 54 deferred 0
  5b6273e9…  5083 XP v1  new 293 rearmed 29 cooled 208 deferred 0
  2460ebe8…  1388 XP v1  new 14 rearmed 63 cooled 62 deferred 0
  fecb6800…  842 XP v1  new 2 rearmed 40 cooled 76 deferred 0
```

`0232` did not cause this. The output is byte-identical with and without `0232`'s change. Every live
activity is at least 1,043 m, so the new gate gives the same answer as before.

Two things need explaining. The audit finds one mismatch, but the repair plans six rewrites, so
five rows differ from the fold in a way `auditT3` does not check. And the one mismatch has T3
claiming 2 new cells while its Cartography ledger units are 0, on an activity whose fold says 179
new cells. Something written since `0226` (a reingest under `0220`? a replay?) has moved T3 or the
ledger away from what ingest-in-order produces.

## Acceptance criteria

- [x] The cause of each of the six planned rewrites is identified and recorded: which write path
      produced the current T3 value, and whether that path is still live.
- [x] If a live path still produces drift, it is fixed (or a ticket is filed for it), and a test
      reproduces it.
- [x] `auditT3` and `planT3Repair` agree on what counts as drift, or the Resolution explains why
      they legitimately differ.
- [x] The live audit reports 0 mismatches and plans 0 rewrites after the repair, which runs only
      after the cause is understood (XP never decreases, D-135). *Amended in place: the fix was a
      v1 → v1 XP replay, not the T3 repair. The Resolution explains why the repair could not
      reach 0/0.*

## Steps to reproduce

1. `AWS_PROFILE=devault npx vite-node --config vitest.config.ts tools/xp-replay/repair-t3.ts -- --user <sub>`
   (the owner's Cognito sub, from any `Activity` row's `userId`).

## Expected vs actual

**Expected:** `audit: 0 mismatches`, `0 rows to rewrite`, as `0226` left it.

**Actual:** 1 mismatch, 6 rows to rewrite (above).

## Notes

Read-only so far. Nothing was written to the live tables while finding this.

## Resolution

**Nothing in T3 moved after `0226`. What changed was the fold's input.** Found by S3 version
history, not guesswork:

- **`1fb91a42` (2025-08-04) had no `cells.bin` until 2026-10-01T15:18Z.** Its first version
  is `0193`'s `--adopt` reingest, the day after `0226`'s repair. So `0226`'s fold left out its
  179 cells. The five later runs crossing the same roads folded those cells as *new*, which
  matched the ledger that had credited them that way at ingest. `0226`'s "0/0" was clean on
  incomplete input.
- **The one audit mismatch (T3 new 2, ledger 0) was written by that adopt.** `xp-ledger.ts`'s
  `alreadyScored` branch correctly wrote no rows, because the 2025-09-07 dev-era rows stand.
  But T3 had no award columns (the row predates `0048`, and `0226` did not ground-score a run
  with no cells), so `readStoredAward` returned null. The commit then fell back to the fresh
  classification: 2 new, 177 deferred against today's map. **That path is live** for any
  already-scored row without award columns, and `--adopt` is the replay path for everything
  older than 90 days (`0193`).
- **The other five rewrites came from the fold changing, not from a write.** With the 2025 run
  folded first, its cells are more than six months older than these runs, so they *rearm*.
  T3's `newCellCount` on each is exactly the fold's new + rearmed: 84 = 49+35, 16 = 6+10,
  322 = 293+29, 77 = 14+63, 42 = 2+40. `42286384` still held exactly the values `0226` wrote.
- **`0198`'s 18-activity replay at 18:50Z rewrote every `cells.bin` byte-identically** and did
  not move T3, because `0220` kept the stored awards. Not a cause.

**Audit and repair legitimately differ (criterion 3).** `auditT3` compares T3 with T4.
`planT3Repair` compares T3 with the fold. Both read 0 only when T4 agrees with the fold, and here
it did not: the ledger held an **unsettled §3.4 deferral**. Running `repair-t3 --confirm` would
have written fold awards that the ledger never paid, and the audit would then have flagged
them. The repair cannot stand in for a replay. Recorded in D-271.

**The remedy, chosen by the operator over leaving the ledger as-is or filing it: a v1 → v1 XP
replay.** It accepts the `ReplayRun` chronicle entry that `0226` avoided, because a deferral is
exactly what §3.4 says the replay settles. Before running it I checked that `0218` (soft cap)
and `0232` (discovery gate) change nothing live: both tickets' scans found no affected rows.

**The live path, fixed here at the operator's choice** (criterion 2):
- `src/scoring/propagate.ts`:
  - `creditedCounts(entries)` is the inverse of `discoveryRows`, read by reason through the same
    `CELL_REASONS` table (D-031).
  - `ledgerAward(fresh, entries)`: new and rearmed as credited, the fresh classification's
    cooled cells cooled, the remainder deferred.
- `src/pipeline/xp-ledger.ts`:
  - `committedAward = stored ?? (alreadyScored ? ledgerAward(award, existing) : award)`.
  - `existingEntries` now also returns `reason` and `units`. `byActivity` projects ALL, so it
    needed no new read.
- `src/pipeline/t3-repair.ts`: `auditT3` uses `creditedCounts`, replacing its private
  `COUNT_OF_REASON`, so the writer and the check share one definition.
- **Tests** (`xp-ledger.test.ts`, 2 new):
  - the live case: an already-scored row with its award columns stripped, re-delivered as
    new 2 / deferred 177, records 0 new and 179 deferred, with receipt `newCellCount` 0
  - a credited 30 new + 10 rearmed survives an all-cooled reingest as 30 / 10 / 10 cooled
- **Mutation check:** reverting the one line fails both tests. Full suite 2521 passed,
  1 skipped. `tsc`, `eslint`, `check-boundaries` clean.

**Docs.**
- D-271 added.
- Two *As built* notes in `02` §4.3 and §4.4: the no-stored-award rule, and that the repair is
  not the remedy for a deferral.

**What went wrong along the way.**
- The AWS CLI's `s3api list-object-versions --query` fails with "badly formed help string", the
  same bug as `sqs send-message`. I used `@aws-sdk/client-s3` from a throwaway script instead.
- The first fix failed one test silently, for a reason `tsc` caught: `existingEntries` didn't
  carry `units`, so `creditedCounts` read `undefined`.

## Operator validation

**No perceptual check.** Nothing user-facing reads T3's award columns until capability 12.
**One visible effect:** Cartography went from level 22 to 23, from XP that was owed.

Smoke test by the agent against the live stack, user `5488e4b8…`, `devault` profile, 2026-10-01:

- **Before.** `repair-t3.ts` dry run: 1 mismatch, 6 rewrites, exit 1, as the ticket describes.
  Activity, XpLedgerEntry, SkillState and Profile were scanned to the session scratchpad
  (`*-before-0233.json`) first.
- **Cause, by evidence.**
  - S3 `ListObjectVersions` on `users/<sub>/cells/`: `1fb91a42…` has no version before
    2026-10-01T15:18:31Z, and every other activity has versions from September.
  - Ledger scan: `1fb91a42` holds only `constitution_share` + `recent_ground` (2026-09-07). The
    five others each hold `cells_new` equal to T3's `newCellCount`.
- **Replay.** `replay-xp.ts --to 1 --confirm`: `ReplayRun` `0MUQ31EOUZG76JU` DONE.
  - 61 rows deleted, 71 written, 18 T3 rows rescored, 0 floor rows.
  - T6 +0 cells, so nothing was un-revealed (D-020). Manifest generation 128 → 129.
- **XP only rose (D-135).** `SkillState.xpLedgerSum` before → after:
  | Skill | Before | After |
  |---|---|---|
  | Cartography | 14,807 | 15,985 (level 22 → 23) |
  | Constitution | 1,553 | 1,557 |
  | Wayfaring | 4,661 | 4,675 |

  Total 21,021 → 22,217, Total Level 55.
- **After.** `repair-t3.ts` dry run: **0 mismatches over 18 activities, 0 rows to rewrite, exit 0.**
- **Not yet live.** The `xp-ledger.ts` fix deploys with this push. It changes only a re-delivery
  of an already-scored activity with no stored award, and no live row is in that state now: all
  18 carry award columns.
