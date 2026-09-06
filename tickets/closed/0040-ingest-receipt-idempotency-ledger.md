---
id: 40
slug: ingest-receipt-idempotency-ledger
title: IngestReceipt idempotency ledger with deterministic activityId
type: feature
priority: high
status: closed
size: m
capability: 06-ingest-pipeline
depends_on: [12, 25, 39]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-06T17:22:45Z
closed: 2026-09-06T18:11:19Z
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

- [x] `computeActivityId(userId, source, externalId)` is a single exported function; a test asserts
      the same inputs give the same id across processes and across runs (I-5).
      Already built by `0025`. Its tests pinned the formula but recomputed it **in this process**,
      which would stay green if the formula changed consistently under them — so a checked-in
      literal digest, produced by a separate `node` invocation, was added. That is the only form
      of the assertion that can actually fail on a cross-process change.
- [x] The `IngestReceipt` CDK table exists with `pk = ingestKey`, TTL attribute set to 90 days.
      `RETAIN` per `02-data-model.md` §7.2/5, which names T6/T7/T8 together.
- [x] Accept gate: `PutItem` with `ConditionExpression: attribute_not_exists(ingestKey)`; on
      `ConditionalCheckFailedException` the caller stops without enqueueing.
- [x] Score gate: `UpdateItem SET status = "PROCESSING", processingStartedAt = :now` conditional on
      `status = "QUEUED" OR (status = "PROCESSING" AND processingStartedAt < :staleCutoff)`.
- [x] `attempts` is incremented with `ADD 1` per delivery.
      **Amended — it is its own write, not part of the score gate (D-206).** A failed
      `ConditionExpression` writes nothing, so folding the increment into the score gate would
      skip exactly the delivery worth counting: the redelivery that lost the race. `attempts`
      would then count successful claims and T8's "≥ 4 means the DLQ has it" would be false.
      `recordDelivery` is therefore a separate `UpdateItem`, conditional only on the row existing
      (`UpdateItem` upserts, and an unguarded `ADD` would conjure a receipt for a job that never
      passed the accept gate). Cost: one extra write per message, ~800/year.
- [x] On `DONE` the receipt carries `xpAwarded` and `newCellCount`, so a duplicate returns the
      winner's numbers rather than recomputing them.
      **Amended — this ticket produces the transition as a DESCRIPTOR and never executes it.**
      T8 layer 3 and `0041`'s criterion 1 both put the DONE transition inside the same
      `TransactWriteItems` as the `Activity` put. A `markDone()` here that issued its own
      `UpdateItem` would be a second, non-atomic route to the same state — the exact window
      ("no window in which XP is awarded and the receipt is not advanced") that layer 3 exists to
      close. `doneTransactItem` returns the item; `0041` composes it. Verified live by executing
      it through a real `TransactWriteCommand`.
- [x] Test: two concurrent identical jobs — exactly one reaches the work, the other exits before
      any write, and both return the same result.
      **Amended — "the same result" holds when the winner has reached `DONE`, and cannot before
      then.** While the winner is still `PROCESSING` there are no numbers in existence to return,
      so the gate returns the status instead of a fabricated zero; the loser writes nothing and
      SQS redelivers. Making it literally true would mean the loser polling until the winner
      finishes — holding a billed Lambda open to avoid a retry SQS does for free, and deadlocking
      if the winner crashes. Both paths are tested, and the race was run for real against the
      deployed table with six concurrent claimants.
- [x] Test: a stale `PROCESSING` receipt older than the timeout is reclaimed by a retry.
      Tested in unit form and live, together with its converse — a *fresh* `PROCESSING` receipt
      is **not** reclaimable, which is the half that would make the gate useless if it broke.

## Notes

Five-year table size is ~250 live items (90-day TTL × ~2 keys/activity × ~400 activities/year).
This is not a scale problem; it is a correctness structure.

`FOG_ALGO_VERSION` appears in the score-time key so a deliberate algorithm change invalidates
every key and forces an auditable rescore. That key shape is specified here but constructed in
0050.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

1. Press **Sync** twice within a few seconds.
2. In the DynamoDB console, `IngestReceipt` holds one item per activity, not two, with
   `attempts` = 2 on the one that was retried.
3. `Activity` holds exactly one row per Strava activity id.
4. Nothing in CloudWatch shows the pipeline fetching the same activity from Strava twice.

## Resolution

**Files touched**

| File | What |
|---|---|
| `src/pipeline/ingest-receipt.ts` | New. Layers 1 and 2 executed; layer 3 described, not executed. |
| `src/pipeline/ingest-receipt.test.ts` | New, 22 tests. |
| `amplify/backend.ts` | New `IngestPipeline` stack holding T8. |
| `amplify/ingest-receipt-table.test.ts` | New, 5 tests. Synthesizes the backend and asserts T8's shape in CI. |
| `src/domain/activity-id.test.ts` | One assertion added: a literal digest from a separate process. |
| `docs/02-data-model.md` | T8's `attempts` row points at D-206. |

**Decisions.** D-206 — `attempts` is its own write. Recorded in full in `DECISIONS.md`.

**What the design could not settle, and why.**

T8 asks for two things that one DynamoDB write cannot both deliver: `attempts` incremented "per
delivery", and a score gate carrying a `ConditionExpression`. **A conditional update whose
condition fails writes nothing at all**, including its `ADD` — so the delivery that loses the race,
which is the only one worth counting, would leave no trace. That is D-206, and the resolution is
two writes rather than a reinterpretation of the column.

The second unsettled thing is criterion 7's "both return the same result". It is satisfiable only
once the winner has reached `DONE`; while the winner is still `PROCESSING` there are no numbers in
existence to return. The gate returns a discriminated result and the loser exits without writing —
SQS redelivery is the waiting mechanism, and polling would hold a billed Lambda open to avoid a
retry that already happens for free, and deadlock if the winner crashed.

**Where layer 3 lives, and why it is not a function that writes.**

`doneTransactItem` returns a `TransactWriteItems` entry and sends nothing. §4 layer 3 —
*"XP and the receipt commit or fail together. There is no window in which XP is awarded and the
receipt is not advanced"* — is only true if that transition is part of the same atomic act as the
`Activity` put, which `0041` owns. A `markDone()` here would be a second, non-atomic route to the
same state, and it would open the exact window layer 3 exists to close. Verified live by executing
the descriptor through a real `TransactWriteCommand` and then confirming a **replay of it is
refused** by its `status = "PROCESSING"` guard.

**Two guards that are not defensive dressing.**

- `recordDelivery` is conditional on `attribute_exists(ingestKey)`. `UpdateItem` **upserts**, so an
  unguarded `ADD` would create a receipt for a job that never passed the accept gate — a phantom
  row in the table whose whole purpose is recording what was accepted.
- `markFailed` swallows a condition failure and only that. Losing that race means the receipt is no
  longer `PROCESSING` — the work finished, or another attempt reclaimed it — and throwing would
  mask the original failure that caused the caller to call it.

**A `FAILED` receipt is deliberately not reclaimable.** The stale clause matches `PROCESSING` only.
A crash is transient and should retry; a recorded failure is a decision, and should be visible to
`0044` rather than quietly retried forever. SQS's redrive policy governs retries, not this table.

**What went wrong on the way.**

- **The first draft dynamically imported `@aws-sdk/lib-dynamodb`** to keep it out of client
  bundles, which made every function `async` for no reason and invented a justification that does
  not hold — `lib/sources/oauth-state-store.ts` imports it statically and `check-bundle-leak.mjs`
  is about secrets, not bundle size. Replaced with static imports.
- **`0025`'s determinism tests were weaker than criterion 1 requires.** Both existing tests
  recompute the digest in-process, so they would stay green if the formula changed consistently
  underneath them. A literal produced by a separate `node` invocation is the only version of that
  assertion that can fail on the change it is meant to catch.
- **The CDK assertions were mutation-tested before being believed** — removing the TTL attribute
  and flipping `RETAIN` to `DESTROY` failed 2 of the 5, as they should.
- **Dependency injection here differs from `lib/`'s `__setDocClient` idiom**, deliberately:
  `src/pipeline/archive.ts` already injects, so the directory stays consistent with itself and no
  test needs a global reset. Noted in the module so it reads as a choice rather than an oversight.

## Operator validation

**No operator step.** This ticket is a DynamoDB table and the code that writes to it — there is no
screen, no phone and nothing a human eye can see that a call cannot (D-181). All of it was
verified by the agent with `AWS_PROFILE=devault`.

**Automated, in CI** — 28 new tests, suite at 947 passing: `ingest-receipt.test.ts` (22),
`ingest-receipt-table.test.ts` (5, synthesizes the real backend), `activity-id.test.ts` (+1). Plus
`tsc --noEmit`, `eslint --max-warnings 0`, `next build`, and all six `scripts/check-*.mjs` clean.

**Live smoke test**, 2026-09-06 against the deployed `LostSolesIngestReceipt` after Amplify job 110
created it. Real DynamoDB, real conditional expressions, real concurrency — no stubs:

| # | Checked | Result |
|---|---|---|
| 0 | `describe-table` / `describe-time-to-live` | `ACTIVE`; TTL `ENABLED` on attribute `ttl` |
| 1 | Accept, then replay the same key | `accepted`, then `duplicate`. Row: `status QUEUED`, `attempts 0`, `keyKind ACCEPT`, **ttl 90 days out** |
| 2 | `recordDelivery` twice | `1`, then `2` — deliveries counted, not claims |
| 3 | **Six concurrent `claimForScoring` calls** | **exactly 1 `claimed`, 5 `duplicate`.** The real race against one table, not a stubbed one |
| 4 | `doneTransactItem` via a real `TransactWriteCommand` | `status DONE`, `xpAwarded 412`, `newCellCount 97`, `attempts 2` |
| 5 | A duplicate arriving after `DONE` | returned the winner's `xpAwarded 412` / `newCellCount 97` — read, not recomputed |
| 6 | **Replaying the DONE transition** | refused, `TransactionCanceledException`; the stored numbers were **unchanged**. The `status = "PROCESSING"` guard holds |
| 7 | `markFailed` on a `DONE` receipt | silent no-op; status stayed `DONE` |
| 8 | Stale reclaim | a `PROCESSING` receipt older than `PROCESSING_STALE_MS` was **reclaimed**; a **fresh** one was **refused** — both halves, because only the second failing would make the gate useless |
| 9 | Cleanup | both smoke receipts deleted; `readReceipt` returns `undefined` |

Steps 3 and 6 are the ones worth the trouble: the concurrency guarantee and the layer-3 guard are
exactly what a stubbed DynamoDB cannot prove, because a stub that evaluated conditions would be a
second, wrong implementation of the thing under test.
