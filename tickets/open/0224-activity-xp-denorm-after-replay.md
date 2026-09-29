---
id: 224
slug: activity-xp-denorm-after-replay
title: Activity.xpAwarded and xpRulesVersion go stale after an XP replay
type: bug
priority: med
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: [66]
blocked_by: []
source: agent
created: 2026-09-29T13:55:21Z
---

## Description

Found while building `0066`. T3 `Activity` carries `xpAwarded` and `xpRulesVersion`,
denormalised from the ledger at ingest (`src/pipeline/persist.ts`, `0062`) for the activity list.
The XP replay rewrites every ACTIVE activity's ledger rows under the new ruleset, but it does not
touch T3, so after a rebalance each row still shows the old award and the old version. The ledger
is authoritative, so no total is wrong. But the run list and `/run/:id` would show a per-run number
that disagrees with the rows the skill sheet itemises.

## Acceptance criteria

- [ ] After a replay, every ACTIVE activity's `xpAwarded` equals the `SUM` of its ledger rows and
      `xpRulesVersion` names the target version.
- [ ] A tombstoned activity's T3 row is not modified (its rows are kept as awarded, D-258).
- [ ] Idempotent: re-running the same replay writes identical T3 values.

## Steps to reproduce

1. Replay a user from v1 to a stingier v2 (`tools/xp-replay/replay-xp.ts`).
2. Read any of their `Activity` rows.

## Expected vs actual

**Expected:** `xpAwarded` is the v2 sum and `xpRulesVersion: 2`.

**Actual:** the v1 values.

## Notes

The natural place is step 3 of `replayUser`, as one `UpdateItem` per activity through a new
`ReplayStore` method. It needs only the per-activity sums that step 3 already computes.

## Operator validation

None needed — verified with a smoke test against the real tables.
