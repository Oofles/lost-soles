---
id: 220
slug: reingest-overwrites-activity-discovery-award
title: A reingest overwrites the Activity row's discovery award with zeros
type: bug
priority: med
status: closed
size: s
capability: 09-xp-engine-and-ledger
depends_on: [62]
blocked_by: []
source: agent
created: 2026-09-29T02:19:08Z
started: 2026-09-30T03:25:50Z
closed: 2026-09-30T13:41:03Z
---
## Description

Found while building `0062`, and it predates it. A `reingest` (`0192`), or a redelivery after the
90-day receipt TTL, re-runs `projectCells` against a store that already holds this activity's
cells. Every one of them now carries this activity's own `lastRunAt`, so every cell classifies
`cooled`. The award comes back `newCellCount: 0, cooledCellCount: N`, and `persistActivity`
**overwrites** the T3 row with it: the put is unconditional.

The cells, the map and XP are all unaffected. `0062`'s layer-1 check (D-254) keeps XP at its
original value. What changes is the denormalised award on the `Activity` row that the post-run
card and the activity list read. After a replay, a run that opened new ground reads as if it
opened none. `02` §3.2 is explicit that the award is *stored, not recomputed* for exactly this
reason.

## Acceptance criteria

- [x] A second delivery of an already-committed activity leaves `newCellCount`,
      `rearmedCellCount`, `cooledCellCount` and `deferredCellCount` on T3 exactly as the first
      delivery wrote them.
- [x] The fix decides what a *revised* activity (a real source-side edit, `revision` bumped)
      does. That is `05` §3.5's un-award path, so it should probably be refused or deferred here
      rather than half-handled.
- [x] A test runs the same activity through `processActivity` twice against a store that
      remembers the first run's cells, and asserts the row's award is unchanged.

## Steps to reproduce

1. Ingest a run over never-seen ground. T3 shows `newCellCount: N > 0`.
2. Send a `reingest` for the same activity.
3. Read the T3 row again.

## Expected vs actual

**Expected:** `newCellCount: N`, as first awarded.

**Actual:** `newCellCount: 0`, `cooledCellCount: N`.

## Notes

The likely shape: when `persistWithLedger` finds the activity `alreadyScored`, the award on the
row should come from the existing row, not from the reclassification. That is the same decision
D-254 made for XP. The `Activity` put may need `02` §4.3's
`attribute_not_exists(id) OR revision < :rev` condition, which has never been implemented.

## Resolution

**Fixed as the ticket's Notes guessed, with one change: the trigger is T3's own row, not
`alreadyScored`.** `persistWithLedger` now reads the `Activity` row before building the
transaction. If that row carries an award, the put writes that award and the receipt closes with
its `newCellCount`. The fresh all-`cooled` reclassification is discarded. The trigger is keyed on
T3 rather than on T4's layer-1 check, because an activity that earned no XP has no ledger rows but
still has an award worth keeping. Recorded as **D-260**.

- `src/pipeline/persist.ts` — `readStoredAward(activityId, deps)`: a strongly consistent `GetItem`
  projecting the six award columns. It returns `null` when there is no row, or when the row
  predates `0048` and lacks those columns; in that case the fresh classification is written, as
  before. `PersistDeps.ddb.send` widens to accept a `GetCommand`.
- `src/pipeline/xp-ledger.ts` — `persistWithLedger` does the read inside its retry loop, passes the
  kept award to `persistActivity`, and reports `awardKept` on `LedgerCommit`.
- `amplify/backend.ts` — the worker gains `dynamodb:GetItem` on T3, alongside `PutItem`. There is
  still no Update, Delete, Query or Scan.
- Tests:
  - `process-activity.test.ts` — four new tests. The criterion-3 test runs the same activity twice
    against a store remembering the first run's cells, asserts the reclassification really did
    come back all-`cooled`, and asserts T3, `cellsRef` and the receipt keep the first award. The
    other three cover the read's shape, the first-delivery path, and the pre-`0048` row. Four
    existing wrappers were taught to pass the `GetCommand` through.
  - `xp-ledger.test.ts` — one test on the stateful fake (opened, then cooled, via a fresh `reingest`
    key), and three `toEqual` shapes gained `awardKept`.
  - `amplify/xp-ledger-tables.test.ts` — asserts T3's grant is exactly `GetItem` + `PutItem`.
  - Full suite: 2,430 pass. Typecheck and lint are clean.
- Docs: `02` §4.3 has an *As built (`0220`)* paragraph. The `attribute_not_exists(id) OR
  revision < :rev` condition drawn there was **not** implemented, and D-260 says why: on a
  same-revision redelivery it cancels the whole transaction, the receipt never reaches `DONE`,
  and the message ends in the DLQ.

**Criterion 2 — revisions.** A source-side revision keeps the first award too. `05` §3.5's
un-award-and-rescore belongs to the replay job (`0066`), as `0050` already recorded for the XP
half. Rescoring the award here while D-254 keeps the XP would leave T3 and T4 describing two
different versions of the run.

**What went wrong / found on the way.**
- The bug has already corrupted real data. `7d6c71cf…` (2026-09-28) was reingested at
  2026-09-29T18:28Z, and its row says 0 new / 121 cooled against 32 credits in the ledger.
- A T3-vs-T4 check found four more mismatches. Those come from the XP replay: it re-folds credit
  and never writes the result back to T3. That is the award counterpart of `0224`.
- All five are filed as **`0226`**. This ticket fixes future writes only.
- The local `aws sqs send-message` is broken (aws-cli 2.31.35 on Python 3.14: *"badly formed help
  string"*; other `sqs` calls work). The smoke message was sent with `@aws-sdk/client-sqs`.

## Operator validation

**Nothing here needs the operator** (D-181/D-229). There is no screen that reads the award yet.
The agent ran everything below on 2026-09-30 against account `286588821906`, after Amplify job
**254** (commit `83b096c`) reported `SUCCEED`. The worker's `LastModified` is
2026-09-30T03:38:41Z.

**A real `reingest` through the deployed queue and worker, on the operator's own run.** The
operator approved this in the session. Activity `2460ebe8…` (Strava `20290651211`, 2026-09-23),
receipt `ab8f91f6…`:

| | before | after |
|---|---|---|
| `cellCount` / `newCellCount` / `rearmedCellCount` / `cooledCellCount` / `deferredCellCount` | 139 / 77 / 0 / 62 / 0 | **139 / 77 / 0 / 62 / 0** |
| `fogAlgoVersion` | 1 | 1 |
| receipt `attempts` / `status` / `newCellCount` | 1 / DONE / 77 | 2 / DONE / **77** |
| T3 `xpAwarded` | 0 (stale, see `0224`) | 1388 = the ledger's sum (D-254's path) |
| T4 rows for the activity | 4, `awardedAt` 2026-09-23 | the same 4, the same `awardedAt` |

- Worker log: `outcome: persisted`, `xp: {xpAwarded: 1388, rowsWritten: 0, alreadyScored: true,
  awardKept: true}`. The DLQ held 0 messages afterwards.
- Before this fix, the same message would have written `newCellCount: 0` (compare `7d6c71cf…`).
- **What this does not show:** the worker does not log the res-10 reclassification, so the
  second delivery's all-`cooled` result is proven by the unit test, not by this log.

**IAM**, via `iam simulate-principal-policy` on the worker role over T3: `GetItem` and `PutItem`
are allowed; `UpdateItem`, `DeleteItem`, `Query` and `Scan` are `implicitDeny`.

**Perceptual check: none yet.** Once the post-run card or activity list exists (capability 12/13),
a replayed run should show the same new-cell count it showed first time.
