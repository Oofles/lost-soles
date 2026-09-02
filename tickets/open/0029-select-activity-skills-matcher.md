---
id: 29
slug: select-activity-skills-matcher
title: selectActivitySkills matcher plus the seed-time totality and determinism checks
type: feature
priority: high
status: open
size: m
capability: 04-domain-contract-and-rules
depends_on: [28]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] `selectActivitySkills(activity, registry)` exists, is pure, takes the registry as an
      argument (never a module-level import of the YAML), and returns an array of skill rows.
- [ ] It contains **no skill id string literal** — verified by the 0028 grep and by review.
- [ ] It returns **one skill per distinct `measure`**, not one skill overall; a strength fixture
      with pushups and situps returns two skills.
- [ ] Ties at equal `matchPriority` within one `measure` are broken by `skillId` **ascending**,
      and a unit test asserts the tie-break rather than relying on input order.
- [ ] `enabled: false` rows never match; a test flips Slayer to `true` and back and sees the
      result change.
- [ ] `kinds` empty or absent matches any `ActivityKind`; `sources: any` matches any `SourceId`.
- [ ] `requiresTrace: "any"` matches both `hasTrace` values; `true` and `false` match only their
      own.
- [ ] Meta skills are never returned, even if a meta row is given a `match` block by mistake.
- [ ] **Totality check**: a generated fixture over the full `ActivityKind` × `hasTrace` grid
      (2 x |ActivityKind| cases) asserts exactly one skill per `measure` for every cell, and the
      check runs in CI and in the seeder.
- [ ] **Ambiguity fails the build**: a test adds a duplicate row at equal priority and equal
      measure and asserts the validator **exits non-zero**, naming both `skillId`s.
- [ ] **Zero-match-for-measurable-work fails the build**: a test removes Wayfaring's `kinds` entry
      for `run` and asserts the validator exits non-zero.
- [ ] **Determinism check**: the matcher runs with `Date.now`, `new Date` and `Math.random`
      stubbed to throw, and passes.
- [ ] A run with `hasTrace: true` selects Wayfaring and a run with `hasTrace: false` selects
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

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

None at this ticket — pure function, no rendered surface, nothing on a device. The operator-visible
consequence is that a deploy with an ambiguous ruleset stops in CI, which the operator sees as a
red build with two skill ids named in the message. Real on-device validation arrives at 0037 (a
no-GPS run scoring into Vigil) and in capability `09`.
