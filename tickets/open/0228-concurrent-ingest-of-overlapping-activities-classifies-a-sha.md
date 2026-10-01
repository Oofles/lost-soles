---
id: 228
slug: concurrent-ingest-of-overlapping-activities-classifies-a-sha
title: Concurrent ingest of overlapping activities classifies a shared cell new twice
type: bug
priority: high
status: open
size: m
capability: 07-fog-projection-and-cells
depends_on: []
blocked_by: []
source: agent
created: 2026-10-01T18:53:31Z
started: 2026-10-01T19:05:39Z
---

## Description

**Found by `0198`'s migration replay, 2026-10-01.** Cell classification is read-then-write:
`readCells` (`BatchGetItem`) decides `new` / `rearmed` / `cooled`, then the writes land. The
writes are individually safe (conditional `min`/`max`, I-8). The CLASSIFICATION is not: two
workers ingesting activities that share a cell can both read it as absent before either writes,
and both classify it `new`.

D-266 caps the event source at five concurrent workers, so a bulk replay or a Strava history
backfill (the two things that put overlapping activities in flight together) does this routinely.
Measured on the operator's 18 activities replayed at concurrency 5 after the T6 re-key:

- **AGG `exploredChildren` summed to 1,199 at every rung (6, 7 and 8), against 1,141 real cells.**
  58 duplicate `new` classifications. The `0194` replay happened to come out exact.
- **`discoveryCount` = 2 on 23 cells** whose first and last runs are under six months apart, so
  no re-arm can explain it. (Another 167 cells went 1 → 2 and were genuine re-arms, more than six
  months apart. Their old value of 1 was an ordering artefact of the original import.)

**Why `high`.** On a replay the stored award wins (`0220`), so XP did not move. That was verified:
the per-activity `newCellCount` still sums to 1,141. But on a **first** ingest there is no stored
award. Two overlapping backfilled runs both earn full `new` credit for the shared ground, and
D-135 means that XP can never be taken back. Nothing has hit this live yet, because the history
was imported before the cell writer existed.

**Separate defect, same file:** `visitCount` is `ADD :one` with no per-activity guard, so every
replay of an activity counts another visit. Before `0198`'s re-key some cells read 18 visits from
18 activities after several replays. The re-derived rows are correct (max 10) only because each
activity was replayed exactly once onto empty rows.

## Acceptance criteria

- [x] Two activities sharing cells, ingested concurrently, award `new` credit for each shared cell
      exactly once in total. A test drives the interleaving that loses today.
- [x] AGG `exploredChildren` cannot be double-counted by that interleaving.
- [x] `visitCount` and `discoveryCount` do not grow when the same activity is replayed, or the
      ticket records why that stat is allowed to drift.
- [x] The live AGG rows for the operator's account are corrected to the counts T6 actually holds
      (1,141 per rung as of 2026-10-01), **with the operator's go-ahead**. `0198`'s attempt to
      `SET` them was stopped at the permission layer as a write to shared data.
      — done 2026-10-01 on the operator's explicit go-ahead: 7 rows corrected with conditional `SET`s
      (e.g. AGG#6 1197 → 1139, AGG#7 522 → 480). Each rung now sums to 1,141, `rebuildFromTable`
      still matches blob gen 128. This fixes the symptom only; the race above remains open.

## Steps to reproduce

1. Two activities whose traces overlap, neither yet in T6.
2. Deliver both to the worker at once (`tools/replay/replay-activities.ts --confirm` with five
   workers does it).
3. Read the AGG rows and the activities' stored awards.

## Expected vs actual

**Expected:** each shared cell classified `new` by exactly one of the two activities.

**Actual:** both classify it `new`. AGG counts it twice, and on a first ingest both awards credit it.

## Notes

- Candidate shape, **not decided**: make the `new` claim the conditional write itself
  (`attribute_not_exists(pk)` on the first-run write, already half there in `firstRunBackfill`)
  and derive the classification from which write won, rather than from the earlier read. That
  matches how D-219 resolved the manifest race. It needs a design decision before code (D-152).
- Evidence: `tmp/0198/before.json` / `after.json` (gitignored) and `0198`'s Resolution.

## Resolution

**Decision D-268** (operator-approved, including the extension to `rearmed`): a verdict that awards
credit is a CLAIM that the write settles, not a decision the read makes.

- `src/pipeline/explored-cells.ts`:
  - `cellUpdate` takes an optional `CellClaim`. `new` writes under
    `attribute_not_exists(lastRunAt)`, `rearmed` under `lastRunAt = :seen`. It is the same update
    expression under a stricter condition, so an uncontested ingest sends exactly what it did before.
  - `writeCells` now returns `{ written, classified }`, where `classified` holds the SETTLED
    verdicts. A lost claim is collected, the lost cells are re-read in one `readCells` (consistent
    `BatchGetItem`, already granted, so no IAM change) and reclassified by the same
    `classifyCells`, and the loop repeats. It is capped at 5 rounds, then throws.
  - `cooled` and `deferred` take the unclaimed path, with credit hard 0.
  - `CellWriteResult` gains `contested` for the log line.
- `src/pipeline/process-activity.ts`: `awardOf`, `writeAggregates` and the ground split now read
  the settled verdicts. The phase-2 read is renamed `candidates` so nothing scores it by accident.
- Tests (`explored-cells.test.ts`): the fake table evaluates both claim conditions and answers the
  re-read.
  - New `concurrent claims` block, which reads both activities first and then writes: earlier
    wins → later is `cooled`; later wins → earlier is `deferred`; true `Promise.all`; AGG sums
    exact at rungs 6/7/8 in both orders; a re-arm claimed once; a lost `new` that re-arms against an
    older winner; the round budget throws.
  - New `replay` block: replaying the first, middle and last activity on a cell changes no attribute.
  - **Mutation check:** relaxing the two claim conditions back to the unclaimed one fails 6 of the
    new tests.
  - Existing tests that used the helper's `"new"` default over existing cells now report
    `contested`, because the writer corrects the stale verdict instead of crediting it.
    `process-activity.test.ts` now asserts that a first run's writes are claims.
  - `same-run-cases.test.ts`'s fake learned the claim conditions.
- Docs: `05` §3.2 has an amendment block after the I-10 correction, and §3.3 gains the
  allowed-re-read sentence and a "two activities in flight" case. D-268 is in `DECISIONS.md`.

**Criterion 3: no guard needed, and the historical drift is unexplained.** Against the current
writer, a replay cannot move `visitCount` or `discoveryCount`. The activity is either the cell's
`lastRunAt` (`<` is false at equality), its `firstRunAt` (`>` is false), or between them (nothing
applies). A test proves it. I did **not** find what produced `0198`'s "18 visits from 18
activities after several replays". It does not reproduce against this code, so it predates the
current conditions or came from a path since removed. Recorded as unexplained, not as fixed.

**What went wrong / found on the way.**
- The smoke test showed concurrency makes T6's documented "middle arrival writes nothing" hole
  routine for `visitCount`: 164 counted against 340 real visits. A `cooled` write overtaken by a
  later run lands nowhere and marks no replay. Credit is unaffected, and nothing reads
  `visitCount` yet. Filed as **`0229`** (low) rather than widening this ticket.
- A whole-suite run failed ten `amplify/*` CDK suites with `ENOSPC`. `/tmp` (16 GB tmpfs) was full
  of 509 leaked `cdk.out*` directories from earlier synth tests, about 300 MB per run. I cleared
  them and the suite went green. That is not this ticket's defect, and it is not filed.

## Operator validation

No perceptual check: this ticket changes nothing visible. **Smoke test, real DynamoDB**
(`AWS_PROFILE=devault`, us-east-1, 2026-10-01): `tmp/0228/smoke.ts` (gitignored) created a
throwaway `PAY_PER_REQUEST` table with T6's key schema. It ran five synthetic Point Nemo runs one
day apart, sharing a k=4 disk (61 cells) plus 7 private cells each. All five `readCells` ran first,
then all five `writeCells`+`writeAggregates` ran under `Promise.all`. The table was deleted
afterwards. Run twice:

- 340 cells read as `new`, which **settled to 96 `new` = 96 distinct cell rows**.
- `contested` was `[0, 61, 61, 61, 61]`: the race happened on every shared cell, and each lost claim
  re-read and reclassified (`cooled` or `deferred`).
- **AGG `exploredChildren` summed to 96 at rungs 6, 7 and 8.** Before this fix the same shape
  would have summed to 340.
- **Max `discoveryCount` = 1** across all rows.
- `visitCount` summed to 164 of 340. That is the separate undercount filed as `0229`.

The live operator account was not replayed. Its AGG rows were already corrected (criterion 4), and
another concurrent replay of real history would need your go-ahead for writes to shared data.
