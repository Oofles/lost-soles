---
id: 253
slug: persist-each-run-s-new-and-re-armed-cell-ids-at-ingest-and-r
title: Persist each run's new and re-armed cell ids at ingest, and rewrite them in the fold
type: feature
priority: high
status: closed
size: m
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-13T12:07:12Z
started: 2026-10-13T13:39:25Z
closed: 2026-10-13T13:51:24Z
---

## Description

Split out of `0251` (D-152 finding, operator decision 2026-10-13). `0251` assumed the re-armed
verdict was *"written at ingest"* per cell. It is not. Ingest classifies each cell against T6 as it
stood before the run (`classifyCells` → `writeCells`), keeps only the **counts** on T3
(`newCellCount`, `rearmedCellCount`), and the write itself overwrites `lastRunAt` — the one value
the verdict was computed from. After ingest, *"was this cell re-armed by run R?"* cannot be
answered from T6. *"New"* survives as `firstRunId == R` only until a backfill lowers it.
At the time of filing, 5 of the operator's 19 activities carry re-armed cells, so this is not
hypothetical.

Persist the verdict where it is made: one small per-run object beside the per-run cell record
`users/<uid>/cells/<activityId>.bin` (`objectKeys.runCells`), holding the run's **new** and
**re-armed** cell ids. Familiar is everything else in the run's cell record and is not stored.

Writers — every path that produces a classification for a run:

- **Ingest** (`process-activity.ts`, beside `appendCellsToRun`): from `classified`, the verdicts
  the cells were actually *written* with, never `candidates`.
- **The fold** (`xp-replay.ts` step 3, via `foldActivities`' `onActivity`): a replay re-derives
  history, so it rewrites every activity's object — otherwise a replay that changes an award
  leaves a stale reveal set beside a corrected count.
- **Backfill**: the 18 existing traced activities have no object. `t3-repair` is already the fold
  with no replay; it (or a sibling tool) writes the objects once.

`0251` then serves the object on `/run/:id`.

## Acceptance criteria

- [x] Ingest writes the per-run classes object from the classification the cells were written
      with; its new/re-armed sizes equal the `newCellCount`/`rearmedCellCount` written to T3.
      — `process-activity.ts` step 6b writes `runClassesOf(classified)` — the verdicts `writeCells` returned, not `candidates`. `process-activity.test.ts`: sizes equal `result.award`'s counts; the key is in the publish-order list.
- [x] `xp-replay` step 3 rewrites every activity's object from the fold's classification.
      — every activity whose award step 3 writes (ACTIVE, ground-scored), after `writeActivityScores`. A tombstoned or pathless activity is not rescored (D-258), so its object is not rewritten — the same rule as its T3 award. `xp-replay.test.ts` "the run's reveal set (0253)": a stale and a missing set are both restored, five writes, after T3.
- [x] Every existing traced activity has the object after a one-off backfill, and for each, the
      object's sizes equal T3's stored counts — checked against the real table, not assumed.
      — `repair-t3.ts --confirm` on 2026-10-13 against the real bucket: 18 written, then `reveal sets after: 0 reveal-set mismatches` — every object's sizes equal T3's counts, including the 5 runs with re-armed cells.
- [x] An activity with no cells gets no object (or an empty one) — chosen, stated, and tested.
      — no cells → no object (ingest returns before step 6, as for `cells/<id>.bin`; the existing traceless and rules-refused tests assert `blobPuts` is empty). Cells but nothing new or re-armed → an EMPTY object, so absent means "never classified". Tested in `explored-blob-store.test.ts`; three real runs are 0/0.
- [x] Encoding: `LSFG`-style sorted cell sets (reuse `encodeExploredBlob`) or gzipped JSON — the
      choice and its size for a 130-cell run recorded in `## Resolution`.
      — gzipped JSON. Measured on the real objects; recorded in `## Resolution`.
- [x] Domain stays free of storage: classification already lives in `src/domain`; the object's
      key and codec live in `src/pipeline` (D-100 boundaries unchanged, grep gate green).
      — `RunClasses` + pure `runClassesOf` in `src/domain/discovery.ts`; key and codec in `src/pipeline/explored-blob-store.ts`. `check-boundaries.mjs` green.

## Notes

**Open for this ticket to settle, not 0251:** `kind-rescore.ts` `revealWithoutAward` (D-284 c)
opens cells with no award. Are those cells "new" for the reveal? The cells were genuinely first
revealed then, but the run earned nothing for them. Decide, record, and test it.
*Settled 2026-10-13 (operator took the recommendation): **no** — it writes no object (D-294).*

The fold classifies against history in `startedAt` order; ingest classifies against the store as
it stood on arrival. They agree except for out-of-order arrivals, which §3.4 already resolves by
replay — so the fold's rewrite is what makes the object eventually right, the same way it makes
T3's counts right.

## Operator validation

None expected: data plumbing with nothing to look at. Agent smoke: run the backfill against the
real bucket, then for every traced activity compare the object's new/re-armed sizes with T3's
`newCellCount`/`rearmedCellCount`; ingest one synthetic activity through the queue and check its
object appears and agrees.

**Result, 2026-10-13 — agent smoke against real AWS (no operator check; nothing to look at).**
- **Backfill + audit, real bucket and table:** `repair-t3.ts` dry run → T3 audit 0 mismatches,
  18 reveal sets `missing`; `--confirm` → 18 written, `reveal sets after: 0 reveal-set
  mismatches`, exit 0. Every traced activity's object has exactly T3's new/re-armed sizes,
  including the 5 with re-armed cells (e.g. `2460ebe8…` 14 new / 63 re-armed). This is the same
  `writeRunClasses` the worker calls.
- **Deployed worker:** redeployed 13:50 UTC from `35a3b9e`; its downloaded bundle (`index.mjs`)
  contains the `.classes.json` key. Its role holds `WriteAndReadExploredDeliveryLayer`
  (`s3:PutObject`, `s3:GetObject` on `users/*`), the grant its existing `cells/<id>.bin` write
  already uses.
- **Not run:** a synthetic traced ingest through the queue — the manual adapter has no trace, and
  faking a raw archive + receipt for it outweighed what it adds over the above. The first real
  ingest after this deploy is the proof; `repair-t3.ts` (dry run) audits it at any time, and
  `0251`'s smoke reads the object through `/run/:id`.

## Resolution

Split out of `0251` when its premise failed a check: the re-armed verdict was assumed to be
*"written at ingest"* per cell and is not — T3 keeps only the counts, and ingest's own T6 write
overwrites the `lastRunAt` the verdict was read from. The operator chose to persist the verdict
where it is made (D-294) over serving `new` only or folding history on every page load.

**What was built (`35a3b9e`).**
- `src/domain/discovery.ts` — `RunClasses` and `runClassesOf(classified)`: the `new` and `rearmed`
  cells, sorted. Pure, so ingest, replay and repair share one definition and its sizes are
  `awardOf`'s counts by construction.
- `src/pipeline/explored-blob-store.ts` — `objectKeys.runClasses` →
  `users/<uid>/cells/<activityId>.classes.json`; `writeRunClasses` (gzipped JSON, `no-store`) and
  `readRunClasses` (`undefined` when absent; throws on a body that is not `{ new, rearmed }`).
- `src/pipeline/process-activity.ts` — step 6b, right after `appendCellsToRun`, from `classified`.
- `src/pipeline/xp-replay.ts` / `xp-replay-store.ts` — `ReplayStore.writeRunClasses`; step 3
  rewrites it for every activity whose award it writes, after `writeActivityScores`.
- `src/pipeline/t3-repair.ts` — `planT3Repair` now returns the fold's `classes`; new
  `auditRunClasses`. `tools/xp-replay/repair-t3.ts` audits them on a dry run and writes them on
  `--confirm` — the backfill, and a standing check.
- Docs: D-294; `02-data-model.md` §8.3 amendment beside D-276's per-run record.

**Tests.** `discovery.test.ts` (classes exclude cooled and deferred; sizes = `awardOf`),
`explored-blob-store.test.ts` (key, headers, round trip, empty ≠ absent, malformed refused),
`process-activity.test.ts` (ingest writes it, sizes = award; publish-order list updated),
`xp-replay.test.ts` (a re-armed fixture run seven months on; replay restores a stale and a missing
set after T3; repair plans and audit names `missing` and a wrong size), `kind-rescore.test.ts`
(`revealWithoutAward` writes the cell record and no reveal set). Full suite: 3,002 green (1 skipped).

**Encoding — measured on the 18 real objects.** Gzipped JSON. 117 new → 368 B; 179 → 511 B;
322 (293 + 29) → 921 B. At ~130 revealed cells that is **~400 B stored, ~2.4 KB as raw JSON**. A
gzipped `LSFG` pair for the same sets is ~190–220 B. Chosen anyway: the reader serialises the ids
to the browser as JSON, so a binary set would be decoded and re-encoded on every page load, to save
~200 B. The operator's 130-cell run (`7e1c7a17…`) has 63 new and 67 familiar → 234 B.

**Decisions.** D-294. `revealWithoutAward` (D-284 c) writes no object: its cells earn nothing, so
they are not the run's reveal, and the object stays equal to T3's counts. Cost: such cells show as
already clear on `/run/:id`, a rare path (a kind change after the fact).

**What went wrong.** My own ticket commits (`0079`'s close and the `0251`/`0253` split) did not
regenerate `docs/INDEX.md`; CI's gate failed on them — the exact failure a saved memory warns
about. Fixed in `35a3b9e`. The first commit attempt of the code was also refused by the pre-commit
hook because node was not on PATH in that shell. The ticket's planned ingest smoke (*"one synthetic
activity through the queue"*) was not run: the manual adapter carries no trace, so a traced
synthetic would need a fabricated raw archive and receipt. What it would have proven is covered
otherwise — see `## Operator validation`.

