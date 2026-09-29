---
id: 62
slug: xp-ledger-entry-append-only
title: XpLedgerEntry (T4) — append-only, one row per (activity, skill, reason)
type: feature
priority: high
status: closed
size: m
capability: 09-xp-engine-and-ledger
depends_on: [12]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-29T02:05:15Z
closed: 2026-09-29T02:33:39Z
---

## Description

The ledger is the spine of the whole XP system (**D-142**). Every award is a row; `SkillState`
is a **pure SUM** of those rows and nothing else. The equation
**`SkillState.displayedXp == SUM(XpLedgerEntry.xpAwarded)`** (I-15) holds with no exceptions and
no adjustment terms, and it is what makes "why do I have this XP" answerable.

Item shape, from `02-data-model.md` §4.1:

| attr | notes |
|---|---|
| `id` | `${activityId}#${skillId}#${reason}#v${xpRulesVersion}` — deterministic |
| `userId` | GSI2 partition |
| `activityId` | GSI1 partition; the sentinel `__floor__` for floor rows |
| `skillId` | opaque string, never an enum |
| `reason` | closed vocabulary, §4.2 |
| `units` / `unitsEffective` | raw and post-multiplier quantities |
| `xpAwarded` | **integer**, rounded exactly once, here, at write time |
| `xpRulesVersion` | non-null on every row; the row is meaningless without it |
| `isFloor` | the D-135 marker; `false` for every rule-derived row |
| `seq` | `<startedAt>#<activityId>#<nn>` — replay order |
| `awardedAt` | ingest wall clock; **audit only, never a scoring input** |

The deterministic `id` plus `ConditionExpression: attribute_not_exists(id)` makes a webhook
replay a no-op. Rows are written inside the single `TransactWriteItems` alongside the `Activity`
put, the `SkillState` `ADD`s and the receipt's `status = "DONE"` — **XP and its receipt commit
or fail together** (§4.3).

`SkillState` (T2) stores `xpLedgerSum` and `displayedXp` as **two attributes** deliberately: a
bug in one is detectable against the other.

## Acceptance criteria

- [x] `XpLedgerEntry` is defined with every attribute above; `id` is composed by a template that
      never enumerates skill ids.
- [x] Writes use `ConditionExpression: attribute_not_exists(id)`; re-delivering the same
      activity writes zero new rows and does not error the pipeline.
- [x] The `reason` vocabulary is closed and exactly: `new_ground`, `rearmed_ground`,
      `recent_ground`, `distance`, `reps`, `duration`, `cells_new`, `cells_rearmed`,
      `constitution_share`, `retained_floor`, with `slayer_win` / `slayer_loss` / `boss_phase`
      reserved and unused in MVP (D-122).
- [x] `xpAwarded` is an integer on every row; a property test asserts `Number.isInteger` for
      every row the scorer emits and that summing a ledger in **random order** gives the same
      total (I-19).
- [x] Every row carries a non-null `xpRulesVersion` — structurally guaranteed by its presence
      in the `id`.
- [x] Ledger rows, the `Activity` put, the `SkillState` updates and the receipt transition
      commit in **one** `TransactWriteItems`; a forced failure of any item leaves none of them
      written.
- [x] `SkillState` `ADD`s use a `ConditionExpression` on the pre-read `xpLedgerSum`; a lost race
      retries the whole transaction.
- [x] The generated AppSync schema exposes **no** create/update/delete mutation for T4, and read
      is `allow.owner().to(['read'])`; a CI assertion over the generated schema fails the build
      if one appears (I-18, I-20).
- [x] A consistency test asserts `displayedXp == SUM(xpAwarded)` per `(userId, skillId)` over a
      seeded fixture (I-15).

## Notes

**Ticket `0050` handed one of its criteria here rather than faking it (2026-09-08).** `0050`
criterion 3 asked for *"`putLedgerEntry` is a conditional put on `attribute_not_exists`; a
concurrent duplicate loses the race and returns the winner's award"* — `05-fog-of-war.md` §3.5's
layer-1 gate. There was no T4 to put into, and criterion 5 above is that sentence word for word,
so it is closed here rather than duplicated. Two things `0050` did build that this can lean on:
the score-time key (`src/domain/score-key.ts`) is the `id` half of the gate, and the CELL half of
the same property already holds — every cell write is idempotent by construction, and a
concurrent duplicate loses `0044`'s score-gate claim before any of this runs.


**Cross-capability dependency added during backlog validation (2026-08-30):** 0012 provides the Amplify backend the ledger table is defined in.


Cell writes stay **outside** the transaction when a run touches more than ~60 cells: DynamoDB
caps `TransactWriteItems` at 100 items and a run touches 40–130 (D-144). Order is cells first,
then the transaction, so the failure mode is "map ahead of XP", never "XP ahead of map" — the
right direction, because D-020 makes the map append-only.

`isFloor` and `retained_floor` are *defined* here but only **written** by the replay job (0066).
Ship the field now; a ledger that cannot express a floor row cannot be made monotonic later
without a migration.

Volume sanity: ~4.5 rows per activity, 9,000–25,000 rows at five years. This table is small.

## Resolution

**Built.** The ledger (T4) and `SkillState` (T2) exist, and every ingest now writes XP.
- **Scoring path:** `scoreUnits` (0060) → `scoreGround` (0061) → `ledgerEntries`.
- **Commit:** `persistWithLedger` puts the ledger rows, the `SkillState` ADDs, the `Activity` row
  and the receipt's `DONE` in the single `TransactWriteItems`.

**Files added**
- `src/scoring/ledger.ts`:
  - the closed `LEDGER_REASONS` (10) and `RESERVED_REASONS` (3, deliberately outside the
    writable type);
  - `ledgerId`, a template over opaque strings;
  - `ledgerSeq`;
  - `ledgerEntries`, which rounds `unitsEffective × xpPerUnit` exactly once, drops 0-XP rows and
    refuses duplicate `(skill, reason)`;
  - `xpBySkill` and `sumXp`.
- `src/pipeline/xp-ledger.ts`:
  - `existingEntries` (GSI1) and `readSkillStates` (strongly consistent);
  - `ledgerPutItem` (`attribute_not_exists(id)`);
  - `skillStateUpdateItem` (ADD to both `xpLedgerSum` and `displayedXp`, guarded by
    `attribute_not_exists(xpLedgerSum)` or `xpLedgerSum = :prev`);
  - `isLostLedgerRace`;
  - `persistWithLedger`, with up to 3 attempts.
- Tests:
  - `src/scoring/ledger.test.ts` (28): vocabulary, id, seq, and seeded property tests over rows
    the real scorer emits;
  - `src/pipeline/xp-ledger.test.ts` (21): expression assertions, plus a fake that evaluates only
    this path's two condition shapes and applies transactions all-or-nothing;
  - `amplify/xp-ledger-tables.test.ts` (13): the generated schema, keys and GSIs, and grants.

**Files changed**
- `amplify/data/resource.ts`: the `SkillState` and `XpLedgerEntry` models.
- `amplify/backend.ts`: T4 `PutItem` plus `Query` on `index/byActivity` only; T2 `UpdateItem` and
  `Query`; two env vars.
- `amplify/functions/process-activity/handler.ts`: `ledger` deps, and `xp` on the success log.
- `src/pipeline/persist.ts`: T3 `xpAwarded` and `xpRulesVersion` now come from the ledger, and
  `amplifyMetadata` takes a typename.
- `src/pipeline/process-activity.ts`: `projectCells` returns the ground split; the scorer and
  `persistWithLedger` are wired in; `registry` now carries `version`.
- `src/scoring/ground.ts`: see below.
- Allowlist test and handler test: updated.

**Decisions**
- **D-254: an activity is awarded once, checked per ACTIVITY.** This was the one real finding.
  - **The gap:** the deterministic row id stops a concurrent duplicate but not a later one. A
    `reingest`, or a redelivery after the 90-day receipt TTL, re-runs the cells first. They now
    carry this activity's own `lastRunAt`, so the run reclassifies as 100% `cooled` and comes
    back as `recent_ground` rows under **different ids**. Every condition would pass and half
    the XP would be paid again, permanently.
  - **The fix:** before building rows, ingest checks GSI1 `byActivity` for any `isFloor = false`
    row for the activity, under any version. If one exists, the delivery writes no rows and no
    ADDs, and commits the `Activity` row and the receipt with the existing sum.
  - **Approval:** this is the operator's "treat a duplicate as already scored" answer, applied at
    the only granularity where it holds.
  - **Docs:** `02` §4.3 amended.
- **T2 was defined here**, as the operator agreed.
  - `level` and `levelHighWater` are declared but not written: the curve is `0063`'s, and the
    write is filed as `0219`.
  - `02` §4.3's `Update Profile` line is not built either: T1 does not exist yet. `0219` asks
    whether it belongs there or in `0182`.
- **No mutation exists for T2/T4**, rather than mutations that are denied.
  - `allow.owner().to(['read'])` alone still generates `create`/`update`/`delete` resolvers, and
    `Activity` has that shape today. Both models use `disableOperations(["mutations",
    "subscriptions"])`.
  - Subscriptions were removed as well: they fire only on AppSync mutations, and the pipeline
    writes to DynamoDB directly.
  - The CI assertion checks the transformer's SDL line
    (`@model(mutations:null,subscriptions:null) @auth(... operations: [read] ...)`) and the
    synthesized resolver map.
- **GSI keys as named attributes.** Amplify indexes key on one field, so GSI1's sort key is
  stored as `skillIdReason` and GSI3's partition key as `userIdSkillId`, the same approach as T3's
  `userIdLocalDay`. `02` T4 is amended with an "as built" note.
- **Other choices:**
  - Zero-XP rows are dropped (§4.2).
  - `awardedAt` is `activity.ingestedAt`, so re-persisting writes identical bytes.
  - `firstXpAt`/`lastXpAt` are the min/max of `startedAt`, never the clock.
- **Considered and not done: removing `DeploySmokeTest`.** Its header says it stays "until a
  second real model lands", which has now happened three times over. Deleting it is a breaking
  API change outside this ticket's scope, so it was left alone.

**Found and fixed on the way: 0061's `rateGround` labelled every ungrounded skill `distance`.**
- Might's pushups would have been filed under `distance`. The ledger is the first thing that
  writes the reason down, so it is the first place the error would have shown.
- The reason now comes from the measure **kernel** (`distanceKm`→`distance`, `reps`→`reps`,
  `seconds`→`duration`) via a data map, not a switch on skill id. Tested in `ground.test.ts`.

**Filed, not fixed (D-152)**
- `0218`: `softCapUnits` and `minUnitsForCredit` are on every row and applied nowhere. `02` §4.1
  names the soft cap but no document gives its formula. Guessing a curve into an append-only
  ledger was not an option.
- `0219`: write `level`/`levelHighWater` at ingest.
- `0220`: a pre-existing bug from `0192`. A reingest overwrites T3's discovery award with the
  reclassified zeros. XP is protected by D-254; the cell counts are not.

**Proving the guards fail.** Three sabotages, each reverted:
- dropping `disableOperations` from T4 → 2 schema tests failed;
- blinding layer 1 (`alreadyScored = false`) → 5 tests failed, including D-254 and I-15;
- removing the rounding → 11 failed, including every I-19 property test. The random-order sum
  genuinely diverges with float XP.

**What went wrong along the way**
- The first `amplify` test read every model from T4's stack, but each Amplify model has its own
  nested stack.
- `schema` is not exported from `resource.ts`. The SDL came from `data.props.schema.transform()`
  instead.
- The full suite caught two stale fixtures: the T7 model allowlist, and the handler test's
  environment.

## Operator validation

**Nothing here needs the operator** (D-181/D-229). There is no screen for this capability yet:
the `/skills/:skillId` sheet the original text named does not exist. Everything below was run by
the agent on 2026-09-28 against the deployed backend (Amplify job 238, commit `e21b467`, account
`286588821906`).

**Automated.** Checks and suites green:
- `npm run typecheck` and `npm run lint` are clean;
- all 123 test files pass (2,284 tests);
- every gate script passes, including D-100 boundaries, the rules-JSON check and the INDEX check.

**Live smoke test: 13/13, on real DynamoDB.** The shipped `persistWithLedger` was run against the
deployed `Activity-…`, `XpLedgerEntry-…` and `SkillState-…` tables and `LostSolesIngestReceipt`,
as a synthetic user `smoke-0062-<ts>`. Every row it wrote was deleted afterwards, and 0 remained.

| # | What it proved |
|---|---|
| 1 | The first delivery writes 2 rows (`new_ground=300`, `recent_ground=100`): integers, `xpRulesVersion: 1`, Amplify metadata, derived index keys. `SkillState` is `xpLedgerSum = displayedXp = 400`; the Activity row has `xpAwarded: 400`; the receipt is `DONE` with 400. |
| 2 | **Re-delivering the same activity writes zero rows, moves no XP and does not throw** (`alreadyScored: true`). |
| 3 | **D-254:** a re-delivery that reclassifies as recent ground (different ids) still awards nothing. |
| 4 | A second activity ADDs under the `xpLedgerSum = :prev` condition: 400 + 123 = 523. |
| 5 | **A forced failure on real DynamoDB** (receipt already `DONE`) cancels with `[None, ConditionalCheckFailed, None, None, None]`. No Activity row, no ledger row and no ADD landed. |
| 6 | **I-15 on the real tables:** `displayedXp == xpLedgerSum == SUM(xpAwarded)` = 523 over 3 rows. |

**Deployed API.**
- `aws appsync list-resolvers` on `amplifyData` lists 6 `Mutation` resolvers, all for
  `Activity`/`DeploySmokeTest`. There are **none for `SkillState` or `XpLedgerEntry`**, and no
  subscriptions for them.
- Reads exist: `get`/`list` for both models, plus the three T4 index queries.

**Deployed worker.**
- The environment carries `XP_LEDGER_TABLE` and `SKILL_STATE_TABLE`.
- An invoke with `{"Records":[]}` returned 200 with no `FunctionError`, so the module loads with
  the new environment.

**Not exercised: a real activity through the queue.** No run was imported for this. A `reingest`
of one of the operator's archived runs would have written permanent XP for their real account at
the reclassified `recent` rate. That rate is wrong for a first award, which is exactly the
distortion `0220`/D-254 describe. The first real import after this deploy is the end-to-end check.
The line to read is `xp` in the worker's `process-activity` log.

> Original author's intent, kept as context: the skill sheet's `RECENT` list is the ledger
> rendered; importing the same run twice must show one entry and unmoved XP. Rows 2–3 above prove
> the data half. The rendering half belongs to the ticket that builds the sheet.
