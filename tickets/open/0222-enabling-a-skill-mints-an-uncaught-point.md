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
started: 2026-10-14T13:11:22Z
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

- [x] A ruleset version that only flips one row `enabled: false → true` yields zero
      `celebrableLevelUps`, a `totalLevelDelta` of 0, and no milestone.
- [x] A row enabled, then trained in a later diff, celebrates normally.
- [x] The guard still lives only in `src/scoring/celebrate.ts` (the `0065` grep test still passes).

## Notes

Not urgent while Slayer is post-MVP, but it is a real D-146 hole and must close before any row is
switched on. Filed from `0065`; see D-257.

## Resolution

**The fix (D-300).** "Minted" now also means *existed at the baseline but did not count there*. The
baseline stopped being a bare version number and became a value, `Baseline = { rulesVersion,
countedSkills }`, where `countedSkills` holds the ids that were enabled when it was taken.
`isMinted(skill, baseline)` is `introducedIn > rulesVersion || !countedSkills.has(id)`. It is still
the one predicate, and it still lives only in `src/scoring/celebrate.ts`.

**Both consumers had the hole, not only the one this ticket names.** The ticket describes the
`LevelSnapshot` path (`celebrableLevelUps` / `totalLevelDelta` / `celebrableMilestones`). The level-up
cards people actually see (`0082`, `lib/level-up/cards.ts`) go through `earnedTotalLevel` /
`earnedMilestonesCrossed` with a `baselineVersion` number instead, and were exposed in the same way.
Both are fixed:
- `LevelSnapshot` now extends `Baseline`, and `baselineOf(ruleset)` builds one.
- `cards.ts` exports `BASELINE = baselineOf(bundled v1)` and passes it where it used to pass
  `BASELINE_VERSION`. `BASELINE_VERSION` stays, because tests read it.

**Files.** `src/scoring/celebrate.ts`, `src/scoring/index.ts` (exports `baselineOf` and `Baseline`),
`lib/level-up/cards.ts`. Tests: `src/scoring/celebrate.test.ts` (new block), plus call-site updates
in `d146-guard.test.ts`, `src/rules/registry-delta.test.ts` and `lib/level-up/beat3.test.tsx`.
Docs: `06-ui-ux.md` §10.5 and `09-roadmap.md` §5.2 now name the enabled rule. D-300 is recorded.

**What broke along the way.** `beat3.test.tsx` failed after the change. Its fixture ruleset uses
made-up ids (`s0`…`s6`) that are not in the bundled v1, so against the default baseline every one of
them is "not counted", and the Total Level card was suppressed. That is correct under the new rule,
not a regression: a fixture that is not v1 has to supply its own baseline. The test now passes
`baselineOf` of its fixture. Any future fixture-ruleset test of total cards needs to do the same
(recorded in D-300).

**Not changed.** The snapshot path still uses its existing D-146 rule for a milestone that a minted
point crosses in the same diff as an earned one: it fires on the displayed total once an earned
point lands. The flipped row now behaves exactly like any other minted row there, which is what the
ticket's "Expected" asks for. The card path is exact, because it judges on the earned total.

**Tests that prove it** (`src/scoring/celebrate.test.ts`, describe *"a shipped row switched ON is
minted too (0222, D-300)"*):
- *the scenario is real…*: v1 ships a disabled row, its `introducedIn` predates v2, and the flip alone
  raises Total Level by 1. This keeps the rest of the block from passing vacuously.
- *the flip alone: zero celebrable level-ups, a delta of 0, and no milestone…*: criterion 1.
- *the flipped row trained in the SAME diff still celebrates nothing*.
- *enabled, then trained in a LATER diff, it celebrates normally*: criterion 2.
- *the card path's earned total does not count the flipped point…*: rung `earned+2` does not fire on
  one earned level, and the non-vacuity arm shows it WOULD fire against a baseline where the row counted.
- Criterion 3: `celebrate.test.ts` *"only celebrate.ts compares introducedIn against a version"* and
  `d146-guard.test.ts` *"the guard is one named predicate, in one place"* both pass.

Full suite: 3312 passed, 1 skipped, and 1 failure. That failure is the polyline grep test hitting
untracked local `tmp/0080`–`0085` seed scripts, a known local-only false failure; it does not occur
on a clean copy, which is what CI and Amplify run on. `tsc` is clean outside `tmp/`.

## Operator validation

None needed, by the ticket's own terms: this is pure logic with no screen, no infrastructure and
nothing deployed to poke. Slayer is still disabled in every bundled ruleset, so nothing anyone can
see changes today. The tests listed above are the proof.
