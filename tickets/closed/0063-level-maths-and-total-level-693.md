---
id: 63
slug: level-maths-and-total-level-693
title: Level maths — 4L^2, C(L), Total Level and the 693 ceiling (D-130, D-145)
type: feature
priority: high
status: closed
size: m
capability: 09-xp-engine-and-ledger
depends_on: [62]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-29T02:46:31Z
closed: 2026-09-29T02:49:02Z
---

## Description

The pure arithmetic layer over `SkillState`. Two halves, one module, one test file.

**The curve (D-130).** XP to advance from level `L` to `L+1` is **`4L²`**. Cumulative XP to *be*
level `L` is **`C(L) = 2(L−1)L(2L−1)/3`**, always an integer. `maxLevel: 99`,
`deepMaxLevel: 120`. Anchors that must reproduce exactly:

| L | 10 | 25 | 50 | 75 | 90 | **99** | 120 |
|---|---|---|---|---|---|---|---|
| `C(L)` | 1,140 | 19,600 | 161,700 | 447,580 | 955,860 | **1,274,196** | 2,275,280 |

**Runescape's exponential curve was evaluated and rejected** (`04-game-design.md` §2.1). Fed
this user's real mileage at 100 XP/km it gives level 99 in **126 years**; its top-to-middle ratio
`C(99)/C(50)` is 128.6 against the 8–12 this app needs. `4L²` gives 7.88. Rescaling XP per km
cannot fix an exponential — the ratio is a property of the curve alone. **Do not reintroduce it.**
`stepFormula` lives in the `RuleCurve` item (T5, `SK = "__curve__"`), not per skill — D-131
explicitly declined per-skill curve constants.

**Total Level (D-033, D-145).** `TotalLevel = Σ level(skill)` over every skill in the ruleset,
including meta skills; `TotalXP = Σ xp(skill)`, displayed underneath, and it is the number that
goes up every single session without exception. Total Level is the headline number on the home
screen, and it moves ~6× faster than any one skill — which is what keeps mid-game weeks from
feeling empty.

**D-145 — the ceiling is 693, not 594.** Adding Vigil as a fifth activity skill moved it. The
MVP skill set is Wayfaring, Vigil, Might, Fortitude, Endurance, Cartography, Constitution —
**seven**. `04-game-design.md` §1.2 still reads *"MVP ceiling: 6 skills × 99 = 594"* and is
**wrong**; it must be corrected. Slayer is OUT of MVP (D-122) and adding it later does not move
the ceiling again, because 693 already counts seven skills.

The ceiling must be **computed** as `enabledSkillCount × maxLevel`, never written as a literal,
so the next skill row cannot desynchronise it.

## Acceptance criteria

- [x] `xpToAdvance(L) === 4 * L * L` and `cumulativeXp(L) === 2*(L-1)*L*(2*L-1)/3`, both
      returning integers for every `L` in `1..120`.
- [x] `levelForXp(xp)` is the exact inverse of `cumulativeXp` at every boundary: `C(L)` yields
      `L`, `C(L) − 1` yields `L − 1`.
- [x] The table anchors above reproduce exactly, `C(99) === 1274196` asserted by name.
      *Amended at close:* the table above labels 447,580 as `L = 75`. That figure is **C(70)**;
      C(75) is 551,300. `04-game-design.md` §2.1 has it right and the ticket miscopied the
      column. The test asserts every column of the §2.1 table, plus C(75) = 551,300.
- [x] `levelForXp` clamps at `maxLevel` from the `RuleCurve` item; no `99` literal appears in
      the module.
- [x] `TotalLevel = Σ level(skill)` and `TotalXP = Σ xp(skill)` iterate the **enabled registry**,
      so an untrained skill contributes its level 1 and a disabled skill contributes nothing.
- [x] ~~`totalLevelCeiling` is computed as `enabledSkillCount × maxLevel`; a test asserts it equals
      `Σ 99` over the enabled rows of `xp-rules-v1.yaml` and that the value is **693**.~~
      *Amended per D-192:* the test recomputes `Σ maxLevel` over the enabled rows of
      `xp-rules-v1.yaml` and asserts the ceiling equals it. It names **no figure**, because a
      figure goes stale the moment a row is added. That is 891 at `v1`, which has 9 enabled rows.
- [x] ~~No literal `594` or `693` exists in `src/`~~ *Amended per D-192:* no past or present
      ceiling figure (6–9 × `maxLevel`, so 594/693/792/891) appears as a number literal in
      non-test `src/`, and no `maxLevel`/`deepMaxLevel` literal appears in `levels.ts`. Both
      are asserted by a source scan.
- [x] ~~`04-game-design.md` §1.2 is corrected: the MVP ceiling reads **693 (7 skills × 99)**~~
      Already done by `0031` (D-192): §1.2 states the arithmetic, `enabledRows × maxLevel`, and
      shows 891 at `v1` as an example. No edit needed.
- [x] ~~Adding an eighth enabled row to a fixture ruleset moves the computed ceiling to 792~~
      *Amended per D-192:* adding an enabled row to the real ruleset raises the ceiling by exactly
      `maxLevel`, and adding a disabled row leaves it unchanged. No source change is needed.
- [x] A property test asserts `levelForXp` is monotonic non-decreasing in `xp`.

## Notes

The step cost is worth surfacing in the UI verbatim — *"this level costs 4L² — 32,400 XP at
level 90"* — because a legible rule is the opposite of a slot machine.

The doc fix overlaps `04-domain-contract-and-rules`' own doc-amendment ticket. Whoever lands
first wins; the criterion above stays checkable either way. If §1.2 already reads 693 when this
is picked up, tick the box and note it.

`levelHighWater` is **not** computed here — it is a ratchet applied at write time and owned by
0066. This module is pure: no I/O, no clock, no registry singleton.

**2026-09-04 (ticket `0031`, D-192) — this ticket's TITLE says "the 693 ceiling" and 693 is wrong.**
The title is left alone deliberately: it feeds `index.json` and `docs/BUILD-ORDER.md`, and
renaming it would be churn that fixes nothing. Read it as "the Total Level ceiling".

**There is no correct number to substitute.** 594 → 693 → 792 → 891, falsified three times by
changes that were each supposed to be data-only, which is why `04-game-design.md` §1.2 now states
the arithmetic instead: `enabledSkillCount × maxLevel`, 9 × 99 = 891 at `v1`. **Compute it from
`rules/xp-rules-v1.yaml`; do not hardcode a figure, including in a test fixture** — a test
asserting `ceiling === 891` is the same defect one layer down, and it will pass right up until
someone adds a row, which is the moment it was supposed to help.

`09-roadmap.md` §5.1 records the prose half as done and this ticket as the code half.

## Resolution

**Built.** A pure level-maths module, re-exported from `@/src/scoring`.

**Files added**
- `src/scoring/levels.ts`:
  - `xpToAdvance` (4L²) and `cumulativeXp` (C(L)).
  - `levelForXp`:
    - estimates the level from `cbrt(3xp/4)`;
    - corrects it in integers against `C`, so boundaries never depend on float rounding;
    - clamps at the `maxLevel` passed in.
  - `totalLevel`, `totalXp` and `totalLevelCeiling`:
    - take a `ReadonlyMap<skillId, xp>`, which is the shape `xpBySkill` from 0062 already returns;
    - take the skill rows, and filter on `enabled`.
  - No I/O, no clock, no registry singleton; the curve and the rows are always arguments.
- `src/scoring/levels.test.ts` (15 tests):
  - integrality and step checks for L = 1..120;
  - the full §2.1 anchor table;
  - C(99) asserted by name, and the 7.88 ratio;
  - the boundary inverse at every L;
  - clamping;
  - a seeded (63) monotonicity property test over 5,000 pairs;
  - Total Level and Total XP over trained, untrained, disabled and meta rows;
  - the ceiling recomputed from the YAML;
  - the add-a-row fixture;
  - two source scans for literals.

**Files changed**
- `src/scoring/index.ts`: the re-exports.

**What went wrong / findings**
- **The ticket's anchor table was mislabelled.** It gave 447,580 as C(75), but that is C(70). The
  first test run caught it. The design doc was correct, so the fault was in the ticket, not the
  design, and no decision was needed.
- **Four criteria still assumed 693 or 792.** They predate D-192; the ticket's own 2026-09-04
  note says so. They are amended above with strikethrough rather than ticked as written. The
  ceiling test asserts the arithmetic, not a figure.
- **The literal scan matches whole numbers only.** A plain grep for `594` hits the Strava fixture
  id `18736594040123457`. That is a false positive the scan must not trip on, because a scan that
  trips on it gets deleted.

**Decisions:** none new. `levelForXp` clamps at `maxLevel`, as the criterion says. The deep
levels up to `deepMaxLevel` (§2.5) belong to whichever ticket builds them; they can use the
same function with an uncapped curve, which the tests already exercise.

`levelHighWater` and the `SkillState.level` write are still `0219`'s, and this module is what
it will call.

## Operator validation

**Nothing for the operator to check.** The `/skills` panel the original text describes does not
exist yet; Total Level and `XP to next` get a screen when the UI capability does.

**Smoke test (agent, 2026-09-28):**
- **Live tables:** scanned the live `SkillState-nog4xy2l7baqlhghpndh2565qe-NONE` and
  `XpLedgerEntry-…` tables with the `devault` profile. Both are empty (Count 0): nothing has been
  scored in production yet, so there is no real XP to feed through.
- **Real ruleset:** ran the module on the real `rules/xp-rules-v1.yaml` with a synthetic XP map.
  - **Wayfaring:** C(47) + 1,234 XP gives level 47, with `xpToAdvance(47)` = **8,836**, the
    figure the original validation text asks for.
  - **Cartography:** 5,000 XP gives level 16, since C(16) = 4,960 and C(17) = 5,984.
  - **Slayer:** 999,999 XP is ignored, because its row is disabled.
  - **Totals:** Total Level = 47 + 16 + 7 untrained × 1 = **70**, which matches the hand
    calculation. Total XP = 140,278.
  - **Untrained:** an empty map gives Total Level 9, one per enabled row.
  - **Ceiling:** 9 enabled rows × 99 = 891.
- **Suite:** full run is 2,299 passed, 1 skipped. `tsc --noEmit` is clean and `eslint
  --max-warnings 0` is clean.
