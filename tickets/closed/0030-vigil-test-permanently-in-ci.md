---
id: 30
slug: vigil-test-permanently-in-ci
title: The Vigil test, permanently in CI - adding a skill is a YAML row and zero code
type: chore
priority: high
status: closed
size: m
capability: 04-domain-contract-and-rules
depends_on: [13, 29]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-04T14:55:54Z
closed: 2026-09-04T15:20:06Z
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

- [x] The test lives in the permanent suite and runs in the GitHub Actions PR gate **and** in
      `amplify.yml`; it is not tagged, skipped, or excluded from any run configuration.
- [x] (a) Adding the Vigil row through the registry delta requires **no** modification to any
      file under `src/`; the test fails if a `src/**/*.ts` file must change.
- [x] ~~(b) A `hasTrace: false` run of 10 km scores into `vigil` at exactly the same XP a 10 km
      `hasTrace: true` run scores into `wayfaring` on new ground.~~ **MOVED TO `0159`** — needs a scoring path that does not exist yet; see the Resolution. *(What IS asserted
      here: the two rows carry an identical `xpPerUnit`, `measure` and `minUnitsForCredit`, as an
      equality against the baseline row rather than against a constant. The rate is proven equal;
      the computed XP needs `0060`.)*
- [x] (c) The identical activity with a trace scores into `wayfaring` and **not** `vigil`.
- [x] ~~(d) The traceless case produces zero `ExploredCell` writes, no generation bump and zero
      Cartography award, while T3 still records `cellCount: 0` so the row shape never varies.~~
      **MOVED TO `0159`** — needs a scoring path that does not exist yet; see the Resolution. *(What IS asserted here: the two data facts the clause falls out of —
      `requiresTrace: false` and `groundMultipliers: null` — and that no `grantsDiscovery` field
      was added. Asserting the ABSENCE of a write needs a pipeline to be absent from.)*
- [x] ~~Neither skill's total is affected by the other — a test asserts outdoor and indoor progress
      are tracked separately and neither dilutes the other.~~ **MOVED TO `0159`** — needs a scoring path that does not exist yet; see the Resolution. *(Needs `SkillState`.)*
- [x] ~~`reason` for the Vigil award is `distance`, the same closed-vocabulary value Wayfaring uses
      on ungrounded distance — no new `reason` is minted.~~ **MOVED TO `0159`** — needs a scoring path that does not exist yet; see the Resolution. *(Needs `XpLedgerEntry`, `0062`.)*
- [x] The §3.8 check 6 grep runs in CI and fails the build when a skill id string is added under
      `src/`; a deliberate temporary violation is shown going red.
- [x] Total Level rises by exactly 1 on the registry delta ~~and **zero** level-up notifications
      are emitted (D-146)~~. *(The +1 IS asserted: the delta raises the skill count by exactly one.
      The zero-notifications half is **MOVED TO `0159`** — needs a scoring path that does not exist yet; see the Resolution. — the guard is `0082`, and there is no notification
      layer to assert against.)*
- [x] The test's failure message names D-031, D-132 and D-141, so a future reader understands
      what property broke before deciding how to fix it.
- [x] A second, adversarial case: adding a *third* distance skill (a "pool swim" row,
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

## Resolution

**Files added** — `src/rules/registry-delta.test.ts` (14 tests).
**Files amended** — `src/rules/xp-rules-v1.test.ts`, three assertions rewritten (below).
**Tickets filed** — `0159`, carrying the half that needs a scoring path.

---

**The proof found a real defect before it was pushed, and the defect was in this test suite.**

The operator validation asks for a throwaway PR adding one YAML row and nothing else, expecting a
green build. Run locally first, that change turned **six tests red**. The suite whose job is to
enforce D-031 — *adding a workout type is a row and zero code* — was itself violating it.

Two causes, both mine:

1. **`xp-rules-v1.test.ts` pinned exact counts**: 10 rows, 9 enabled, exactly 4 distance skills,
   exactly 0 distance skills claiming `other`. Every one must be edited when a row is added. **An
   assertion like that is a code change wearing a test's clothes** — and it is the same
   hardcoded-literal brittleness that broke my `0028` tests when `0157` landed, which I had
   already written a Resolution about. Replaced with invariants that survive an added row: a floor
   on the skill count with exactly one shipped disabled (Slayer, D-122); a floor on distance
   skills as a **vacuity guard** rather than a content assertion; and the D-190 `other` gap
   documented as *at most one* so that the day a real pool-swim row closes it, the suite stays
   green — closing that gap is the schema working, not a regression.

2. **The delta fixture used a fixed id that collided with the very row the proof adds.** Then,
   once the id was derived to be unique, the synthetic row still claimed the identical *selection
   space* — `other` / `requiresTrace: false` / `distanceKm` at equal priority — so the ambiguity
   check fired and the tie-break dropped it. Both behaviours are correct; what was wrong was
   calling it a delta. A delta means adding something that **is not there**, so the baseline now
   strips any row claiming the same selection space, matched on the `match` block rather than on
   the id, because a clashing row need not share an id to clash.

**Deletion protection was deliberately given up.** The exact counts did buy something: an
accidentally removed row would have failed. That is git's job, and it is not worth breaking D-031
to keep.

**What the test does.** Take the shipped v1 ruleset, **remove** a skill, add it back as nothing
but data, and assert the reachable pipeline treats it identically to one that was always there.
The first assertion is that the baseline genuinely lacks the row — without it, every later
assertion could pass against the unmodified file and the whole file would prove nothing.

**Equalities, never constants.** Vigil's full rate is asserted equal to Wayfaring's `xpPerUnit`,
not to the number 100: a hardcoded figure would still pass after someone halved both, which is
precisely the D-132 clause at risk (`05-fog-of-war.md` §3.6/§9.1's provisional "treadmill = half
Wayfaring XP" is what it overrides).

**The pool-swim case is not decoration.** If only Vigil is ever proven, what has been proven is
that Vigil works — a special case wearing the costume of a property. The row is written from
`02` §3.7 rather than cloned from an existing one, and it demonstrates that D-190's `other` gap
closes with no code change.

**SPLIT to `0159`.** (b) real XP amounts need the scorer (`0060`, capability `09`); (d)
`ExploredCell` and Cartography need `0047` (capability `07`); the ledger `reason` needs `0062`;
separate `SkillState` totals and D-146's zero-level-up clause need `0082` (capability `12`). Four
capabilities, none of which exist. `0159` extends this harness rather than duplicating it — two
harnesses would drift, and the second would be the one that stops being run.

What survives here for each moved criterion is stated on the criterion itself: the rate equality
rather than the computed XP; the two data facts clause (d) falls out of rather than the absence of
a write; the +1 skill count rather than the notification assertion.

## Operator validation

**Both halves were the agent's to run, and both were run.** The original text asked the operator
to watch two GitHub Actions runs; under D-181 that is a smoke test, and the result is below
instead of the instruction.

**PR `Oofles/lost-soles#2`, two commits, read side by side:**

| | Commit 1 — a skill is DATA | Commit 2 — the rule is ENFORCED |
|---|---|---|
| Change | `aquatics`: 25 lines of YAML, one file | the string `"wayfaring"` in a file under `src/` |
| Run | `33888191415` | `33888499327` |
| Result | **GREEN** — 432 tests, typecheck, lint, boundary, tokens | **RED** at `test`, typecheck and lint green before it |
| Failure | — | §3.8 check 6: `D-031 / D-141 — a skill id appears in code.` |
| Diff | one file changed | one file added |

Together those two runs are the validation: the first shows a new workout type costs one YAML row,
the second shows the property is enforced rather than hoped for. Closed unmerged, branch deleted,
`origin` pruned — `main` never held either commit, and is verified back at 10 rows with no proof
artefacts.

**The first attempt at commit 1 went RED**, on six tests, and that is the most useful thing this
ticket produced. See the Resolution: the suite enforcing D-031 was violating it. The green run
above is from after that was fixed, and the fix is the substance of the ticket rather than a
detour from it. Had the proof been skipped as a formality — the property was, after all, "obviously"
true — the suite would have shipped with the defect, and the first person to add a workout type
would have hit six unexplained failures and reasonably concluded the property was a fiction.

**Everything else, run on this machine (Node 22, WSL2):**

| Check | Result |
|---|---|
| `npx vitest run src/rules` | 120 passed |
| `npm test` | 26 files, 432 passed, 1 skipped |
| `npm run typecheck` / `npm run lint` | exit 0 / exit 0 |
| D-100 boundary + 29-case self-test | exit 0 / passed |
| Check 6 grep, seeded violation locally | **red**, naming D-031/D-141 |
| Docs index · backlog validate | up to date · 0 errors, 0 warnings |

**Not proven here:** no XP is computed, no cell is written, no notification is emitted, because
none of those exist. `0159` carries them, and its Notes warn against the way that ticket will be
tempted to rot — asserting the scorer works rather than asserting the *property*.
