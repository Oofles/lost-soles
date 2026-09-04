---
id: 63
slug: level-maths-and-total-level-693
title: Level maths — 4L^2, C(L), Total Level and the 693 ceiling (D-130, D-145)
type: feature
priority: high
status: open
size: m
capability: 09-xp-engine-and-ledger
depends_on: [62]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] `xpToAdvance(L) === 4 * L * L` and `cumulativeXp(L) === 2*(L-1)*L*(2*L-1)/3`, both
      returning integers for every `L` in `1..120`.
- [ ] `levelForXp(xp)` is the exact inverse of `cumulativeXp` at every boundary: `C(L)` yields
      `L`, `C(L) − 1` yields `L − 1`.
- [ ] The table anchors above reproduce exactly, `C(99) === 1274196` asserted by name.
- [ ] `levelForXp` clamps at `maxLevel` from the `RuleCurve` item; no `99` literal appears in
      the module.
- [ ] `TotalLevel = Σ level(skill)` and `TotalXP = Σ xp(skill)` iterate the **enabled registry**,
      so an untrained skill contributes its level 1 and a disabled skill contributes nothing.
- [ ] `totalLevelCeiling` is computed as `enabledSkillCount × maxLevel`; a test asserts it equals
      `Σ 99` over the enabled rows of `xp-rules-v1.yaml` and that the value is **693**.
- [ ] No literal `594` or `693` exists in `src/`; the test may name 693, the implementation
      may not.
- [ ] `04-game-design.md` §1.2 is corrected: the MVP ceiling reads **693 (7 skills × 99)**, the
      seven skills are named, and the note records that Slayer does not move it again (D-122).
- [ ] Adding an eighth enabled row to a fixture ruleset moves the computed ceiling to 792 with
      no source change.
- [ ] A property test asserts `levelForXp` is monotonic non-decreasing in `xp`.

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

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

On the **`/skills` panel header** on the **Pixel 8 Pro**, one thumb, screen at default
brightness: read the pinned **TOTAL LEVEL** figure and the `next:` milestone under it. Count the
tiles on screen (including the collapsed `Untrained` group) and check that Total Level is at
least that count — an untrained skill is level 1, so the floor equals the skill count. Then open
Wayfaring's detail sheet and confirm the `XP to next` figure equals `4L²` for the level shown:
at level 47 it must read 8,836, not a rounded or eyeballed number.
