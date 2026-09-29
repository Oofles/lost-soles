---
id: 218
slug: soft-cap-and-min-units-for-credit-unapplied
title: softCapUnits and minUnitsForCredit are declared on every skill row and applied nowhere
type: design
priority: med
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: [60, 62]
blocked_by: []
source: agent
created: 2026-09-29T02:19:08Z
---
## Description

Found while building `0062`. Every skill row in `rules/xp-rules-v1.yaml` carries `softCapUnits`
and `minUnitsForCredit`, and nothing in `src/scoring` reads either. `02` §4.1 says
`unitsEffective` is taken *"after the D-120 ground split and any `softCapUnits`"*, and `04` §3.5
gives Might a cap of 100 reps "per session". Neither document gives the **formula**. Is it a hard
clamp, diminishing returns past the cap, or something else? And does `minUnitsForCredit` drop the
row, or pay nothing below the line and full rate above it?

`0062` did not invent one. A guessed curve written into an append-only ledger could never be taken
back (D-135). This ticket makes that decision first and then applies it.

Today's cost is small. Through Strava, strength activities carry no sets, so no reps reach the
scorer. The one live effect is that a run under 0.25 km earns XP that `minUnitsForCredit` says it
should not.

## Acceptance criteria

- [ ] The soft-cap formula and the `minUnitsForCredit` semantics are decided by the operator and
      recorded as a `D-xxx`, with `04` §3.5 amended to state them.
- [ ] Both are applied in `src/scoring`, between `scoreUnits` and the ground split, read only
      from the skill row. No skill id and no literal cap appears in code (D-031).
- [ ] Tests cover a session at, under and over each skill's cap, and an activity just under and
      just over `minUnitsForCredit`.
- [ ] `unitsEffective` on a ledger row reflects the cap; `units` stays the raw measurement.

## Options considered

- **Hard clamp at `softCapUnits`.** Simple, and legible (D-051): "reps past 100 earn nothing".
- **Diminishing returns past the cap**, e.g. half rate. Closer to the word "soft", but a second
  number the row does not carry.
- **`minUnitsForCredit` as a floor that zeroes the row** vs **as a threshold subtracted from the
  units.** The first is what the name suggests.

## Open questions

- Which of the above, for each field?
- Does the cap apply per activity or per game day? `04` §3.5 says "per session".

## Notes

Not implemented in `0062`, because that would have widened its scope (D-152) and the formula is
not in the plan.

## Operator validation

None. It is scoring arithmetic with no screen of its own. The tests are the evidence.
