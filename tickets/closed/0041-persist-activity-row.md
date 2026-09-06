---
id: 41
slug: persist-activity-row
title: pipeline/persist.ts — write the Activity row inside the ingest transaction
type: feature
priority: high
status: closed
size: m
capability: 06-ingest-pipeline
depends_on: [25, 40]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-06T18:38:13Z
closed: 2026-09-06T19:00:42Z
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

- [x] `persistActivity(activity, receiptKey)` issues one `TransactWriteItems` containing the
      `Activity` put and the receipt `status = "DONE"` update conditional on `status = "PROCESSING"`.
      The receipt half is 0040's `doneTransactItem` descriptor, so there is exactly one expression
      of what a DONE transition is.
- [x] The `Activity` `PutItem` uses the deterministic `activityId` from 0040; re-persisting the
      same activity writes identical bytes and awards nothing.
      **`activityItem` is a PURE function of the activity** — no clock — which is what makes
      "identical bytes" a real assertion rather than "identical apart from the fields that always
      change". `createdAt`/`updatedAt` come from `activity.ingestedAt` (D-207).
- [x] All three time fields are stored: UTC epoch-ms, naive local, IANA zone id.
      **Amended on one word: `startedAt` is stored as an ISO 8601 string with a real `Z`, not
      epoch-ms.** T3 and the contract both specify a string, `a.datetime()` is a string, and it is
      GSI1's sort key — where lexicographic ordering of ISO 8601 is the property being relied on.
      Epoch-ms would sort correctly too but would disagree with the contract, and D-140 makes the
      contract win. The substance the criterion asks for — three fields, absolute vs naive vs zone
      id, an offset is not a timezone — is stored in full.
- [x] The transaction contains **zero** `ExploredCell` writes; a test asserts the item list holds
      no T6 keys (I-10).
      `assertNoCellWrites` **throws** rather than a test merely observing: it runs on every call,
      including on `extraItems`, and it recognises a T6 key under `Put`, `Update` or `Delete`.
- [x] The function signature accepts an optional list of additional transact items so capability
      `09` can add ledger rows without a refactor.
- [x] A failed transaction leaves the receipt in `PROCESSING`, reclaimable by retry, and leaves no
      partial `Activity` row.
- [x] Unit test with the transaction stubbed to throw asserts no orphaned writes.

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

## Resolution

**Files touched**

| File | What |
|---|---|
| `amplify/data/resource.ts` | T3 `Activity` in full — every field, four custom types, three GSIs, read-only auth. |
| `src/pipeline/persist.ts` | New. `persistActivity`, `activityItem`, `userIdLocalDay`, `assertNoCellWrites`. |
| `src/pipeline/persist.test.ts` | New, 17 tests. |
| `amplify/activity-model.test.ts` | New, 5 tests. Synthesizes the backend and asserts the GSI projections. |
| `lib/sources/source-account-store.test.ts` | The AppSync model allowlist gains `Activity`, with a note saying what it is. |
| `docs/02-data-model.md` | T3's auth line gains a build note (D-207). |

**Decisions.** D-207 — the pipeline writes T3 rows raw and therefore owns Amplify's item
conventions. Recorded in full in `DECISIONS.md`.

**SCOPE WAS WIDENED, DELIBERATELY AND WITH OPERATOR APPROVAL.** No ticket in the backlog
created the T3 model. `0012` shipped `DeploySmokeTest` as an explicit placeholder — "nothing
should build on it" — and `0062` covers T4, but T3 had nothing. `0041` cannot persist into a
table that does not exist, so the options (a new ticket and block; a minimal model; the full
model here) went to the operator, who chose the full model. That is a departure from "never
widen a ticket's scope" made by the person entitled to make it, recorded here rather than
absorbed silently.

**The transaction, and what is kept out of it.** `persistActivity` issues ONE
`TransactWriteItems`: the `Activity` put plus `0040`'s `doneTransactItem` descriptor, guarded on
`status = "PROCESSING"`. Cells are **not** in it and cannot be — `assertNoCellWrites` throws,
including on `extraItems`. That guard is not decoration: cells in this transaction would work for
every activity under 98 cells and then start failing at the 100-item cap, on exactly the long
runs that reveal the most ground, and the repair for scored-but-unrevealed ground is re-fogging,
which D-020 forbids outright. A comment would not have stopped that.

**Three findings.**

1. **The ticket's "UTC epoch-ms" contradicts the contract.** T3 and
   `contracts/ingestion-contract.md` §2 both specify `startedAt` as an ISO 8601 string with a real
   `Z`, and it is GSI1's sort key — lexicographic ordering of ISO 8601 is the property being
   relied on. D-140 makes the contract win, so the criterion was amended rather than the code
   bent. The substance it asks for — three fields, absolute vs naive vs zone id — is stored in full.
2. **`createdAt`/`updatedAt` must not come from the clock.** The first draft used `new Date()`,
   which makes criterion 2's "identical bytes" unassertable — the best a test could then do is
   compare everything except the fields that always differ. Deriving them from
   `activity.ingestedAt` makes `activityItem` a pure function of the activity, and the byte
   comparison a real test. See D-207.
3. **The AppSync model allowlist in `source-account-store.test.ts` failed, correctly.** It asserts
   the schema exposes only models that have come there and said what they are — precisely so a new
   model is a deliberate act. `Activity` was added to it with a note recording that it holds
   workout records and no credential material.

**What went wrong on the way.**

- **`check-design-tokens.mjs` blocked this ticket entirely**, reading `gpslogger#9001` and
  `#2026-09-05` as hex colours. That is ticket `0146`, already filed and high priority, and its
  own description predicted this. It runs in `amplify.yml` and `gate.yml`, so `0041` could not
  deploy green, and no respelling of those two strings was available that was not a contortion.
  Raised with the operator; `0146` was fixed and closed first, and this ticket resumed on top of it.
- **The smoke test's first re-persist check reported `false`**, which looked like a criterion-2
  failure and was not. DynamoDB does not guarantee attribute ordering across reads, so
  `JSON.stringify` of two `GetItem` results can differ for byte-identical data. Re-run with sorted
  keys: identical, 31 attributes both times. The code was right and the test was wrong — worth
  recording, because the reverse conclusion was one commit away.
- **The GSI synth test found nothing at first.** It filtered the table by `tableName`, which
  Amplify builds as an `Fn::Join` over the API id — an object at synth time, a string only after
  deploy. Every assertion reported a *missing* index rather than a wrong one, which is the failure
  shape that looks like a bug in the thing under test. Filtered by logical id instead.

## Operator validation

**No operator step.** A DynamoDB table and the code that writes to it — no screen, nothing a human
eye can see that a call cannot (D-181). Verified by the agent with `AWS_PROFILE=devault`.

**Automated, in CI** — 22 new tests, suite at 969 passing: `persist.test.ts` (17),
`activity-model.test.ts` (5). Plus `tsc --noEmit`, `eslint --max-warnings 0`, `next build`, and all
six `scripts/check-*.mjs` at exit 0. The GSI projection assertions were mutation-tested — flipping
`KEYS_ONLY` to `ALL` and trimming the `INCLUDE` list fails 2 of the 5.

**Live smoke test**, 2026-09-06 against the deployed `Activity-nog4xy2l7baqlhghpndh2565qe-NONE`
after Amplify job 112. Real DynamoDB, real transaction, real GSI queries:

| # | Checked | Result |
|---|---|---|
| 0 | `describe-table` | `ACTIVE`; all three GSIs `ACTIVE` with **`ALL` / `KEYS_ONLY` / `INCLUDE`** exactly as T3 argues |
| 1 | `persistActivity` against the real tables | one transaction committed |
| 2 | **D-207's item shape, read back raw** | `__typename: "Activity"`, `owner: "<uid>::<uid>"`, `createdAt`/`updatedAt` = `ingestedAt`. **The assumption was verified, not trusted** — this is the check the decision demanded |
| 3 | The three time fields | `startedAt 2026-09-06T03:00Z`, `startedAtLocal 2026-09-05T21:00:00`, `timezone America/Denver`, `userIdLocalDay <uid>#2026-09-05` — **the local day is the 5th while UTC is the 6th**, which is the whole point of I-13 |
| 4 | The receipt, after the same transaction | `DONE`, `xpAwarded 412`, `newCellCount 0` — atomically, in one act |
| 5 | Re-persist the same activity | **identical, 31 attributes both times** (compared with sorted keys — see above) |
| 6 | `byUserAndStart` query | 1 row, `name` present → projection is genuinely `ALL` |
| 7 | `byUserAndDedupe` query | 1 row, keys `dedupeKey,id,userId` and **nothing else** → genuinely `KEYS_ONLY`, so the write cost argument holds |
| 8 | `byUserAndDay` query on the LOCAL day | 1 row, keys `distanceM,id,kind,startedAtLocal,userIdLocalDay,xpAwarded` → exactly the `INCLUDE` list T3 names |
| 9 | **Replaying the whole transaction** | refused, `TransactionCanceledException`; receipt numbers unchanged. Layer 3's guard holds end to end |
| 10 | Cleanup | both tables scanned: **0 items** |

Rows 2 and 7 are the two worth the trouble. Row 2 is the only way to know D-207's field set is
right rather than remembered — the shape is Amplify's to define and could change under a version
bump. Row 7 proves the projection is what was intended, and a projection cannot be altered after
creation: getting it wrong would mean replacing the index later on a table written on every ingest.
