---
id: 159
slug: vigil-test-end-to-end
title: The Vigil test, end to end — real XP, no ExploredCell, and no level-up card for a free skill
type: chore
priority: high
status: closed
size: m
capability: 12-post-run-moment
depends_on: [47, 60, 62, 82]
blocked_by: []
source: agent
created: 2026-09-04T15:06:10Z
started: 2026-10-14T12:37:57Z
closed: 2026-10-14T12:44:12Z
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

- [x] (b) A traceless 10 km run scores into `vigil` at exactly the XP a traced 10 km run scores
      into `wayfaring` on fully new ground — asserted as an equality between two computed
      figures, never against a hardcoded number.
- [x] (d) The traceless case writes **zero** `ExploredCell` items, bumps no generation, and awards
      zero Cartography; the persisted activity still records `cellCount: 0`.
- [x] The Vigil award's `reason` is `distance`, and a test asserts the `reason` vocabulary gained
      no new member.
- [x] Outdoor and indoor totals are independent: XP into one leaves the other's `SkillState`
      untouched, asserted in both directions.
- [x] The registry delta raises Total Level by exactly 1 and emits **zero** level-up
      notifications (D-146), asserted at the notification layer.
- [x] The same assertions pass for the pool-swim row from `0030`, not only for Vigil — the
      property must generalise.
- [x] Runs in the permanent suite, in the GitHub Actions gate **and** `amplify.yml`; not tagged,
      skipped or excluded from any run configuration.
- [x] Each failure message names **D-031, D-132, D-141** and, for the level-up clause, **D-146**.
- [x] `0030`'s harness is extended, not duplicated.

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

**2026-10-07 (capability `10` audit).** A second registry-delta harness now exists:
`app/new-workout-type.test.tsx` (`0072`). It already runs a real `logWorkout` and the Vigil
traceless/traced clauses under a fresh ruleset, and it asserts the traceless run writes zero
`ExploredCell`, but only that arm. Before extending `0030`'s harness, decide which of the two to
extend, and do not build a third. The "two harnesses would drift" warning above now applies to
these two.

## Resolution

**Files.** `src/rules/registry-delta.test.ts` (extended: 22 tests added, 34 total), and a
three-line pointer comment in `app/new-workout-type.test.tsx`. No production code changed: every
clause held against the code as it stands, so nothing was filed.

**Which harness.** `0030`'s `registry-delta.test.ts`, as the Description asked, despite the
2026-10-07 note. It already holds both deltas (Vigil removed and re-added; the never-heard-of
pool-swim row), and the shared pipeline rig (`src/pipeline/__fixtures__/process-rig.ts`) is
importable without React. `0072`'s traceless block stays as it was, with a comment saying the full
clauses live here and that block should not grow. Two harnesses, two separate subjects, no third.

**What the new block does.** `describe.each` over both deltas runs the real `processActivity` on
the rig with the delta as its registry, five runs per delta: traceless and traced under the delta,
plus a traceless and traced baseline and an always-there peer under the baseline. Comparators are
found from the data, never by name: the traced skill is the one `revealsGround` row (D-189), and
the reason peer is an existing ungrounded distance row with `requiresTrace: false` (`cadence`).
Discovery skills are whichever rows earned `cells_*` in the traced arm.
- **(b)** Two checks. First, XP ÷ the row's own `xpPerUnit` equals the traced skill's XP ÷ its
  rate on ground asserted to be all-new. That form generalises to pool swim, whose price differs
  (220 vs 100). Second, the raw XP is equal when the rates match: for Vigil this is the shipped row
  as-is; for pool swim it is a variant re-priced to the traced rate.
- **(d)** Both arms. The traced arm must write cells and aggregates, bump the generation, award
  discovery XP and have `cellCount > 0`, and it is asserted first. Only then is the traceless arm
  shown to have zero of each, plus `cellCount: 0` present on the T3 row.
- **reason.** The row's ledger reasons equal the peer's, and every reason the delta world writes is
  a reason the baseline world already writes and a member of `LEDGER_REASONS`.
- **Independence.** Each arm writes its own `SkillState`, which is asserted so the absence is not
  vacuous. Neither arm writes the other's `SkillState` or ledger XP.
- **D-146.** Total Level +1 exactly; zero total cards from `levelUpQueue`; the same run under
  `baselineVersion = NEXT` (nothing minted) does fire 100; the run that earns the 100th level
  fires it.

**Change to the delta itself.** `withRow` now ships the row the way a real delta would: ruleset
`version: v1 + 1`, with the row's `introducedIn` set to that version. `0030`'s version appended the
row under v1 unchanged. The matcher can't see the difference, but D-146 keys on `introducedIn`, so
the old delta tested a row that was never new. `without`/`withoutSameSelection` now return a full
`RuleSet`, because `processActivity` needs `version`/`effectiveFrom`. All 12 of `0030`'s original
tests pass unchanged.

**What went wrong.** My first D-146 non-vacuity check asserted that an empty diff would fire 100
once the guard was off. It failed in both states. Every consumer (`/log`, `run-sequence.tsx`)
compares before and after under one registry, so a free point can never fire on its own. The
real hazard is the run that brings the earned total to 99 while the displayed total reads 100
(D-297's earned total). I rewrote the check to test that run, and that is the case the guard
breakage turns red.

**Decisions.** None that rise to a `D-xxx`: this is a test of settled decisions D-031, D-132,
D-141 and D-146/D-297.

## Operator validation

*As planned:* None expected — a CI regression test with no rendered surface. The operator-visible consequence is
covered by `0072` (a new row changes zero pixels) and by capability `12`'s own USE step. Verify by
agent: both arms of clause (d), the two-direction independence check, and a deliberate breakage of
the D-146 guard shown going red before it is trusted green.

**Agent, 2026-10-14. No rendered surface; nothing to put in front of the operator** (as the
ticket expected).

- **Both arms of (d)** run and assert, traced arm first. In the rig, the traced 10 km run wrote 21
  cells, 6 aggregates, bumped the generation and paid `cells_new`. The traceless run wrote none of
  these, and T3 still recorded `cellCount: 0`.
- **Independence in both directions** asserted, with each arm's own `SkillState` write shown first.
- **Deliberate breakage of the D-146 guard.** `isMinted` was made to return `false` in
  `src/scoring/celebrate.ts`. Result: 4 failures (the zero-cards clause and the late-not-lost
  clause, × Vigil and pool swim), each naming D-146 with D-031/D-132/D-141. Restored → 34/34 green.
- **Full gate**, with local `tmp/` moved aside (its leftovers give false typecheck and grep
  failures): `typecheck` clean, `lint` clean (0 warnings), `npm test` 186 files, 3308 passed
  (1 skipped: the `pre-commit-hook.test.mjs` gitleaks-availability case, unrelated). `npm test` is the command in both the
  GitHub Actions gate and `amplify.yml`; the file sits under the default `src/**` include, with no
  tag, `.skip` or exclude.

