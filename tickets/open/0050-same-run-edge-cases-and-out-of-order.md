---
id: 50
slug: same-run-edge-cases-and-out-of-order
title: Same-run edge cases, out-of-order and backfilled activities, score-time idempotency
type: feature
priority: high
status: open
size: m
capability: 07-fog-projection-and-cells
depends_on: [40, 48]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The three families of correctness case in `05-fog-of-war.md` §3.3–3.5, made explicit as tests and
as the score-time idempotency gate.

**Same-run cases (§3.3)** are all solved by `traceToCells` returning a `Set` (0045), but each needs
a named test so nobody optimises the `Set` away:

- A cell crossed twice in one activity scores once; `visitCount` +1, not +2 (visits are per
  activity, not per traversal).
- An out-and-back scores exactly what its one-way version scores.
- A figure-eight's crossing cell is one cell.
- Two activities on the same day are *different* activities and score independently — the second
  finds `lastRunAt` a few hours old and scores zero. Correct per D-120; the cooldown does not care
  that it is the same day.
- A paused-and-resumed recording emitted as one trace is one activity. Segment splitting keeps its
  geometry honest but does not split the scoring.

**Out-of-order (§3.4).** The canonical score of a history is a deterministic fold over the user's
activities sorted ascending by `startedAt`, ties broken by `activityId`, single-threaded per user
(I-14). Normal case — the incoming `startedAt` is later than everything scored — scores
incrementally. Otherwise, **enqueue a replay** from that timestamp forward: re-fold the already-
stored activities in date order, rewrite affected cell records and ledger entries. Never on the
request path. Replay is bounded — five years is ~1,000 activities × ~110 cells ≈ 110k in-memory
operations, one invocation.

**Replay must never un-reveal a cell.** It rewrites `lastRunAt`, `firstRunAt` and `discoveryCount`;
it never deletes one. D-020 forbids it outright, and a replay over a superset of activities can
only produce a superset of cells anyway.

**Score-time idempotency (§3.5).** Two layers in one key:

```
key = source#externalId # sha256(canonicalJson({points, startedAt})).slice(0,16) # v<FOG_ALGO_VERSION>
```

Layer 1 catches webhook redelivery. Layer 2 catches the same source id now carrying *different*
geometry — the user cropped the activity or corrected its start time. Same id + same content → key
hits, nothing is written, the stored award is returned. Same id + different content is a
**revision**: look up the prior ledger entry by source id, un-award it (subtract XP, decrement
`visitCount`/`discoveryCount`, restore `lastRunAt`/`lastRunId` by replay), then score the new
version. **Do not remove cells** — ground that was revealed stays revealed even if the activity
that revealed it was edited to exclude it.

`store.appendCellsToRun(activityId, cells)` exists precisely so un-award is possible without
re-deriving geometry. `FOG_ALGO_VERSION` is in the key so a deliberate algorithm change invalidates
every key and forces a full auditable rescore rather than a silent mix of old and new scoring.

## Acceptance criteria

- [ ] Named tests exist for all five same-run cases above, each asserting cell count, credit and
      `visitCount`.
- [ ] Score-time `ingestKey` is built exactly as specified, including `FOG_ALGO_VERSION`.
- [ ] Ledger `putLedgerEntry` is a conditional put on `attribute_not_exists`; a concurrent duplicate
      loses the race and returns the winner's award.
- [ ] Re-processing the same run changes **zero cells and zero timestamps** and writes nothing.
- [ ] Editing a fixture's start time produces a key miss, an un-award of the prior entry, and a
      rescore — with the cell set unchanged in size (I-7).
- [ ] An activity whose `startedAt` precedes an already-scored activity enqueues a replay instead of
      scoring inline; a test asserts nothing was written on the request path.
- [ ] Replay folds ascending by `startedAt`, ties by `activityId`; the fixture replayed with its
      input list **shuffled** produces an identical ledger and identical cell attributes (I-14).
- [ ] Replay is idempotent: running it twice changes nothing the second time.
- [ ] No code path anywhere calls `DeleteItem` on T6; a grep test enforces this.
- [ ] `appendCellsToRun` is written on every scored activity and is read by the un-award path.

## Notes

Replay can *lower* a previously displayed XP total (`05-fog-of-war.md` §9.3). That is D-135/D-142's
problem and is handled by the ledger's `retained_floor` mechanism in capability `09`; at this
milestone nothing displays XP, so the risk is deferred, not solved. Say so in the capability doc
rather than half-implementing a floor here.

Cell writes being idempotent by construction (min/max/set-insert) is what makes a partial retry
converge without a compensating transaction.

## Operator validation

1. Sync, then immediately Sync again. Cell count and every cell timestamp are unchanged; CloudWatch
   shows the second job exiting at the score gate.
2. In Strava, crop one of your imported runs (shorten it by a kilometre) and Sync. The map must
   **not** lose the cropped-off territory — that ground stays revealed forever.
3. Manually import an old activity from a year ago. Confirm a replay job runs, and that no cell
   disappeared from the map afterwards.
