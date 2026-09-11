---
id: 198
slug: res-parent-must-move-6-to-7-now-that-cells-are-res-11
title: RES_PARENT must move 6 to 7 now that cells are res 11
type: chore
priority: med
status: open
size: m
capability: 07-fog-projection-and-cells
depends_on: []
blocked_by: []
source: agent
created: 2026-09-11T01:04:51Z
---

## Description

**D-237 (ticket `0194`) moved the canonical grid from res 10 to res 11 and deliberately left
`RES_PARENT` at 6.** This ticket is the other half, filed rather than smuggled in behind a constant
change so the migration it needs is visible before someone runs it.

`src/domain/fog.ts` justifies `RES_PARENT = 6` on exactly one number: a res-6 cell has **7⁴ = 2,401**
res-10 children, a hard ceiling rather than an average, and that single fact does three jobs —

1. it bounds a DynamoDB partition (2,401 × ~160 B ≈ 384 KB),
2. it bounds a viewport read to 1–20 `Query` calls (AP-15/AP-16),
3. it hands the client its bucketing (`05` §6.2) and the delta-invalidation key (`02` §7.4).

At res 11 a res-6 parent has **7⁵ = 16,807** children — *precisely the figure the same comment
already rejected for res 5*, at ~2.7 MB per partition.

**Nothing is broken today and that is why this is `med` and not `high`.** 2.7 MB is still three
orders of magnitude under the 10 GB partition limit, and the account holds 695 cells. Payoff (1)
survives with a thinner margin. What actually degrades is (2): a viewport `Query` pulls up to 7×
the items it was sized for.

**The fix is res 7, and it is the arithmetic the existing comment already spells out.** A res-7
parent has 7⁴ = 2,401 res-11 children, restoring every number above unchanged. The comment rejects
res 7 — *"343 children makes partitions too small and multiplies rebuild queries by 7"* — but that
was res 7 **against res-10 cells**. Against res-11 cells it is the same 2,401 that made res 6 right
in the first place.

## Options considered

### A. Move `RES_PARENT` to 7 and re-key T6 (recommended)

Restores the original arithmetic exactly. The cost is that it is a genuine data migration, not a
constant change: `U#<uid>#C#<res-6 parent>` becomes `U#<uid>#C#<res-7 parent>` on every T6 row,
and four things read that key shape — AP-15/AP-16's viewport reads, `05` §6.2's client bucketing,
`02` §7.4's delta-invalidation key, and the `#AGG#` items.

The migration itself is cheap for the same reason `0194`'s was: raw traces are archived immutably
(D-101) and `0192`'s replay path re-derives everything from S3. There is no need to transform rows
in place — re-derive them.

### B. Leave it at res 6

Defensible while the account is small, and it is what ships today. It gets worse slowly and
silently, which is the failure mode a `## Notes` entry does not prevent. The number this hinges on
is how many items a viewport `Query` returns in practice — see the open question.

### C. Store at res 11 with a res-6 parent but add a secondary bucketing

Rejected before it is proposed. A second grouping key is a second source of truth about where a
cell lives, and `02` T6's whole design is that the partition key IS the bucketing the client reuses.

## Open questions

- **How many items does a real viewport `Query` actually return now?** The 1–20 `Query` bound in
  AP-15/AP-16 was computed against 2,401-child partitions. Measure it against the re-derived res-11
  set before choosing A over B — this is the number that decides whether B is tolerable.
- **Does `#AGG#` need to change with it?** `explored-agg.ts` computes `totalChildren` as
  `7^(RES - res)`, which already follows `RES`. Confirm the AGG item's own res ladder (6/7/8) is
  still the right ladder when the parent moves.

## Acceptance criteria

- [ ] A viewport `Query`'s real item count is **measured** against the current res-11 set and
      recorded, so option B is rejected on evidence rather than on principle.
- [ ] `RES_PARENT` is 7, and `parentOf` and every T6 key derive from it rather than from a literal.
- [ ] The T6 rows are re-derived through `0192`'s replay path rather than transformed in place, and
      D-020 holds: no cell loses `firstRunAt`, and nothing is un-revealed.
- [ ] `05` §6.2's client bucketing and `02` §7.4's delta-invalidation key are updated to match, or
      shown not to need it.
- [ ] `src/domain/fog.ts`'s `RES_PARENT` comment loses the "D-237 moved the grid out from under it"
      section, because it no longer has.
- [ ] A `D-xxx` records the move, superseding the res-6 half of the original `RES_PARENT` reasoning.

## Notes

- **The old res-6-keyed rows are superseded, not deleted** (D-020), the same way `0194` left the
  res-10 cells and their `explored-r10.<gen>.bin` objects in place under their own names.
- `0196` (a bulk replay exhausts `regenerateExplored`'s manifest-race retries) is in the path of any
  re-derivation and should be settled first or at the same time.

## Operator validation

None beyond a smoke test — this is a partition key, and nothing about it is visible on screen. The
evidence is the measured `Query` item count in criterion 1 plus a post-migration read of the map at
the same generation, confirming the same cell set comes back through the new key.
