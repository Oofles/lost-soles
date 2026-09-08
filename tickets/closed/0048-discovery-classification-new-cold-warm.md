---
id: 48
slug: discovery-classification-new-cold-warm
title: Discovery classification — new / re-armed (>6mo, 50%) / cooled (<6mo, 0%)
type: feature
priority: high
status: closed
size: m
capability: 07-fog-projection-and-cells
depends_on: [47]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-09-08T05:37:22Z
---

## Description

D-120's scoring rule, as a pure function, feeding capability `09` but consumed by nothing yet:

```
SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000     # 183 days, UTC, not calendar months (§9.2)
CREDIT_NEW    = 1.0     # no record for the cell
CREDIT_REARM  = 0.5     # last run more than 6 months ago; the cell re-arms
CREDIT_COOLED = 0.0     # last run within 6 months
```

Two rules in this ticket are the ones that get silently broken:

**Scoring time is `activity.startedAt`, never `now()` (I-12).** A run uploaded three days late must
score as it would have on the day it happened. Any `now()` in the scoring path makes replay
non-reproducible and breaks I-1 and I-14 together. The classifier takes `at` as a parameter and the
module must not import a clock at all.

**Classify fully against pre-run state, then write.** Every cell is classified against the store as
it was *before this activity*. Updating `lastRunAt` inside the classify loop makes later cells in
the same run re-read as "cooled" — a self-inflicted bug that would silently halve the credit of a
long run through new territory. The pseudocode in `05-fog-of-war.md` §3.2 enforces this by
separating phase 2 (classify) from phase 4 (write); keep that separation visible in the code, and
carry each cell's pre-read `rec` alongside it rather than re-reading.

Reads are one `BatchGetItem` over the candidate cells, which the res-6 partition keys keep to a
handful of partitions.

Output is an award record: `{cellCount, newCellCount, rearmedCellCount, cooledCellCount,
discoveryCredits, res: 10, algoVersion}`. **The award is stored, not recomputed** — recomputing it
later gives a different answer, because by then the cells are in the store.

`discoveryCount` increments for new and re-armed cells only; cooled cells increment `visitCount`
and nothing else.

A negative `at − rec.lastRunAt` must assert and log, never pass silently. A negative delta reaching
the classifier means the replay queue (0050) has a bug, and the naive comparison would quietly
yield "cooled".

## Acceptance criteria

- [x] `classifyCells(cells, records, at)` is pure and returns disjoint `new` / `rearmed` / `cooled`
      lists plus the summed credit.
      *Shape amended: it returns ONE list of `{cell, discovery, record?}` rather than three lists,
      and `awardOf` sums it. Three parallel lists lose which record belongs to which cell, and
      §3.3 requires the pre-read `rec` to be **carried** to the write phase rather than re-read.
      Disjointness is stronger than the criterion asked — a cell has one `discovery`, so two
      classes cannot both contain it by construction, and a test asserts the three counts sum to
      `cellCount`.*
- [x] The module is tested with the clock stubbed to **throw**; no `Date.now()` anywhere in the
      scoring path (I-12).
      *All three doors are stubbed — `Date.now()`, `performance.now()` and the no-argument `Date`
      constructor — for the whole file, and the first test asserts the stub is armed so the other
      32 cannot pass vacuously. `Date.parse(iso)` stays available: a function that can only answer
      a question you already asked it cannot tell the time.*
- [x] Boundary tests: `at − lastRunAt` of 182 days → cooled (0.0); 184 days → re-armed (0.5); no
      record → new (1.0). A cell run 7 months ago classifies cold, 5 months ago warm.
      *Plus exactly 183 days, which §3.2's `<` puts on the re-armed side and which no criterion
      named.*
- [x] `SIX_MONTHS_MS` is 183 days of milliseconds, defined once, with the §9.2 rationale in a
      comment.
- [x] A run crossing 30 new + 30 cooled cells produces credit 30.0, not 60.0 or 45.0.
- [x] Classify-then-write ordering test: a run over 100 contiguous *new* cells classifies all 100
      as new. (Written naively, the tail would come back cooled.)
      *Asserted in the unit tests, end to end through `processActivity`, and against real
      DynamoDB at 130 cells — see the smoke test.*
- [x] `discoveryCount` increments only for new and re-armed cells.
- [x] A negative delta logs an error and fails the job rather than scoring it as cooled.
      *A typed `OutOfOrderScoringError` carrying the cell and both timestamps, thrown before any
      write. "Logs" is the handler's job and it already logs a failure with `errorClass` (`0044`);
      a `console.error` inside a pure domain module would be the clock problem in another form.*
- [x] The award record is persisted and read back by the UI path; a second call returns the stored
      award rather than reclassifying.
      *Persisted on the T3 row (`cellCount`, `newCellCount`, `rearmedCellCount`, `cooledCellCount`,
      `fogAlgoVersion`) inside the ingest transaction, and `newCellCount` on the T8 receipt's
      `DONE` — which is what a duplicate reads. **"Read back by the UI path" could not be
      satisfied and is amended**: there is no UI path until capability 10. What exists is the
      storage the UI will read and the duplicate path that already returns it, and a test asserts
      a duplicate returns the stored numbers without touching the classifier.
      `discoveryCredits` is deliberately not a column — it is exactly
      `newCellCount + 0.5 × rearmedCellCount`, and a second copy of two stored numbers is the
      two-owners failure D-193 names.*

## Notes

Capability `09` consumes `newShare = newCellCount / cellCount` to blend Wayfaring XP (D-021,
half XP on known ground). Fog contributes exactly that one number and nothing else; activity-skill
XP is not this subsystem's business (`05-fog-of-war.md` §3.6).

Zero cells (treadmill, indoor, no-GPS) → zero credit, no cell writes, no generation bump, but a
ledger entry is **still written** with `cellCount: 0`, so the idempotency gate covers no-GPS
activities and re-import stays a no-op. A trace whose samples are all filtered out by 0045 is
treated as no-GPS and logs the reject counts.

## Resolution

**Files touched**

| File | What changed |
|---|---|
| `src/domain/discovery.ts` | new — the classifier, the award, `newShare`, `FOG_ALGO_VERSION`, `OutOfOrderScoringError` |
| `src/domain/discovery.test.ts` | new — 33 tests, whole file run with the clock stubbed to throw |
| `src/pipeline/explored-cells.ts` | `readCells` (AP-15); the writer takes classified cells and the credit flows into `discoveryCount` |
| `src/pipeline/process-activity.ts` | `projectCells` becomes read → classify → write → award |
| `src/pipeline/persist.ts` | `activityItem` writes the award and `fogAlgoVersion` onto T3 |
| `amplify/backend.ts` | `dynamodb:BatchGetItem` added to the T6 grant — the first read `0047` deliberately withheld |
| `src/domain/contract-drift.test.ts` | strips comments before matching imports — see below |
| `docs/02-data-model.md` | AP-15 corrected: `BatchGetItem`, not `Query` |
| `docs/05-fog-of-war.md` | §3.2 phase 4 reconciled with D-144/I-10 |

**The shape of it.** Read once, up front, into a `Map`; classify against that map; write carrying
each cell's verdict. The separation is enforced by the type rather than by discipline — there is
no store in `classifyCells`'s scope, so the interleaved version cannot be written by accident. It
is worth being blunt about why: interleaved, the tail of a long run through new territory reads
its own head's writes and comes back `cooled`, halving the credit of exactly the runs the game
exists to reward, with nothing anywhere looking wrong.

**Two doc divergences, resolved rather than noted** (D-153: the code changes or the doc changes,
never neither):

1. **AP-15 said `Query` per res-6 parent.** That returns the whole partition — up to 2,401 cells
   — to classify the ~45 this run crossed, and a point-to-point run through four parents is four
   calls. `BatchGetItem` is one call with the exact keys. AP-15's own estimate carried the tell:
   *"1–2,401 items"*. Corrected, and `Query` is left ungranted so `0049`'s rebuild has to ask for
   it deliberately.
2. **§3.2's phase 4 wrapped the cell writes in `store.transact(...)`.** That predates D-144: 130
   cells against a 100-item cap means the pseudocode works for every activity under ~98 cells and
   then fails silently on the longest runs. Already resolved in code by `0047`; the section now
   says so, and maps `putLedgerEntry` onto the T8 `DONE` transition plus the T3 counts.

**What the fakes could not catch, and the smoke test did.** `BatchGetItem` answers a repeated key
with a **400** — *"Provided list of item keys contains duplicates"* — not a partial result.
`readCells` takes an `Iterable` and passed it straight through. Production hands it a `Set` and
could never trip it, but a caller with an array is one `concat` away from failing an ingest with
a validation error that never mentions cells. The unit tests missed it because the fake is
`Map`-backed and a `Map` absorbs duplicates in silence. `readCells` now dedupes, with a test.

The same run exposed a second thing, in the test rather than the code: 230 cells generated at
0.0012° steps are not 230 distinct cells — two adjacent steps can land in one res-10 hexagon —
so the chunking test was asserting `[100, 100, 30]` against 223 keys. It now asserts the distinct
count first.

**A false positive in an inherited gate, fixed at the gate.** `contract-drift.test.ts` matches
`from "…"` over the whole file body, and `discovery.ts` says a reader must not have to
*distinguish "absent" from "none"* — which read as an import of a package called `none`. Prose is
going to keep doing that in a directory this heavily commented, so the check now strips comments
rather than the comment avoiding the word. A gate with false positives is a gate that gets
bypassed, which is the lesson `check-boundaries.mjs` already carries. Its own fixture is
assembled with `join(" ")` so this file's text never contains the pattern it tests for.

**Deliberately out of scope.** The AGG aggregate, `bumpGeneration` and `cellsRef` → `0049`.
XP → capability 09; this subsystem hands it exactly one number, `newShare`, and names no XP rate.
`traceRejectCounts` → **`0180`, filed**: §3.6's *"treated as no-GPS"* half falls out for free, but
the *"and logs the reject counts"* half needs `traceToCells` to widen a return type that two
closed tickets specify, and no criterion here asked for it.

## Operator validation

**Smoke tests — run by the agent, D-181, on 2026-09-08.** No screen: a pure function, a read, and
four columns. Everything below ran against the real AWS account (`286588821906`, `us-east-1`,
profile `devault`) or in CI.

**1. The whole loop — read, classify, write — against real DynamoDB.** A throwaway table
(`LostSolesExploredCell-smoke-0048`) driven by the *shipped* `readCells`, `classifyCells`,
`awardOf` and `writeCells`, then deleted. **30/30 assertions passed.**

```
1. 12 cells, empty store      read 0; all 12 new; credit 12; newShare 1; 12 written
2. same ground +30 days       CONSISTENT read sees run 1; all 12 cooled; credit 0
3. +184 days after RUN 1      STILL cooled — the cooldown runs from lastRunAt, not
                              firstRunAt, and only 154 days had passed since run 2
4. +184 days after the LAST   all 12 re-armed; credit 6.0
5. one cell inspected         visitCount 4, discoveryCount 2 — one discovery, two cooled
                              re-runs, one re-arm; firstRunAt unmoved at run 1
6. half-new run               6 new + 6 cooled; credit 6 (not 12, not 9); newShare 0.5
7. 130 new cells, one call    all 130 new; credit 130 — NOT halved by its own writes
8. replay run 7               all 130 cooled; credit 0; zero attributes changed
9. BatchGetItem               130 keys read back; a duplicated key list no longer 400s
10. out-of-order, real state  OutOfOrderScoringError, thrown before any write
```

Step 3 is the one worth keeping: the first draft of this script asserted "184 days after the first
run re-arms" and it did not. That is the code being right — D-120's clock is `lastRunAt` — and the
assertion being wrong. It is now asserted deliberately in both directions.

**2. The deployed IAM**, read off the live role after Amplify job 133 (`546232d`, SUCCEED):

```
statements scoped to LostSolesExploredCell:  ["dynamodb:UpdateItem", "dynamodb:BatchGetItem"]
any Delete* on the whole role:               ['sqs:DeleteMessage']   <- the queue, not a table
any dynamodb:Query / dynamodb:Scan:          []
```

I-7 still holds, `BatchGetItem` is the only read added, and `Query` stayed out so `0049` must
justify it.

**3. The worker still cold-starts**, so nothing added here broke the bundle:
`Init Duration: 481.66 ms`, no `Runtime.ImportModuleError`.

**4. CI, locally** — `npx vitest run`: **1287 passed**, 1 skipped, 67 files (was 1227/66).
`npm run typecheck` and `npm run lint --max-warnings 0` clean. All six gate scripts pass.

**Still needs a human, and cannot be done yet.** These need runs actually flowing through the
pipeline. Carry them to the first real imports:

1. Sync a run over ground covered in the last month: the T3 row shows `newCellCount` near zero and
   `cooledCellCount` near `cellCount`.
2. Sync a run down a street never run: `newCellCount` roughly the number of ~130 m corridor
   segments in it.
3. **Nothing changes on the map for a cooled run, and that is correct** — D-020 means the ground
   was already revealed. The row is what explains why. Worth looking at once so the absence of a
   visible change is not later reported as a bug.
4. The six-month re-arm cannot be observed for six months. When the first cell does re-arm, check
   `discoveryCount` went to 2 while `visitCount` kept climbing — the smoke test proves the
   mechanism, only time proves the calendar.
