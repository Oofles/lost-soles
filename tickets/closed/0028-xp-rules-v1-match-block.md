---
id: 28
slug: xp-rules-v1-match-block
title: rules/xp-rules-v1.yaml WITH the match block and matchPriority - before the first line of the scorer
type: feature
priority: high
status: closed
size: m
capability: 04-domain-contract-and-rules
depends_on: [25]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-09-04T13:18:30Z
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

- [x] `rules/xp-rules-v1.yaml` exists with ~~seven~~ **eight** skill rows and one curve entry.
      *(Amended: the Description enumerates seven MVP skills — Wayfaring, Vigil, Might,
      Fortitude, Endurance, Cartography, Constitution — and separately requires Slayer to ship
      `enabled: false` (D-122), which is an eighth row. "Seven" counted the MVP set, or predates
      Vigil joining it. Seven rows are `enabled: true`; a test asserts both numbers.)*
- [x] Every `kind: activity` row has a `match` block with all four keys present and a
      `matchPriority`.
- [x] Every `kind: meta` row has `match` absent or null.
- [x] Wayfaring and Vigil are **no longer byte-identical**: they differ in `requiresTrace`
      (`true` vs `false`), in `displayOrder`, and in `groundMultipliers` (`{1.0,0.5,0.5}` vs
      `null`). A test asserts the two rows differ in at least the `requiresTrace` field.
- [x] Vigil carries `xpPerUnit: 100` — **full** activity XP, identical to Wayfaring (D-132).
- [x] A schema validator rejects: an unknown `measure`, a `kinds` entry that is not an
      `ActivityKind`, a `sources` entry that is not a `SourceId`, a `requiresTrace` outside
      `{true,false,any}`, a duplicate `skillId`, a `feeds[].skill` that does not resolve to an
      existing `kind: meta` row, and a cycle in `feeds`.
- [x] `groundMultipliers: null` and `groundMultipliers: {new:1,rearmed:1,recent:1}` are accepted
      as **distinct** values and a test asserts they are not conflated.
- [x] Constitution's `1/3` share is a `feeds[].rate` attribute on the source rows, **not** a
      constant anywhere in code.
- [x] `grep -rn "hasTrace ?" src/` returns nothing, and `grep -rE '"(wayfaring|vigil|might|fortitude|endurance|cartography|constitution)"' src/` returns nothing outside `rules/`, fixtures and tests.
- [x] The YAML parses in CI and the seeder validation from `02-data-model.md` §3.8 checks 1 and 2
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

## Resolution

**Files added**

- `rules/xp-rules-v1.yaml` — the registry. Eight skill rows, one curve, heavily commented
  because this file is the authority and a future reader must be able to answer "which skill
  does a treadmill run train?" from it alone.
- `src/rules/schema.ts` — the shape, from `02-data-model.md` §3.2/§3.4, plus the closed
  vocabularies as runtime arrays.
- `src/rules/schema.types.test.ts` — compile-time assertions binding those arrays to the
  domain's unions.
- `src/rules/validate.ts` — §3.8 checks 1 and 2, plus criterion 6's structural rejections.
- `src/rules/load.ts` — one place that knows where the YAML lives.
- `src/rules/xp-rules-v1.test.ts` (18), `validate.test.ts` (20), `no-skill-names.test.ts` (5).

**Files amended** — `tickets/open/0031-*.md`, a dated note naming a divergence for it to settle.

---

**Three judgement calls made inside the ticket rather than blocking on:**

1. **Eight rows, not seven.** Criterion 1 said seven; the Description enumerates seven MVP skills
   *and* separately requires Slayer at `enabled: false`. Seven are enabled, eight exist. Criterion
   amended with the reasoning; a test asserts both counts, so neither number can drift unnoticed.

2. **The validator is TypeScript under `src/rules/`, not a plain-node script under `scripts/`.**
   Every other gate check (`check-boundaries`, `check-design-tokens`) is plain node because it must
   run in the Amplify container, which has no TypeScript. This one is different: §3.8 requires the
   same validation **in CI and again in the seeder**, and the seeder is Amplify TypeScript. Written
   as a script it would have to be written twice, and two implementations of one rule is how they
   come to disagree. It runs in both gates via `npm test`, which `amplify.yml` and `gate.yml` both
   already invoke.

3. **`sources` is shape-validated, never enumerated — and this is the interesting one.** Criterion
   6 asks the validator to reject "a `sources` entry that is not a `SourceId`". But `SourceId` is
   deliberately open (`| (string & {})`, contract conflict 1) precisely so that adding a source
   never edits code. A validator enforcing the enumerated members would reject `sources: [garmin]`
   — a perfectly valid `SourceId` — and make adding a source a code change, which is the failure
   D-100 exists to prevent. So the check is on shape (lower-kebab-case). `kinds` is the opposite
   case and **is** enumerated, because `ActivityKind` is genuinely closed. Both directions are
   tested: an unenumerated source is accepted, a malformed one is rejected.

**A divergence between two design docs, found while writing the file.** `04-game-design.md` §1.3's
YAML sample puts `exercises:` at the **top level** with a `skill:` back-reference;
`02-data-model.md` §3.2 **nests** them in the skill row, and also says the YAML is "seeded verbatim
into T5" — so the file's shape and the item's shape must be one shape. Shipped nested, because
§1.3 itself names `02` §3 as authoritative for this schema and because a back-reference is a second
place the mapping can disagree. **Not left to be remembered**: recorded as a dated note on `0031`,
which already owns the §1.3 amendment and whose own criteria ("matching the shape shipped in
`rules/xp-rules-v1.yaml`", "the amended §1.3 parses with the 0028 validator") now cannot be
satisfied without fixing it. No `D-xxx`: `0031` is the decision point, and pre-empting it here
would be deciding the doc's content from inside a different ticket.

**The runtime-vocabulary problem, and why it did not become a domain edit.** The validator checks
values at runtime and therefore needs `ActivityKind`'s members as data, but `src/domain/activity.ts`
is types-only by deliberate design (0025). Duplicating the list is only safe if something binds the
copy to the original, so `ACTIVITY_KINDS` lives in `src/rules/schema.ts` with a compile-time
`Equals` assertion against the domain union: gain or lose a kind without updating the array and
`tsc` fails. The domain keeps its property; the duplication cannot drift silently.

**What went wrong.**

1. The compile-time assertions were first written in `schema.ts`, where ESLint reads them as unused
   bindings and `--max-warnings 0` turns that into a red build (D-164). The `_`-prefixed exemption
   is scoped to `*.types.test.ts` only. Moved there rather than widening the exemption — widening
   it would reopen exactly the hole D-164 closed, and 0025's config comment says so explicitly.
2. **A test comment tripped the ticket's own criterion-8 grep.** `no-skill-names.test.ts` quoted the
   failure mode verbatim, so `grep -rn "hasTrace ?" src/` returned a hit — on prose describing the
   thing it forbids. Reworded. This is the D-166/D-167 false-positive trap in miniature, one
   commit after writing a test whose whole design is to avoid it, and the general lesson holds: a
   gate that fires on prose gets bypassed.

**Deliberately not done.** §3.8 checks 3–6 are not implemented here: totality and determinism need
the matcher (`0029`), the D-132 regression needs the full scoring path (`0030`). Check 6's grep
*is* implemented, as `no-skill-names.test.ts`, because `0029` and `0030` both refer to it as "the
0028 grep" — it had to exist for them to cite. The validator is structured so `0029` adds its
ambiguity check by appending to the same error list rather than by restructuring: errors accumulate
and each names its path.

## Operator validation

**One item genuinely belongs to the operator, and it is the one this ticket's author wrote down.**
Everything mechanical, I ran.

★ **OPERATOR — desktop, a text editor, on `rules/xp-rules-v1.yaml`.** Read the eight rows top to
bottom and answer, *from the YAML alone with no code open*: **"which skill does a treadmill run
train, and which does an outdoor run train?"** If the file cannot answer it, the `match` block is
wrong and this ticket is not done.

This one cannot be delegated to me, and not because of tooling: **I wrote the file, so my reading
proves nothing about whether it is legible to anyone else.** The question is exactly the one the
scorer will have to answer five capabilities from now, and the entire point of D-141 is that the
file answers it instead of a branch. The answer should be reachable from `match.requiresTrace` —
`true` on Wayfaring, `false` on Vigil — with everything else in the two rows identical.

The ticket does not carry this as an `(operator)` criterion, so it did not block the close. If the
file reads badly, that is a finding worth a new ticket rather than a reopen.

**Smoke tests — everything else, run on this machine (Node 22, WSL2):**

| Check | Command | Result |
|---|---|---|
| YAML parses | `node -e` over `rules/xp-rules-v1.yaml` | 8 rows, 7 enabled |
| §3.8 checks 1 & 2 | `validateRuleSet(loadRuleSet(1))` | `[]` — no errors |
| Rules tests | `npx vitest run src/rules` | 46 passed |
| Full suite | `npm test` | 24 files, 358 passed, 1 skipped |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint at `--max-warnings 0` | `npm run lint` | exit 0 |
| Criterion 8, grep 1 | `grep -rn "hasTrace ?" src/` | **nothing** |
| Criterion 8, grep 2 | `grep -rEn '"(wayfaring\|vigil\|might\|fortitude\|endurance\|cartography\|constitution)"' src/` | nothing outside tests |
| D-100 boundary | `node scripts/check-boundaries.mjs` | exit 0 |
| Design tokens | `node scripts/check-design-tokens.mjs` | exit 0 |
| Docs index | `node scripts/build-index.mjs --check` | up to date |

**The validator was verified to REJECT, not only to accept.** Twenty tests, each starting from the
**real v1 file** and breaking exactly one thing — so a passing case cannot be an artefact of a
hand-built fixture that was already wrong elsewhere. All seven rejections in criterion 6, plus a
self-feed (the shortest cycle and the easiest to miss), a `feeds` target that resolves to an
*activity* row rather than merely to nothing, and the two `sources` directions in opposition:
`garmin` accepted, `"Not A Source"` rejected.

**What is NOT proven here, and belongs to `0029`/`0030`:** that the matcher actually selects
Wayfaring for a traced run and Vigil for a traceless one. This ticket ships the data that makes
that decidable and asserts the two rows are mutually exclusive *as data*; nothing yet reads them.
That is the ticket's design — the file exists five capabilities before the scorer on purpose — but
it means the D-132 behaviour is asserted, not yet demonstrated.
