---
id: 159
slug: vigil-test-end-to-end
title: The Vigil test, end to end — real XP, no ExploredCell, and no level-up card for a free skill
type: chore
priority: high
status: open
size: m
capability: 12-post-run-moment
depends_on: [47, 60, 62, 82]
blocked_by: []
source: agent
created: 2026-09-04T15:06:10Z
---

## Description

**Split out of `0030` on 2026-09-04.** `0030` was written across four capabilities that did not
exist when it came up in the build order. It kept the half that could be proven — the
registry-delta zero-code property, which is D-031's actual acceptance test — and this ticket
carries the half that needs a scoring path to run against.

`02-data-model.md` §3.8 check 5, clauses (b) and (d), plus the D-146 knock-on:

- **(b)** a `hasTrace: false` run of 10 km scores into `vigil` at **exactly** the XP a 10 km
  `hasTrace: true` run scores into `wayfaring` on new ground — full rate, not half. Needs the
  scorer (`0060`).
- **(d)** the traceless case produces **zero** `ExploredCell` writes, no generation bump and zero
  Cartography award, while T3 still records `cellCount: 0` so the row shape never varies. Needs
  `0047` and `0041`.
- **`reason`** for the Vigil award is `distance` — the same closed-vocabulary value Wayfaring uses
  on ungrounded distance. **No new `reason` is minted.** Needs `XpLedgerEntry` (`0062`).
- **Separate totals**: outdoor and indoor progress are tracked independently and neither dilutes
  the other. Two `skillId`s ⇒ two `SkillState` rows.
- **D-146**: adding a skill mints a free Total Level point, and it must **never** fire a level-up
  celebration. Guarded at the **notification layer, not the scoring layer** (`06-ui-ux.md` §5.4,
  §10.5). Assert the registry delta raises Total Level by exactly 1 and emits **zero** level-up
  events. Needs `0082`.

**Why the D-146 clause belongs here rather than at `0082`.** `0082` builds the guard; this asserts
it holds for the case that will actually trip it. Every future skill row mints a free point, so
this is not a Vigil quirk — it is the standing cost of D-031's promise, and the assertion should
outlive the ticket that built the guard.

**Extend `0030`'s registry-delta harness rather than writing a second one.** It already adds Vigil
(and a pool-swim row) to a v1 ruleset that lacks them and drives the matcher. This ticket takes
the same delta further down the pipeline. Two harnesses would drift, and the second would be the
one that stops being run.

## Acceptance criteria

- [ ] (b) A traceless 10 km run scores into `vigil` at exactly the XP a traced 10 km run scores
      into `wayfaring` on fully new ground — asserted as an equality between two computed
      figures, never against a hardcoded number.
- [ ] (d) The traceless case writes **zero** `ExploredCell` items, bumps no generation, and awards
      zero Cartography; the persisted activity still records `cellCount: 0`.
- [ ] The Vigil award's `reason` is `distance`, and a test asserts the `reason` vocabulary gained
      no new member.
- [ ] Outdoor and indoor totals are independent: XP into one leaves the other's `SkillState`
      untouched, asserted in both directions.
- [ ] The registry delta raises Total Level by exactly 1 and emits **zero** level-up
      notifications (D-146), asserted at the notification layer.
- [ ] The same assertions pass for the pool-swim row from `0030`, not only for Vigil — the
      property must generalise.
- [ ] Runs in the permanent suite, in the GitHub Actions gate **and** `amplify.yml`; not tagged,
      skipped or excluded from any run configuration.
- [ ] Each failure message names **D-031, D-132, D-141** and, for the level-up clause, **D-146**.
- [ ] `0030`'s harness is extended, not duplicated.

## Notes

**Do not let this ticket quietly become "assert the scorer works".** Its subject is the
*property* — that a skill added as data behaves identically to one that was always there, all the
way to the ledger and the notification layer. A test that only proves Vigil scores 1000 XP proves
the scorer, not the property. Every assertion should be an equality or an invariance between the
delta case and the baseline, not a comparison against a constant.

Clause (d) is the one most likely to be asserted vacuously: with no trace there is nothing to
project, so "zero `ExploredCell` writes" passes trivially unless the test also proves the traced
case DOES write them. Assert both arms.

Capability is `12-post-run-moment` because `0082` is the last dependency to land, not because the
test is about the post-run screen.

## Operator validation

None expected — a CI regression test with no rendered surface. The operator-visible consequence is
covered by `0072` (a new row changes zero pixels) and by capability `12`'s own USE step. Verify by
agent: both arms of clause (d), the two-direction independence check, and a deliberate breakage of
the D-146 guard shown going red before it is trusted green.
