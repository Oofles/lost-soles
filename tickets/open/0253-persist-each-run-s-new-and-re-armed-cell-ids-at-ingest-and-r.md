---
id: 253
slug: persist-each-run-s-new-and-re-armed-cell-ids-at-ingest-and-r
title: Persist each run's new and re-armed cell ids at ingest, and rewrite them in the fold
type: feature
priority: high
status: open
size: m
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-13T12:07:12Z
started: 2026-10-13T13:39:25Z
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

- [ ] Ingest writes the per-run classes object from the classification the cells were written
      with; its new/re-armed sizes equal the `newCellCount`/`rearmedCellCount` written to T3.
- [ ] `xp-replay` step 3 rewrites every activity's object from the fold's classification.
- [ ] Every existing traced activity has the object after a one-off backfill, and for each, the
      object's sizes equal T3's stored counts — checked against the real table, not assumed.
- [ ] An activity with no cells gets no object (or an empty one) — chosen, stated, and tested.
- [ ] Encoding: `LSFG`-style sorted cell sets (reuse `encodeExploredBlob`) or gzipped JSON — the
      choice and its size for a 130-cell run recorded in `## Resolution`.
- [ ] Domain stays free of storage: classification already lives in `src/domain`; the object's
      key and codec live in `src/pipeline` (D-100 boundaries unchanged, grep gate green).

## Notes

**Open for this ticket to settle, not 0251:** `kind-rescore.ts` `revealWithoutAward` (D-284 c)
opens cells with no award. Are those cells "new" for the reveal? The cells were genuinely first
revealed then, but the run earned nothing for them. Decide, record, and test it.

The fold classifies against history in `startedAt` order; ingest classifies against the store as
it stood on arrival. They agree except for out-of-order arrivals, which §3.4 already resolves by
replay — so the fold's rewrite is what makes the object eventually right, the same way it makes
T3's counts right.

## Operator validation

None expected: data plumbing with nothing to look at. Agent smoke: run the backfill against the
real bucket, then for every traced activity compare the object's new/re-armed sizes with T3's
`newCellCount`/`rearmedCellCount`; ingest one synthetic activity through the queue and check its
object appears and agrees.
