---
id: 238
slug: validator-logmode-measure-agreement
title: Validator does not check that a skill row's logMode agrees with its measure
type: bug
priority: low
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-10-02T15:19:39Z
---

## Description

**Found by capability 09's drift audit (2026-10-02).** The scoring kernel is chosen by the
`measure` prefix (`src/scoring/units.ts:40-67`). `logMode` is only checked for membership
(`src/rules/validate.ts:~415`). A row with `logMode: reps` and `measure: distanceKm` validates and
scores as distance. That is a data row the rules allow but the design never meant to, and adding
a workout type is supposed to be a data row that cannot go wrong silently (D-031/D-141).

## Acceptance criteria

- [ ] `validate` refuses a skill row whose `logMode` disagrees with its `measure` kind, with a
      message naming the row, both fields and the allowed pairings.
- [ ] The allowed `logMode` ↔ `measure` pairings live in one table, in `src/rules`, not as a
      per-skill branch (no skill id appears; `no-skill-names.test.ts` stays green).
- [ ] Every row in every bundled ruleset still validates.
- [ ] 02-data-model §3.7's note pointing at this ticket is updated to say the check exists.

## Steps to reproduce

1. Copy a reps skill row in a scratch ruleset; change its `measure` to `distanceKm`, leaving `logMode: reps`.
2. Run the validator over that ruleset.

## Expected vs actual

- **Expected:** a seed-time error naming the row and the mismatched pair.
- **Actual:** it validates, and the row scores as distance.

## Notes

TODO

## Operator validation

TODO
