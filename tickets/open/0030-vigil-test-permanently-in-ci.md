---
id: 30
slug: vigil-test-permanently-in-ci
title: The Vigil test, permanently in CI - adding a skill is a YAML row and zero code
type: chore
priority: high
status: open
size: m
capability: 04-domain-contract-and-rules
depends_on: [13, 29]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

D-031 makes modularity a **product decision**; D-132 supplies its acceptance test: adding Vigil
must be a **data row, not code**. `02-data-model.md` §3.8 check 5 requires that test to live in
CI **permanently**, not as a one-off proof that is run once and then deleted.

The test, per §3.8/5: seed the v1 registry, add **only** the Vigil row from §3.5, and assert:

- **(a)** the repo's TypeScript diff is **empty** — adding the skill changed no `.ts` file;
- **(b)** a `hasTrace: false` run scores into `vigil` at **full** rate;
- **(c)** the same run **with** a trace scores into `wayfaring`;
- **(d)** neither writes an `ExploredCell` for the traceless case.

Mechanically, (a) is the hard one and must be honest. Implement it as a **registry-delta test**:
take the v1 ruleset with Vigil removed, add the Vigil row programmatically at test time, and
assert the full downstream path (matcher → measure → rate → feeds → skill-state key) produces a
correct new skill using **only** production code paths that were not modified. Pair it with the
§3.8 check 6 grep — `grep -rE '"(wayfaring|vigil|might|fortitude|endurance|cartography|constitution)"' src/` returns nothing outside `rules/`, fixtures and tests — which is the standing,
mechanical version of "no code names a skill".

Also assert the D-146 knock-on, since it is a Vigil-shaped trap that will recur for every future
skill: **adding a skill mints a free Total Level point, and it must never fire a level-up
celebration.** Guard it at the **notification layer, not the scoring layer** (`06-ui-ux.md` §5.4,
§10.5). The assertion here is that the registry delta raises Total Level by exactly 1 and emits
**zero** level-up events.

The three D-132 clauses and what satisfies each, all with **no code change**: a separate skill
(two `skillId`s ⇒ two `SkillState` rows ⇒ two independent totals and levels); full XP
(`xpPerUnit: 100`, `groundMultipliers: null` ⇒ multiplier 1.0, which also overrides
`05-fog-of-war.md` §3.6's provisional "treadmill = half Wayfaring XP"); and zero discovery credit
(`hasTrace: false` ⇒ `traceRef: null` ⇒ no trace ⇒ no cells ⇒ no `ExploredCell` write, no
generation bump, no Cartography award).

## Acceptance criteria

- [ ] The test lives in the permanent suite and runs in the GitHub Actions PR gate **and** in
      `amplify.yml`; it is not tagged, skipped, or excluded from any run configuration.
- [ ] (a) Adding the Vigil row through the registry delta requires **no** modification to any
      file under `src/`; the test fails if a `src/**/*.ts` file must change.
- [ ] (b) A `hasTrace: false` run of 10 km scores into `vigil` at exactly the same XP a 10 km
      `hasTrace: true` run scores into `wayfaring` on new ground.
- [ ] (c) The identical activity with a trace scores into `wayfaring` and **not** `vigil`.
- [ ] (d) The traceless case produces zero `ExploredCell` writes, no generation bump and zero
      Cartography award, while T3 still records `cellCount: 0` so the row shape never varies.
- [ ] Neither skill's total is affected by the other — a test asserts outdoor and indoor progress
      are tracked separately and neither dilutes the other.
- [ ] `reason` for the Vigil award is `distance`, the same closed-vocabulary value Wayfaring uses
      on ungrounded distance — **no new `reason` is minted**.
- [ ] The §3.8 check 6 grep runs in CI and fails the build when a skill id string is added under
      `src/`; a deliberate temporary violation is shown going red.
- [ ] Total Level rises by exactly 1 on the registry delta and **zero** level-up notifications
      are emitted (D-146).
- [ ] The test's failure message names D-031, D-132 and D-141, so a future reader understands
      what property broke before deciding how to fix it.
- [ ] A second, adversarial case: adding a *third* distance skill (a "pool swim" row,
      `kinds: [other], requiresTrace: false, measure: distanceKm`) also requires zero code — the
      property must generalise, not be special-cased to Vigil.

## Notes

This test is **the acceptance criterion for D-031, wired into CI so the property cannot rot.**
It is the reason D-141's defect was found in planning rather than at ticket ~15, where every
subsequently-added workout type would have compounded the switch statement.

The pool-swim case is deliberately included: `02-data-model.md` §3.7 points out that pool swimming
is not a new kernel, it is "another Vigil". If the test only ever proves Vigil works, it proves a
special case rather than the property.

If (a) cannot be made honest — if adding a skill genuinely does require a code change — **do not
weaken the test.** That outcome means the schema is still wrong, and it must be escalated as a new
ticket against 0028, exactly as D-141 was raised against `04-game-design.md` §1.3.

## Operator validation

**Desktop, the GitHub Actions run page for a PR.** Open a throwaway PR that adds a single row to
`rules/xp-rules-v1.yaml` and changes nothing else. Confirm the build is **green** and that the
diff view shows one changed file. Then push a second commit adding the string `"wayfaring"` to a
file under `src/` and confirm the build goes **red** on the check 6 grep. Those two runs, side by
side, are the validation: the first proves a skill is data, the second proves the property is
enforced rather than hoped for.
