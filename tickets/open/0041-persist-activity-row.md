---
id: 41
slug: persist-activity-row
title: pipeline/persist.ts — write the Activity row inside the ingest transaction
type: feature
priority: high
status: open
size: m
capability: 06-ingest-pipeline
depends_on: [25, 40]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Persist the normalized `Activity` (T3) into DynamoDB as part of the ingest `TransactWriteItems`,
together with the `IngestReceipt` transition to `status = "DONE"` guarded by
`status = "PROCESSING"`. XP and the receipt commit or fail together, so there is never a window in
which XP exists and the receipt does not (`02-data-model.md` T8, layer 3).

At this milestone there is no XP engine (capability `09`), so the transaction carries the
`Activity` put and the receipt transition and nothing else. It must be written so the `SkillState`
`ADD`s and `XpLedgerEntry` conditional puts slot in without restructuring.

**Cells are explicitly not in this transaction.** D-144: 40–130 cells per run exceeds
`TransactWriteItems`' 100-item cap, so atomicity across both is not available. The chosen skew is
"map ahead of XP" and never the reverse (I-10) — revealed-but-unscored ground self-heals on
replay, whereas scored-but-unrevealed ground would contradict D-020 and could only be repaired by
re-fogging, which no code path is allowed to do. The ordering obligation (cells first, then the
XP transaction) is fixed in code here even though the cell writer lands in 0047.

Time handling per D-140 and I-13: three fields — absolute UTC epoch-ms, naive local wall clock,
and the IANA zone id. An offset is not a timezone. `startedAtLocal` is what day-bucketing reads.

## Acceptance criteria

- [ ] `persistActivity(activity, receiptKey)` issues one `TransactWriteItems` containing the
      `Activity` put and the receipt `status = "DONE"` update conditional on `status = "PROCESSING"`.
- [ ] The `Activity` `PutItem` uses the deterministic `activityId` from 0040; re-persisting the
      same activity writes identical bytes and awards nothing.
- [ ] All three time fields are stored: UTC epoch-ms, naive local, IANA zone id.
- [ ] The transaction contains **zero** `ExploredCell` writes; a test asserts the item list holds
      no T6 keys (I-10).
- [ ] The function signature accepts an optional list of additional transact items so capability
      `09` can add ledger rows without a refactor.
- [ ] A failed transaction leaves the receipt in `PROCESSING`, reclaimable by retry, and leaves no
      partial `Activity` row.
- [ ] Unit test with the transaction stubbed to throw asserts no orphaned writes.

## Notes

Do not add a `hasTrace` branch here. Skill selection is the matcher's job (0029, D-141), and the
fog subsystem's contract for a no-GPS activity is "zero cells, still a ledger entry"
(`05-fog-of-war.md` §3.6).

The `Activity` row stores the normalized activity, not the trace. The trace lives in `raw/` (0039)
and as the derived polyline object; T3 does not carry point arrays.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

1. Sync a run. In the DynamoDB console, `Activity` shows one row whose id is the sha256 form, not
   a ULID.
2. Check the three time fields on a run you started in the evening: the local field must read the
   wall clock on your watch, not a UTC-shifted hour.
3. Delete that `Activity` row by hand and press Sync again. The row comes back identical — same
   id, same field values.
