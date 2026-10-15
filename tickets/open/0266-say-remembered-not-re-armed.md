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

- [x] `rearmed_ground` reads `remembered ground` and `cells_rearmed` reads `remembered cells`
      wherever they render (tally breakdown, skill sheet).
- [x] No user-visible string in `app/`, `components/` or `lib/` says "re-armed" *(amended at build: bare `rearmed` occurs only as code values, which this criterion exempts — see Resolution)*;
      a test greps rendered markup (or the word table) to hold it. Reason ids, code identifiers and
      comments are untouched.
- [x] Existing tests that assert the old words are updated, not deleted.

## Notes

Filed by the capability-12 drift audit, 2026-10-15. Ledger reason ids (`rearmed_ground`) are
versioned with the ruleset (`02` §4.2) and must not change; this is copy only.

## Operator validation

None by eye beyond reading it: the change is a word. Agent: the grep test, plus one headless load of
a `/run/:id` with re-armed ground showing `remembered ground` in the breakdown.

**Deployed:** Amplify job 395 (`a2e815b`) SUCCEED. Local gate on that commit: typecheck, lint,
`npm test` 190 files / 3,419 passed (1 skipped, the known gitleaks-availability case), and every
`amplify.yml` pre-build guard.

**Agent smoke, deployed site, 2026-10-15** (throwaway Cognito user signed in by SRP through the
repo's own `aws-amplify/auth`, session cookies sent with `curl`; **no data written**. A read-only
scan of all 11 tables found 0 rows naming the uid, and the user was then deleted):
- `/skills/might` signed in: HTTP 200. Its shipped JS contains `remembered ground` and
  `remembered cells`, and neither `re-armed ground` nor `re-armed cells`.
- A fake `/run/:id` renders the 404 page, which does not load the run page's chunk, so the run
  page's JS could not be inspected live without seeding an activity on prod. I did not seed one.
  Instead, a local `next build` of the same commit puts `a row for`, `data-hint` and
  `pointer: coarse` in `app/run/[activityId]/page-*.js`. The live chunk carries a different hash
  (env inlined at build), so it could not be fetched by name.

**By eye:** none needed. The change is one word, and the guard test fails if it regresses.

## Resolution

**Files.** `lib/skills/detail.ts`: `REASON_WORDS` now gives `rearmed_ground → "remembered ground"`
and `cells_rearmed → "remembered cells"` (D-309), with a comment pointing at D-309. This one table
feeds both the `/run/:id` tally breakdown and the skill sheet's `RECENT` breakdown, so one edit
covers both. Reason ids are unchanged: they are versioned with the ruleset (`02` §4.2).
`lib/run-moment/tally.test.tsx`: the breakdown assertion was updated to `62 remembered ground`.
`lib/skills/detail.test.ts`: new `D-309` block.
- Every `LEDGER_REASONS` entry's words must avoid `re-armed`.
- A source walk of `app/`, `components/` and `lib/` (tests and comment lines excluded) refuses
  `re-armed` in any string literal, template or JSX text.
- Proven red-then-green: planting `"re-armed ground"` back in the table failed both tests.

**Amended criterion 2.** It said "re-armed **or rearmed**". Widening the walk to the unhyphenated
form found six hits, all code values, not copy: the `"new" | "rearmed"` union in
`lib/fog/reveal*.ts`, and `${m.rearmed}` in `detail.ts`'s rules sentence. The criterion itself
exempts code identifiers, so the guard matches the copy spelling `re-armed` only. That is noted in
the test.
