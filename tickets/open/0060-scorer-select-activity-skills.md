---
id: 60
slug: scorer-select-activity-skills
title: The scorer — activity to per-skill unit counts via selectActivitySkills
type: feature
priority: high
status: open
size: m
capability: 09-xp-engine-and-ledger
depends_on: [29]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The first line of the scorer. Given a normalized `Activity` (ingestion contract §2) and the
skill registry for a pinned `rulesVersion`, produce a list of `(skillId, measure, units)`
tuples — the raw work done, per skill, before any rating or multiplier is applied.

Selection is **data, not code**. It is implemented exactly as `02-data-model.md` §3.4
specifies:

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

**Grouping by `measure` is the load-bearing part.** It is why one strength session trains
Might *and* Fortitude (two measures: `reps:pushup`, `reps:situp`) while a run trains exactly
one distance skill. It is also what invariant I-26 is stated over.

**The scorer must never `switch` on a skill id** (D-031, D-141). The line
`activity.hasTrace ? "wayfaring" : "vigil"` is the named failure mode of this capability; if
it appears anywhere, D-031 is broken. Skill ids are opaque strings throughout (I-25).

The matcher is total and deterministic (`04-game-design.md` §7.4): same activity + same
`rulesVersion` ⇒ same skills, always, with no clock and no RNG read anywhere in the path.

This ticket produces unit counts only. Rating (`xpPerUnit`, soft caps), ground multipliers
(0061), propagation (0064) and ledger persistence (0062) are separate.

## Acceptance criteria

- [ ] `selectActivitySkills(activity, registry)` is implemented and exported from the scoring
      module; it takes the registry as an argument and never imports it from a module-level
      singleton.
- [ ] Filtering applies `kind == "activity"`, `enabled`, `match.kinds`, `match.requiresTrace`
      and `match.sources` in that order; absent/empty `kinds` means "any".
- [ ] Candidates are grouped by `match.measure` and exactly one skill is returned per distinct
      measure, chosen by `max(matchPriority)` with ties broken on `skillId` ascending.
- [ ] A `logMode: reps` session carrying both pushups and situps returns **two** skills
      (Might and Fortitude), each with its own unit count.
- [ ] A run with `hasTrace: true` returns exactly one distance skill; the same run with
      `hasTrace: false` returns exactly one distance skill, and it is a different one.
- [ ] Meta skills (`kind: meta`) are never returned by the matcher.
- [ ] A totality fixture sweeps the full `ActivityKind` × `hasTrace` grid and asserts: never
      zero skills for an activity carrying measurable work, never two candidates at equal
      `matchPriority` within one measure group (I-26).
- [ ] The matcher is called in a test with `Date.now` and `Math.random` stubbed to throw, and
      passes (determinism, `04-game-design.md` §7.4).
- [ ] `grep -rE '"(wayfaring|vigil|might|fortitude|endurance|cartography|constitution)"' src/`
      returns nothing outside `rules/`, fixtures and tests, and this grep runs in CI (I-25).
- [ ] No `switch`, `if/else` chain, enum or union type over skill ids exists in `src/scoring/`.

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0029 provides selectActivitySkills; the scorer cannot exist without the matcher (D-141).


Blocked in practice by the `04-domain-contract-and-rules` capability: `match` and
`matchPriority` must exist in `rules/xp-rules-v1.yaml` and be seeded into `RuleSkill` (T5)
**before the first line of the scorer is written** (D-141, roadmap §4.2). Retrofitting
selection into data after a `switch` exists is the failure this ordering prevents.

`02-data-model.md` §3.1's five-jobs table (J1 selection … J5 presentation) is the map of what
lives where. This ticket is J1 and J2 only.

The extractor set behind `match.measure` (`distanceKm`, `reps:<exercise>`, `seconds:<exercise>`)
is a closed vocabulary per §3.7 — adding a measure is a schema change and should be loud; adding
a *skill* over an existing measure is a YAML row and must be silent.

## Operator validation

Not user-visible on its own. Validate on the **`/skills` panel** on the **Pixel 8 Pro**, after
0062 and 0063 land: log one strength session containing both pushups and situps, then look at
the Might and Fortitude tiles. **Both must have moved from one session.** If only one moved,
the measure grouping is wrong. Then run indoors with GPS off and confirm the Vigil tile moves
while the Wayfaring tile does not.
