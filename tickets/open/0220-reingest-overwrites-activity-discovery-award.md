---
id: 220
slug: reingest-overwrites-activity-discovery-award
title: A reingest overwrites the Activity row's discovery award with zeros
type: bug
priority: med
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: [62]
blocked_by: []
source: agent
created: 2026-09-29T02:19:08Z
---
## Description

Found while building `0062`, and it predates it. A `reingest` (`0192`), or a redelivery after the
90-day receipt TTL, re-runs `projectCells` against a store that already holds this activity's
cells. Every one of them now carries this activity's own `lastRunAt`, so every cell classifies
`cooled`. The award comes back `newCellCount: 0, cooledCellCount: N`, and `persistActivity`
**overwrites** the T3 row with it: the put is unconditional.

The cells, the map and XP are all unaffected. `0062`'s layer-1 check (D-254) keeps XP at its
original value. What changes is the denormalised award on the `Activity` row that the post-run
card and the activity list read. After a replay, a run that opened new ground reads as if it
opened none. `02` §3.2 is explicit that the award is *stored, not recomputed* for exactly this
reason.

## Acceptance criteria

- [ ] A second delivery of an already-committed activity leaves `newCellCount`,
      `rearmedCellCount`, `cooledCellCount` and `deferredCellCount` on T3 exactly as the first
      delivery wrote them.
- [ ] The fix decides what a *revised* activity (a real source-side edit, `revision` bumped)
      does. That is `05` §3.5's un-award path, so it should probably be refused or deferred here
      rather than half-handled.
- [ ] A test runs the same activity through `processActivity` twice against a store that
      remembers the first run's cells, and asserts the row's award is unchanged.

## Steps to reproduce

1. Ingest a run over never-seen ground. T3 shows `newCellCount: N > 0`.
2. Send a `reingest` for the same activity.
3. Read the T3 row again.

## Expected vs actual

**Expected:** `newCellCount: N`, as first awarded.

**Actual:** `newCellCount: 0`, `cooledCellCount: N`.

## Notes

The likely shape: when `persistWithLedger` finds the activity `alreadyScored`, the award on the
row should come from the existing row, not from the reclassification. That is the same decision
D-254 made for XP. The `Activity` put may need `02` §4.3's
`attribute_not_exists(id) OR revision < :rev` condition, which has never been implemented.

## Operator validation

TODO — a smoke test: replay an archived activity and read T3 before and after.
