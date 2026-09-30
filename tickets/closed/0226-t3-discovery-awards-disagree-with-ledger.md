---
id: 226
slug: t3-discovery-awards-disagree-with-ledger
title: Five real T3 discovery awards disagree with the ledger's Cartography credit
type: bug
priority: med
status: closed
size: s
capability: 09-xp-engine-and-ledger
depends_on: [220]
blocked_by: []
source: agent
created: 2026-09-30T03:33:03Z
started: 2026-09-30T19:14:59Z
closed: 2026-09-30T19:20:31Z
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

- [x] Decide which source is authoritative for a repaired award. Probably the fold, since T4 is
      the ledger of record, but the ledger stores only credits (`new + 0.5 × rearmed`), not the
      split, so the split has to be re-derived from the fold rather than read back.
- [x] The XP replay (or a step beside it) writes the folded award back to T3, so a replayed
      activity's row stops being provisional. Coordinate with `0224`, which touches the same
      rows for `xpAwarded`.
- [x] A one-off repair runs against the operator's data, and the check above reports 0 mismatches
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

## Resolution

**Criterion 1 (authority): the fold (D-261).** The ledger stores only credits, but the replay's
fold is what writes the ledger's discovery rows in the same step. So the fold agrees with T4 by
construction and also supplies the cooled/deferred split. No re-derivation was needed:
`fold.awards` already held the full `DiscoveryAward` per activity.

**Criterion 2 (replay writes it back).** This builds on `0224`'s `writeActivityScores`.
`ActivityScoreWrite` gained an optional `award`. `activityScoreItem` then also sets the six
award columns `activityItem` writes (`cellCount`, `new`/`rearmed`/`cooled`/`deferredCellCount`,
`fogAlgoVersion`), and never `discoveryCredits` (D-193). Replay step 3 passes the award only for
an activity it scored with cells (`groundScored`). Anything else keeps ingest's award, as agreed
with the operator.

**Criterion 3 (the repair).** The operator chose a standalone repair over a v1 → v1 replay,
because a `ReplayRun` is a chronicle entry (D-258).
- `src/pipeline/t3-repair.ts`: `planT3Repair` runs the same fold and ground-scored rule. It
  takes the score from T4 as it stands, not by rescoring, and returns only the drifted ACTIVE
  rows. `auditT3` is the check.
- `tools/xp-replay/repair-t3.ts` is the CLI. It is a dry-run audit by default and exits 1 on
  drift. `--confirm` writes through the real store and audits again.
- `tools/xp-replay/tables.ts` holds `modelTables`, moved out of `replay-xp.ts` so both CLIs
  share it.

**What differed from the ticket.**
- **The repair also wrote `xpAwarded`/`xpRulesVersion`.** `0224`'s smoke test found 15 of 17
  real rows at `xpAwarded: 0` with no version, because they predate `0062`. The same write
  covers those columns, so the repair fixed them too. It covered 16 rows in all, not the
  ticket's 5.
- **The check compares by reason, not by skill and credit.** The first version summed `units` on
  rows whose `id` contained `cartography`, as the ticket's reproduction steps did. That failed
  `no-skill-names.test.ts`, because it names a skill in code (D-031). It was also subtly wrong:
  a discovery row's `units` is the raw cell count, and the 0.5 is in `unitsEffective`. So
  "credit = Σ units" holds only with no rearmed cells, which happens to be true of the operator's
  data. The check now compares `newCellCount` and `rearmedCellCount` against the `units` on the
  `cells_new` and `cells_rearmed` rows. Recorded in D-261.

**Tests.**
- `xp-replay.test.ts`: the MemoryStore's T3 now has flat award columns, and `listActivities`
  returns them the way the real store does. New tests cover:
  - a deferred award (a §3.4 backfill) and a reingest's all-cooled award both come back as
    ingest-in-order wrote them, and the audit is clean
  - a treadmill run's award is untouched by a replay
  - the audit finds both kinds of drift and ignores a tombstone that agrees
  - the repair restores T3 exactly, touches no ledger, T2, T6 or ReplayRun, and plans nothing
    on a second pass
- `xp-replay-store.test.ts`: the award command shape.
- The full suite passes (2440, 1 skipped), and `tsc` and lint are clean.

**Docs.** D-261 is added. `02` §4.4 step 3 gains "e", plus an *As built* note.

## Operator validation

None needed for perception. Nothing reads these columns until capability 12. Smoke test on the
operator's real data (user `5488e4b8…`, profile `devault`, 2026-09-30):
- **Before**: `repair-t3.ts` (dry run) reported **20 mismatches over 17 activities**. That was
  the ticket's 5 award rows, with identical values (`42286384` 0→16, `4ab05c72` 0→46,
  `ab00f078` 46→0, `0232ac74` 16→0, `7d6c71cf` 0→32), plus 15 pre-`0062` `xpAwarded` zeros.
  It exited 1.
- T3's columns were backed up first to the session scratchpad (`t3-before-0226.json`).
- **Repair**: `--confirm` rewrote 16 rows. **After: 0 mismatches over 17 activities, 0 rows
  still to rewrite.** A fresh dry run exited 0.
- Spot check by `GetItem`: `42286384…` previously held "0 new, 70 deferred" and now holds
  `newCellCount 16, cooledCellCount 54, deferredCellCount 0, xpAwarded 451, xpRulesVersion 1`.
  It is no longer provisional.
