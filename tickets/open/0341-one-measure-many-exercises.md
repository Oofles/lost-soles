---
id: 341
slug: one-measure-many-exercises
title: A skill's one measure can be fed by several exercises, each with a unit conversion
type: feature
priority: high
status: open
size: m
capability: 10-add-workout
depends_on: []
blocked_by: []
source: agent
created: 2026-11-04T05:04:40Z
---

## Description

D-483 needs one skill fed by exercises of different entry kinds: Might takes strength minutes and pushups, and Fortitude takes strength minutes, situps and planks. Today `validate.ts` (`entryAgreesWithMeasure`) only accepts an exercise whose id matches its skill's measure (`count` ⇒ `reps:<id>`, `seconds`/`minutes` ⇒ `seconds:<id>`), so a skill has exactly one exercise.

This ticket lets an exercise declare a conversion into its skill's single `seconds:` measure. D-191 (one measure per row) is unchanged: the row still tallies one quantity, and several exercises now contribute to it. Pushup = 8 s, situp = 6 s, plank second = 3 s at 0.5 XP/s reproduces v4's 4 / 3 / 1.5 XP exactly.

## Acceptance criteria

- [ ] `RuleExercise` gains an optional conversion field (name settled in the ticket, e.g. `secondsPerUnit`). An exercise with it may feed a `seconds:<tally>` measure whose suffix is not its own id; an exercise without it keeps today's rule exactly.
- [ ] The validator refuses a conversion that is missing where needed, non-positive or non-finite, or set on a `distance` entry; and still refuses an entry that would score nothing.
- [ ] The scorer sums every set of every exercise feeding a measure, each multiplied by its conversion, before soft cap, sanity ceiling and `minUnitsForCredit` apply — once per skill per activity, never per exercise.
- [ ] No `switch` or branch on a skill or exercise id (D-031); `no-skill-names.test.ts` stays green.
- [ ] Every shipped ruleset (v1–v4) still validates and scores byte-identically: a replay of the fixture ledger under each moves no XP.
- [ ] `02` §3.2/§3.7 and `04` §1.3 describe the field, and the §1.3 example YAML still passes `doc-schema.test.ts`.

## Notes

Decision: D-483. Cited design: `02-data-model.md` §3.2, §3.4, §3.7, §3.8; `04-game-design.md` §1.3 (D-191 block), §3.5 (soft cap).
No ruleset uses the field in this ticket; v5 (`0343`) is the first.

## Operator validation

None perceptual: this is scoring plumbing. Smoke test: the suite plus a scripted score of a synthetic multi-exercise activity against a test ruleset.
