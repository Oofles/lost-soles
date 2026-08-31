---
id: 62
slug: xp-ledger-entry-append-only
title: XpLedgerEntry (T4) — append-only, one row per (activity, skill, reason)
type: feature
priority: high
status: open
size: m
capability: 09-xp-engine-and-ledger
depends_on: [12]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] `XpLedgerEntry` is defined with every attribute above; `id` is composed by a template that
      never enumerates skill ids.
- [ ] Writes use `ConditionExpression: attribute_not_exists(id)`; re-delivering the same
      activity writes zero new rows and does not error the pipeline.
- [ ] The `reason` vocabulary is closed and exactly: `new_ground`, `rearmed_ground`,
      `recent_ground`, `distance`, `reps`, `duration`, `cells_new`, `cells_rearmed`,
      `constitution_share`, `retained_floor`, with `slayer_win` / `slayer_loss` / `boss_phase`
      reserved and unused in MVP (D-122).
- [ ] `xpAwarded` is an integer on every row; a property test asserts `Number.isInteger` for
      every row the scorer emits and that summing a ledger in **random order** gives the same
      total (I-19).
- [ ] Every row carries a non-null `xpRulesVersion` — structurally guaranteed by its presence
      in the `id`.
- [ ] Ledger rows, the `Activity` put, the `SkillState` updates and the receipt transition
      commit in **one** `TransactWriteItems`; a forced failure of any item leaves none of them
      written.
- [ ] `SkillState` `ADD`s use a `ConditionExpression` on the pre-read `xpLedgerSum`; a lost race
      retries the whole transaction.
- [ ] The generated AppSync schema exposes **no** create/update/delete mutation for T4, and read
      is `allow.owner().to(['read'])`; a CI assertion over the generated schema fails the build
      if one appears (I-18, I-20).
- [ ] A consistency test asserts `displayedXp == SUM(xpAwarded)` per `(userId, skillId)` over a
      seeded fixture (I-15).

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0012 provides the Amplify backend the ledger table is defined in.


Cell writes stay **outside** the transaction when a run touches more than ~60 cells: DynamoDB
caps `TransactWriteItems` at 100 items and a run touches 40–130 (D-144). Order is cells first,
then the transaction, so the failure mode is "map ahead of XP", never "XP ahead of map" — the
right direction, because D-020 makes the map append-only.

`isFloor` and `retained_floor` are *defined* here but only **written** by the replay job (0066).
Ship the field now; a ledger that cannot express a floor row cannot be made monotonic later
without a migration.

Volume sanity: ~4.5 rows per activity, 9,000–25,000 rows at five years. This table is small.

## Operator validation

On the **`/skills/:skillId` detail sheet** for Wayfaring, on the **Pixel 8 Pro**: the `RECENT`
list is the ledger rendered. After importing one run, its rows must appear there and the sum of
every row ever shown must equal the level bar's XP on the panel behind it. Import the same run
twice (re-trigger the sync): the sheet must show **one** entry, not two, and the XP must not
move on the second import.
