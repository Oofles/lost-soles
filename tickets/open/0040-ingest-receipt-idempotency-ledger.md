---
id: 40
slug: ingest-receipt-idempotency-ledger
title: IngestReceipt idempotency ledger with deterministic activityId
type: feature
priority: high
status: open
size: m
capability: 06-ingest-pipeline
depends_on: [12, 25, 39]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The `IngestReceipt` table (T8, `02-data-model.md`) is what makes replay unable to double-award.
It ships now, at the first import, because retrofitting idempotency onto an append-only XP ledger
after the fact is not possible — you cannot tell which of two awards was the duplicate.

Two pieces, both required by D-140:

1. **`activityId = sha256(userId:source:externalId)`** — deterministic, never a ULID (I-5). A
   duplicate `PutItem` on the same key is a no-op instead of a second row. The exact input string
   and hashing are canonical; write them once in `src/domain/activity.ts` and never inline them.
2. **The receipt table** — CDK `dynamodb.Table`, `pk = ingestKey`, no sort key, `ttl` 90 days out.
   Two key shapes coexist (`keyKind: ACCEPT | SCORE`); at this stage only `ACCEPT`-time keys are
   written, since the Sync path (0043) is the only producer. The `SCORE`-time key belongs to
   0050.

State machine: `QUEUED → PROCESSING → DONE`, plus `FAILED`. Every transition is a conditional
update. A `PROCESSING` older than the Lambda timeout is reclaimable by the next attempt, which is
why `processingStartedAt` exists.

The TTL is safe to expire because the permanent backstop is set semantics: a replay after the
receipt has aged out re-derives cells that are already present, so `delta = newCells \ explored`
is empty and nothing is awarded (`02-data-model.md` T8, layer 4).

## Acceptance criteria

- [ ] `computeActivityId(userId, source, externalId)` is a single exported function; a test asserts
      the same inputs give the same id across processes and across runs (I-5).
- [ ] The `IngestReceipt` CDK table exists with `pk = ingestKey`, TTL attribute set to 90 days.
- [ ] Accept gate: `PutItem` with `ConditionExpression: attribute_not_exists(ingestKey)`; on
      `ConditionalCheckFailedException` the caller stops without enqueueing.
- [ ] Score gate: `UpdateItem SET status = "PROCESSING", processingStartedAt = :now` conditional on
      `status = "QUEUED" OR (status = "PROCESSING" AND processingStartedAt < :staleCutoff)`.
- [ ] `attempts` is incremented with `ADD 1` per delivery.
- [ ] On `DONE` the receipt carries `xpAwarded` and `newCellCount`, so a duplicate returns the
      winner's numbers rather than recomputing them.
- [ ] Test: two concurrent identical jobs — exactly one reaches the work, the other exits before
      any write, and both return the same result.
- [ ] Test: a stale `PROCESSING` receipt older than the timeout is reclaimed by a retry.

## Notes

Five-year table size is ~250 live items (90-day TTL × ~2 keys/activity × ~400 activities/year).
This is not a scale problem; it is a correctness structure.

`FOG_ALGO_VERSION` appears in the score-time key so a deliberate algorithm change invalidates
every key and forces an auditable rescore. That key shape is specified here but constructed in
0050.

## Operator validation

1. Press **Sync** twice within a few seconds.
2. In the DynamoDB console, `IngestReceipt` holds one item per activity, not two, with
   `attempts` = 2 on the one that was retried.
3. `Activity` holds exactly one row per Strava activity id.
4. Nothing in CloudWatch shows the pipeline fetching the same activity from Strava twice.
