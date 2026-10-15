---
id: 266
slug: say-remembered-not-re-armed
title: Say remembered, never re-armed, on screen
type: bug
priority: low
status: open
size: s
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-15T13:20:51Z
started: 2026-10-15T13:31:03Z
---

## Description

D-309: **"remembered" is the only on-screen word for re-armed ground.** `0081` reused the skill
sheet's `reasonWords` for the tally breakdown, so the same post-run panel says "re-armed ground" in
a row's breakdown and "8 remembered" in its cells line, while `04` and `06` say "remembered"
throughout. Found by the `12-post-run-moment` audit (§2).

The words live in `REASON_WORDS` (`lib/skills/detail.ts:385-392`): `rearmed_ground: "re-armed
ground"`, `cells_rearmed: "re-armed cells"`. They feed the tally breakdown on `/run/:id` and the
`RECENT` breakdown on the skill sheet.

## Steps to reproduce

1. Open `/run/:id` for a run with re-armed ground (e.g. the 2026-09-27 run).
2. Click a skill row in the tally to expand its breakdown.

## Expected vs actual

**Expected:** the breakdown and the cells line use one word, "remembered" (D-309, `06` §3.2).
**Actual:** the breakdown says "re-armed ground" while the cells line on the same panel says
"N remembered".

## Acceptance criteria

- [ ] `rearmed_ground` reads `remembered ground` and `cells_rearmed` reads `remembered cells`
      wherever they render (tally breakdown, skill sheet).
- [ ] No user-visible string in `app/`, `components/` or `lib/` says "re-armed" or "rearmed";
      a test greps rendered markup (or the word table) to hold it. Reason ids, code identifiers and
      comments are untouched.
- [ ] Existing tests that assert the old words are updated, not deleted.

## Notes

Filed by the capability-12 drift audit, 2026-10-15. Ledger reason ids (`rearmed_ground`) are
versioned with the ruleset (`02` §4.2) and must not change; this is copy only.

## Operator validation

None by eye beyond reading it: the change is a word. Agent: the grep test, plus one headless load of
a `/run/:id` with re-armed ground showing `remembered ground` in the breakdown.
