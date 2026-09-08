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

- [x] T6 exists as a CDK table, `RETAIN` + PITR, `pk = USER#<uid>#CELLS#<res6ParentId>`,
      `sk = <res10CellId>`.
      *Key shape amended to `U#<uid>#C#<res6ParentId>`, which is what `02-data-model.md` T6
      specifies and what `persist.ts`'s I-10 guard has greped for since `0041`. The ticket's
      longer form was a paraphrase; adopting it would have silently disarmed that guard.*
- [x] No Lambda role holds `dynamodb:DeleteItem` on T6 except the account-deletion role (I-7).
      *Asserted in `amplify/explored-cells-table.test.ts` against the synthesized template, and
      more strongly than asked: no `DeleteItem`, no `BatchWriteItem` (a batch carries
      `DeleteRequest`) and no `PutItem` (a `Put` is the unconditional `SET` I-8 forbids). The
      account-deletion role does not exist yet, so the exception has nothing to except.*
- [x] `writeCells(cells, activity)` writes with `min` semantics on `firstRunAt` and `max` on
      `lastRunAt`, via conditional `UpdateItem` — no read-modify-write anywhere.
- [x] Out-of-order fixture: a 2026 run is ingested, then a 2024 backfill; the cell ends with
      `firstRunAt` = 2024 and `lastRunAt` = 2026 (I-8).
      *Verified twice — against the in-memory table in `explored-cells.test.ts`, and against
      real DynamoDB in the smoke test below.*
- [x] `lastRunId` follows `lastRunAt` (only updated when `at >= rec.lastRunAt`).
- [x] `visitCount` increments once per **activity**, not per traversal — an out-and-back gives +1.
- [x] Cells are written **before** the XP transaction; a fault-injection test kills the process
      between the two and asserts the recovery path **leaves the transaction unrun** (I-10).
      *Amended. The criterion said "awards XP without touching cells", and **there is no XP
      engine until capability 09** — `persistActivity` writes `xpAwarded: 0` by construction, so
      the assertion as written could only ever have been vacuous. What the criterion was
      protecting IS assertable now and is asserted: injecting a cell-write failure leaves no
      `Activity` row and no `DONE` receipt, so the skew can only ever be map-ahead-of-XP. The
      XP half of the original sentence belongs to `0060`.*
- [x] ~~Batches respect DynamoDB's 25-item `BatchWriteItem` limit with retry of unprocessed
      items;~~ **bounded-concurrency parallel `UpdateItem` with retry on throttling;** 130 cells
      complete in one invocation.
      *Amended because the original is **structurally impossible**: `BatchWriteItem` carries only
      `PutRequest` and `DeleteRequest` — no `UpdateExpression`, no `ConditionExpression` — so it
      cannot coexist with criterion 3, and a `Put` would be the plain `SET` I-8 exists to forbid.
      `02-data-model.md` WP-3 agreed all along: *"40–130 `UpdateItem` + 1–2 AGG"*. Implemented as
      a fixed worker pool (8) over one queue, with exponential backoff on throttling only.*
- [x] Re-running the writer with the same activity changes zero attributes.
- [x] `lastRunAt` is typed `S`/ISO-8601, never boolean or numeric flag (I-9 type-level check).
- [x] **A traced `ride` fixture produces zero `ExploredCell` writes** (D-189, from the Notes).
      *Added as a criterion, as the Notes asked. Enforced by reading `revealsGround` off the
      matched skill row — never a `switch` on `ActivityKind` — and asserted end to end through
      `processActivity`, not just at the rules layer.*

## Notes

`firstRunAt` is not called out by D-120 but is required by lifetime statistics ("you first set foot
here on…") and cannot be reconstructed from `lastRunAt` once the cell has been re-run. Write it
now; there is no later.

`discoveryCount` is not incremented here — it is a classification output and belongs to 0048.
This ticket writes the timestamps and counts visits.

**2026-09-04 (D-189, ticket `0157`) — this ticket must honour `revealsGround`.**
`rules/xp-rules-v1.yaml` now carries `revealsGround` on every activity skill row, and
**`wayfaring` is the only `true`**. An activity whose matched skill is `false` — a road ride
under `roving`, say — has a real trace and real cells and **must write NONE of them**: no
`ExploredCell` item, no generation bump, and therefore no Cartography award.

Read it off the matched skill row; do not branch on `ActivityKind`, which is the `switch` D-031
forbids. If this ticket ships without reading the field, D-189 silently does not happen and —
because the map never re-fogs (D-020) — every cell wrongly written before it is noticed is
permanent. Worth an acceptance criterion of its own: a traced `ride` fixture produces zero
`ExploredCell` writes.

## Resolution

**Files touched**

| File | What changed |
|---|---|
| `amplify/backend.ts` | `LostSolesExploredCell` in `IngestPipeline` — RETAIN, PITR, no TTL, no GSI; `grant(worker, "dynamodb:UpdateItem")` and nothing else |
| `amplify/explored-cells-table.test.ts` | new — 12 synth assertions on the table and its IAM |
| `src/pipeline/explored-cells.ts` | new — the writer, both conditional updates, `cellKey`, `lastRunDay` |
| `src/pipeline/explored-cells.test.ts` | new — 31 tests against an in-memory T6 that **evaluates the conditions** |
| `src/pipeline/process-activity.ts` | a `cells` phase between the gate and persist; `projectCells`; `cells` on the result |
| `src/rules/reveals-ground.ts` + test | new — D-189's gate, read off the matched skill row |
| `amplify/functions/process-activity/handler.ts` | loads and validates the ruleset at cold start; wires the cell deps |
| `scripts/build-rules-json.mjs`, `rules/xp-rules-v1.json` | new — D-217 |
| `scripts/check-adapter-deletion.mjs` | `rules/` added to `COPY` — see below |
| `.github/workflows/gate.yml`, `amplify.yml` | `build-rules-json.mjs --check` on both CI surfaces |
| `src/domain/fog.ts` | `RES_PARENT = 6` and `parentOf` |
| `docs/decisions/DECISIONS.md` | D-217 |

**The blocker, and what it forced.** The Notes require reading `revealsGround` before writing a
cell, and **the ingest Lambda had no way to read the ruleset at all**: `src/rules/load.ts`
resolves `rules/` from `import.meta.url`, which after esbuild bundling points at the bundle, and
T5 is not seeded until capability 09. Both channels the design assumed were unavailable. Resolved
by generating `rules/xp-rules-v1.json` from the YAML — esbuild inlines a JSON import with no
loader and no bundling change — committed beside its source and gated by `--check` on both CI
surfaces. **D-217**, chosen by the operator over a required-but-unanswerable injected predicate.
The pipeline takes the registry as an *argument*, so the day T5 exists that is one line in the
handler.

**Three things the ticket asked for were wrong, and each is amended on the criterion with its
reason** — criterion 8 was structurally impossible (`BatchWriteItem` carries no
`ConditionExpression`), criterion 7 asserted an XP engine that does not exist yet, and criterion
1's key shape contradicted both T6 and the guard `persist.ts` has held since `0041`.

**What went differently from the plan, recorded because it is the useful part.**

1. **The first draft of the IAM test passed vacuously.** It scanned the table's own stack for
   policies and found none — Amplify puts `defineFunction` resources in a separate nested stack
   — so every "grants no `DeleteItem`" assertion was true about an empty list. Fixed by scanning
   the worker's stack, and a `finds the grant at all` test now runs *first* so the absences can
   never be vacuous again. This is the `0142` failure mode, reproduced verbatim one capability
   later.
2. **`check-adapter-deletion.mjs` failed and blamed the wrong thing.** Its `COPY` list is
   "everything the typecheck needs", and `rules/` was not on it — so once the handler imported
   the JSON, three files failed to resolve the module in the copied tree and were reported as
   *adapter seam leaks*. A true failure with an entirely misleading name. `rules/` added.
3. **The in-memory table is a transcription, and transcriptions drift.** It applies the two
   expressions and refuses any third, so a change to the module fails every test — but nothing
   in it proves DynamoDB behaves that way. That gap is closed by the live smoke test below, not
   by the unit tests, and it found nothing only because the expressions came straight from T6.

**A hole in T6's design, found and documented rather than patched.** An activity landing
*strictly between* an existing `firstRunAt` and `lastRunAt` — a 2025 backfill onto a cell holding
2024 and 2026 — satisfies neither condition and its visit goes uncounted. Both timestamps stay
correct; only `visitCount` (documented as *"most-run ground; a future heat view"*) undercounts,
and `05-fog-of-war.md` §3.4 enqueues out-of-order activities for a replay that recomputes every
attribute from the fold. The cheap alternative — an unconditional `ADD` — would trade a cosmetic
undercount for a double-count on every redelivery. Asserted as a test so it is a known property
rather than a future surprise. **No ticket filed**: `0050` already owns out-of-order and
backfilled activities and `0103` owns the rebuild fold.

**Deliberately out of scope, and where each went.** T6 item type B, the AGG aggregate → `0049`
("…, aggregates, and the manifest generation counter"). `discoveryCount` increments → `0048`;
the `ADD … :credit` term ships now with a credit of zero so the attribute exists from the first
write and `0048` supplies a number rather than restructuring the expression. `Activity.cellCount`
stays `0` for the same reason. T6 reads (AP-15/AP-16) → `0048`/`0049`, each adding the grant it
needs where a reviewer can see it; a test asserts no read is granted today.

## Operator validation

**Smoke tests — run by the agent, D-181, on 2026-09-08.** This ticket has no screen: it is a
table, an IAM policy and a pure writer. Everything below was executed against the real AWS
account (`286588821906`, `us-east-1`, profile `devault`) or in CI.

**1. The conditional writes, against real DynamoDB — the fidelity gap the unit tests cannot
close.** A throwaway table (`LostSolesExploredCell-smoke-0047`) was created, driven with the
*shipped* expressions, and deleted. **22/22 assertions passed.** It was a separate table on
purpose: writing probe rows into the real fog would leave permanent junk in the one table that
has no delete path (I-7).

```
1. first run (2026)          primary applies; firstRunAt = lastRunAt = 2026; visitCount 1
2. 2024 BACKFILL arrives     primary REFUSED by the condition; fallback applies
                             firstRunAt -> 2024, lastRunAt STILL 2026 (not stomped)
                             lastRunId  a-2026 (follows the clock); firstRunId a-2024
                             visitCount 2
3. replay the backfill       both conditions refuse; ZERO attributes changed
4. replay the newest run     refused — `lastRunAt < :at` is false at equality
5. a MIDDLE arrival (2025)   both refuse; unchanged, exactly as T6's design says
6. a genuinely newer run     applies; firstRunAt unmoved at 2024; lastRunAt -> 2027
```

I-8 verified in the service, not in a fake: **a 2024 import cannot stomp a 2026 `lastRunAt`.**

**2. The deployed table** — Amplify job 132, commit `3bb1fcf`, **SUCCEED**:

```
$ aws dynamodb describe-table --table-name LostSolesExploredCell
  Status   ACTIVE          Keys  pk (HASH, S) / sk (RANGE, S)
  Billing  PAY_PER_REQUEST GSI   null
$ aws dynamodb describe-continuous-backups ...  ->  PITR: ENABLED
$ aws dynamodb describe-time-to-live      ...  ->  TTL:  DISABLED
```

TTL `DISABLED` is an assertion, not a default worth skipping: `LostSolesIngestReceipt` expires at
90 days, and the difference is D-020 — nothing in the fog may expire.

**3. The deployed IAM (I-7), read off the live role** —
`amplify-d14fhvl4rp79nn-ma-processactivitylambdaServ-RzXDC5kclVt6`:

```
statements scoped to LostSolesExploredCell:  "dynamodb:UpdateItem"   (and nothing else)
every dynamodb action on the whole role:     GetItem, PutItem, UpdateItem
any Delete* on the role:                     ['sqs:DeleteMessage']   <- the queue, not a table
any wildcard action:                         []
```

`PutItem` and `GetItem` are the T3 and T7/T8 grants, each scoped to its own table ARN; **no
statement anywhere grants any DynamoDB delete.** I-7 holds on the deployed role, not just in the
synth.

**4. The ruleset really is inside the Lambda (D-217).** The handler imports
`rules/xp-rules-v1.json` and runs `assertValidRuleSet` at *module scope*, so a missing or invalid
ruleset fails the cold start. Invoked with `{"Records":[]}` — which the handler iterates, so it
does no work:

```
START ... Init Duration: 429.39 ms   Max Memory Used: 116 MB
END / REPORT — no Runtime.ImportModuleError, no validation throw
```

A cold start that completes is the proof: had the JSON not been bundled, this is where it would
have failed.

**5. CI, locally** — `npx vitest run`: **1227 passed**, 1 skipped, 66 files (was 1162/63).
`npm run typecheck` and `npm run lint --max-warnings 0` clean. All six gate scripts pass, including
`check-adapter-deletion --self-test`, `check-boundaries`, and `build-rules-json.mjs --check`.

**Still needs a human, and cannot be done yet.** The original steps need a run to actually flow
through the pipeline, which needs the Sync action and a connected source. Carry them to the first
real import:

1. Sync one run. In the DynamoDB console, pick a cell in `LostSolesExploredCell` and confirm
   `firstRunAt`/`lastRunAt` are ISO-8601 strings equal to the activity's `startedAt` — **not** the
   ingest time.
2. Re-run the same route tomorrow and Sync: `firstRunAt` unchanged, `lastRunAt` moved,
   `visitCount` 2.
3. If you uploaded a run hours late, the cell timestamp must show the **run** time, not the upload
   time. This is the one an automated test cannot catch, because every fixture chooses its own
   `startedAt`.
