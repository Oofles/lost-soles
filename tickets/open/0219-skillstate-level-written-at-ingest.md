---
id: 219
slug: skillstate-level-written-at-ingest
title: SkillState level and levelHighWater written at ingest, in the ledger transaction
type: feature
priority: high
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: [62, 63]
blocked_by: []
source: agent
created: 2026-09-29T02:19:08Z
started: 2026-09-29T19:04:46Z
---
## Description

`02` §4.3's transaction sets `level` and `levelHighWater` on each `SkillState` alongside the
`ADD`: *"the Lambda computes them from the pre-read `SkillState` and writes them with a
`ConditionExpression` on the pre-read `xpLedgerSum`"*. `0062` built the ADD, the pre-read and the
condition. It did **not** write `level` or `levelHighWater`, because the curve is `0063`'s and was
not built yet. T2 declares both attributes as optional so rows written before this ticket read
cleanly.

This ticket adds the two SETs to `skillStateUpdateItem` (`src/pipeline/xp-ledger.ts`):
`level = levelForXp(prev + xp, curve)` and `levelHighWater = max(prev.levelHighWater, level)`
(I-17). It also backfills the rows that already exist.

## Acceptance criteria

- [x] `skillStateUpdateItem` sets `level` and `levelHighWater` from the pre-read row plus this
      activity's XP, using `0063`'s `levelForXp` and the ruleset's `curve`.
- [x] `levelHighWater` is `max(previous, computed)`: a test with a pre-read high-water above the
      computed level leaves it untouched (I-17).
- [x] Every `SkillState` row written before this ticket has `level`/`levelHighWater` populated.
      A one-shot script against the deployed table is acceptable; record what it did.
      — met without a script: `0066`'s replay had already written both on all three rows. See
      Resolution.
- [x] Profile `totalXp` (`02` §4.3's `Update Profile` line) is either written here, or confirmed
      to be owned by the ticket that creates T1 (`0182`), with a note saying which.
      — written here, operator's call 2026-09-29, together with `totalLevel`. T1 was created by
      `0066`, not `0182`; a note on `0182` records what moved.

## Notes

Filed by `0062`. The retry-on-lost-race already covers these SETs: they are computed from the
same pre-read that the condition guards.

## Resolution

**What was built.**

`src/pipeline/xp-ledger.ts`:
- `skillStateUpdateItem` now also does `SET #level = :level, levelHighWater = :hw`, inside the
  same ADD and under the same `xpLedgerSum = :prev` guard. So `0062`'s lost-race retry already
  covers these SETs.
  - `level` = `levelForXp(pre-read displayedXp + xp, curve)`.
  - `levelHighWater` = `max(pre-read levelHighWater, level)`.
  - Both come from the new `levelsAfter`. `level` is a DynamoDB reserved word, so the expression
    uses `#level`.
- `profileTotalsItem` is §4.3's `Update Profile` line. It is appended as the last item of the
  transaction and SETs `totalXp` and `totalLevel`. It carries no condition. The Amplify metadata
  (`__typename`, `owner`, `createdAt`) is `if_not_exists`, so the item creates T1 if no replay
  has yet.
- `SkillStateRow` and `readSkillStates` now also read `displayedXp`, `level` and
  `levelHighWater`. `displayedXp` falls back to `xpLedgerSum`.
- `ledgerTransactItems` and `persistWithLedger` now take `curve`.
- `LedgerDeps` gains `profileTable`.

Wiring:
- `process-activity.ts` passes `deps.registry.curve`.
- `handler.ts` reads `required("PROFILE_TABLE")`.
- `amplify/backend.ts` sets `PROFILE_TABLE` and grants `dynamodb:UpdateItem` on T1, and nothing
  else.
- The `exploredGeneration` mirror is still off. `handler.ts` passes it `table: undefined`
  explicitly, where it used to read `process.env.PROFILE_TABLE`. Without that change, setting the
  variable would have switched on `0182`'s mirror in passing, without its repair path or its
  criteria. `0182` has a dated note saying its steps 1–2 landed here.

**Decisions** (operator-confirmed 2026-09-29, within §4.3's design; no new D-xxx):
1. **The level comes from `displayedXp`, not `xpLedgerSum`.** The ticket's "prev + xp" was
   ambiguous. The replay levels on the displayed number (`xp-replay.ts`), and the two differ after
   a retained floor.
2. **`totalXp` is SET from a recomputation, not `ADD :xp`** as §4.3's sketch reads. The pre-read
   already holds every `SkillState` row, so the totals are recomputed whole with the same sums
   `0066`'s step 6 uses:
   - Σ `displayedXp` over **enabled** skills;
   - Σ shown level, which is `max(level, levelHighWater, level-for-XP)`;
   - an untrained enabled skill counts level 1.

   An ADD would carry any earlier drift forward for ever; a recomputation repairs it on the next
   award. §4.3's as-built note in `docs/02-data-model.md` now says so, and says why.
3. **`totalLevel` is written here too.** T1 documents it as denormalised "in the same transaction
   as an XP write". Writing `totalXp` without it would leave the headline stale.

**The backfill criterion needed no script.** Before starting, a scan of the deployed
`SkillState-nog4…` showed all three rows already populated:
- cartography 13455 XP → L22 / hw 22;
- wayfaring 4218 → L15 / hw 15;
- constitution 1405 → L10 / hw 10.

`0066`'s replay wrote them on 2026-09-29 when it recorded the first award. There are no other rows.

**What went wrong.**
- The first full-suite run failed 18 tests in `amplify/functions/process-activity/handler.test.ts`.
  The new `required("PROFILE_TABLE")` threw at module load because the test environment did not
  set it; adding the variable fixed it.
- `process-activity.test.ts`'s transaction-shape assertion needed the Profile item appended.

**Tests.**
- `src/pipeline/xp-ledger.test.ts` has 9 new tests:
  - level/high-water on a first ADD;
  - level comes from `displayedXp`, not `xpLedgerSum`;
  - I-17: a pre-read high-water of 9 over a computed 5 is left alone;
  - the maxLevel clamp;
  - `profileTotalsItem`'s sums (enabled only, untrained = 1, a ratcheted untouched row counts its
    high-water, a pre-`0219` row counts what its XP buys);
  - create-if-absent metadata;
  - a two-commit run that moves the level and the totals;
  - a re-delivery that touches neither.
- `amplify/xp-ledger-tables.test.ts` asserts the worker's T1 actions are exactly
  `["dynamodb:UpdateItem"]` and that `PROFILE_TABLE` is in its environment.
- Typecheck and lint are clean. The full suite passes: 131 files, 2,424 tests. Every gate passes,
  `docs/INDEX.md` is regenerated, and `validate` reports 0 errors.

**Files.**
- `src/pipeline/xp-ledger.ts`, `src/pipeline/process-activity.ts`
- `amplify/backend.ts`, `amplify/functions/process-activity/handler.ts`,
  `amplify/data/resource.ts` (stale comment)
- `docs/02-data-model.md` §4.3, `docs/INDEX.md`
- tests: `xp-ledger.test.ts`, `process-activity.test.ts`, `handler.test.ts`,
  `xp-ledger-tables.test.ts`
- `tickets/open/0182-…` (note)

## Operator validation

**Nothing here needs the operator** (D-181/D-229). There is no skills screen yet, and every claim
below can be checked with a script. The agent ran all of it on 2026-09-29 against account
`286588821906`.

**Live smoke test: 8/8, on real DynamoDB.** The shipped `persistWithLedger` and
`profileTotalsItem` ran against the deployed `Activity-…`, `XpLedgerEntry-…`, `SkillState-…`,
`Profile-…` and `LostSolesIngestReceipt` tables, as the synthetic user
`smoke-0219-1790709053717`.

| # | What it proved |
|---|---|
| 0 | **The totals formula reproduces the replay's numbers on the operator's real T2**, read-only: computed 19078 XP / Total Level 53, stored 19078 / 53. The ingest and the replay agree on what the headline is. |
| 1a–c | With no Profile row, the first award (300 XP) wrote `level 6 / hw 6` and **created** T1: `__typename: "Profile"`, `owner: "<uid>::<uid>"`, `createdAt`, `totalXp 300`, `totalLevel 14` (6 + 8 untrained enabled skills at 1). |
| 2a | **I-17 on the real table:** `levelHighWater` was forced to 40, then 100 XP was ingested. `level` was recomputed to 7 and the high-water stayed at 40. |
| 2b | `totalLevel` counted the high-water (40 + 8 = 48), `totalXp` 400, and `createdAt` did not move. |
| 3 | A re-delivery of the same activity came back `alreadyScored: true`. A sentinel `totalXp = -1` was left untouched, so an unscored delivery does not write Profile. |
| 4 | **Drift repair:** after the sentinel, the next real award set `totalXp` to 600, which equals `displayedXp`. It recomputes rather than adding onto −1. |

Cleanup: a filtered scan of all five tables for `smoke-0219` counted **0 rows** in each.

**Deployed worker** (commit `4e340f1`; backend deployed in Amplify job 250, Lambda
`LastModified 2026-09-29T19:14:01Z`):
- `PROFILE_TABLE` = `Profile-nog4xy2l7baqlhghpndh2565qe-NONE`.
- An invoke with `{"Records":[]}` returned 200 with no `FunctionError`, so the module loads with
  `required("PROFILE_TABLE")`.
- `iam simulate-principal-policy` on the worker role over T1: `UpdateItem` allowed; `GetItem`,
  `PutItem`, `DeleteItem`, `Query` and `Scan` all implicitDeny.

**Not exercised: a real XP-bearing activity through the queue.** The reason is `0062`'s: every
archived run is already scored, so a replay awards nothing (layer 1), and a `reingest` would write
permanent XP at the wrong rate. The first real import is the end-to-end check. The line to read is
the operator's `Profile` row: `totalXp` should rise from 19078 by that run's `xpAwarded`.

**Perceptual check (later):** once the skills screen exists, the level it shows per skill should
equal T2's `max(level, levelHighWater)`.
