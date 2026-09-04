# Lost Soles — RPG Systems Design

**Status:** design, planning phase. No code exists.
**Scope:** the progression, reward and combat systems. Map rendering, ingestion and data
platform live in their own documents.
**Authority:** every `D-xxx` cited here is settled and user-confirmed in
`docs/decisions/DECISIONS.md`. Nothing in this document may contradict one. Where I make a
call that is *not* covered by a decision, it is marked **[JUDGMENT CALL]** with the reasoning,
so it can be overruled cheaply.

---

## 0. Design thesis

The user runs 3–5×/week, 3–8 miles, and has done so for years without an app. Lost Soles is
therefore **not** a behaviour-change tool. It is a **chronicle**. Its job is to make an existing
habit feel like it accumulates into something.

Three constraints dominate every number below:

1. **Novelty is the motivator** (D-012). New ground must always be the most valuable thing
   that can happen in a session.
2. **Upkeep is the enemy** (D-013). No system may require an action that is not itself exercise.
   Combat resolves without the user (D-041). Gear equips itself (§6). There are no streaks,
   no dailies, no punishments — ever.
3. **The input rate is flat for life.** This is the single biggest departure from Runescape and
   it drives the entire XP curve (§2). A Runescape player's XP/hour grows ~100× between level 1
   and level 99. This user will run roughly 1,841 km in year 1 and roughly 1,841 km in year 15.
   A curve designed for exponentially growing input, fed by constant input, **stalls**.

The theme: souls wandered off into the fog and forgot the way home. Every road you run is a
road remembered. The map is not a scoreboard — it is a rescue in progress.

---

## 1. The skill system

Per **D-030** (hybrid), **D-031** (activity skills, must be modular), **D-032** (meta skills),
**D-033** (Total Level).

### 1.1 The skills

**Activity skills** — 1:1 with a thing the body does. Trained only by doing that thing.

| Skill | Trains on | Unit | Flavour |
|---|---|---|---|
| **Wayfaring** | Running / walking / hiking with a trace | kilometre | Ground covered. The distance skill. **The only skill that opens the map** (D-189). |
| **Vigil** | Running without a trace — treadmill, track, dead watch | kilometre | Full Wayfaring XP, no ground (D-132). |
| **Roving** | Cycling with a trace | kilometre | 60 XP/km (D-189, rescaled by `0158`). Earns no map. |
| **Cadence** | Cycling without a trace — stationary bike | kilometre | The pedalling rate, and a rhythm that goes nowhere. |
| **Might** | Pushups | rep | Pressing strength. |
| **Fortitude** | Situps | rep | The core. Endurance of the trunk. |
| **Endurance** | Planks | second | Holding a position against time. |

**Meta skills** — never trained directly, only as a by-product of activity skills.

| Skill | Fed by | Flavour |
|---|---|---|
| **Cartography** | Newly revealed H3 cells (§3.3) | The map itself. The novelty skill. |
| **Constitution** | 1/3 of *all* activity-skill XP | Total lifetime volume. Always high. |
| **Slayer** | Encounter and boss damage (§5) | POST-MVP — out of MVP per D-122. |

MVP ships **nine enabled skills**: seven activity skills — Wayfaring, Vigil, Roving, Cadence,
Might, Fortitude, Endurance — plus Cartography and Constitution (**D-122** — Slayer ships
`enabled: false` because combat is out). Six was the count before D-132 added Vigil (ticket
`0028`) and D-189 added the cycling pair (ticket `0157`); `rules/xp-rules-v1.yaml` is the
authority and this list follows it, never the other way round.

**Only Wayfaring opens the map** (D-189). Vigil and Cadence have no trace to project; Roving has
one and deliberately does not use it, so a bike ride earns full XP and leaves the fog intact for
the day the same ground is run.

**Constitution's 1/3 rate is lifted directly from Runescape's Hitpoints skill**, which gains
1/3 of all combat XP and therefore ends up as one of every player's highest levels. The effect
we want is identical: a single number that answers "how much work have I done, in total, ever."
It is the skill that never stalls, because every skill feeds it.

### 1.2 Total Level (D-033)

`TotalLevel = Σ level(skill)` over every **enabled** skill in the ruleset, including meta skills.

**The ceiling is arithmetic, not a constant** (D-145, corrected again by ticket `0031`):

```
ceiling = (number of enabled rows in rules/xp-rules-vN.yaml) × maxLevel
```

At `v1` — **9 enabled rows** (Wayfaring, Vigil, Roving, Cadence, Might, Fortitude, Endurance,
Cartography, Constitution) and `maxLevel: 99`:

| | rows | ceiling |
|---|---|---|
| MVP, as shipped | 9 | **891** |
| ...if Slayer is enabled (D-122, post-MVP) | 10 | **990** |
| Beyond 99 — `deepMaxLevel: 120` (§2.5) | 9 | **1,080** |

> **This figure has now been wrong three times, and the reason is worth more than the number.**
> It was published as **594** (6 rows), corrected to **693** when Slayer was counted, and both
> were falsified again by Vigil (`0028`) and by Roving and Cadence (`0157`) — each of which was
> *supposed* to be a data-only change, and each of which silently invalidated a hardcoded total
> in this document.
>
> **So do not read a number here. Count the rows.** `rules/xp-rules-v1.yaml` is the authority;
> the table above is a snapshot of it on 2026-09-04 and will go stale the next time a row lands.
> Quoting it back as fact is the failure mode; deriving it is the fix.

Total Level is the **headline number on the home screen**, not any individual skill. It moves
~9× faster than any single skill, which is what keeps mid-game weeks from feeling empty
(a run that moves Wayfaring 1.8% of a level can still be the run that ticks Total Level).

`TotalXP = Σ xp(skill)` is displayed underneath, and it is the number that **always** goes up,
every session, without exception. That guarantee matters (§4.1).

### 1.3 Skills are data, not code — the extensibility requirement (D-031)

This is the most load-bearing structural requirement in the document. **Adding "Burpees"
must be adding a row.** If it requires a code change, the design has failed.

> ### ⚠ AMENDED 2026-08-30 (D-141) — the schema first published in this section was **defective**
>
> It is corrected below. The correction is purely **additive** — a `match` block and a
> `matchPriority` field — and no pre-existing field changed meaning.
>
> **What was wrong.** A skill row said *how much* XP an activity earns but never *which
> activities the skill consumes*. The schema covered four of the five jobs a skill row has —
> measurement (`logMode`, `unit`), rating (`xpPerUnit`, `softCapUnits`, `groundMultipliers`),
> propagation (`feeds`) and presentation (`name`, `displayOrder`) — and silently omitted the
> fifth: **selection**.
>
> **How it was caught.** By running D-132 as a real acceptance test. Under the original schema
> **Wayfaring** (outdoor running) and **Vigil** (GPS-less running) come out *byte-identical* in
> every field that could tell them apart — both `kind: activity`, `logMode: trace`, `unit: km`,
> `xpPerUnit: 100`. Nothing in either row states which one a given run trains, so the scorer
> would have had to decide in code:
>
> ```ts
> // THE FAILURE MODE. If this line is ever written, D-031 is broken and D-132 has failed.
> const skill = activity.hasTrace ? "wayfaring" : "vigil"
> ```
>
> That is a `switch` on skill id — the exact construct this section outlaws — and it would have
> been extended again by every future skill that splits on a condition: indoor cycling, rowing
> erg, pool swim. Each is a Vigil-shaped problem.
>
> **Why it matters beyond these two skills.** A schema can look complete, be internally
> consistent, and still be missing an entire job. This one was found in planning rather than in
> ticket ~15, where every workout type added afterwards would have compounded the branch.
> **This note stays** — the correction must not read as if the schema was always right.
>
> **Authority.** The `match` design is derived in **`02-data-model.md` §3**, which is
> authoritative for this schema: §3.1 the five jobs, §3.2 the `RuleSkill` item shape, §3.4 the
> matcher, §3.5 the worked Vigil test, §3.8 the CI checks that stop the property rotting. This
> section carries the corrected schema; §3 carries the reasoning.

The skill registry is a versioned data file (`rules/xp-rules-v1.yaml`), loaded at ingest time
and pinned per activity (§7). The schema:

```yaml
# rules/xp-rules-v1.yaml — an EXCERPT. The file itself is the authority (02 §3.2/§3.3);
# this block is checked against it by `src/rules/doc-schema.test.ts`, which extracts the
# YAML below and runs the 0028 validator over it. If it drifts, the build goes red.
#
# Trimmed for reading: Fortitude, Endurance and Slayer follow Might's and Constitution's
# shape exactly. Nothing else is omitted — in particular all FOUR distance skills are here,
# because the seed-time totality check (02 §3.8/3, ticket 0029) requires every distance-
# carrying kind to have exactly one, and an excerpt that dropped one would not validate.
version: 1
effectiveFrom: 2026-09-01T00:00:00Z

curve:                       # D-130. NOT per-skill — D-131 rejected per-skill constants.
  stepFormula: "4 * L^2"
  maxLevel: 99
  deepMaxLevel: 120          # §2.5

skills:

  - id: wayfaring
    name: Wayfaring
    kind: activity
    enabled: true
    displayOrder: 10
    logMode: trace           # trace | reps | duration | derived — a CLOSED set (02 §3.7)
    unit: km
    match:                   # J1 SELECTION (D-141) — which activities this skill consumes
      kinds: [run, walk, hike]  # ActivityKind values. Absent/[] = ANY, not none.
      requiresTrace: true       # true | false | any — reads Activity.hasTrace
      sources: any              # any | [<sourceId>, …] — escape hatch, rarely used
      measure: distanceKm       # J2. ONE measure per row — see the resolved item below.
    matchPriority: 100       # higher wins; ties break on skill id ascending (§7.4)
    xpPerUnit: 100
    softCapUnits: null
    sanityCeilingUnits: 300
    minUnitsForCredit: 0.25
    groundMultipliers:       # D-120 — null would mean "not ground-scored", a DIFFERENT claim
      new: 1.0
      rearmed: 0.5
      recent: 0.5
    revealsGround: true      # D-189 — the ONLY true in the file. Running opens the map.
    feeds:
      - skill: constitution
        rate: 0.3333         # Constitution's 1/3 lives HERE, never as a constant in code

  # ONE FIELD separates this from Wayfaring, and it is read off Activity.hasTrace.
  - id: vigil
    name: Vigil              # provisional (D-132) — a display string, NEVER an identifier
    kind: activity
    enabled: true
    displayOrder: 15
    logMode: trace
    unit: km
    match: { kinds: [run, walk, hike], requiresTrace: false, sources: any, measure: distanceKm }
    matchPriority: 100
    xpPerUnit: 100           # D-132: FULL XP, identical to Wayfaring. Not half.
    softCapUnits: null
    sanityCeilingUnits: 300
    minUnitsForCredit: 0.25
    groundMultipliers: null  # not ground-scored — there is no ground
    revealsGround: false
    feeds: [{ skill: constitution, rate: 0.3333 }]

  # The same construction one level down: `kinds` separates cycling from running.
  - id: roving
    name: Roving
    kind: activity
    enabled: true
    displayOrder: 20
    logMode: trace
    unit: km
    match: { kinds: [ride], requiresTrace: true, sources: any, measure: distanceKm }
    matchPriority: 100
    xpPerUnit: 60            # D-189, rescaled by 0158 to session parity at a 15 km ride
    softCapUnits: null
    sanityCeilingUnits: 200
    minUnitsForCredit: 0.5
    groundMultipliers: null
    revealsGround: false     # a bike must not be able to collect the map's reward
    feeds: [{ skill: constitution, rate: 0.3333 }]

  - id: cadence
    name: Cadence
    kind: activity
    enabled: true
    displayOrder: 25
    logMode: trace
    unit: km
    match: { kinds: [ride], requiresTrace: false, sources: any, measure: distanceKm }
    matchPriority: 100
    xpPerUnit: 60
    softCapUnits: null
    sanityCeilingUnits: 200
    minUnitsForCredit: 0.5
    groundMultipliers: null
    revealsGround: false
    feeds: [{ skill: constitution, rate: 0.3333 }]

  - id: might
    name: Might
    kind: activity
    enabled: true
    displayOrder: 30
    logMode: reps
    unit: rep
    match: { kinds: [strength, other], requiresTrace: any, sources: any, measure: "reps:pushup" }
    matchPriority: 100
    xpPerUnit: 4
    softCapUnits: 100        # per session, §3.5
    sanityCeilingUnits: 600
    minUnitsForCredit: 1
    groundMultipliers: null
    revealsGround: false
    feeds: [{ skill: constitution, rate: 0.3333 }]
    exercises:               # NESTED in the skill that owns them (02 §3.2), not top-level:
      - id: pushup           # the YAML is seeded VERBATIM into T5, so the file's shape and
        label: Pushups       # the item's shape are one shape. A `skill:` back-reference
        entry: count         # would be a second place the mapping could disagree.
        quickValues: [10, 20, 25, 50]

  - id: cartography
    name: Cartography
    kind: meta               # meta skills are NEVER matched — they arrive via `feeds`, or
    enabled: true            # via the fog subsystem's derived award (02 §3.4, 05 §8.2)
    displayOrder: 60
    logMode: derived
    unit: cell               # H3 res-10 (D-115)
    match: null
    xpPerUnit: 15
    unitMultipliers: { new: 1.0, rearmed: 0.5, recent: 0.0 }   # D-120 discovery credit
    softCapUnits: null
    sanityCeilingUnits: null
    minUnitsForCredit: 0
    groundMultipliers: null
    revealsGround: null      # null on meta rows; required on every activity row
    feeds: []

  - id: constitution
    name: Constitution
    kind: meta
    enabled: true
    displayOrder: 70
    logMode: derived
    unit: share
    match: null
    xpPerUnit: 1             # the share arrives pre-computed; the rate is on the FEEDER row
    softCapUnits: null
    sanityCeilingUnits: null
    minUnitsForCredit: 0
    groundMultipliers: null
    revealsGround: null
    feeds: []                # Constitution feeds nothing — §1.1, and 02 §3.8 check 2
```

**Adding a workout type is exactly this diff** — no code:

```yaml
  - id: pullups
    name: Grip                 # new activity skill
    kind: activity
    displayOrder: 45
    logMode: reps
    unit: rep
    match: { kinds: [strength, other], requiresTrace: any, sources: any, measure: "reps:pullup" }
    matchPriority: 100
    xpPerUnit: 8               # heavier than a pushup: full bodyweight, smaller muscle base
    softCapUnits: 50
    sanityCeilingUnits: 300
    minUnitsForCredit: 1
    feeds: [{ skill: constitution, rate: 0.3333 }]
# ...and one row in `exercises:`
  - id: pullup
    label: Pull-ups
    skill: grip
    entry: count
    quickValues: [5, 10, 15]
```

#### The proof: Wayfaring vs Vigil, side by side (D-141 / D-132)

The whole point of the amendment is that these two rows are now distinguishable **by data
alone**. Vigil (D-132, GPS-less running) is added as this row and nothing else:

```yaml
  - id: vigil
    name: Vigil                # provisional (D-132) — a display string, never an identifier
    kind: activity
    displayOrder: 15
    logMode: trace             # same kernel: a distance-measured effort
    unit: km
    match: { kinds: [run, walk, hike], requiresTrace: false, sources: any, measure: distanceKm }
    matchPriority: 100
    xpPerUnit: 100             # D-132: FULL activity XP, identical to Wayfaring
    groundMultipliers: null    # not ground-scored — there is no ground
    softCapUnits: null
    sanityCeilingUnits: 300
    minUnitsForCredit: 0.25
    feeds: [{ skill: constitution, rate: 0.3333 }]
```

Every field of both rows, complete:

| field | `wayfaring` | `vigil` |
|---|---|---|
| `id` | `wayfaring` | `vigil` |
| `name` | Wayfaring | Vigil *(provisional, D-132)* |
| `kind` | `activity` | `activity` |
| `enabled` | `true` | `true` |
| `displayOrder` | `10` | `15` |
| `logMode` | `trace` | `trace` |
| `unit` | `km` | `km` |
| `match.kinds` | `[run, walk, hike]` | `[run, walk, hike]` |
| **`match.requiresTrace`** | **`true`** | **`false`** ← **the entire discriminator** |
| `match.sources` | `any` | `any` |
| `match.measure` | `distanceKm` | `distanceKm` |
| `matchPriority` | `100` | `100` |
| `xpPerUnit` | `100` | `100` *(D-132: full XP, not half)* |
| `groundMultipliers` | `{new: 1.0, rearmed: 0.5, recent: 0.5}` (D-120) | `null` — **not ground-scored**, which is a different claim from `{1,1,1}` |
| `softCapUnits` | `null` | `null` |
| `sanityCeilingUnits` | `300` | `300` |
| `minUnitsForCredit` | `0.25` | `0.25` |
| `feeds` | `[{constitution, 0.3333}]` | `[{constitution, 0.3333}]` |

One field separates them, and it is read off `Activity.hasTrace` — a field the ingestion
contract already defines and `02-data-model.md` T3 already stores. **No new type, no new
concept, no code.** Equal `matchPriority` is safe here because `requiresTrace: true` and
`requiresTrace: false` make the two rows mutually exclusive: no activity is ever a candidate for
both, so the tie-break never fires. `02-data-model.md` §3.8 check 3 asserts exactly that,
across every `ActivityKind` × `hasTrace` combination, on every build.

**D-132's third clause needs no field at all.** "Zero discovery credit, no map reveal" is not
configured anywhere — it *falls out*:

> `hasTrace: false` ⇒ `traceRef: null` ⇒ no trace ⇒ no H3 projection ⇒ `cells.size == 0` ⇒
> no `ExploredCell` write ⇒ no generation bump ⇒ **no Cartography award** (05 §3.6).

Adding a `grantsDiscovery: false` flag would be a second, redundant statement of the same fact,
and a place for the two to disagree. There is deliberately no such field.

> **AMENDED 2026-09-04 (D-189, ticket `0157`) — a `revealsGround` field now exists, and this
> passage is still right.**
>
> The paragraph above refuses a flag **for Vigil**, and the reason is redundancy: a traceless
> activity has no cells, so the flag would restate what `hasTrace: false` already settles.
> That reasoning holds and is unchanged.
>
> **Roving — cycling with a trace — is the case it does not cover.** A road ride has a real
> trace and real cells, and the decision that they must not be written is information that
> exists **nowhere else in the data**. Nor can it live in code: "only `[run, walk, hike]`
> reveal" is a hardcoded list of kinds, which is the `switch` this whole section outlaws.
>
> So the test §1.3 applies is the right test, and `revealsGround` passes it where
> `grantsDiscovery` failed it. The field is required on every activity row — including Vigil,
> where it is admittedly redundant — because a reader should not have to reason about
> tracelessness to learn whether a skill opens the map, and because a validator that demands
> it everywhere is what stops a future row omitting it silently. **It has no default**: the map
> never re-fogs (D-020), so a cell revealed by a forgotten line is revealed for ever. The activity row still
records `cellCount: 0` so the shape never varies. This also settles the provisional
"treadmill = half Wayfaring XP" suggestion in `05-fog-of-war.md` §3.6/§9.1: D-132 overrides it —
full XP into a separate skill.

**Verdict: Vigil is one YAML row, one seeded registry item, zero lines of code.**

#### `match` must exist in `xp-rules-v1.yaml` before any scoring code is written

Not "before Vigil ships" — **before the first line of the scorer**. This is a sequencing
requirement, not a preference. If the scorer is written against the un-amended schema it will
contain the `hasTrace ? "wayfaring" : "vigil"` branch, and retrofitting selection into data
afterwards means rewriting the scorer *and* reissuing a rules version, because every ledger row
already written cites a `xpRulesVersion` whose rows lack `match`. `v1` ships with `match` on
every activity skill from the very first seed. `02-data-model.md` §3.6 files this as a blocking
implementation item; §3.8 check 5 wires the D-132 regression test into CI permanently, so the
"adding a workout type touches zero code" property cannot rot.

#### RESOLVED (ticket `0031`, D-191): one `measure` per row. A skill needing two quantities is two rows.

This was carried as an open item — *"whether `match` becomes a list or `measure` accepts a set"* —
and it is now settled, because the matcher shipped and the answer follows from it rather than from
taste.

**Why it cannot be a set.** `selectActivitySkills` (`02-data-model.md` §3.4) groups candidates
**by `measure`** and returns one skill per distinct measure. That grouping is exactly what lets a
single strength session train Might *and* Fortitude — different measures — while a run trains one
distance skill. A row carrying two measures has **no defined position in that grouping**: it would
belong to two groups, win or lose each independently, and could be selected for one of its
measures and not the other. There is no sensible tie-break for a row that is half-selected.

**So: one row, one measure.** A skill that genuinely owns two quantities — a movement scored on
both reps and seconds — is two rows that happen to share a display name. That costs a `displayOrder`
and a line, and it keeps the matcher's grouping total.

**This is not a limitation to route around later.** It is the same shape as the rest of the schema:
the general mechanism is rows, and the answer to "I need one row to do two things" is two rows.
`02-data-model.md` §3.7's closed set of four kernels is the same principle at the layer below.

Consequences the implementation must respect:

- The skill list is **never** hardcoded. No enum, no union type, no `switch` on skill id.
  Skills are rows; the UI iterates them.
- **Selection is data too** (D-141). Which activities a skill consumes is `match`, evaluated by
  one generic matcher (`02-data-model.md` §3.4) that never names a skill. The matcher must be
  **total and deterministic** — same activity + same `rulesVersion` ⇒ same skills, no clock, no
  RNG — because §7.4 replay soundness depends on it.
- Total Level and Total XP iterate the registry, so a new skill lifts the ceiling automatically.
  A new skill starts at level 1 with 0 XP — Total Level goes *up* by 1, never down.
- **That free point must never fire a level-up celebration (D-146), and the guard belongs at the
  NOTIFICATION layer, not the scoring layer** (`06-ui-ux.md` §5.4 and §10.5). The increment is
  real bookkeeping and the scorer is right to produce it; what would be wrong is the app
  congratulating you for a row someone added. Guarding it in the scorer would mean the scorer
  lying about Total Level — and Total Level is asserted to only ever rise (§4.1), so a scorer that
  suppressed the point would have to suppress it for ever, in every replay. **Every future skill
  row trips this**, which is why it is a standing property rather than a Vigil quirk;
  ticket `0159` asserts it once the notification layer exists.
- D-061 already anticipated this: an "Add workout" button opening a page of one-row-per-type,
  chosen precisely so a seventh exercise does not clutter the home screen.
- Cartography's `unit: cell` and Wayfaring's `unit: km` sharing one schema is the proof the
  schema is general enough. If a future skill needs a shape this schema cannot express, add a
  `logMode`, not a special case. **Four kernels exist and the set is closed** (`trace`, `reps`,
  `duration`, `derived`); adding a fifth is the one event that legitimately requires code
  (`02-data-model.md` §3.7). Note that a schema passing this "general enough" test can still be
  missing a job entirely — it passed it before `match` existed.

---

## 2. The XP curve

### 2.1 Runescape's actual curve, and why it cannot be used

Runescape's formula, verified:

```
XP(L) = floor( (1/4) * Σ_{i=1}^{L-1} floor( i + 300 * 2^(i/7) ) )
```

| Level | 10 | 20 | 30 | 50 | 70 | 80 | 90 | **99** |
|---|---|---|---|---|---|---|---|---|
| Cumulative XP | 1,154 | 4,470 | 13,363 | 101,333 | 737,627 | 1,986,068 | 5,346,332 | **13,034,431** |

Level 99 = **13,034,431 XP**, confirmed. The curve is essentially `XP ∝ 2^(L/7)` — it doubles
every 7 levels.

**It does not survive contact with real training volume.** Here is what happens if we adopt it
verbatim, feeding it this user's real running at 100 XP/km:

| Runescape level | Time to reach, at 1,841 km/yr |
|---|---|
| 30 | 0.1 years |
| 50 | 0.8 years |
| 70 | 6.7 years |
| 80 | 18.8 years |
| 90 | 51.4 years |
| **99** | **126 years** |

The user would hit level 52 in year one, then spend the rest of their life crawling from 52 to 77.

**Why, precisely.** In Runescape the *input rate scales with the output*. A level-1 player earns
maybe 10k XP/hour; a level-99 player using endgame methods earns 500k–1M+ XP/hour. The
exponential curve is matched by exponentially growing income, so the wall-clock time per level
stays roughly constant. Running has no such loop. You cannot unlock a better kilometre. A
kilometre at level 90 is the same kilometre as at level 10.

The diagnostic number is the **top-to-middle ratio**:

- Runescape: `XP(99) / XP(50) = 128.6`. If level 50 takes 1 year, level 99 takes **129 years**.
- What we need: level 50 around year 1, level 99 around year 10–12 → a ratio of roughly **8–12**.

Note that rescaling XP per km cannot fix this. Multiplying all XP by *k* moves every level
earlier by the same factor; the *ratio* is a property of the curve alone. **The curve must change.**

### 2.2 The Lost Soles curve

> **XP required to advance from level L to level L+1 = 4 × L²**
>
> Cumulative XP to *be* level L: `C(L) = 2·(L−1)·L·(2L−1) / 3`  (always an integer)

That is a cubic in cumulative terms, `C(L) ≈ (4/3)L³`, versus Runescape's exponential. It is
the simplest formula that produces the right shape, and it is memorable enough to put in the
UI ("this level costs 4L² — 32,400 XP at level 90").

| Level | 5 | 10 | 20 | 25 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | **99** | 110 | 120 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Cumulative XP | 120 | 1,140 | 9,880 | 19,600 | 34,220 | 82,160 | 161,700 | 280,840 | 447,580 | 669,920 | 955,860 | **1,274,196** | 1,750,540 | 2,275,280 |
| Step to next | 100 | 400 | 1,600 | 2,500 | 3,600 | 6,400 | 10,000 | 14,400 | 19,600 | 25,600 | 32,400 | 39,204 | 48,400 | 57,600 |

`C(99) / C(50) = 7.88`. Sixteen times gentler than Runescape's tail.

**Level 99 costs 1,274,196 XP.** A seven-figure number is deliberate: the top of the curve
should read as a monument, and "the million XP mark" (around level 91) is a real landmark
on the way.

### 2.3 What this feels like in runs

Cost of the next level, expressed in the user's own 8.85 km runs:

| Level | XP for next level | = km | = runs |
|---|---|---|---|
| 9 → 10 | 324 | 3 | 0.4 |
| 24 → 25 | 2,304 | 23 | 2.6 |
| 49 → 50 | 9,604 | 96 | 10.9 |
| 74 → 75 | 21,904 | 219 | 24.8 |
| 89 → 90 | 31,684 | 317 | 35.8 |
| 98 → 99 | 38,416 | 384 | 43.4 |

Early levels arrive mid-run. The first run of the app's life takes Wayfaring to level 9.
By level 90 a level is a two-and-a-half-month campaign — which is correct, and which is exactly
why Total Level, Cartography and the strength skills carry the mid-game (§4.1).

### 2.4 Progression table — the actual math

**Assumptions, stated explicitly so they can be argued with:**

*Running* (the user's real data): 4 runs/week × 5.5 mi = 8.85 km/run → 35.4 km/week →
**1,841 km/year**.

*Strength* — the brief says "modest but regular"; I am assuming **3 sessions/week** of
**75 pushups** (3×25), **90 situps** (3×30), **180 plank-seconds** (2×90s). That is 11,700
pushups, 14,040 situps and 28,080 plank-seconds a year. If the real volume is half this, halve
the strength columns; the curve is unaffected.

*Ground mix* — the fraction of each run that is genuinely new decays as the city fills in, and
is then held up permanently by the 6-month re-arm (D-120). Modelled as:

| Period | new | re-armed (>6mo) | recent (<6mo) |
|---|---|---|---|
| month 1 | 85% | 0% | 15% |
| months 2–3 | 62% | 2% | 36% |
| months 4–6 | 46% | 6% | 48% |
| months 7–12 | 34% | 14% | 52% |
| year 2 | 24% | 28% | 48% |
| year 3 | 18% | 36% | 46% |
| years 4–5 | 14% | 40% | 46% |
| year 6+ | 12% | 42% | 46% |

*Cell density* — H3 resolution 10 (D-115) averages ~15,048 m² per cell (~66 m edge). With a
~50 m soft-disc reveal radius (per R4's splatting), a kilometre of path sweeps a ~100 m
corridor ≈ 100,000 m² ≈ **6.5 cells/km**.

**Result:**

| | Wayfaring XP | **Way** | **Might** | **Fort** | **End** | Cartography XP | **Carto** | Constitution XP | **Con** | **TOTAL LEVEL** | Total XP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 month | 14,189 | **22** | 14 | 14 | 14 | 12,713 | **21** | 8,369 | **18** | **103** | 46,192 |
| 3 months | 39,040 | **31** | 21 | 20 | 20 | 31,558 | **29** | 23,933 | **26** | **147** | 127,291 |
| 6 months | 72,634 | **38** | 26 | 25 | 25 | 53,544 | **34** | 46,051 | **33** | **181** | 237,750 |
| **1 year** | 134,301 | **47** | 33 | 32 | 32 | 90,337 | **41** | 88,447 | **40** | **225** | 444,126 |
| 2 years | 248,431 | **57** | 41 | 40 | 40 | 158,538 | **49** | 170,170 | **50** | **277** | 839,220 |
| **3 years** | 357,038 | **64** | 47 | 46 | 46 | 223,150 | **55** | 250,052 | **57** | **315** | 1,223,362 |
| 5 years | 566,889 | **75** | 56 | 54 | 54 | 345,196 | **64** | 407,363 | **67** | **370** | 1,974,648 |
| 10 years | 1,082,313 | **93** | 71 | 68 | 68 | 641,334 | **78** | 797,571 | **84** | **462** | 3,831,619 |
| 15 years | 1,597,737 | **106**† | 81 | 78 | 78 | 937,473 | **89** | 1,187,779 | **96** | **528** | 5,688,590 |

† past 99 — see §2.5.

Time to **99 Wayfaring: 11.9 years.** 99 Constitution: ~16 years.

**Checked against the calibration targets:**

- *Visible progress every session* — ✅ at low levels literal level-ups; at all levels Total XP
  and the cell counter. See §4.1 for the mid/late-game guarantee, which is a UI problem, not a
  curve problem.
- *Level 20–30 within the first couple of months* — ✅ Wayfaring **22 at one month, 27 at two
  months**, Cartography 21/26, Total Level 103 after month one. Dead centre of the target.
- *99 as a genuine multi-year achievement* — ✅ 11.9 years at *current* volume.

**[JUDGMENT CALL — the one most worth reviewing]** The curve constant `4` in `4L²` is the
single dial that sets the whole timeline, and it rescales the table linearly.

| constant | L @ 1 mo | L @ 2 mo | 99 Wayfaring |
|---|---|---|---|
| `3L²` | 24 | 30 | **8.8 years** |
| **`4L²` (chosen)** | **22** | **27** | **11.9 years** |
| `5L²` | 20 | 25 | 14.9 years |

I chose 4 because it lands the two-month hook in the middle of the requested 20–30 band rather
than at its edge, and because 12 years is a defensible reading of "genuine multi-year". If 12
years reads as *unreachable* rather than *monumental*, change one number to 3 and the entire
table rescales by 0.75 — no other consequence. This is exactly the kind of change §7 is built
to make safe. It is also worth noting that the table assumes **flat volume forever**; any real
increase in mileage pulls 99 in.

**A note on the strength skills.** At the assumed modest volume, 99 Might takes 27 years. That
is not a bug — it is the system telling the truth. 99 Might in 10 years requires 612 pushups a
week (about 200 per session, 3×/week). That is a real, legible, achievable training target that
the app is now quietly proposing, which is a better use of the number than inflating the rate.
**[JUDGMENT CALL]** I would rather the strength skills be honestly slow at low volume than
hand out levels for 75 pushups a week.

### 2.5 Past 99

Levels 1–99 are the game, exactly as in Runescape. Reaching 99 in a skill awards **Mastery**:
a permanent gold-leaf crest beside the skill, and a landmark on the map.

Because this user may still be running in year 20, the same `4L²` formula continues to
**level 120** ("Deep levels"), unlocked and displayed only after 99. 99→120 is another
1,001,084 XP — roughly nine more years of Wayfaring. This mirrors Runescape's own 99/120
convention and costs nothing to implement: it is `maxLevel` vs `deepMaxLevel` in the ruleset.

There is no prestige, no reset, no seasonal wipe. **D-020's spirit is total: the map only ever
grows, and so do the numbers.**

---

## 3. XP awards, exactly

### 3.1 Ground classification (D-120)

Every explored cell carries its visit history. Discovery scoring is a function of
`now − lastRunAt` (D-120's own stated implication). Three classes:

| Class | Condition | Wayfaring XP | Cartography credit |
|---|---|---|---|
| **New** | cell has never been entered | **100%** | **100%** (15 XP/cell) |
| **Re-armed** | `lastRunAt` more than 6 months ago | **50%** | **50%** (7.5 XP/cell) |
| **Recent** | `lastRunAt` within 6 months | **50%** | **0%** |

The map **never re-fogs** (D-120). Re-armed ground is visually identical to any other explored
ground; only its *credit* re-arms. If we want to surface it at all, it is a subtle warmth/coolness
in the parchment tint on the atlas layer — but that is a §04-map decision, not this document's.

**Attribution algorithm.** For each consecutive pair of trace points, take the midpoint,
resolve its H3 res-10 cell, classify that cell, and attribute the segment's length to that
class. Distance is therefore split three ways and multiplied piecewise. Cell counts for
Cartography are of *distinct* cells touched in the activity, classified by their state
**before** this activity. A cell touched twice in one run counts once.

Because `CellVisit` is append-only (D-020), the classification is derivable at any time from
history alone — nothing needs to be denormalised, and a rebalance can recompute it (§7).

### 3.2 Rates, and why these ratios

| Skill | Unit | XP per unit | A typical session |
|---|---|---|---|
| Wayfaring | km | **100** | 8.85 km fully new = 885 |
| Vigil | km | **100** | identical to Wayfaring, deliberately — D-132 |
| Roving | km | **60** | 15 km = 900 (`0158`) |
| Cadence | km | **60** | identical to Roving, as Vigil is to Wayfaring |
| Might | pushup | **4** | 75 = 300 |
| Fortitude | situp | **3** | 90 = 270 |
| Endurance | plank-second | **1.5** (90/min) | 180 s = 270 |
| Cartography | new cell | **15** | 58 cells = 870 |
| Constitution | — | 1/3 of activity XP | run 295 / strength 280 |

**100 XP/km is the anchor**, chosen to be legible: a kilometre is a hundred, a mile is 161,
a 5-mile run is about 800. Every other rate is derived from it.

**Cross-discipline fairness — the reasoning, because this is the biggest judgment call in §3.**

The obvious anchor, *metabolic equivalence*, is wrong and should be rejected loudly. Running
costs roughly 1 kcal/kg/km — about 60 kcal per kilometre. A pushup costs about 0.4 kcal. By
that measure one kilometre ≈ 150 pushups, and a hard 100-pushup session would be worth
**67 XP**, less than a warm-up jog. Metabolic honesty produces a game nobody plays.

The anchor I chose is **session parity**: *one typical hard session of anything should be
worth about the same total XP as one typical hard session of anything else.*

- Typical run: 8.85 km → **885 XP** (fully new ground) or ~500 XP (mostly repeat).
- Typical strength session: 75 pushups + 90 situps + 180 s plank →
  300 + 270 + 270 = **840 XP**.

Those match, deliberately. Within the strength session, the internal ratios are:

- **Pushup 4 > situp 3.** A pushup moves ~65% of bodyweight through a longer range with more
  muscle mass involved; a situp moves the trunk only. A 4:3 ratio is a modest, defensible
  acknowledgement of that without pretending to be a physiologist.
- **Plank 1.5 XP/s = 90 XP/min = 22.5 pushups per minute of plank.** A hard minute of plank and
  a set of ~22 pushups are comparable work. This also makes the three strength skills level at
  nearly the same rate under the assumed volume, which looks tidy and coherent on the skill
  panel and means a strength session usually produces *some* level-up somewhere.

**Cartography is tuned to parity with Wayfaring, on purpose.** At 6.5 cells/km × 15 XP,
a kilometre of brand-new ground yields ~97.5 Cartography XP against Wayfaring's 100. The
statement is clean and memorable: **a kilometre of new ground is worth roughly double —
once in Wayfaring, once in Cartography.** Since novelty is the stated core motivator (D-012),
the highest-value thing the user can do is exactly the thing they already want to do.

**Objection I want on the record:** measured *per minute of clock*, strength beats running by
roughly 4×. Running at ~6 min/km is ~17 XP/min; a 5-minute pushup block is ~60 XP/min. Two
reasons I am accepting that: (a) time-under-load is not clock time, and pushup sets are dense
where a run is not; (b) D-123 removes any fraud concern — this is a private, single-user app
and there is no one to out-grind. If the user finds strength feels *cheap*, the fix is to halve
the strength `xpPerUnit` values, which is a one-line ruleset change.

### 3.3 Cartography, specifically

`CartographyXP = 15 × (new cells) + 7.5 × (re-armed cells)`. Recent cells contribute nothing
(D-120).

**Why Cartography does not die.** The obvious failure mode: the user maps their whole city in
three years and the skill flatlines forever. The 6-month re-arm is what prevents it. At steady
state (year 6+), 42% of a typical run is on re-armed ground, worth 7.5/cell — a permanent
floor of ~31 Cartography XP/km even after every street nearby is known. And because the re-arm
is a *rotation* incentive, it pushes the user to spread their routes across the whole map
instead of grinding the same three loops, which is the behaviour D-012 says they want anyway.

This is the mechanism that makes the whole system survive year five. It is worth protecting in
any future rebalance.

### 3.4 Constitution

`ConstitutionXP = floor( Σ (activity-skill XP awarded this session) / 3 )`.

Computed on **post-multiplier** XP — i.e. after the ground multipliers and after any soft caps.
Meta-skill XP (Cartography, Slayer) does **not** feed Constitution: Constitution is total
*physical volume*, and cells are not exercise.

Rounding is floor, once, on the session total — never per-skill, to avoid rounding drift.

### 3.5 Degenerate cases

**D-123 means no anti-cheat.** Everything below exists to stop *accidental nonsense* — GPS
jitter, a fat-fingered zero, a forgotten stopwatch — from corrupting a permanent record. None
of it is adversarial, and none of it should ever show the user an accusatory message.

**GPS noise (the important one).** A trace left running while the user stands still generates
tens of metres of phantom movement per minute and can spuriously reveal cells forever (D-020:
reveals are permanent, so a bad reveal is a permanent scar).

1. Drop trace points with reported `accuracy > 30 m`.
2. Drop segments implying speed > 7 m/s (25 km/h) — GPS spikes and car rides. Bridge the gap
   rather than splitting the activity.
3. Drop segments implying speed < 0.3 m/s sustained over > 60 s (standing still).
4. Require a segment length ≥ 5 m before it contributes distance or reveals cells.
5. Cell reveal requires the *filtered* path to actually pass within the reveal radius; a single
   surviving jitter point does not reveal.

These filters run in the derived layer, not on the raw trace. **Raw traces are stored untouched
in S3** (D-101, D-121 mitigation 2) so a better filter can be applied later by recomputation.

**Very short activities.** No minimum for XP — a 400 m shakeout run earns 40 Wayfaring XP and
that is correct; it happened. But `minUnitsForCredit` (0.25 km) gates *discovery*: below that,
no cells are revealed and no Cartography is awarded. Rationale: the sub-250 m case is
overwhelmingly a mis-started or mis-stopped recording, and a bad reveal is permanent while a
lost 40 XP is not.

**Absurd manual entries.** Two layers, both soft:

*Soft cap on rep/duration skills* (`softCapUnits = S`). Effective units:

```
effective(n, S) = min(n, S)
                + 0.50 × clamp(n − S,   0, S)
                + 0.25 × clamp(n − 2S,  0, 4S)
```

Maximum effective value is `2.5 × S`, reached at `n = 6S`. With S = 100 pushups:

| entered | 50 | 100 | 150 | 200 | 300 | 500 | 1,000 | 5,000 |
|---|---|---|---|---|---|---|---|---|
| effective | 50 | 100 | 125 | 150 | 175 | 225 | 250 | 250 |
| XP | 200 | 400 | 500 | 600 | 700 | 900 | 1,000 | 1,000 |

A normal session (75 pushups) never touches the cap. A genuinely huge session (200) still gets
1.5× a normal one. A typo (5,000) is bounded at 2.5× a normal session instead of 67×.

**[JUDGMENT CALL]** Diminishing returns within a session is mildly anti-realistic — the 200th
pushup is harder than the 20th, not easier. I am using it anyway because it solves the typo
problem *and* the "one absurd session dwarfs a year of running" problem with a single mechanic
and no error dialogs, which fits D-013 far better than a confirmation prompt would. If the user
dislikes it, the alternative is `softCapUnits: null` plus a hard `sanityCeilingUnits` clamp,
which is blunter but simpler.

*Sanity ceiling on distance.* No soft cap on running — an ultramarathon should be paid in full,
and distance is self-limiting in a way reps are not. Instead, a single activity over
`sanityCeilingUnits` (300 km) is ingested and paid in full but **flagged in the chronicle**
with a one-tap "that's right / that's wrong" affordance. Never blocked, never silently altered.

**Manual (traceless) distance entry — treadmills.** Allowed. Awards full Wayfaring XP at
100 XP/km and **zero Cartography**, because nothing was revealed. Thematically exact: you ran,
but you saw nothing new. It also means a treadmill winter does not break the streak of
progress, only the streak of discovery.

**Duplicate imports.** Deduplicate on `(source, sourceActivityId)` and, for file imports, on
`(startedAt ± 60 s, distance ± 1%)`. A double-import must never double-award — this is a
correctness requirement, not a balance one.

---

## 4. Levels, milestones and feedback

### 4.1 The guarantee

**Every session must show at least one thing that visibly moved.** This is the product's
central promise and the curve alone does not deliver it — at Wayfaring 90, a run is 1.8% of a
level, which is two pixels on a progress bar.

Four layers, in increasing frequency, so that something is always in motion:

| Layer | Cadence at year 1 | Cadence at year 10 |
|---|---|---|
| A single skill level-up | every ~3 runs | every ~30 runs |
| **Total Level** ticks | most weeks | every ~2 weeks |
| Cells revealed counter | **every run** | **every run** |
| Total XP | **every session** | **every session** |

The two guaranteed-every-session numbers are **cells revealed** and **Total XP**. Both are
displayed prominently and permanently. Neither can ever be zero for a real activity.

Additionally, progress bars must show **"~9 runs to level 48"**, not just a percentage. A
percentage that moves 1.8% reads as nothing; "9 runs away" reads as a plan.

### 4.2 The import moment — "Return from the Fog"

This is the core reward loop. It is the entire reason the user opens the app. It should be a
**sequence, not a screen**, roughly 8–10 seconds, skippable by tap, and it should never require
a decision.

1. **The map, first. Always first.** (~2.5 s) The run draws itself as a travelling point of
   lantern light along the actual route, at speed, and the fog burns back behind it in the soft
   discs of R4's splatting. Newly revealed ground blooms warm; re-armed ground glows briefly
   and settles. This is the payoff for D-012 and it must never be preceded by a numbers panel.
   *If we only ever get one thing right in this app, it is this 2.5 seconds.*

2. **The tally.** (~3 s) The camera pulls back and an itemised ledger counts up, one row at a
   time, in the gold-on-navy of D-050:

   ```
   Wayfaring      +576      ▓▓▓▓▓▓▓░░░  L47   8,003 to 48
   Cartography    +375      ▓▓▓▓▓░░░░░  L41   4,572 to 42
   Constitution   +192      ▓░░░░░░░░░  L41 ↑  6,645 to 42
   ─────────────────────────────────────────────────────
   21 cells claimed · 8 remembered · 3.18 km never run before
   ```

   Rows are itemised by *reason*, not just by skill, on tap: `318 new ground · 62 remembered ·
   196 familiar`. The user should always be able to see *why* a number is what it is. This falls
   out for free from the `XpLedger` design in §7.

3. **Level-ups interrupt.** A level-up stops the tally and takes the screen: a gold-leaf card,
   the skill's sigil, the old number crossfading to the new. One card per level, queued. This is
   the only moment in the app permitted to be loud.

4. **A line of chronicle.** (~1 s) One generated sentence, in the voice of the setting, drawn
   from the session's most distinctive fact:
   - *"Thirty-eight paces in a hundred fell on roads that had never felt your step."*
   - *"You returned to Ashgrove Lane after two hundred and eleven days. It remembered you."*
   - *"The longest road you have walked in a year."*

   These come from a template table keyed off computed facts (new-ground %, longest gap
   re-armed, personal-best distance, cell milestones). It is cheap, it is data, and it is the
   thing that makes the app feel like it is *paying attention*.

5. **One nudge, never a chore.** (D-013) A single line at the bottom: the nearest unexplored
   frontier and how far away it is. `Unclaimed ground 1.2 km north — Millbrook.` Tapping it
   seeds the route planner (D-070). Ignoring it costs nothing and it never nags, never repeats,
   never turns red.

**What must NOT be here:** no streak counter, no "you missed 3 days", no daily goal ring, no
comparison to anyone (D-011), no prompt to log something else, no confirmation dialogs.

### 4.3 Milestone levels

Per skill:

| Level | Name | Reward |
|---|---|---|
| 10 | *Initiate* | The skill's sigil unlocks (before this it is a blank seal) |
| 25 | *Journeyman* | Sigil gains colour |
| 50 | *Adept* | Halfway plate; a map landmark placed where the level was earned |
| 75 | *Veteran* | Gear slot unlock (post-MVP, §6) |
| 90 | *Elder* | — |
| **99** | **Mastery** | Gold-leaf crest, permanent. A shrine on the map at the exact cell. |
| 120 | *Deep Mastery* | — |

Milestones tied to *place* are the strongest ones this app has, because they cost nothing to
maintain and they are visible forever on a map the user already looks at. **Every milestone that
can be a landmark should be a landmark.**

Total Level milestones: **100, 150, 200, 250, 300, 400, 500**, then the ceiling (§1.2 — **891**
at `v1`; count the enabled rows, do not quote this number).

> **The ladder has a gap above 500, and it was not designed in.** These milestones were chosen
> against a 594 ceiling, where 500 was the last rung before the top. The ceiling is now 891, so
> there is a 391-point run with nothing in it — the stretch where a mid-game player spends the
> most time. Adding rungs is a design decision about pacing, not arithmetic, so it is **not** made
> here: it belongs to `0063`, which owns Total Level maths. Recorded rather than quietly patched,
> because a ladder that silently stops paying out is exactly the mid-game emptiness §1.2 says
> Total Level exists to prevent.
Under the model, Total Level 100 lands in **month one** — the first milestone should arrive
before the honeymoon ends, and it does.

Territory milestones, which are the ones most aligned with D-012 and are entirely independent
of the XP curve:

- 100 / 1,000 / 10,000 / 50,000 / 100,000 cells revealed.
- **"Every street in <neighbourhood>"** — completion of a named administrative or OSM
  neighbourhood polygon. This is the single most motivating milestone type available to this
  app (it is why CityStrides and Wandrer work) and it should be built as soon as the fog is.
- First 5 km / 10 km / 25 km from home, in each compass direction.
- Total distance: 100 / 500 / 1,000 / 5,000 / 10,000 / 20,000 km. (20,000 km ≈ halfway around
  the world, and lands around year 11 — the same era as 99 Wayfaring. Pair them.)

### 4.4 Never punish

There is no XP loss, no decay, no de-levelling, no expiring buff, and no state that requires
maintenance. A three-month injury layoff costs nothing but time. When the user comes back, the
6-month re-arm has quietly made half the city interesting again, and the first run back is worth
more than the last run before. **The system's response to absence is to make returning better.**
That is the whole answer to Habitica (D-013).

---

## 5. Combat — POST-MVP

**Explicitly out of MVP** (D-122). Designed now so the MVP data model does not preclude it, and
so the Slayer skill row already exists in the ruleset (disabled).

Per **D-040** both systems ship: map encounters *and* boss quests.
Per **D-041** everything resolves automatically at import. The user never plays a battle,
never chooses an action, never opens a combat screen. Combat is something they *read about
afterwards*, in the chronicle. This is non-negotiable: a battle the user must play is the
Habitica trap (D-013).

### 5.1 Fiction

The fog is not weather. It is forgetting. Souls that lost their way are still out there in it,
and they have been out there long enough to become something else. Running a road remembers it,
and remembering it drags whatever is standing on it back into the light.

You are not killing monsters. **You are recovering people.** A defeated creature resolves into
the soul it used to be and returns home. A creature that escapes goes deeper, and becomes worse.

This is why the app is called Lost Soles and why the pun is load-bearing: the soles do the work.

### 5.2 Player Power

One scalar, derived from levels and gear, recomputed at import:

```
Power = round( 0.40 × Wayfaring
             + 0.30 × Constitution
             + 0.30 × mean(Might, Fortitude, Endurance) )
      + gearPower
```

It tracks roughly "your average level", which keeps it legible: Power ≈ 18 at one month,
≈ 41 at one year, ≈ 83 at ten years. The weighting says: running is the primary discipline,
total volume matters nearly as much, and strength is a real but secondary contributor —
consistent with an app whose subject is a runner.

### 5.3 Map encounters

**Spawning.** Deterministic, seeded, never stored as random state:

```
seed = hash(userId, h3CellIndex, floor(epochDays / 7))
```

A weekly epoch means the world repopulates every week without any scheduled job, any
notification, or any expiry the user must respond to. It also means **the entire creature
population is a pure function of (user, map, week)** — which is what makes §7's recomputation
safe.

- Candidate density: ~1 creature per **120 frontier cells**, where "frontier" = an explored
  cell adjacent to at least one unexplored cell, or an unexplored cell adjacent to an explored
  one. **Creatures live at the edge of the known world.** Deep in mapped territory there is
  nothing left to find; that is the point.
- Weighting toward long-fogged and remote ground, so the interesting fights are where the
  interesting running is.

**Encountering.** At import, the filtered trace is walked; a creature is encountered if the
path passes within **60 m** of its cell centre. Maximum **3 resolutions per activity** (the
post-run report must stay readable); surplus creatures simply remain for next time.

**Difficulty.** Threat is set relative to the player, so encounters neither trivialise at high
level nor become hopeless at low:

```
Threat T = clamp( Power + tierOffset + remotenessBonus, 1, 120 )
```

| Tier | Offset | Spawn weight | Win chance at parity |
|---|---|---|---|
| Wisp | −8 | 50% | 70% |
| Shade | −2 | 30% | 55% |
| Wraith | +6 | 15% | 35% |
| Revenant | +14 | 5% | 15% |

`remotenessBonus = min(6, floor(km from hearth / 4))` — the far edge of the map is dangerous.

**Resolution** (D-041), deterministic:

```
roll   = seededRandom( activityId, creatureId )        # uniform [0,1)
pWin   = clamp( 0.5 + (Power − T) / 40, 0.05, 0.97 )
win    = roll < pWin
SlayerXP = win ?  round(8 × T)  :  round(2 × T)
```

**A loss costs nothing.** No XP loss, no damage, no debuff (D-013). The creature "slips deeper":
it respawns next epoch one tier higher and further out, and the user still receives 25% Slayer
XP for having driven it off. The narrative reads as a near-miss, never a failure.

At Power 41 with ~2 resolutions per run, expected value is ~230 XP per encounter, ~460 XP/run — Slayer settles as a
mid-fast skill, permanently gated on running frontier ground, which is the behaviour we want.

### 5.4 Boss quests

The problem boss quests solve: **rest days and strength days must matter** (D-040). A boss is a
single long-running target that accepts damage from *anything*.

**Damage:**

```
damage = ( Σ activity-skill XP awarded this session )
       × affinity
       × ( 1 + 0.01 × SlayerLevel )
```

- Note it uses **activity-skill XP, not total XP** — Cartography does not damage bosses, so a
  pure strength day and a pure running day contribute on equal footing.
- `affinity` = **1.5** if the session's dominant skill matches the boss's stated weakness,
  otherwise **1.0**. Never below 1.0. A weakness is a bonus for variety, never a penalty for
  doing what you were going to do anyway.

**Sizing.** A typical week is ~4,800 activity XP (4 runs + 3 strength sessions). Because real
training volume is flat for life, **boss HP must not scale with player level** — if it did,
bosses would get slower forever. Instead HP is fixed per tier and the `(1 + 0.01 × Slayer)`
multiplier is what makes the player faster over the years.

| Tier | HP | Weeks at year 1 (Slayer ~40) | Weeks at year 10 (Slayer ~85) |
|---|---|---|---|
| I — a Stray | 15,000 | 2.2 | 1.7 |
| II — a Wanderer | 25,000 | 3.7 | 2.8 |
| III — a Herald | 40,000 | 6.0 | 4.5 |
| IV — the Long Forgetting | 75,000 | 11.2 | 8.4 |

One boss active at a time. Phases at 75% / 50% / 25% each unlock a line of the boss's story in
the chronicle and may rotate its weakness — a fully passive way to make the *middle* of a
multi-week quest have beats in it.

**On kill:** a guaranteed gear drop (§6), `SlayerXP = HP / 20`, and a **permanent shrine placed
on the map at the cell where the killing blow landed**. That shrine is the real reward. It costs
nothing to maintain, it is visible forever (D-020), and years later it is a memory of a specific
run on a specific street.

**No timers.** A boss has no deadline and cannot be failed. If the user does nothing for four
months, the boss is exactly where they left it.

---

## 6. Equipment and loot — POST-MVP

Out of MVP (D-122). **D-013 is the whole design brief here: upkeep is the enemy.**

### 6.1 Rules

1. **No inventory.** There is no bag, no capacity, no dropping, no selling, no repair, no
   durability, no consumables, no crafting.
2. **Nothing is equipped.** Each item belongs to exactly one slot and has exactly one scalar
   power value. The game *always* uses the highest-power item in each slot. Because "best" is
   totally ordered, there is no decision to make and therefore no chore. Acquiring a better item
   *is* equipping it.
3. **Items are a collection, not a loadout.** The gear screen is a display cabinet: what you
   own, where you found it, and on what date. It is a museum of runs.
4. **Nothing is ever lost or degrades.**

### 6.2 Slots and effects

| Slot | Unlocked at | Effect |
|---|---|---|
| **Soles** | Wayfaring 25 | `gearPower` |
| **Lantern** | Cartography 25 | **+reveal radius** (50 m base → up to +20%) |
| **Bracers** | any strength skill 25 | `gearPower` |
| **Cloak** | Total Level 200 | `gearPower`, and lowers loss severity in the chronicle |
| **Charm** | Slayer 75 | `gearPower`, plus one flavour effect (e.g. +1 max encounters/activity) |

`gearPower` is capped at **+15 total**, which is a meaningful but bounded shift in encounter
odds (about +37 percentage points of win chance at the extreme, from `(P−T)/40`).

**[JUDGMENT CALL — worth the user's attention]** I recommend that **gear grants no XP
multipliers at all.** The temptation is obvious (+5% Wayfaring XP feels good), but it is a trap
in this specific app:

- It compounds against a curve tuned in §2, so the 12-year figure quietly becomes 9 or 7.
- It makes historical XP non-comparable — "was that run big, or was I just wearing good boots?"
- It creates a reason to think about gear, which is exactly the upkeep D-013 forbids.

So gear affects **combat power, reveal radius, and appearance** — things that change what the
*map* does, not what the *numbers* mean. The Lantern is the best item in the game and it is the
one that literally lets you see further, which is the most on-theme reward this app can offer.

If the user wants XP-bearing gear anyway, the safe form is a **hard cap of +10% total**,
recorded per-activity in the ledger (§7) so history stays auditable.

### 6.3 Sources

| Source | Drop | Rate |
|---|---|---|
| Boss kill | guaranteed, tier-appropriate | 1 per boss |
| Map encounter win | random roll | ~4% (Wisp) to ~35% (Revenant) |
| Milestone level 75 | guaranteed, named item | once per skill |
| **First visit to a named landmark** | guaranteed, place-named item | once per landmark |

That last row is the one that matters most. An item called **"the Millbrook Lantern"**, found
because the user ran somewhere they had never been, is worth more emotionally than any drop
table, and it ties loot directly to D-012's novelty motivator. Landmarks come free from OSM
POIs (parks, bridges, trailheads, summits, water towers) — the map data is already there.

Every item records `foundOn` (date), `foundAt` (cell / place name) and `foundDuring`
(activity id). Tapping an item flies the map to where it was found.

---

## 7. Balance safety — rebalancing without rewriting history

The system will be mis-tuned on the first try. Everything above must be changeable in year three
without invalidating year one.

### 7.1 The invariant

> **Store facts. Derive XP. Never store XP as a fact.**

| Layer | Contents | Mutability |
|---|---|---|
| **Raw** | The original GPX/FIT in S3 (D-101, D-121). Never touched. | immutable |
| **Facts** | `Activity`, `Trace`, `CellVisit`, `StrengthSet` — what physically happened. | append-only |
| **Rules** | `xp-rules-vN.yaml` — every constant in this document. | versioned, immutable once shipped |
| **Derived** | `XpLedger`, `SkillState`, `EncounterResult`, `BossProgress`. | fully recomputable |

A rebalance is: write `xp-rules-v2.yaml`, run the replay job, done. **It is a recomputation,
not a data migration.** No fact is edited and no history is lost.

### 7.2 Facts, precisely

```
Activity      { id, userId, source, sourceActivityId, startedAt, durationSec,
                distanceMeters, rawS3Key, ingestedAt, xpRulesVersion }
CellVisit     { userId, h3Index, activityId, visitedAt }        # APPEND-ONLY (D-020)
StrengthSet   { id, userId, activityId, exerciseId, reps|seconds, performedAt }
```

**`CellVisit` being append-only is what makes D-120 recomputable.** The "was this ground run
within 6 months?" question is answered by looking at the *previous* `CellVisit` row for that
cell — it does not need a denormalised `lastRunAt` field, and it stays correct even if the
6-month window is later changed to 4 or 9 months. A `lastRunAt` column may exist as a **cache**
for map rendering, but it must never be the source of truth for scoring.

D-062 already requires the data model to accommodate sets from day one even though MVP logs a
single number — `StrengthSet` honours that.

### 7.3 The ledger

```
XpLedger { activityId, skillId, reason, units, unitsEffective,
           xpAwarded, xpRulesVersion, sequence }
```

`reason` ∈ `new_ground | rearmed_ground | recent_ground | reps | duration |
cells_new | cells_rearmed | constitution_share | slayer_win | slayer_loss | boss_phase`.

One row per (activity, skill, reason). This single table does three jobs:

1. It is the itemisation behind the post-run tally (§4.2), for free.
2. It is the audit trail for "why did I get that number".
3. It makes `SkillState` a pure `SUM` — so a rebalance is `DELETE FROM XpLedger; replay;` and
   nothing else in the system needs to know.

### 7.4 Replay determinism

For replay to be sound, everything downstream must be a pure function of facts + rules:

- Ground classification: from `CellVisit` history. ✅
- GPS filtering: from the raw trace + rule constants. ✅ (which is why filtering must live in
  the derived layer, §3.5, not be baked in at ingest)
- Encounter spawns: `hash(userId, cell, week)`. ✅ deterministic
- Encounter outcomes: `seededRandom(activityId, creatureId)`. ✅ deterministic — **no
  unseeded RNG anywhere in this design.** This is a hard requirement.
- Boss damage: from ledger XP. ✅
- Loot rolls: `seededRandom(activityId, creatureId, "loot")`. ✅

Replay order is `Activity.startedAt` ascending; ties broken by `Activity.id`.

### 7.5 Levels are memories — the high-water rule

A rebalance that *reduces* rates would de-level the user. That is unacceptable under D-013's
spirit: the app must never take something back.

```
SkillState { skillId, xp, level, levelHighWater }
displayedLevel = max(level, levelHighWater)
```

`levelHighWater` is set on every level-up and **never decreases**. If v2 makes pushups worth 3
instead of 4, a user who reached Might 40 stays Might 40 — they simply do not advance again
until their recomputed XP catches up. **[JUDGMENT CALL]** The alternative — showing the honest
recomputed level — is more truthful and I am rejecting it, because a number going down is
exactly the kind of small betrayal that makes people close an app for good.

### 7.6 Operational notes

- Ship the replay job in MVP, before it is needed. A recompute path that has never been run is
  not a recompute path.
- Volume is small enough that this is trivial: ~1,000 activities/year, ~250k `CellVisit` rows
  after a decade. A full replay is seconds, and fits the D-083 budget without special handling.
- Keep every shipped ruleset file forever, in the repo. `Activity.xpRulesVersion` records what
  the user *saw at the time*, which is what the chronicle should replay.
- Never rebalance silently. A rules change writes a chronicle entry: *"The rules of the world
  shifted on 12 March. Your deeds were re-measured; nothing was taken away."*

---

## 8. Worked examples

Unambiguous, end-to-end. This is the section to build from. All numbers use
`xp-rules-v1` as specified in §1.3 and §3.2.

### 8.1 The pipeline

```
1. Adapter (Strava, D-121) → normalized Activity + Trace           [D-100]
2. Archive raw payload to S3                                        [D-121 mitigation 2]
3. Dedupe on (source, sourceActivityId)                             [§3.5]
4. Filter trace: accuracy > 30 m, speed > 7 m/s, speed < 0.3 m/s,
   segment < 5 m                                                    [§3.5]
5. For each segment: midpoint → H3 res-10 cell → classify
   (new | rearmed | recent) from CellVisit history                  [§3.1, D-115, D-120]
6. Accumulate distance per class; accumulate distinct cells per class
7. Award Wayfaring:    Σ (class distance × 100 × classMultiplier)
8. Award Cartography:  15 × newCells + 7.5 × rearmedCells
9. Award Constitution: floor(activitySkillXP / 3)
10. Write CellVisit rows (append-only)                              [D-020]
11. Write XpLedger rows; recompute SkillState                       [§7.3]
12. (post-MVP) Resolve encounters, apply boss damage                [§5]
13. Render "Return from the Fog"                                    [§4.2]
```

### 8.2 Example A — a 5.2-mile run, 38% new ground

**Input.** Strava activity, 5.2 mi, filtered trace of 2,714 points.

```
distance = 5.2 mi × 1.609344 = 8.369 km
```

**Step 5–6 — ground classification.** The segment walk yields:

| Class | Distance | Distinct cells (state before this run) |
|---|---|---|
| New — never entered | 3.180 km (38.0%) | **21** |
| Re-armed — last run 211 days ago | 1.255 km (15.0%) | **8** |
| Recent — last run 34 days ago | 3.933 km (47.0%) | 26 |
| **Total** | **8.369 km** | 55 |

**Step 7 — Wayfaring.**

```
new       3.180 km × 100 XP/km × 1.0  = 318.0  → floor → 318
rearmed   1.255 km × 100 XP/km × 0.5  =  62.75 → floor →  62   (D-120: re-run ground is half)
recent    3.933 km × 100 XP/km × 0.5  = 196.65 → floor → 196   (D-120: re-run ground is half)
                                                          ─────
                                        Wayfaring total     576 XP
```

Floor **once per ledger row**, and define the skill total as the sum of the floored rows. The
itemisation the user reads then always adds up exactly, which matters because §4.2 shows it.

**Step 8 — Cartography.**

```
new cells        21 × 15.0 = 315.0
rearmed cells     8 ×  7.5 =  60.0      (D-120: 50% discovery credit past 6 months)
recent cells     26 ×  0   =   0.0      (D-120: zero discovery credit inside 6 months)
                             ───────
                              375 XP
```

**Step 9 — Constitution.**

```
activity-skill XP this session = 576  (Wayfaring only; Cartography is a meta skill)
floor(576 / 3) = 192 XP
```

**Step 11 — ledger rows written.**

| activityId | skillId | reason | units | xpAwarded |
|---|---|---|---|---|
| A-1041 | wayfaring | `new_ground` | 3.180 km | 318 |
| A-1041 | wayfaring | `rearmed_ground` | 1.255 km | 62 |
| A-1041 | wayfaring | `recent_ground` | 3.933 km | 196 |
| A-1041 | cartography | `cells_new` | 21 cells | 315 |
| A-1041 | cartography | `cells_rearmed` | 8 cells | 60 |
| A-1041 | constitution | `constitution_share` | — | 192 |

(318 + 62 + 196 = 576 Wayfaring; 315 + 60 = 375 Cartography.)

**Result.** Starting from the one-year state in §2.4:

| Skill | Before | Award | After | Level | Next level at | Remaining |
|---|---|---|---|---|---|---|
| Wayfaring | 134,301 (L47) | +576 | 134,877 | **47** | 142,880 | 8,003 (~14 runs) |
| Cartography | 90,337 (L41) | +375 | 90,712 | **41** | 95,284 | 4,572 |
| Constitution | 88,447 (L40) | +192 | 88,639 | **41 ↑** | 95,284 | 6,645 |

**Total Level +1. Constitution 40 → 41.** Level-up card fires (§4.2 step 3).

**What the user sees:**

```
        ⟡  RETURN FROM THE FOG  ⟡

   [2.5s: the route draws itself in lantern-light,
    fog peeling back in soft discs behind it]

   Wayfaring      +576   ▓▓▓▓▓▓▓░░░  47      8,003 to 48  (~14 runs)
   Cartography    +375   ▓▓▓▓▓░░░░░  41      4,572 to 42
   Constitution   +192   ▓░░░░░░░░░  41 ↑    6,645 to 42

   ┌──────────────────────────────┐
   │   CONSTITUTION   40 → 41     │
   └──────────────────────────────┘

   21 cells claimed · 8 remembered · 3.18 km never run before

   "You returned to Ashgrove Lane after two hundred and eleven days.
    It remembered you."

   Unclaimed ground 1.2 km north — Millbrook
```

*(post-MVP, §5: after step 2 the ledger would also carry up to 3 `slayer_win`/`slayer_loss`
rows, and 576 damage — ×1.47 at Slayer 47 = 847 — against the active boss.)*

### 8.3 Example B — a strength session, the next day

**Input**, logged via the "Add workout" page (D-061), one row per type:

```
Pushups   3 × 25  =  75 reps
Situps    3 × 30  =  90 reps
Plank     2 × 90s = 180 seconds
```

**Soft caps** (§3.5): 75 < S=100, 90 < S=120, 180 < S=300. **No cap applies.**
`unitsEffective = units` in all three rows.

**Awards.**

```
Might        75 reps    × 4    XP/rep =  300
Fortitude    90 reps    × 3    XP/rep =  270
Endurance   180 seconds × 1.5  XP/sec =  270
                                        ─────
activity-skill XP                        840
Constitution   floor(840 / 3)          =  280
```

**Result:**

| Skill | Before | Award | After | Level | Next level at | Remaining |
|---|---|---|---|---|---|---|
| Might | 63,000 (L36) | +300 | 63,300 | **36** | 64,824 | 1,524 |
| Fortitude | 56,700 (L35) | +270 | 56,970 | **35** | 59,640 | 2,670 |
| Endurance | 56,700 (L35) | +270 | 56,970 | **35** | 59,640 | 2,670 |
| Constitution | 88,639 (L41) | +280 | 88,919 | **41** | 95,284 | 6,365 |

**Cross-discipline sanity check** — the point of §3.2:

| | Total XP awarded | Skills advanced |
|---|---|---|
| Example A (8.37 km run, 38% new) | 576 + 375 + 192 = **1,143** | 3 |
| Example B (strength session) | 300 + 270 + 270 + 280 = **1,120** | 4 |

Within 2%. A hard run and a hard strength session are worth the same. That is the design target
from §3.2, and it is the number to re-check after any rebalance.

*(post-MVP: this session does 840 × 1.0 × (1 + 0.01 × 47) = **1,235 damage** to the active boss.
A day with no run still moves the quest — which is the entire reason D-040 asked for bosses.)*

---

## 9. Summary of judgment calls, for overruling

Everything here is a call I made that no decision covers. Each is cheap to reverse.

| # | Call | Where | Reverse by |
|---|---|---|---|
| 1 | **Reject Runescape's curve; use `4L²`.** 99 Wayfaring = 11.9 years. | §2.2 | Change `4` to `3` (99 in 8.8 yrs) or `5` (14.9 yrs). Rescales linearly, nothing else changes. |
| 2 | **Cross-discipline parity by *session*, not by calories.** A hard run ≈ a hard strength session ≈ ~1,100 XP. | §3.2 | Halve or double the rep/second rates in the ruleset. |
| 3 | **Gear grants no XP multipliers** — only combat power, reveal radius and appearance. | §6.2 | Add capped multipliers, ledger-recorded. |
| 4 | Strength skills are honestly slow at modest volume (99 Might = 27 yrs at 75 pushups × 3/wk). | §2.4 | Raise `xpPerUnit`, or leave it as an implicit training target. |
| 5 | In-session diminishing returns on reps (anti-realistic, but kills the typo problem without dialogs). | §3.5 | `softCapUnits: null` + hard sanity clamp. |
| 6 | **Levels never go down** on a rebalance (`levelHighWater`). | §7.5 | Show the honest recomputed level. |
| 7 | Cartography tuned to near-parity with Wayfaring per km of new ground. | §3.3 | Change `xpPerUnit` on the cartography row. |

## 10. Open questions for later documents

- **Reveal radius** is assumed at 50 m, giving 6.5 cells/km. It belongs to the map document
  (R4), but every Cartography number here scales with it linearly. If it lands at 30 m,
  Cartography XP/cell should rise to ~25 to preserve the parity in §3.3.
- **Walking vs running.** GPSLogger run continuously (D-112) would reveal every street *walked*.
  Recommend: walks earn full Cartography and **50% Wayfaring**, as a distinct
  `activityType` multiplier in the ruleset — one more data row, no code. Flagged, not decided.
- **Neighbourhood completion** (§4.3) needs an OSM boundary source. Highest-value milestone
  type available; should get its own ticket early.
- Slayer's XP scale (§5.3) is unvalidatable until encounters exist. Expect a v2 rebalance.

---

## ADDENDUM — Round 4 user decisions (2026-08-30)

Confirmed after this document was written. **These override anything above that conflicts.**

- **XP curve `4L²` is CONFIRMED** (D-130). The recommendation in §2 stands unchanged.
- **Strength pacing left as-is** (D-131). 99 Might ≈ 27 years is accepted as honest. The §9
  proposals to rebalance strength rates or adopt per-skill curve constants are **declined**.
- **NEW ACTIVITY SKILL — GPS-less running** (D-132). Treadmill/indoor runs earn **full activity
  XP into a separate skill**, provisionally named **Vigil**, with **zero** discovery credit and
  no map reveal. This resolves the treadmill open question in `05-fog-of-war.md` §9.1.
  - Outdoor (Wayfaring) and indoor (Vigil) progress never dilute each other.
  - **This is the acceptance test for §1's skill-as-data schema.** Adding Vigil must be a data
    row. If it requires a code change, the schema in §1 is wrong and must be revised.
  - The name is provisional; the mechanic is not.
- **Gear grants no XP multipliers** (D-134). Combat power, lantern reveal radius and appearance
  only. Confirms the §6 recommendation.
- **Replay never lowers already-displayed XP** (D-135). Corrections may only add.
  Resolves `05-fog-of-war.md` §9.3.
- **Cold territory is shown in atlas mode only** (D-133). Resolves `05-fog-of-war.md` §9.7.
