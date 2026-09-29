---
id: 217
slug: validator-refuses-derived-measure-on-activity-row
title: Validator refuses a derived measure (cells/share) on a kind: activity row
type: bug
priority: med
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: [60]
blocked_by: []
source: agent
created: 2026-09-29T01:18:03Z
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

- [ ] `validateRuleSet` reports an error on a `kind: activity` row whose `match.measure` is `cells`
      or `share`. The message names `02` §3.7's `derived` kernel.
- [ ] The set of measures an activity row may use is written once and shared with
      `src/scoring/units.ts`'s kernels, so that the two cannot drift. Either one derives from the
      other, or a test asserts that every measure the validator allows on an activity row has a
      kernel in the scorer.
- [ ] A test builds a broken ruleset (one activity row with `measure: cells`) and demands the
      failure. `0029`'s Resolution explains why a test that only checks "the shipped file
      validates" proves nothing.
- [ ] The shipped `rules/xp-rules-v1.yaml` still validates clean.

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

## Operator validation

None. This is a seed-time validation rule with nothing to look at. The broken-ruleset test is the
evidence.
