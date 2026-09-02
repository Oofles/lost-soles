---
id: 48
slug: discovery-classification-new-cold-warm
title: Discovery classification — new / re-armed (>6mo, 50%) / cooled (<6mo, 0%)
type: feature
priority: high
status: open
size: m
capability: 07-fog-projection-and-cells
depends_on: [47]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] `classifyCells(cells, records, at)` is pure and returns disjoint `new` / `rearmed` / `cooled`
      lists plus the summed credit.
- [ ] The module is tested with the clock stubbed to **throw**; no `Date.now()` anywhere in the
      scoring path (I-12).
- [ ] Boundary tests: `at − lastRunAt` of 182 days → cooled (0.0); 184 days → re-armed (0.5); no
      record → new (1.0). A cell run 7 months ago classifies cold, 5 months ago warm.
- [ ] `SIX_MONTHS_MS` is 183 days of milliseconds, defined once, with the §9.2 rationale in a
      comment.
- [ ] A run crossing 30 new + 30 cooled cells produces credit 30.0, not 60.0 or 45.0.
- [ ] Classify-then-write ordering test: a run over 100 contiguous *new* cells classifies all 100
      as new. (Written naively, the tail would come back cooled.)
- [ ] `discoveryCount` increments only for new and re-armed cells.
- [ ] A negative delta logs an error and fails the job rather than scoring it as cooled.
- [ ] The award record is persisted and read back by the UI path; a second call returns the stored
      award rather than reclassifying.

## Notes

Capability `09` consumes `newShare = newCellCount / cellCount` to blend Wayfaring XP (D-021,
half XP on known ground). Fog contributes exactly that one number and nothing else; activity-skill
XP is not this subsystem's business (`05-fog-of-war.md` §3.6).

Zero cells (treadmill, indoor, no-GPS) → zero credit, no cell writes, no generation bump, but a
ledger entry is **still written** with `cellCount: 0`, so the idempotency gate covers no-GPS
activities and re-import stays a no-op. A trace whose samples are all filtered out by 0045 is
treated as no-GPS and logs the reject counts.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

1. Sync a run over ground you have covered in the last month. The award record shows
   `newCellCount` near zero and `discoveryCredits` 0.
2. Sync a run down a street you have never run. `newCellCount` should roughly match the number of
   ~130 m corridor segments in that street.
3. Nothing is visible on the map for a cooled run — that is correct, D-020 means the ground was
   already revealed. Confirm the map does not change and the award record explains why.
