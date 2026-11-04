---
id: 341
slug: one-measure-many-exercises
title: A skill's one measure can be fed by several exercises, each with a unit conversion
type: feature
priority: high
status: closed
size: m
capability: 10-add-workout
depends_on: []
blocked_by: []
source: agent
created: 2026-11-04T05:04:40Z
started: 2026-11-04T05:09:52Z
closed: 2026-11-04T05:15:41Z
---

## Description

D-483 needs one skill fed by exercises of different entry kinds: Might takes strength minutes and pushups, and Fortitude takes strength minutes, situps and planks. Today `validate.ts` (`entryAgreesWithMeasure`) only accepts an exercise whose id matches its skill's measure (`count` ⇒ `reps:<id>`, `seconds`/`minutes` ⇒ `seconds:<id>`), so a skill has exactly one exercise.

This ticket lets an exercise declare a conversion into its skill's single `seconds:` measure. D-191 (one measure per row) is unchanged: the row still tallies one quantity, and several exercises now contribute to it. Pushup = 8 s, situp = 6 s, plank second = 3 s at 0.5 XP/s reproduces v4's 4 / 3 / 1.5 XP exactly.

## Acceptance criteria

- [x] `RuleExercise` gains an optional conversion field (settled as `scale`). An exercise with it may feed a `seconds:<tally>` measure whose suffix is not its own id; an exercise without it keeps today's rule exactly.
- [x] The validator refuses a conversion that is missing where needed, non-positive or non-finite, or set on a `distance` entry; and still refuses an entry that would score nothing.
- [x] The scorer sums every set of every exercise feeding a measure, each multiplied by its conversion, before soft cap, sanity ceiling and `minUnitsForCredit` apply — once per skill per activity, never per exercise.
- [x] No `switch` or branch on a skill or exercise id (D-031); `no-skill-names.test.ts` stays green.
- [x] Every shipped ruleset (v1–v4) still validates and scores byte-identically: a replay of the fixture ledger under each moves no XP.
- [x] `02` §3.2/§3.7 and `04` §1.3 describe the field, and the §1.3 example YAML still passes `doc-schema.test.ts`.

## Notes

Decision: D-483. Cited design: `02-data-model.md` §3.2, §3.4, §3.7, §3.8; `04-game-design.md` §1.3 (D-191 block), §3.5 (soft cap).
No ruleset uses the field in this ticket; v5 (`0343`) is the first.

## Resolution

**Shape: `RuleExercise.scale?: number`.** I named it `scale` rather than `secondsPerUnit` because it is
not tied to seconds. It multiplies the exercise's own entry field into whatever its skill's
`reps:`/`seconds:` measure counts. A scaled exercise feeds its row's measure whatever the suffix
is. An unscaled exercise keeps the old suffix rule exactly, so v1–v4 are untouched: none of them
carries `scale`, and a test asserts that for each.

**Scoring** (`src/scoring/units.ts`).
- `measureUnits(activity, measure, exercises = [])`. `sumSets` adds two kinds of set:
  - sets whose exercise is the suffix, counted once each (the pre-v5 rule);
  - sets of the skill's own scaled exercises, as entry field × `scale`.
  A scaled exercise whose id is the suffix only takes the scaled path, so it is never counted
  twice.
- New `SET_FIELD_BY_ENTRY`: count → `reps`, seconds/minutes → `durationS`, distance → none. It
  is keyed on the entry enum, as `STEP_BY_ENTRY` is.
- `scoreUnits` and `revealsGround` pass `skill.exercises`. The soft cap, sanity ceiling and
  `minUnitsForCredit` read the summed units, so they apply once per skill per activity.

**Validator** (`src/rules/validate.ts`).
- A scaled exercise needs a finite `scale` greater than 0, a set-summed measure, and an entry
  other than `distance`.
- New cross-row check: a set-summed measure's suffix may not name another row's exercise.
  Otherwise the suffix path and the scaled path would both count its sets.

**Entry boundary and rows.**
- `entryFieldFor` (`lib/log/workout-entry.ts`) returns a scaled exercise's own entry field, so
  pushups still log `reps` on a seconds tally and a seconds-bearing pushup set is refused.
- `logRows` (`lib/log/rows.ts`) divides `minUnitsForCredit` by `scale` as well. An 8 s floor is
  one pushup.

**Docs.**
- `02` §3.2: the exercise shape gains `scale`.
- `02` §3.7: the reps/duration kernels gain the scaled path.
- `04` §1.3: a D-483 note under D-191 (one measure still, several exercises into it).
- `check-doc-ruleset.mjs`: the self-test's exercise-key mutation follows the new shape.

**Tests.**
- New fixture `src/rules/__fixtures__/scaled-tally.ts`: v4 with Might as a `seconds:might` tally
  of a minutes exercise (`scale: 1`) and pushups (`scale: 8`), as v5 will ship it.
- `units.test.ts`: 5 tally tests, plus 4 tests (one per v1–v4) proving each shipped ruleset still
  scores by suffix.
- `validate.test.ts`: 9 tests.
- `rows.test.ts`: 2 tests.
- `log-workout.test.ts`: 4 tests through the real adapter and `processActivity`:
  - 30 min = 900;
  - 30 pushups = 120, as under v4;
  - 90 min soft-capped once = 2,250;
  - a seconds pushup set refused.
- Full suite: 4,730 passed, 1 skipped. Typecheck and lint are clean. Every `node scripts/…` guard in
  `amplify.yml` and `drill:ci` pass, apart from the three that need Amplify's environment or AWS
  (`--require-literals`, `check-auth-posture`, `check-d123-trigger-a`), which this change does not
  touch.

## Operator validation

### Agent smoke test, 2026-11-04

There is nothing perceptual: no shipped ruleset uses `scale` until v5 (`0343`), so the live app is
unchanged. The checks are the suite plus the scripted end-to-end runs above against the
scaled-tally fixture through the real adapter, `processActivity` and the ledger rig. The live
proof comes with `0343`'s replay.
