---
id: 47
slug: explored-cell-writes-first-last-run-at
title: ExploredCell writes — firstRunAt via min, lastRunAt via max, outside the ingest transaction
type: feature
priority: high
status: open
size: m
capability: 07-fog-projection-and-cells
depends_on: [41, 46]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The T6 `ExploredCell` table and its writer. This ticket carries three invariants that **cannot be
fixed later**, because the timestamps they protect cannot be invented after the fact.

**1. Each cell carries timestamps, not a presence bit (D-120, I-9).**

```
PK: USER#<uid>#CELLS#<res6ParentId>     SK: <res10CellId>
  firstRunAt     ISO8601   written with min()  — immutable in spirit; lifetime stats
  firstRunId     string
  lastRunAt      ISO8601   written with max()  — THE cooldown input
  lastRunId      string
  visitCount     number    distinct activities that touched the cell
  discoveryCount number    1 + one per re-arm
```

D-120's cooldown is `activity.startedAt − lastRunAt`. A boolean makes the 6-month re-arm
mechanic unimplementable, and the loss is unrecoverable.

**2. `min` and `max`, never a plain `SET`, never a read-modify-write (I-8).** Activities arrive out
of order — backfills, webhook redelivery, a future GPX import. A plain `SET` lets a 2024 import
stomp a 2026 `lastRunAt` and silently corrupt every future discovery decision on that cell. This is
structural: `UpdateItem` with `ConditionExpression: attribute_not_exists(lastRunAt) OR lastRunAt < :at`,
plus the `firstRunAt > :at` write on the fallback path.

**3. Cell writes sit OUTSIDE the ingest transaction (D-144, I-10).** 40–130 cells per run exceeds
`TransactWriteItems`' 100-item cap, so atomicity is not available. The writes go via
`BatchWriteItem`/`UpdateItem`, idempotent by construction (min/max/set-insert). **Cells are written
first, then the XP transaction.** The only permitted skew is "map ahead of XP" — never the reverse.
Revealed-but-unscored ground self-heals on replay; scored-but-unrevealed ground contradicts D-020
and could only be repaired by re-fogging, which no code path may do.

The table is a CDK `dynamodb.Table` with `removalPolicy: RETAIN` and PITR on — this is the one
table whose loss would feel final. The client never reads it (it downloads the blob instead), so
putting it behind AppSync would add $4.00/M operations for a path nobody uses.

`res6ParentId` in the partition key is not decoration: a res-6 partition is ~36 km² holding at most
~2,401 res-10 children, which bounds partition size, makes a viewport read 1–20 queries, and hands
the client its viewport bucketing for free (0058).

## Acceptance criteria

- [ ] T6 exists as a CDK table, `RETAIN` + PITR, `pk = USER#<uid>#CELLS#<res6ParentId>`,
      `sk = <res10CellId>`.
- [ ] No Lambda role holds `dynamodb:DeleteItem` on T6 except the account-deletion role (I-7).
- [ ] `writeCells(cells, activity)` writes with `min` semantics on `firstRunAt` and `max` on
      `lastRunAt`, via conditional `UpdateItem` — no read-modify-write anywhere.
- [ ] Out-of-order fixture: a 2026 run is ingested, then a 2024 backfill; the cell ends with
      `firstRunAt` = 2024 and `lastRunAt` = 2026 (I-8).
- [ ] `lastRunId` follows `lastRunAt` (only updated when `at >= rec.lastRunAt`).
- [ ] `visitCount` increments once per **activity**, not per traversal — an out-and-back gives +1.
- [ ] Cells are written **before** the XP transaction; a fault-injection test kills the process
      between the two and asserts the recovery path awards XP without touching cells (I-10).
- [ ] Batches respect DynamoDB's 25-item `BatchWriteItem` limit with retry of unprocessed items;
      130 cells complete in one invocation.
- [ ] Re-running the writer with the same activity changes zero attributes.
- [ ] `lastRunAt` is typed `S`/ISO-8601, never boolean or numeric flag (I-9 type-level check).

## Notes

`firstRunAt` is not called out by D-120 but is required by lifetime statistics ("you first set foot
here on…") and cannot be reconstructed from `lastRunAt` once the cell has been re-run. Write it
now; there is no later.

`discoveryCount` is not incremented here — it is a classification output and belongs to 0048.
This ticket writes the timestamps and counts visits.

## Operator validation

1. Sync one run. In the DynamoDB console, pick a cell in T6 and confirm `firstRunAt` and
   `lastRunAt` are ISO-8601 strings equal to the activity's `startedAt`, not to the ingest time.
2. Re-run the same route tomorrow and Sync. `firstRunAt` is unchanged, `lastRunAt` moved,
   `visitCount` is 2.
3. Confirm your run's `startedAt` is what landed — if you uploaded the run hours late, the cell
   timestamp must show the run time, not the upload time.
