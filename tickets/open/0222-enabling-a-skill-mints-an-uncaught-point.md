---
id: 222
slug: enabling-a-skill-mints-an-uncaught-point
title: Enabling a disabled skill row mints a Total Level point that celebrate.ts cannot see
type: bug
priority: med
status: open
size: s
capability: 12-post-run-moment
depends_on: [65]
blocked_by: []
source: agent
created: 2026-09-29T03:36:58Z
---

## Description

Found while building `0065` (D-257). `totalLevel` counts only **enabled** rows, so flipping a
shipped row from `enabled: false` to `enabled: true` raises Total Level by one with no work done —
the same free point D-146 describes. Slayer ships disabled (D-122) and is the first row this hits.

`src/scoring/celebrate.ts` detects a minted skill by `introducedIn > before.rulesVersion`. Slayer
is `introducedIn: 1`, so when it is enabled in a later version it is **not** treated as minted, and
`totalLevelDelta` / `celebrableLevelUps` ignore it only by luck (a level-1 skill with no XP has no
level-up). A Total Level **milestone** crossed by that point would, however, be celebrated as soon
as any earned point lands in the same diff — and the displayed rise would be one more than the
celebrated delta, with nothing saying why.

The likely fix is to have `LevelSnapshot` carry the set of skill ids that counted when it was
taken (`0067`'s snapshot already lists every skill, level 1 included), and treat "not counted in
`before`" as minted alongside `introducedIn`. That is a design choice, so confirm it first.

## Steps to reproduce

1. Take `rules/xp-rules-v1.yaml` as v1 and a snapshot of any history scored under it.
2. Ship v2 identical except the disabled meta row (`enabled: false`) set to `enabled: true`.
3. Pick a milestone ladder with a rung at exactly v1's Total Level + 1, and add one earned level
   to the v2 history.
4. Call `celebrableMilestones(before, after, v2, ladder, lastCelebrated)`.

## Expected vs actual

**Expected:** the enabled row's free point is treated like any minted row, so it neither counts
toward the celebrable delta nor lets a milestone fire on its account.
**Actual:** `introducedIn` is 1, so the row is not minted; Total Level shows +2 while
`totalLevelDelta` says +1, and the milestone fires one earned point early.

## Acceptance criteria

- [ ] A ruleset version that only flips one row `enabled: false → true` yields zero
      `celebrableLevelUps`, a `totalLevelDelta` of 0, and no milestone.
- [ ] A row enabled, then trained in a later diff, celebrates normally.
- [ ] The guard still lives only in `src/scoring/celebrate.ts` (the `0065` grep test still passes).

## Notes

Not urgent while Slayer is post-MVP, but it is a real D-146 hole and must close before any row is
switched on. Filed from `0065`; see D-257.

## Operator validation

None needed: pure logic, proven by tests. Record the test names that prove it at close.
