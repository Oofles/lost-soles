---
id: 233
slug: live-t3-has-drifted-from-the-ledger-again-repair-t3-reports
title: Live T3 has drifted from the ledger again: repair-t3 reports 1 mismatch and plans 6 rewrites
type: bug
priority: med
status: open
size: s
capability: 07-fog-projection-and-cells
depends_on: []
blocked_by: []
source: agent
created: 2026-10-01T21:46:19Z
---

## Description

Found while closing `0232`. The read-only T3 audit (`tools/xp-replay/repair-t3.ts` with no
`--confirm`), run against the live tables on 2026-10-01, reports drift that `0226` had repaired:

```
audit: 1 mismatches over 18 activities
  1fb91a42…  2025-08-04  newCellCount     T3 2  ledger 0

repair (ground rules v1): 6 rows to rewrite
  1fb91a42…  335 XP v1  new 179 rearmed 0 cooled 0 deferred 0
  66013b20…  1409 XP v1  new 49 rearmed 35 cooled 0 deferred 0
  42286384…  451 XP v1  new 6 rearmed 10 cooled 54 deferred 0
  5b6273e9…  5083 XP v1  new 293 rearmed 29 cooled 208 deferred 0
  2460ebe8…  1388 XP v1  new 14 rearmed 63 cooled 62 deferred 0
  fecb6800…  842 XP v1  new 2 rearmed 40 cooled 76 deferred 0
```

`0232` did not cause this. The output is byte-identical with and without `0232`'s change. Every live
activity is at least 1,043 m, so the new gate gives the same answer as before.

Two things need explaining. The audit finds one mismatch, but the repair plans six rewrites, so
five rows differ from the fold in a way `auditT3` does not check. And the one mismatch has T3
claiming 2 new cells while its Cartography ledger units are 0, on an activity whose fold says 179
new cells. Something written since `0226` (a reingest under `0220`? a replay?) has moved T3 or the
ledger away from what ingest-in-order produces.

## Acceptance criteria

- [ ] The cause of each of the six planned rewrites is identified and recorded: which write path
      produced the current T3 value, and whether that path is still live.
- [ ] If a live path still produces drift, it is fixed (or a ticket is filed for it), and a test
      reproduces it.
- [ ] `auditT3` and `planT3Repair` agree on what counts as drift, or the Resolution explains why
      they legitimately differ.
- [ ] The live audit reports 0 mismatches and plans 0 rewrites after the repair, which runs only
      after the cause is understood (XP never decreases, D-135).

## Steps to reproduce

1. `AWS_PROFILE=devault npx vite-node --config vitest.config.ts tools/xp-replay/repair-t3.ts -- --user <sub>`
   (the owner's Cognito sub, from any `Activity` row's `userId`).

## Expected vs actual

**Expected:** `audit: 0 mismatches`, `0 rows to rewrite`, as `0226` left it.

**Actual:** 1 mismatch, 6 rows to rewrite (above).

## Notes

Read-only so far. Nothing was written to the live tables while finding this.

## Operator validation

TODO
