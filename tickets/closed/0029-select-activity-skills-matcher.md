---
id: 29
slug: select-activity-skills-matcher
title: selectActivitySkills matcher plus the seed-time totality and determinism checks
type: feature
priority: high
status: closed
size: m
capability: 04-domain-contract-and-rules
depends_on: [28]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-04T14:39:51Z
closed: 2026-09-04T14:48:37Z
---

## Description

The code half of D-141: one small, total, deterministic function that reads the `match` blocks
from 0028 and answers "which activity skills does this `Activity` train?" — with no skill name
anywhere in it.

`02-data-model.md` §3.4, in full:

```
selectActivitySkills(activity, registry):
    candidates = registry.skills
        .filter(s => s.kind == "activity" && s.enabled)
        .filter(s => s.match.kinds is empty  OR  activity.kind in s.match.kinds)
        .filter(s => s.match.requiresTrace == "any"
                     OR s.match.requiresTrace == activity.hasTrace)
        .filter(s => s.match.sources == "any" OR activity.source.source in s.match.sources)
    group candidates by match.measure
    for each group: take max(matchPriority), tie-break skillId ascending
    return one skill per distinct measure
```

**Grouping by `measure` is the part that is easy to get wrong and hard to notice.** It is what
lets one strength session train Might *and* Fortitude (two different measures: reps of `pushup`,
reps of `situp`) while a run trains exactly one distance skill. Returning a flat "best match"
instead of one-per-measure silently halves strength scoring. Meta skills are **never** matched —
they arrive through `feeds`, and Cartography through the fog subsystem's own derived award.

The matcher must be **total and deterministic** (`04-game-design.md` §7.4 requires this for
replay soundness): same activity + same `rulesVersion` ⇒ same skills, always, with no clock and
no RNG.

**And the checks fire at seed time, not run time.** Per invariant I-26 and `02-data-model.md`
§3.8 checks 3 and 4, ambiguity is a **deploy failure**, not a 6am-Sunday failure:

- **Totality (check 3):** for a fixture set covering **every `ActivityKind` × `hasTrace`
  combination**, `selectActivitySkills` returns **exactly one** skill per `measure`. Zero matches
  for an activity carrying measurable work, or two rows at equal `matchPriority` sharing a
  `measure`, **fails the build**.
- **Determinism (check 4):** the matcher is invoked with the clock and RNG stubbed to throw,
  mirroring the contract §5 purity check on `normalize()`.

Both run in CI **and again in the deploy-time seeder**, so a ruleset that would be ambiguous can
never reach the table.

## Acceptance criteria

- [x] `selectActivitySkills(activity, registry)` exists, is pure, takes the registry as an
      argument (never a module-level import of the YAML), and returns an array of skill rows.
- [x] It contains **no skill id string literal** — verified by the 0028 grep and by review.
- [x] It returns **one skill per distinct `measure`**, not one skill overall; a strength fixture
      with pushups and situps returns two skills.
- [x] Ties at equal `matchPriority` within one `measure` are broken by `skillId` **ascending**,
      and a unit test asserts the tie-break rather than relying on input order.
- [x] `enabled: false` rows never match; a test flips Slayer to `true` and back and sees the
      result change.
- [x] `kinds` empty or absent matches any `ActivityKind`; `sources: any` matches any `SourceId`.
- [x] `requiresTrace: "any"` matches both `hasTrace` values; `true` and `false` match only their
      own.
- [x] Meta skills are never returned, even if a meta row is given a `match` block by mistake.
- [x] **Totality check**: a generated fixture over the full `ActivityKind` × `hasTrace` grid
      (2 × |ActivityKind| cases) asserts ~~exactly one skill per `measure` for every cell~~
      **at most one skill per `measure` for every cell, and exactly one distance skill for every
      known kind that can carry distance**, and the check runs in CI and in the seeder.
      *(Amended, **D-190**: "exactly one per measure for every cell" is unsatisfiable. `other` is
      the catch-all kind and no distance skill claims it — deliberately, per `02` §3.7, which
      says an open-water swim gets its own row when added. `strength` carries no distance by
      nature. Taken literally the criterion would have failed the build on the correct shipped
      ruleset. Strict for `run`/`walk`/`hike`/`ride`; the exemption is named in code and asserted
      by a test rather than achieved by weakening the rule.)*
- [x] **Ambiguity fails the build**: a test adds a duplicate row at equal priority and equal
      measure and asserts the validator **exits non-zero**, naming both `skillId`s.
- [x] **Zero-match-for-measurable-work fails the build**: a test removes Wayfaring's `kinds` entry
      for `run` and asserts the validator exits non-zero.
- [x] **Determinism check**: the matcher runs with `Date.now`, `new Date` and `Math.random`
      stubbed to throw, and passes.
- [x] A run with `hasTrace: true` selects Wayfaring and a run with `hasTrace: false` selects
      Vigil, with no branch in the matcher naming either.

## Notes

The grid fixture is the valuable artefact here — 0030 reuses it, and every future skill row
inherits its coverage for free. Generate it from the `ActivityKind` union rather than hand-listing
kinds, so adding a kind to the domain automatically widens the check instead of silently leaving
a hole.

"Measurable work" needs a definition for the zero-match rule to be checkable: an activity is
measurable if any extractor in §3.7 would yield a non-zero unit count (non-zero `distanceM`, or a
non-empty `sets`). An `other`-kind activity with zero distance and no sets legitimately matches
nothing and must not fail the build.

## Resolution

**Files added**

- `src/rules/select-activity-skills.ts` — the matcher, plus `candidatesByMeasure`.
- `src/rules/select-activity-skills.test.ts` — 31 tests.
- `src/purity/traps.ts` — the purity traps, extracted from `0027`'s harness (below).

**Files amended**

- `src/rules/validate.ts` — `validateSelection`: §3.8 checks 3 and 4.
- `src/rules/validate.test.ts` — +7 tests.
- `src/adapters/normalize-purity.ts` — now built on the shared traps.
- `src/adapters/normalize-purity.test.ts` — one assertion on the new `where` field.
- `docs/decisions/DECISIONS.md` — **D-190**.

---

**Three things went wrong, and all three were the same shape: a check that looked right and
proved nothing.** They are the substance of this ticket, so they are written out rather than
summarised.

**1. The ambiguity check inspected the matcher's WINNERS and therefore found nothing.**
`validateSelection` originally called `selectActivitySkills` and looked for two skills sharing a
measure. There never are any — the tie-break has already collapsed each group to one by the time
it returns. The check passed on a ruleset with a deliberately duplicated Wayfaring row, which is
precisely the ruleset it exists to reject. **Ambiguity is only visible before it is resolved**, so
the matcher now exports `candidatesByMeasure` — the pre-tie-break view — used by the check and by
nothing else, with a comment saying why it exists so it does not look like dead surface area.

Worth stating plainly: had the test asserted only "the shipped file validates clean", this would
have shipped. It was caught by a test that builds a *broken* ruleset and demands a failure.

**2. The totality check, taken literally, fails the build on the correct ruleset.** §3.8 check 3
says zero matches for measurable work is a build failure. `other` with a trace has real distance
and no distance skill — deliberately, because `02` §3.7 says an open-water swim gets its own row
when someone adds one. Requiring a skill for `other` means requiring one for every activity nobody
has classified yet, which no ruleset can satisfy. Narrowed to the four known distance-carrying
kinds and recorded as **D-190**; the exemption is named in code and asserted by a test, not
achieved by loosening the rule until it stopped complaining.

I found this while writing `0157`, not this ticket — the cycling rows made the `other` gap obvious.
It had been true and unsurfaced since the check was written.

**3. My own test named the vendor and the D-100 grep failed the build.** `D-188`, which I recorded
one session ago, deliberately keeps test files inside that grep. It fired on a source-id list in a
test that had no need of that name — which is the argument for the rule, demonstrated on me a day
after I made it. Reworded; the test is better for it.

**The purity traps were extracted rather than reimplemented.** Check 4 needs the clock and RNG
stubbed to throw, "mirroring the contract §5 check on `normalize()`". Writing a second set of stubs
would eventually trap a different set of globals, and then "pure" would quietly mean two things —
the same argument that put the rules validator in one place. `src/purity/traps.ts` is the shared
definition, sited outside `src/adapters/` so `src/rules/` does not depend on the adapter boundary.
Each caller now supplies its own `where` and `why`, so a failure names which function broke its
contract and what that contract buys; `normalize()`'s D-100/D-121.2 rationale survives verbatim,
and `0027`'s 24 tests still pass unchanged.

**Design notes worth keeping:**

- **One skill per `measure` is the part that is easy to get wrong and hard to notice.** A flat
  "best match" would return one skill for a strength session and silently drop two thirds of its
  XP, while every single-skill test kept passing. Asserted directly: `strength` returns all three.
- **The tie-break is tested against both input orders.** Asserting it once proves the fixture's
  array order, not the comparator. Sorting rather than scanning for a maximum makes the order a
  property of the code.
- **Totality means the matcher ANSWERS**, never throws and never returns undefined, for every cell
  including the ones no skill claims. A matcher that threw on an unclassified activity would take
  down ingestion for a kind nobody had thought about.
- **`kinds: []` means ANY, not none.** Getting it backwards stops every skill matching, and a test
  suite whose fixtures always set `kinds` explicitly would never notice. Tested explicitly.
- The registry is an argument, never a module import: a recomputation runs against the
  `rulesVersion` the activity was scored under, which may not be the current one.

**Discovered, not fixed:** narrowing a row's `sources` trips the totality check, because every
other source's runs would then score nothing. That is correct behaviour and now has a test, but it
means the `sources` escape hatch cannot be used on a kind's only distance skill without also
adding a fallback row. Nothing needs it today; worth knowing before someone reaches for it.

## Operator validation

**None.** A pure function and two seed-time checks — no screen, no device, no deployed resource.
The operator-visible consequence is that a deploy with an ambiguous ruleset stops in CI showing
two skill ids; real on-device validation arrives at `0037` and in capability `09`.

**Smoke tests, run on this machine (Node 22, WSL2):**

| Check | Command | Result |
|---|---|---|
| Matcher tests | `npx vitest run src/rules/select-activity-skills.test.ts` | 31 passed |
| Rules tests | `npx vitest run src/rules` | 106 passed |
| Full suite | `npm test` | 25 files, 418 passed, 1 skipped |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint at `--max-warnings 0` | `npm run lint` | exit 0 |
| D-100 boundary | `node scripts/check-boundaries.mjs` | exit 0 (after a real failure — see below) |
| ...and its self-test | `--self-test` | 29 cases passed |
| Skill-name grep | criterion 8's two greps from `0028` | clean |
| Design tokens · docs index | both checks | exit 0 · up to date |

**Each check was verified to FAIL before being trusted to pass**, which is the whole point given
that two of them did not work on the first attempt:

- **Ambiguity** — a duplicated Wayfaring row at equal `matchPriority` is rejected, with **both**
  ids and the grid cell named (`selection[run/hasTrace=true]`). The seeder's own entry point,
  `assertValidRuleSet`, throws on the same ruleset, which is what "exits non-zero" is made of.
  **This check silently passed on that ruleset in its first version**, because it read the
  matcher's winners after the tie-break had resolved them.
- **Zero-match** — removing `run` from Wayfaring's `kinds` is rejected with *"no skill measures
  distance for a run with hasTrace=true … Real distance would be recorded and score nothing."*
- **The D-190 narrowing** — a test asserts the shipped file validates clean *because* `other` is
  exempt, so removing the exemption produces a legible failure rather than a mystery.
- **The D-100 grep** — fired for real, on my own test file naming the MVP vendor, and the build
  went red until it was fixed. That is D-188 doing its job on the person who wrote it.

**The determinism check runs the matcher under the same traps as `normalize()`** — `Date.now`,
`new Date()`, `Math.random`, `performance.now`, `crypto.randomUUID`, `crypto.getRandomValues`,
`fetch` — from one shared definition, so the two cannot drift into meaning different things.

**What is NOT proven here:** no XP is computed by anything yet. The matcher says which skills an
activity trains; whether the right number lands in them is capability `09`. `0030` is where the
D-132 property becomes a permanent regression test rather than a passing assertion.
