---
id: 217
slug: validator-refuses-derived-measure-on-activity-row
title: Validator refuses a derived measure (cells/share) on a kind: activity row
type: bug
priority: med
status: closed
size: s
capability: 09-xp-engine-and-ledger
depends_on: [60]
blocked_by: []
source: agent
created: 2026-09-29T01:18:03Z
closed: 2026-10-01T20:09:56Z
---

## Description

Found while building `0060`. `validateMatch` (`src/rules/validate.ts`) accepts any member of the
closed measure set on a `kind: activity` row, including `cells` and `share`. Those are the
`derived` kernel's measures (`02-data-model.md` §3.7): their units are supplied by another
subsystem (the fog, `feeds`), never read off an `Activity`.

The scorer's `measureUnits` (`src/scoring/units.ts`) therefore has no extractor for them and
throws. That throw is correct, but it fires **per activity at ingest**, when I-26 says a registry
that cannot score must fail **at seed time**: *"the deploy fails, not the run."* A ruleset carrying
such a row validates clean today and would send every matching activity to the DLQ.

No shipped row does this, so this is latent.

## Acceptance criteria

- [x] `validateRuleSet` reports an error on a `kind: activity` row whose `match.measure` is `cells`
      or `share`. The message names `02` §3.7's `derived` kernel.
- [x] The set of measures an activity row may use is written once and shared with
      `src/scoring/units.ts`'s kernels, so that the two cannot drift. Either one derives from the
      other, or a test asserts that every measure the validator allows on an activity row has a
      kernel in the scorer.
- [x] A test builds a broken ruleset (one activity row with `measure: cells`) and demands the
      failure. `0029`'s Resolution explains why a test that only checks "the shipped file
      validates" proves nothing.
- [x] The shipped `rules/xp-rules-v1.yaml` still validates clean.

## Steps to reproduce

1. Copy `rules/xp-rules-v1.yaml` and change `might`'s `match.measure` to `cells`.
2. Run `validateRuleSet` on it. It returns no errors.
3. Call `scoreUnits` on a strength activity against it. It throws `has no extractor on an Activity`.

## Expected vs actual

**Expected:** step 2 reports an error, and the ruleset never reaches T5 or the Lambda.

**Actual:** step 2 passes, and the failure only shows at ingest, once per activity.

## Notes

This is the `0029` validator's gap, not `0060`'s. It was not fixed in `0060` because that would
have widened the ticket's scope (D-152).

## Resolution

Commit `2e4e4bc`.

**Files touched:**
- `src/rules/schema.ts`: adds `DERIVED_MEASURES = ["cells", "share"]` beside `FIXED_MEASURES`.
  A `satisfies` clause means it can only hold members of `FIXED_MEASURES`.
- `src/rules/validate.ts`: `validateMatch` has a new branch after `isMeasure`. A
  well-formed measure that is in `DERIVED_MEASURES` gets an error at `skills[i].match.measure`
  that names "02 §3.7's `derived` kernel". It is an `else if`, so a measure that is not a
  measure at all still gets one error, not two. Meta rows return before this code, so they
  are unaffected.
- `src/rules/validate.test.ts`: a new `describe` takes the REAL v1 file, sets `might`'s
  measure to `cells` and then to `share`, and requires the error at that path with the §3.7
  wording (AC 3). The existing baseline case, "the real file … passes", covers AC 4.
- `src/scoring/units.test.ts`: a new case takes every measure the validator allows on an
  activity row (`FIXED_MEASURES` minus `DERIVED_MEASURES`, plus each `MEASURE_PREFIXES` entry
  with an exercise id appended) and requires `measureUnits` to have a kernel for it, meaning it
  does not throw. It also requires every derived measure to throw.
- `docs/02-data-model.md` §3.8: new check 7 recording the rule. `docs/INDEX.md` regenerated.

**Decision: AC 2 is met by a binding test, not shared code.** The ticket allowed either.
`src/scoring` imports from `src/rules`, so deriving the validator's set from `units.ts`'s
`KERNELS` would make rules depend on scoring and create an import cycle. Deriving `KERNELS`
from `schema.ts` would not work either: a kernel is a function, and a list of names cannot
generate it. The test sits in scoring because scoring is the side that can see both. No `D-xxx`
was needed: this enforces §3.7 and I-26 as already written.

**Verified the test can fail:** I stashed only the `validate.ts` change and reran
`validate.test.ts`. Both new cases failed, `cells` and `share`, and they passed again once
the change was restored. Typecheck, eslint and the full suite are green: 133 files,
2486 passed, 1 skipped.

**What went wrong:** nothing material. `prettier --check` flags 29 files across `src/rules`
and `src/scoring`, `units.ts` among them, which this ticket did not touch. Prettier is
evidently not enforced, so I wrapped my own long line by hand and left the rest alone.

## Operator validation

No perceptual check. This is a seed-time validation rule with nothing to look at.

Smoke test (agent): I ran the ticket's reproduction as a test against the real ruleset.
`might.match.measure = cells` (and `share`) now makes `validateRuleSet` return the §3.7 error
(step 2 of the repro used to pass). The `validate.ts` stash run above showed the test fails
without the fix. Two paths call this validator: `loadRuleSet` (`src/rules/load.ts`), which CI's
`xp-rules-v1.test.ts` uses, and `process-activity`'s `assertValidRuleSet` at module load
(`handler.ts:111`). A broken file now fails CI and the Lambda's cold start, not each activity.
There is no separate seeder yet.
