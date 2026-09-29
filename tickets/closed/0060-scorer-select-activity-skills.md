---
id: 60
slug: scorer-select-activity-skills
title: The scorer — activity to per-skill unit counts via selectActivitySkills
type: feature
priority: high
status: closed
size: m
capability: 09-xp-engine-and-ledger
depends_on: [29]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-29T01:14:43Z
closed: 2026-09-29T01:19:00Z
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

- [x] `selectActivitySkills(activity, registry)` is implemented and exported from the scoring
      module; it takes the registry as an argument and never imports it from a module-level
      singleton.
- [x] Filtering applies `kind == "activity"`, `enabled`, `match.kinds`, `match.requiresTrace`
      and `match.sources` in that order; absent/empty `kinds` means "any".
- [x] Candidates are grouped by `match.measure` and exactly one skill is returned per distinct
      measure, chosen by `max(matchPriority)` with ties broken on `skillId` ascending.
- [x] A `logMode: reps` session carrying both pushups and situps returns **two** skills
      (Might and Fortitude), each with its own unit count.
- [x] A run with `hasTrace: true` returns exactly one distance skill; the same run with
      `hasTrace: false` returns exactly one distance skill, and it is a different one.
- [x] Meta skills (`kind: meta`) are never returned by the matcher.
- [x] A totality fixture sweeps the full `ActivityKind` × `hasTrace` grid and asserts: never
      zero skills for an activity carrying measurable work, never two candidates at equal
      `matchPriority` within one measure group (I-26).
- [x] The matcher is called in a test with `Date.now` and `Math.random` stubbed to throw, and
      passes (determinism, `04-game-design.md` §7.4).
- [x] `grep -rE '"(wayfaring|vigil|might|fortitude|endurance|cartography|constitution)"' src/`
      returns nothing outside `rules/`, fixtures and tests, and this grep runs in CI (I-25).
- [x] No `switch`, `if/else` chain, enum or union type over skill ids exists in `src/scoring/`.

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

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

Not user-visible on its own. Validate on the **`/skills` panel** in the desktop browser, after
0062 and 0063 land: log one strength session containing both pushups and situps, then look at
the Might and Fortitude tiles. **Both must have moved from one session.** If only one moved,
the measure grouping is wrong. Then import an indoor, GPS-less activity (manual adapter or a synthetic one through the queue, D-229) and confirm the Vigil tile moves
while the Wayfaring tile does not.

**Result, 2026-09-28 (agent smoke test, no operator step).** I scanned the deployed
`Activity-nog4xy2l7baqlhghpndh2565qe-NONE` table (`--profile devault`) and ran all **17** stored
activities through `scoreUnits` against the real v1 registry, with the purity traps installed.
All 17 are traced Strava runs from 2025-08-04 to 2026-09-28. Each returned exactly **one** tuple,
`wayfaring` / `distanceKm`, with units equal to `distanceM / 1000` (e.g. 8561.6 m → 8.56). There
were no errors and no zero-unit rows. This proves the scorer reads the shapes the pipeline actually
writes. The harness was a throwaway test file, deleted afterwards and not committed.

**Not covered by the smoke test:** the deployed data has no strength session and no untraced run,
so the Might+Fortitude case and the Vigil case rest on the suite
(`src/scoring/units.test.ts`, against the shipped registry).

**The `/skills` panel check above is withdrawn from this ticket, not deferred to the operator.**
No skills panel exists yet, and "both tiles moved" is a correctness question the suite already
answers, not a perception one (D-229). Whether the panel *reads* well belongs to the ticket that
builds the panel.

## Resolution

**Files added**

- `src/scoring/units.ts`: `scoreUnits(activity, registry)` → `{ skillId, measure, units }[]`,
  plus `measureUnits(activity, measure)`, the J2 extractor.
- `src/scoring/index.ts`: the scoring module's entry point. It re-exports `selectActivitySkills`
  and `MatchableActivity` from `src/rules/`, alongside the new functions.
- `src/scoring/units.test.ts`: 50 tests.
- `tickets/open/0217-…`: follow-up bug, below.

**The matcher was already built, so this ticket is mostly J2.** `0029` shipped
`selectActivitySkills` with the §3.4 filter order, grouping by measure, the tie-break, the totality
and determinism checks, and 31 tests. Criteria 1–3 were therefore met by **re-exporting** it
(operator-approved at the start), not by reimplementing it. A second matcher in `src/scoring/`
would let selection drift between the seed-time validator and the scorer, which is the failure D-141
exists to prevent. Likewise, criterion 9's I-25 grep already runs in CI as
`src/rules/no-skill-names.test.ts` (`0028`, part of `npm test`). That test reads the skill list
from the rules file, so it is a superset of the seven names in the criterion's literal grep. I also
ran the literal grep by hand, and it returns nothing outside tests.

**Design decisions**

- **Zero-unit tuples are dropped** (operator decision, 2026-09-28). Selection groups by *measure*,
  not by what was logged. So a pushups-only session still selects the situp and plank skills, and a
  treadmill run with no `distanceM` still selects a distance skill. Returning `units: 0` for those
  would put rows into an append-only ledger for work nobody did. Tested both ways: the matcher
  returns 3 skills for a pushups-only session and the scorer returns 1.
- **J2 reads the measure string, not the row's `exercises[]`.** `02` §3.7's reps kernel is
  written as "Σ `sets[].reps` where exercise ∈ this skill's `exercises[].id`", but the matcher
  groups on `match.measure`, which encodes the exercise (`reps:pushup`). Using the same field for
  both halves means J1 and J2 cannot disagree. In v1 the two coincide on every row. The dispatch is
  a lookup keyed on the measure's **kernel prefix** (`distanceKm` / `reps` / `seconds`), the
  closed set §3.7 says stays code. It never looks at a skill id.
- **Corrupt work throws; missing work is zero.** A set with no `reps` field contributes 0, since a
  plank set legitimately has none. A negative or non-finite total throws, because XP never decreases
  (D-135) and an `Infinity` that reached the ledger could never be taken back. Sanity ceilings and
  minimum-credit floors (`04` §3.5) are rating concerns and deliberately not here.
- **A derived measure (`cells`, `share`) on an activity row throws.** Those units come from another
  subsystem, never off an `Activity`.

**Discovered, not fixed: `0217`.** The validator accepts `cells`/`share` as the measure of a
`kind: activity` row, so a ruleset carrying one validates clean and then throws once per activity
at ingest. I-26 says that must fail at seed time. No shipped row does it. Filed rather than fixed,
because the validator belongs to `0029` and fixing it here would widen scope (D-152).

**Proving the new guards can fail.** Everything passed on the first run, so I sabotaged
`scoreUnits` with a `Date.now()` call and a `switch (activity.kind)`. Exactly two tests went red:
the purity-trap test and the no-switch check. Then I restored it. The no-switch detector skips
comment lines on purpose, so that prose describing the rule does not trip it (the D-166/D-167
false-positive trap).

**Test titles cite I-25 and I-26** (D-224), so the invariant ratchet counts them.

**Gate:** `tsc --noEmit` clean · `eslint --max-warnings 0` clean ·
`check-boundaries.mjs` exit 0 · `npm test` 119 files, 2196 passed, 1 skipped.
