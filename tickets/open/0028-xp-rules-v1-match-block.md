---
id: 28
slug: xp-rules-v1-match-block
title: rules/xp-rules-v1.yaml WITH the match block and matchPriority - before the first line of the scorer
type: feature
priority: high
status: open
size: m
capability: 04-domain-contract-and-rules
depends_on: [25]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

**This is the single most load-bearing ticket in Phase 1, and its value is entirely in its
placement.** It is ticket 4 of capability `04`; the first line of the scorer is ticket 1 of
capability `09` — five capabilities and two whole phases later. That distance is deliberate.

**The defect (D-141).** The skill-as-data schema in `04-game-design.md` §1.3 covers measurement,
rating, propagation and presentation, and **silently omits selection**. Under it, Wayfaring
(outdoor running) and Vigil (GPS-less running, D-132) are **byte-identical in every field** —
same `kind: activity`, `logMode: trace`, `unit: km`, `xpPerUnit: 100`. Nothing in a row states
*which activities feed it*. A scorer written against that schema must therefore decide in code:

```ts
// THE FAILURE MODE. If this line is ever written, D-031 is broken and D-132 has failed.
const skill = activity.hasTrace ? "wayfaring" : "vigil"
```

That is a `switch` on skill id — the exact construct D-031 forbids — and every future workout
type that splits on a condition (indoor cycling, rowing erg, pool swim) is a Vigil-shaped problem
that would extend that branch.

**The fix, additive and small:** a declarative `match` block plus `matchPriority`, using only
types that already exist in `contracts/ingestion-contract.md`:

```yaml
match:
  kinds:         [run, walk, hike]   # ActivityKind values. Empty/absent = any.
  requiresTrace: true                # true | false | any   <-- THE Vigil discriminator
  sources:       any                 # any | [strava, manual, ...] — escape hatch, rarely used
  measure:       distanceKm          # J2: which quantity off the Activity is the unit count
matchPriority:   100                 # higher wins; ties break on skillId ascending
```

`kinds` draws from `ActivityKind`; `requiresTrace` reads `Activity.hasTrace`; `sources` draws
from `SourceId`; `measure` names one of the fixed extractors in `02-data-model.md` §3.7
(`distanceKm`, `reps:<exerciseId>`, `seconds:<exerciseId>`, `cells`, `share`).

**Deliverable:** `rules/xp-rules-v1.yaml` containing **all seven MVP skills as rows** —
Wayfaring, Vigil, Might, Fortitude, Endurance (activity) and Cartography, Constitution (meta) —
each activity row carrying an explicit `match` and `matchPriority`; plus the single `RuleCurve`
entry (`stepFormula: "4 * L^2"`, D-130; D-131 rejected per-skill curves). `groundMultipliers`
has a documented **third state**: `null` means "this skill is not ground-scored", which is
distinct from `{1,1,1}`, which would be a claim about ground. Wayfaring is
`{new: 1.0, rearmed: 0.5, recent: 0.5}` per D-120; Vigil is `null` — there is no ground.

Slayer ships `enabled: false` (D-122, no combat in MVP). Meta skills carry no `match` at all —
they arrive through `feeds` and through the fog subsystem's derived award.

## Acceptance criteria

- [ ] `rules/xp-rules-v1.yaml` exists with seven skill rows and one curve entry.
- [ ] Every `kind: activity` row has a `match` block with all four keys present and a
      `matchPriority`.
- [ ] Every `kind: meta` row has `match` absent or null.
- [ ] Wayfaring and Vigil are **no longer byte-identical**: they differ in `requiresTrace`
      (`true` vs `false`), in `displayOrder`, and in `groundMultipliers` (`{1.0,0.5,0.5}` vs
      `null`). A test asserts the two rows differ in at least the `requiresTrace` field.
- [ ] Vigil carries `xpPerUnit: 100` — **full** activity XP, identical to Wayfaring (D-132).
- [ ] A schema validator rejects: an unknown `measure`, a `kinds` entry that is not an
      `ActivityKind`, a `sources` entry that is not a `SourceId`, a `requiresTrace` outside
      `{true,false,any}`, a duplicate `skillId`, a `feeds[].skill` that does not resolve to an
      existing `kind: meta` row, and a cycle in `feeds`.
- [ ] `groundMultipliers: null` and `groundMultipliers: {new:1,rearmed:1,recent:1}` are accepted
      as **distinct** values and a test asserts they are not conflated.
- [ ] Constitution's `1/3` share is a `feeds[].rate` attribute on the source rows, **not** a
      constant anywhere in code.
- [ ] `grep -rn "hasTrace ?" src/` returns nothing, and `grep -rE '"(wayfaring|vigil|might|fortitude|endurance|cartography|constitution)"' src/` returns nothing outside `rules/`, fixtures and tests.
- [ ] The YAML parses in CI and the seeder validation from `02-data-model.md` §3.8 checks 1 and 2
      run against it and pass.

## Notes

**Placement is the acceptance criterion that matters most.** Per roadmap §4.2: *if `09`/1 is
ever reached and this ticket is not closed, stop.* Do not write the scorer against a schema
without `match` intending to retrofit it. The retrofit is a rewrite of every call site plus a data
migration of every ledger row's `xpRulesVersion` semantics.

D-132's "zero discovery credit / no reveal" clause needs **no field**: `hasTrace: false` implies
`traceRef: null` implies no trace implies no H3 projection implies no `ExploredCell` write, no
generation bump and no Cartography award. It falls out of `05-fog-of-war.md` §3.6. Do not add a
`grantsDiscovery` flag.

The YAML in git is the authority; the `RuleSkill` table (T5) is a **materialised projection**
seeded verbatim at deploy time (`02-data-model.md` §3.2, §3.3). The seeder is
idempotent and append-only across versions: it never edits an existing `rulesVersion` partition,
because a ledger row citing `v1` is meaningless if `v1`'s rows were mutated.

Vigil's name is provisional (D-132) — it is a `name` display string, never an identifier. A
rename must be an edit to one attribute.

## Operator validation

**Desktop, a text editor, on `rules/xp-rules-v1.yaml` itself.** Read the seven rows top to bottom
and answer, from the YAML alone with no code open, the question "which skill does a treadmill run
train, and which does an outdoor run train?" If you cannot answer it from the file, the `match`
block is wrong and this ticket is not done. That reading *is* the validation — it is exactly the
question the scorer will have to answer later, and the whole point of D-141 is that the file
answers it instead of a branch.
