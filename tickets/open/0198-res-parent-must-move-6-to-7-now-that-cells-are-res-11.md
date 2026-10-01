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
started: 2026-10-01T18:27:07Z
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

- [x] A viewport `Query`'s real item count is **measured** against the current res-11 set and
      recorded, so option B is rejected on evidence rather than on principle.
- [x] `RES_PARENT` is 7, and `parentOf` and every T6 key derive from it rather than from a literal.
- [x] The T6 rows are re-derived through `0192`'s replay path rather than transformed in place, and
      D-020 holds: no cell loses `firstRunAt`, and nothing is un-revealed.
- [x] `05` §6.2's client bucketing and `02` §7.4's delta-invalidation key are updated to match, or
      shown not to need it.
- [x] `src/domain/fog.ts`'s `RES_PARENT` comment loses the "D-237 moved the grid out from under it"
      section, because it no longer has.
- [x] A `D-xxx` records the move, superseding the res-6 half of the original `RES_PARENT` reasoning.

## Notes

- **The old res-6-keyed rows are superseded, not deleted** (D-020), the same way `0194` left the
  res-10 cells and their `explored-r10.<gen>.bin` objects in place under their own names.
- `0196` (a bulk replay exhausts `regenerateExplored`'s manifest-race retries) is in the path of any
  re-derivation and should be settled first or at the same time.

## Resolution

**Option A shipped: `RES_PARENT = 7` (D-267).** Code in `d863189`, deployed by Amplify job 272.
T6 was re-derived through `0192`'s replay path.

### Criterion 1: the measurement, and what it actually showed

Measured live before anything moved: **1,141 res-11 cells** in two res-6 partitions. The real
`Query` on the big one returned **1,139 items for 46 RCU**, and the other held 2. After the
re-key: **5 res-7 partitions of 480 / 363 / 264 / 32 / 2 items**, the largest 19.5 RCU, each one
page.

Honest reading: **at today's size option B costs nothing measurable.** One page, 46 RCU, on a
path nobody runs. A was chosen on the ceiling, not today's cost. A full res-6 partition is 16,807
items, ~2.7 MB over three pages. And `lib/fog/zoom-buckets.ts`'s coarse render buckets were
grouping at 16,807 children per invalidation key. Both grow with a map that never shrinks, and
the migration only gets more expensive.

**The ticket's framing was off in one place:** there is no "viewport `Query`". AP-15 has been
`BatchGetItem` since `0048`, and the client reads the blob. The only per-parent `Query` is the
rebuild (AP-16/AP-17). That reads the same total either way; only the pages per partition change.
The docs now say "bounds a rebuild read".

### Open questions, answered

- **`#AGG#`'s ladder stays 6/7/8.** `totalChildren` already followed `RES`. What did need to
  change was **`explored-rebuild.ts`, which enumerated `AGG_RESOLUTIONS[0]` (= 6)**. That was
  correct only by coincidence while the parent was res 6. Left alone, every rebuild would have
  queried res-6 keys that no new cell is written under and published an empty map, and **no test
  would have caught it**: the fakes write and read through the same code. It now reads
  `AGG#${RES_PARENT}` and throws at import if the ladder ever lacks that rung.
- **Client bucketing (`05` §6.2) and the delta-invalidation key (`05` §7.4, `02` §6.5) needed
  no code.** `zoom-buckets.ts` and `explored-set.ts` already derived from `RES_PARENT` / `parentOf`
  (`0058`/`0203` did that in anticipation). With the parent at 7, `groupResFor` coincides with
  `RES_PARENT` for every bucket at res ≥ 7, and a new test asserts that.

### The migration

1. Snapshot all 1,163 T6 items (1,141 cells, 21 AGG, 1 GEN) to `tmp/0198/before.json` and
   `s3://…/backup/0198/t6-before.json`. Manifest at generation 99.
2. Push, then wait for job 272 (BUILD/DEPLOY/VERIFY SUCCEED; worker Lambda modified 18:42Z).
3. With the operator's go-ahead: delete the 21 AGG rows (the `0194` finding: a replay `ADD`s
   to them). The 1,141 res-6 cell rows and `#GEN` were left alone.
4. Replay all 18 receipted activities. Queue drained, DLQ 0, generation 99 → 128.

### What went wrong

**The AGG counts came back 58 high (1,199 per rung, not 1,141).** The replay ran five workers wide
(D-266). Overlapping activities each read a shared cell as absent before either wrote it, and both
classified it `new`. The same race put `discoveryCount = 2` on 23 cells. That is a **live-ingest
defect**, not something this ticket introduced: on a first-time backfill it would double-award XP
that D-135 forbids taking back. Filed as **`0228`** (high).

XP did **not** move on this replay: the per-activity stored award still sums to 1,141 new cells
(`0220`'s stored-award path). My follow-up `SET` to correct the AGG rows to T6's true counts was
**refused at the permission layer** as a write to shared data. Correcting them is now a `0228`
criterion that needs the operator's go-ahead. They are a cross-check only: no shipped artefact and
no rebuild reads the counts.

**Two counters changed, and both are now closer to the truth than before:**

- `visitCount` dropped on 153 cells (e.g. 18 → 10). The old rows had been incremented by every
  earlier replay of the same activity (`ADD :one` has no per-activity guard; also in `0228`).
- `discoveryCount` went 1 → 2 on 167 cells that genuinely re-armed (first and last runs more than
  six months apart). The old 1 was an ordering artefact of the original import.

Neither is XP, and neither is covered by D-020's append-only rule. D-020's cell fields
(`firstRunAt`, `lastRunAt`) are identical on every cell.

My first verify script failed to decode the blob because the S3 object is `Content-Encoding: gzip`.
That was a bug in the script, not the data; fixed and re-run.

### Files

`src/domain/fog.ts` (constant + comment) · `src/pipeline/explored-rebuild.ts` (enumerates
`AGG#${RES_PARENT}`, ladder assertion, error message) · comment-only: `explored-cells.ts`,
`explored-generation.ts`, `persist.ts`, `explored-agg.ts`, `explored-blob.ts`,
`lib/fog/explored-set.ts`, `lib/fog/zoom-buckets.ts` · tests: `explored-cells.test.ts`,
`explored-rebuild.test.ts`, `zoom-buckets.test.ts` (new "coincides with RES_PARENT" test),
`process-activity.test.ts` · docs: `01` §4 / step 13 / live updates, `02` T6 + partition math +
§2.10 + AP-16 + S-2 + §6.5, `05` §2.4 / §6.2 / §7.4 / §9.4 · `DECISIONS.md` D-267 · new ticket
`0228`. Scratch scripts: `tmp/0198/{measure,snapshot,delete-agg,fix-agg}.mjs`, `verify.ts` (gitignored).

## Operator validation

**None asked of the operator**, as planned: this is a partition key, and nothing about it shows on screen.
The planned evidence was the measured `Query` count plus a post-migration read of the map at the same
generation through the new key. Both are below.
Smoke tests run against production on 2026-10-01:

- **Gates:** `tsc --noEmit` 0, `eslint --max-warnings 0` 0, **2,474 tests** passed (133 files),
  every `scripts/check-*.mjs` guard 0.
- **Deploy:** Amplify job 272 on `d863189`: BUILD / DEPLOY / VERIFY SUCCEED. `/` → 200,
  `/?fog=mask,debug` → 200.
- **D-020, cell by cell, before vs after:** 1,141 res-7-keyed rows, every one keyed by `parentOf`.
  **Every pre-migration cell present (nothing un-revealed)**. `firstRunAt`, `firstRunId`,
  `lastRunAt`, `lastRunId`, `lastRunDay`: 0 cells differ. The 1,141 res-6 rows remain,
  byte-identical to before.
- **The real rebuild path, live:** the shipped `rebuildFromTable` (enumerate `AGG#7`, `Query` each
  res-7 partition) returns **1,141 cells, identical to the published `explored-r11.128.bin`**
  decoded through the shipped `decodeExploredBlob`. `AGG#7`'s parents are exactly the 5 cell
  partitions.
- **Criterion 1, after:** five res-7 `Query` calls, 2–480 items, 0.5–19.5 RCU, none paginated.
- **XP untouched:** stored per-activity `newCellCount` still sums to 1,141 over 18 activities.
- **Not passing: AGG `exploredChildren` sums 1,199 at each rung.** See *What went wrong*; owned by
  `0228`.
