---
id: 157
slug: cycling-skills-and-reveals-ground
title: Roving and Cadence — two cycling skills, and the revealsGround field that keeps the map running-only
type: feature
priority: high
status: closed
size: m
capability: 04-domain-contract-and-rules
depends_on: [28]
blocked_by: []
source: operator
created: 2026-09-04T14:14:07Z
started: 2026-09-04T14:14:48Z
closed: 2026-09-04T14:20:31Z
---

## Description

Two new activity skills, requested by the operator on 2026-09-04 after reading
`rules/xp-rules-v1.yaml` (the `0028` legibility check — it passed):

| Skill | Trains on | Unit | Reveals map? |
|---|---|---|---|
| **Roving** | Cycling **with** a trace | km | **No** |
| **Cadence** | Cycling **without** a trace — stationary bike | km | No (no trace) |

They mirror the Wayfaring/Vigil pair exactly: same `measure: distanceKm`, made mutually
exclusive by `match.requiresTrace`, and separated from the running pair by `match.kinds`
(`[ride]` vs `[run, walk, hike]`). **`kind: ride` matches no skill at all today**, so a
recorded bike ride currently scores nothing — this closes a live gap.

`xpPerUnit: 35` for both, per the operator's choice of the speed-ratio anchor: cycling covers
roughly 3× the distance of running for comparable effort, so 100/3 ≈ 35. A ~25 km ride is
~875 XP, which sits alongside a typical run (885) and strength session (840) under §3.2's
session-parity principle. Cadence takes the **same** rate as Roving, exactly as D-132 gave
Vigil full Wayfaring XP rather than half.

### The part that is not a data row: `revealsGround`

**The operator's decision: cycling must not open the map, and must not earn Cartography.**
Running is the motivation the whole app is built around, and the map is its reward. Stated
directly: *"the only skill that should count for Cartography is currently running."*

Nothing in the schema can express that today, and **it cannot be expressed in code either** —
"only `[run, walk, hike]` reveal" is a hardcoded list of kinds, which is the same `switch` that
D-031 forbids and D-141 was written to remove. So it is a new field on the skill row:

```yaml
revealsGround: true      # wayfaring only
revealsGround: false     # every other activity skill
```

**Semantics.** When an activity matches this skill and carries a trace, its cells are written
to `ExploredCell` — and therefore earn Cartography. `false` means the trace is archived and can
still be drawn as a route, but writes no cells, bumps no generation, and awards nothing.

**Why this is not the `grantsDiscovery` flag that `04-game-design.md` §1.3 forbids.** §1.3
refuses that flag for Vigil, and is right to: for a traceless skill the answer already falls out
(`hasTrace: false` ⇒ no projection ⇒ no cells), so the field would be a second statement of the
same fact and a place for the two to disagree. **Roving is the case that argument does not
cover.** A GPS ride has a real trace and real cells; nothing else in the data says whether they
count. The field carries information that exists nowhere else, which is exactly the test §1.3
applies — and fails to satisfy only in Vigil's case.

**Timing is the same argument as D-141's.** `ExploredCell` writes are `0047`, three capabilities
away. The field must exist in `v1` before that code is written, or the projection ships
revealing everything and the retrofit is a rewrite plus a data migration — and because the map
**never re-fogs** (D-020), every cell wrongly revealed in between is permanent.

### Deliberately NOT in this ticket

- **Walking and hiking already count.** Wayfaring's `match.kinds` is `[run, walk, hike]`, so both
  already reveal ground and earn Cartography. Nothing to add.
- **Rucking is not a row.** A ruck is a walk with a weighted pack, and nothing in the ingestion
  contract distinguishes the two. It needs a new discriminator or a source-specific hint — a
  design decision, not data. Not filed; raise it when it is wanted.

## Acceptance criteria

- [x] `rules/xp-rules-v1.yaml` gains `roving` and `cadence`, both `kind: activity`, both
      `match.kinds: [ride]`, `measure: distanceKm`, `xpPerUnit: 35`.
- [x] `roving` has `requiresTrace: true`, `cadence` has `requiresTrace: false`; a test asserts
      the two rows differ in that field and are therefore mutually exclusive.
- [x] Both carry `groundMultipliers: null` — neither is ground-scored.
- [x] Both feed Constitution at the same `rate` as every other activity skill.
- [x] `revealsGround` is present on **every** `kind: activity` row and absent or null on every
      `kind: meta` row; the validator rejects an activity row without it.
- [x] `wayfaring` is the **only** row with `revealsGround: true`, and a test asserts that by
      filtering the registry rather than by naming the skill.
- [x] A test asserts no activity is a candidate for more than one `distanceKm` skill, across the
      full `ActivityKind` × `hasTrace` grid — extending `0028`'s mutual-exclusivity assertion to
      four distance skills rather than two.
- [x] `02-data-model.md` §3.2's attribute table documents `revealsGround`, since §3.2 is
      authoritative for this schema.
- [x] `04-game-design.md` §1.1's skill table lists Roving and Cadence, and §1.3's "there is
      deliberately no such field" passage is amended to say why `revealsGround` is not the flag
      it refuses — not left to read as a contradiction.
- [x] A `D-xxx` records the decision, the reasoning, and the rejected alternative (reveal but
      award nothing), including why that alternative is worse than either other option.
- [x] `0047` carries a note that it must honour `revealsGround`, so the field is not inert data.
- [x] Typecheck, lint at `--max-warnings 0`, the full suite and `build-index.mjs --check` all pass.

## Notes

**The rejected alternative is worth keeping on the record**, because it is the one that looks
reasonable and is not: *reveal the ground but award no Cartography*. Because the map cannot
re-fog, cycling through a neighbourhood would permanently destroy that ground's discovery value
— running it later would earn nothing, because the ground is no longer new. It eats the map
without paying for it. Either cycling counts fully or it does not touch the map at all; the
middle option is strictly worse than both ends.

`revealsGround` is deliberately a property of the SKILL, not of the activity or the source. A
future skill that should open the map — rucking, trail running, a walking skill split out of
Wayfaring — sets it `true` and needs no code. That is the same property `match` bought for
selection.

Total Level's ceiling moves again: the registry goes from 8 rows to 10. `0031` owns §1.2's
ceiling number and carries a note about it.

## Resolution

**Files amended**

- `rules/xp-rules-v1.yaml` — `roving` and `cadence` added; `revealsGround` on all ten rows.
- `src/rules/schema.ts` — the `revealsGround` field.
- `src/rules/validate.ts` — `validateRevealsGround`: required on activity rows, forbidden on meta.
- `src/rules/xp-rules-v1.test.ts` — +17 tests, including the mutual-exclusivity grid.
- `src/rules/validate.test.ts` — +4 rejection tests.
- `docs/02-data-model.md` §3.2 (the authoritative attribute table) and §3.4 ("selection is not
  revelation"); `docs/04-game-design.md` §1.1 (skill table, MVP count) and §1.3 (an amendment
  banner on the `grantsDiscovery` refusal).
- `docs/decisions/DECISIONS.md` — **D-189**.
- Notes appended to `0047` and `0031`.

---

**What the operator asked for was two data rows. It was not two data rows, and saying so early
was the useful part.** The two skills genuinely are rows — `match.kinds: [ride]` separates cycling
from running exactly as `match.requiresTrace` separates outdoors from indoors, so the four
distance skills are pairwise mutually exclusive and no matcher change is needed. But *"cycling
must not count for Cartography"* could not be expressed at all. Nothing in the schema said whether
a skill opens the map, and it could not go in code either: "only `[run, walk, hike]` reveal" is a
hardcoded list of kinds, which is the `switch` D-031 forbids and D-141 was written to remove.
Selection became data in `0028`; revelation had to as well.

**The middle option was the one worth arguing about.** Asked whether a ride should reveal ground
but earn no Cartography, I pushed back rather than offering it neutrally, and the operator chose
"no reveal at all". The reason it matters: the map never re-fogs (D-020), so revealing without
awarding would **permanently destroy that ground's discovery value** — running the same streets
later would earn nothing, because they are no longer new. Either cycling counts fully or it does
not touch the map; anything between is strictly worse than both ends. It is in D-189 because it is
the option that sounds most reasonable and is not.

**P1 was checked before any of this and does not settle it**, though it looks like it should.
*"Any distance covered with a trace attached reveals ground and earns XP"* rules out gating on
shape, minimum or GPS quality, and rules out distinguishing runs from walks. It was written about
not silently discarding effort, not about which disciplines own the map. D-189 narrows it
deliberately and says so; every prohibition P1 actually makes still stands.

**The awkward part, handled head-on rather than quietly.** `04-game-design.md` §1.3 says of
`grantsDiscovery`: *"There is deliberately no such field."* Adding a neighbouring field could read
as reversing that, so §1.3 now carries an amendment banner explaining why it does not: the refusal
is about **Vigil**, where the answer falls out of `hasTrace: false` and a flag would restate it.
Roving is the case that reasoning does not cover — a real trace, real cells, and a decision that
exists nowhere else in the data. The test §1.3 applies is the right test; `revealsGround` passes it
where `grantsDiscovery` failed it.

**Required, never defaulted.** A default would make "opens the map" the silent consequence of
forgetting a line, and D-020 makes that permanent. Whichever way it fell it would be wrong for half
the rows, so the file must say — including on Vigil and Cadence, where it is admittedly redundant.
Stated anyway so a reader never has to reason about tracelessness to learn whether a skill opens
the map.

**A test that would have made the field a lie, and does not:** a second row set to `true` validates
cleanly. Without that, `revealsGround` would be a disguised special case for running rather than a
property of a skill, and rucking or trail running would be a code change after all.

**What went wrong.**

1. **My own `0028` tests were brittle and broke immediately.** `validate.test.ts` hardcoded
   `skills[2]` for Might and `no-skill-names.test.ts` hardcoded a count of 8; inserting two rows
   moved both. Fixed by deriving indices with an `at(id)` helper and asserting invariants rather
   than literals — the same staleness those tests exist to prevent, reproduced inside them. Worth
   noting because I wrote them one session earlier while explicitly reasoning about not hardcoding
   the skill list.
2. A first pass at inserting `revealsGround` matched `groundMultipliers: null` on a stripped line,
   which missed the strength rows whose value carries a trailing comment, and a second attempt
   produced a duplicate key that only the YAML parser caught. Redone line-by-line with an assertion
   that every expected row was hit.

**Known gap, recorded rather than fixed:** `kind: other` **with** a trace still matches no distance
skill. That was true before this ticket and closing it is a design decision about what an untyped
traced activity should train, not something to slip into a cycling change. A test asserts the gap
explicitly so it is visible; `0029`'s totality check is where it becomes a hard seed-time error if
it matters.

**The field is inert until `0047` reads it.** That ticket writes `ExploredCell`, three capabilities
away, and now carries a note saying it must branch on the matched skill's `revealsGround` rather
than on `ActivityKind`. If it ships without that, D-189 silently does not happen and every wrongly
revealed cell is permanent. This is the same placement argument D-141 made: the data has to exist
before the code that consumes it, or the retrofit is a rewrite plus a migration.

## Operator validation

★ **OPERATOR — desktop, a text editor, on `rules/xp-rules-v1.yaml`.** The same reading as `0028`,
which you did and which passed, but the question now has four answers instead of two. From the
file alone, with no code open:

> Which skill does **an outdoor run**, **a treadmill run**, **a road ride** and **a stationary
> bike** each train — and which of the four opens the map?

If `match` and `revealsGround` are carrying their weight the file answers all five parts without
inference. `displayOrder` groups the four distance skills together (10, 15, 20, 25) so they read
as a block. I cannot check this myself: I wrote the file, so my reading proves nothing about
whether it is legible to anyone else.

**Also worth your eye, and cheap:** 35 XP/km is a judgement about *your* riding. It assumes a
typical hard ride is around 25 km, which lands at ~875 XP alongside a run (885) and a strength
session (840). If your normal ride is 15 km or 45 km, the parity is off and the fix is one number
in one row — say so and I will rescale it.

**Smoke tests — everything else, run on this machine (Node 22, WSL2):**

| Check | Command | Result |
|---|---|---|
| YAML parses | `node -e` over the file | 10 rows, 9 enabled |
| Validator on the shipped file | `validateRuleSet(loadRuleSet(1))` | `[]` |
| Rules tests | `npx vitest run src/rules` | 67 passed |
| Full suite | `npm test` | 24 files, 379 passed, 1 skipped |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint at `--max-warnings 0` | `npm run lint` | exit 0 |
| D-100 boundary | `node scripts/check-boundaries.mjs` | exit 0 |
| Design tokens | `node scripts/check-design-tokens.mjs` | exit 0 |
| Docs index | `node scripts/build-index.mjs --check` | up to date |
| Backlog | `tickets.mjs validate` | 0 errors, 0 warnings |

**The mutual-exclusivity grid is the assertion that matters most here.** All four distance skills
share `measure: distanceKm` at equal `matchPriority`, which is only safe if no activity is ever a
candidate for two of them — otherwise the tie-break fires and which skill a ride trains depends on
row order. Twelve generated cases cover the full `ActivityKind` × `hasTrace` grid and every one
matches at most one skill. `0029` makes that operational in the matcher; here it is proven of the
data, before any matcher exists to be wrong.

**The validator was verified to reject**, not only to accept: an activity row missing
`revealsGround`, a non-boolean value, the field set on a meta row — and, in the other direction, a
**second** row set to `true` validating cleanly, which is what proves the field is data rather
than a special case for running.

**What is NOT proven here.** No cell is written by anything yet, so "a ride does not reveal" is
asserted as data and not demonstrated as behaviour. `0047` is where it becomes real, and it now
carries a note saying so.
