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

- [ ] Two activities sharing cells, ingested concurrently, award `new` credit for each shared cell
      exactly once in total. A test drives the interleaving that loses today.
- [ ] AGG `exploredChildren` cannot be double-counted by that interleaving.
- [ ] `visitCount` and `discoveryCount` do not grow when the same activity is replayed, or the
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

## Operator validation

None beyond a smoke test. The evidence is a replay of the archived activities at concurrency 5
whose AGG sums equal T6's cell count.
